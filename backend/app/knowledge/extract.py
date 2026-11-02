"""
Any source → markdown, with page markers.

    PDF, images, DOCX, PPTX   Mistral OCR (Document AI); pypdf / python-docx if OCR fails
    URL                       fetched; HTML reduced to text, a PDF link sent to OCR by URL
    text, md, json, yaml, csv decoded as-is

Page markers (``<!-- page N -->``) survive into distillation, so every item can
cite the page it came from.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import mimetypes
from typing import Any, Optional

logger = logging.getLogger(__name__)

TEXT_TYPES = {".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".htm", ".xml"}
OCR_TYPES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".docx", ".pptx", ".doc", ".ppt"}
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


class ExtractionError(ValueError):
    """The source could not be turned into text."""


def _ext(filename: str) -> str:
    name = (filename or "").lower()
    return name[name.rfind("."):] if "." in name else ""


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _html_text(html: str) -> str:
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
            tag.decompose()
        lines = [line.strip() for line in soup.get_text("\n").splitlines()]
        return "\n".join(line for line in lines if line)
    except Exception:
        return html


def _pages_markdown(response: Any) -> str:
    pages = getattr(response, "pages", None) or []
    parts = []
    for i, page in enumerate(pages):
        index = getattr(page, "index", i)
        parts.append(f"<!-- page {int(index) + 1} -->\n{getattr(page, 'markdown', '') or ''}")
    return "\n\n".join(parts).strip()


async def _ocr(client: Any, document: dict) -> str:
    from app.config import settings

    response = await asyncio.to_thread(
        client.ocr.process, model=settings.KNOWLEDGE_OCR_MODEL, document=document, table_format="markdown")
    return _pages_markdown(response)


def _local_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(f"<!-- page {i} -->\n{(page.extract_text() or '').strip()}"
                       for i, page in enumerate(reader.pages, 1)).strip()


def _local_docx(data: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(data))
    lines = []
    for para in document.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style = (para.style.name or "").lower() if para.style is not None else ""
        if style.startswith("heading"):
            level = "".join(ch for ch in style if ch.isdigit()) or "2"
            lines.append("#" * min(int(level), 6) + " " + text)
        else:
            lines.append(text)
    for table in document.tables:
        for row in table.rows:
            lines.append("| " + " | ".join(cell.text.strip() for cell in row.cells) + " |")
    return "\n".join(lines)


async def from_bytes(client: Any, data: bytes, filename: str, content_type: str = "") -> tuple[str, str]:
    """Extract text from an uploaded file. Returns ``(markdown, method)``."""
    ext = _ext(filename)
    if ext in TEXT_TYPES or (content_type or "").startswith("text/"):
        text = _decode(data)
        if ext in (".html", ".htm"):
            return _html_text(text), "html"
        if ext == ".json":
            try:
                return json.dumps(json.loads(text), indent=2, ensure_ascii=False), "json"
            except Exception:
                pass
        return text, "text"
    if ext not in OCR_TYPES:
        raise ExtractionError(f"Unsupported file type '{ext or content_type}'.")

    mime = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    data_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    document = ({"type": "image_url", "image_url": data_url} if ext in IMAGE_TYPES
                else {"type": "document_url", "document_url": data_url, "document_name": filename})
    error: Optional[Exception] = None
    if client is not None:
        try:
            text = await _ocr(client, document)
            if text.strip():
                return text, "mistral_ocr"
        except Exception as e:
            error = e
            logger.info("OCR failed for %s (%s) — trying a local parser", filename, e)
    try:
        if ext == ".pdf":
            return _local_pdf(data), "pypdf"
        if ext == ".docx":
            return _local_docx(data), "python-docx"
    except Exception as e:
        error = e
    raise ExtractionError(f"Could not read '{filename}'" + (f": {error}" if error else "."))


async def from_url(client: Any, url: str) -> tuple[str, str, str]:
    """Fetch and extract a URL. Returns ``(markdown, method, title)``."""
    import httpx

    if not url.lower().startswith(("http://", "https://")):
        raise ExtractionError("Only http(s) URLs can be fetched.")
    if client is not None and url.lower().split("?")[0].endswith(".pdf"):
        try:
            text = await _ocr(client, {"type": "document_url", "document_url": url})
            if text.strip():
                return text, "mistral_ocr", url.rsplit("/", 1)[-1]
        except Exception as e:
            logger.info("OCR by URL failed for %s (%s) — downloading instead", url, e)
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        response = await http.get(url, headers={"User-Agent": "Mozilla/5.0 (knowledge ingestion)"})
        response.raise_for_status()
    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    if content_type == "application/pdf":
        text, method = await from_bytes(client, response.content, url.rsplit("/", 1)[-1] or "page.pdf",
                                        content_type)
        return text, method, url.rsplit("/", 1)[-1]
    html = _decode(response.content)
    title = ""
    try:
        from bs4 import BeautifulSoup

        tag = BeautifulSoup(html, "html.parser").find("title")
        title = tag.get_text(strip=True) if tag else ""
    except Exception:
        pass
    return (_html_text(html) if "html" in content_type else html), "web", title or url
