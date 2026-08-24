"""
Library Service — Mistral Libraries API wrapper.
Manages document libraries for the document_library built-in tool.
Uses direct HTTP calls to the Mistral API for reliability.
"""

import logging
from typing import Optional
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.mistral.ai"
_HEADERS = {
    "Authorization": f"Bearer {settings.MISTRAL_API_KEY}",
}


def _http_client() -> httpx.Client:
    """Create a fresh HTTP client with auth headers."""
    return httpx.Client(
        base_url=_BASE_URL,
        headers=_HEADERS,
        timeout=60.0,
    )


async def list_libraries() -> list[dict]:
    """List all user libraries."""
    try:
        with _http_client() as client:
            resp = client.get("/v1/libraries")
            resp.raise_for_status()
            data = resp.json()
            # API may return array directly or wrapped in { data: [...] }
            libraries = data if isinstance(data, list) else data.get("data", data)
            return [
                {
                    "id": lib.get("id"),
                    "name": lib.get("name"),
                    "description": lib.get("description", ""),
                    "document_count": lib.get("document_count", 0),
                    "created_at": str(lib.get("created_at", "")),
                }
                for lib in libraries
                if isinstance(lib, dict)
            ]
    except httpx.HTTPStatusError as e:
        logger.error("Failed to list libraries: %s", e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to list libraries: %s", e)
        raise


async def create_library(name: str, description: str = "") -> dict:
    """Create a new library."""
    try:
        with _http_client() as client:
            body = {"name": name}
            if description:
                body["description"] = description
            resp = client.post(
                "/v1/libraries",
                json=body,
                headers={**_HEADERS, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            lib = resp.json()
            return {
                "id": lib.get("id"),
                "name": lib.get("name"),
                "description": lib.get("description", ""),
            }
    except httpx.HTTPStatusError as e:
        logger.error("Failed to create library: %s", e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to create library: %s", e)
        raise


def _purge_local_graph(library_id: str) -> dict:
    """Remove everything graph RAG derived from a library that no longer exists.

    Deleting a library upstream leaves two things behind here: the knowledge
    graph built from its documents, and the local rows tracking them. Neither
    has any meaning once the documents are gone — worse, the entities stay
    reachable to an unscoped graph lookup, so an agent could cite a document
    nobody can open.

    Best-effort: the library is already deleted by the time this runs, and
    failing to tidy up must not turn a successful delete into an error.
    """
    summary: dict = {}
    try:
        from app.rag import graph_store, store as rag_store

        summary["graph"] = graph_store.delete_library_graph(library_id)
        removed = 0
        for document in rag_store.list_documents(library_id):
            rag_store.delete_document(document["id"])
            removed += 1
        summary["documents_forgotten"] = removed
    except Exception as e:
        logger.warning("Could not purge graph data for library %s: %s", library_id, e)
        summary["error"] = str(e)[:200]
    return summary


async def delete_library(library_id: str) -> dict:
    """Delete a library, and everything graph RAG derived from it."""
    try:
        with _http_client() as client:
            resp = client.delete(f"/v1/libraries/{library_id}")
            resp.raise_for_status()
            return {
                "deleted": True,
                "library_id": library_id,
                "rag": _purge_local_graph(library_id),
            }
    except httpx.HTTPStatusError as e:
        logger.error("Failed to delete library: %s", e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to delete library: %s", e)
        raise


async def list_documents(library_id: str) -> list[dict]:
    """List all documents in a library."""
    try:
        with _http_client() as client:
            resp = client.get(f"/v1/libraries/{library_id}/documents")
            resp.raise_for_status()
            data = resp.json()
            documents = data if isinstance(data, list) else data.get("data", data)
            return [
                {
                    "id": doc.get("id"),
                    "filename": doc.get("filename", doc.get("name", "Unknown")),
                    "size": doc.get("size", doc.get("bytes", 0)),
                    "created_at": str(doc.get("created_at", "")),
                    "mime_type": doc.get("mime_type", ""),
                }
                for doc in documents
                if isinstance(doc, dict)
            ]
    except httpx.HTTPStatusError as e:
        logger.error("Failed to list documents for library %s: %s", library_id, e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to list documents for library %s: %s", library_id, e)
        raise


async def upload_document(library_id: str, filename: str, file_content: bytes, content_type: str = "application/octet-stream") -> dict:
    """Upload a document directly to a library.
    
    Per the OpenAPI spec, POST /v1/libraries/{library_id}/documents
    accepts multipart/form-data with a 'file' field directly — no
    intermediate Files API step needed.
    """
    try:
        with _http_client() as client:
            resp = client.post(
                f"/v1/libraries/{library_id}/documents",
                files={"file": (filename, file_content, content_type)},
            )
            resp.raise_for_status()
            doc = resp.json()
            logger.info("Uploaded document %s to library %s (id: %s)", filename, library_id, doc.get("id"))
            return {
                "id": doc.get("id"),
                "filename": doc.get("filename", doc.get("name", filename)),
                "library_id": library_id,
            }
    except httpx.HTTPStatusError as e:
        logger.error("Failed to upload document to library %s: %s", library_id, e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to upload document to library %s: %s", library_id, e)
        raise


async def delete_document(library_id: str, document_id: str) -> dict:
    """Remove a document from a library."""
    try:
        with _http_client() as client:
            resp = client.delete(f"/v1/libraries/{library_id}/documents/{document_id}")
            resp.raise_for_status()
            return {"deleted": True, "document_id": document_id, "library_id": library_id}
    except httpx.HTTPStatusError as e:
        logger.error("Failed to delete document %s from library %s: %s", document_id, library_id, e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to delete document %s from library %s: %s", document_id, library_id, e)
        raise


async def update_library(library_id: str, name: Optional[str] = None, description: Optional[str] = None) -> dict:
    """Update a library's name and/or description."""
    try:
        with _http_client() as client:
            body: dict = {}
            if name is not None:
                body["name"] = name
            if description is not None:
                body["description"] = description
            resp = client.put(
                f"/v1/libraries/{library_id}",
                json=body,
                headers={**_HEADERS, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            lib = resp.json()
            return {
                "id": lib.get("id"),
                "name": lib.get("name"),
                "description": lib.get("description", ""),
            }
    except httpx.HTTPStatusError as e:
        logger.error("Failed to update library %s: %s", library_id, e.response.text)
        raise
    except Exception as e:
        logger.error("Failed to update library %s: %s", library_id, e)
        raise


async def upload_webpage(library_id: str, page_url: str) -> dict:
    """Fetch a webpage and upload its HTML content as a document to the library."""
    try:
        # Fetch the webpage
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as web_client:
            web_resp = await web_client.get(page_url)
            web_resp.raise_for_status()
            html_content = web_resp.content
            content_type = web_resp.headers.get("content-type", "text/html")

        # Derive a filename from the URL
        from urllib.parse import urlparse
        parsed = urlparse(page_url)
        slug = parsed.netloc + parsed.path.rstrip("/")
        slug = slug.replace("/", "_").replace(".", "_")[:80]
        filename = f"{slug}.html"

        # Upload to the library
        with _http_client() as client:
            resp = client.post(
                f"/v1/libraries/{library_id}/documents",
                files={"file": (filename, html_content, content_type.split(";")[0].strip())},
            )
            resp.raise_for_status()
            doc = resp.json()
            logger.info("Uploaded webpage %s to library %s (id: %s)", page_url, library_id, doc.get("id"))
            return {
                "id": doc.get("id"),
                "filename": doc.get("filename", doc.get("name", filename)),
                "library_id": library_id,
                "source_url": page_url,
            }
    except httpx.HTTPStatusError as e:
        error_text = e.response.text if hasattr(e, 'response') else str(e)
        logger.error("Failed to upload webpage to library %s: %s", library_id, error_text)
        raise
    except Exception as e:
        logger.error("Failed to upload webpage to library %s: %s", library_id, e)
        raise

