"""
Files people hand to a model — images, audio, documents, text files — and the
content each model and each Mistral API accepts for them.

Measured on 2026-11-17 against every chat model on the account:

* **Documents** (PDF, Word, PowerPoint, Excel) as ``document_url``: every chat
  model, on the chat, agents and Conversations APIs — Mistral reads them.
* **Images** as ``image_url``: exactly the models whose catalog entry has
  ``vision``; any other model refuses with "Image input is not enabled".
* **Audio** as ``input_audio``: only Voxtral (the catalog's ``audio`` models)
  actually listens. Most other models accept the chunk, but Mistral hands them
  only its transcript — a recording without speech (footsteps, music) reached
  them as nothing at all, and they answered "I don't see any audio file". So
  for every other model the audio goes as its transcript, made here, and when
  there is no speech, as Voxtral's description of what it sounds like. The
  Conversations API (agent chat) takes no audio at all.
* **Text files** (txt, md, csv, json, yaml, html, xml): placed in the message.

So the content is built per model and per API, and nothing is ever refused
outright: a model that cannot take an image gets the image's text (Mistral
OCR), audio it cannot take arrives as its transcript (Voxtral), and a model
that turns out to refuse a kind at run time is remembered and the call is
made again with that kind converted.

An attachment travels as ``{"type": "attachment", "upload_id": ...}`` and is
resolved here from the upload store, so conversations stored in the browser
and workflow run inputs carry a reference, never the file.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime
from functools import partial
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

IMAGE, AUDIO, DOCUMENT, TEXT = "image", "audio", "document", "text"
KINDS = (IMAGE, AUDIO, DOCUMENT, TEXT)

#: Extension → (kind, mime). Extensions decide; a browser's MIME type is often empty.
FILE_TYPES: dict[str, tuple[str, str]] = {
    ".png": (IMAGE, "image/png"), ".jpg": (IMAGE, "image/jpeg"), ".jpeg": (IMAGE, "image/jpeg"),
    ".webp": (IMAGE, "image/webp"), ".gif": (IMAGE, "image/gif"),
    ".mp3": (AUDIO, "audio/mpeg"), ".wav": (AUDIO, "audio/wav"), ".m4a": (AUDIO, "audio/mp4"),
    ".ogg": (AUDIO, "audio/ogg"), ".flac": (AUDIO, "audio/flac"), ".webm": (AUDIO, "audio/webm"),
    ".aac": (AUDIO, "audio/aac"),
    ".pdf": (DOCUMENT, "application/pdf"),
    ".docx": (DOCUMENT, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ".pptx": (DOCUMENT, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ".xlsx": (DOCUMENT, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ".txt": (TEXT, "text/plain"), ".md": (TEXT, "text/markdown"), ".csv": (TEXT, "text/csv"),
    ".json": (TEXT, "application/json"), ".yaml": (TEXT, "application/yaml"),
    ".yml": (TEXT, "application/yaml"), ".html": (TEXT, "text/html"), ".xml": (TEXT, "application/xml"),
    ".log": (TEXT, "text/plain"),
}
_MIME_KIND = {mime: kind for kind, mime in FILE_TYPES.values()}

#: Most characters of a text file placed into one message.
MAX_TEXT_CHARS = 100_000
OCR_MODEL = "mistral-ocr-latest"
TRANSCRIBE_MODEL = "voxtral-mini-latest"
#: Listens to a recording without speech and says what it sounds like.
LISTEN_MODEL = "voxtral-small-latest"

_ID = re.compile(r"^[0-9]{8}_[0-9]{6}_[0-9a-f]{8}\.[a-z0-9]{2,5}$")


class AttachmentError(Exception):
    """A file a person can act on: wrong type, too large, empty, unknown."""


# ── Kinds and the upload store ─────────────────────────────────────────────


def kind_of(filename: str, mime: Optional[str] = None) -> Optional[str]:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in FILE_TYPES:
        return FILE_TYPES[ext][0]
    mime = (mime or "").split(";")[0].strip().lower()
    if mime in _MIME_KIND:
        return _MIME_KIND[mime]
    for prefix, kind in (("image/", IMAGE), ("audio/", AUDIO), ("text/", TEXT)):
        if mime.startswith(prefix):
            return kind
    return None


def mime_of(filename: str, mime: Optional[str] = None) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in FILE_TYPES:
        return FILE_TYPES[ext][1]
    return (mime or "").split(";")[0].strip().lower() or mimetypes.guess_type(filename)[0] or \
        "application/octet-stream"


def accepted_extensions(kinds: Iterable[str] = KINDS) -> list[str]:
    wanted = set(kinds)
    return [ext for ext, (kind, _) in FILE_TYPES.items() if kind in wanted]


def save(filename: str, content: bytes, mime: Optional[str] = None, *, max_mb: float = 20) -> dict:
    """Store an upload; returns what a client keeps to refer to it."""
    filename = os.path.basename(filename or "file") or "file"
    kind = kind_of(filename, mime)
    if kind is None:
        raise AttachmentError(
            f"'{filename}' is not a supported file. Attach an image, audio, a PDF or Office "
            "document, or a text file.")
    if not content:
        raise AttachmentError(f"'{filename}' is empty.")
    if len(content) > max_mb * 1024 * 1024:
        raise AttachmentError(f"'{filename}' is {len(content) / 1048576:.1f} MB; the limit is {max_mb:g} MB.")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in FILE_TYPES:
        ext = mimetypes.guess_extension(mime_of(filename, mime)) or ".bin"
    upload_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    with open(os.path.join(UPLOAD_DIR, upload_id), "wb") as f:
        f.write(content)
    return {"upload_id": upload_id, "filename": filename, "kind": kind,
            "mime": mime_of(filename, mime), "size": len(content), "url": f"/uploads/{upload_id}"}


def load(upload_id: str) -> bytes:
    """The bytes of an upload. Ids are checked, so a path can never be smuggled in."""
    if not _ID.match(str(upload_id or "")):
        raise AttachmentError("Unknown attachment.")
    path = os.path.join(UPLOAD_DIR, upload_id)
    if not os.path.isfile(path):
        raise AttachmentError("The attachment is no longer available — attach it again.")
    with open(path, "rb") as f:
        return f.read()


def exists(upload_id: str) -> bool:
    return bool(_ID.match(str(upload_id or ""))) and os.path.isfile(os.path.join(UPLOAD_DIR, upload_id))


# ── What a model takes ─────────────────────────────────────────────────────

#: Kinds a model was seen to refuse at run time ("X input is not enabled for this model").
_REFUSED: dict[str, set[str]] = {}
_lock = threading.Lock()


def _card(model: str) -> Optional[dict]:
    try:
        from app.app_settings import catalog

        return catalog.index().get(model)
    except Exception:  # noqa: BLE001 — unknown, not an error
        return None


def support(model: Optional[str], api: str = "chat") -> dict[str, str]:
    """How each kind reaches ``model``: "native", or "text" (converted before sending).

    ``api``: "chat" and "agents" (completions), or "conversations" (agent chat).
    """
    caps = ((_card(model or "") or {}).get("capabilities") or {}) if model else {}
    with _lock:
        refused = set(_REFUSED.get(model or "", set()))
    known = bool(caps)
    image = "native" if (caps.get("vision") or not known) and IMAGE not in refused else "text"
    # Only a model that listens gets the recording; the rest get its words.
    audio = "native" if caps.get("audio") and api != "conversations" and AUDIO not in refused else "text"
    return {IMAGE: image, AUDIO: audio, DOCUMENT: "native" if DOCUMENT not in refused else "text",
            TEXT: "native"}


def refused_kinds(exc: BaseException) -> set[str]:
    """The kinds a model refused, read from the error; empty for any other failure."""
    text = str(exc).lower()
    found = set()
    for kind, word in ((IMAGE, "image"), (AUDIO, "audio"), (DOCUMENT, "document")):
        if re.search(rf"{word} (input|inputs|content)? ?(is|are) not (enabled|supported)", text):
            found.add(kind)
    return found


def remember_refusal(model: Optional[str], kinds: set[str]) -> None:
    if model and kinds:
        with _lock:
            _REFUSED.setdefault(model, set()).update(kinds)
        logger.info("Model %s does not take %s input — sending it as text from now on",
                    model, ", ".join(sorted(kinds)))


# ── Conversions (cached per upload) ────────────────────────────────────────

_converted: dict[str, str] = {}


async def _ocr(client, upload_id: str, mime: str, kind: str) -> str:
    key = f"ocr:{upload_id}"
    if key in _converted:
        return _converted[key]
    data_uri = f"data:{mime};base64,{base64.b64encode(load(upload_id)).decode()}"
    document = ({"type": "image_url", "image_url": data_uri} if kind == IMAGE
                else {"type": "document_url", "document_url": data_uri})
    result = await asyncio.to_thread(partial(client.ocr.process, model=OCR_MODEL, document=document))
    text = "\n\n".join(str(getattr(p, "markdown", "") or "") for p in getattr(result, "pages", None) or [])
    _converted[key] = text.strip()
    return _converted[key]


async def _transcribe(client, upload_id: str, filename: str) -> str:
    key = f"asr:{upload_id}"
    if key in _converted:
        return _converted[key]
    result = await asyncio.to_thread(partial(
        client.audio.transcriptions.complete, model=TRANSCRIBE_MODEL,
        file={"file_name": filename or upload_id, "content": load(upload_id)}))
    _converted[key] = str(getattr(result, "text", "") or "").strip()
    return _converted[key]


async def _listen(client, upload_id: str) -> str:
    """What a recording sounds like, from a model that listens (for audio without speech)."""
    key = f"listen:{upload_id}"
    if key in _converted:
        return _converted[key]
    b64 = base64.b64encode(load(upload_id)).decode()
    # Asked to name only what is heard: asked for "the setting", it described a
    # recording of footsteps on gravel as "a bustling city street".
    result = await asyncio.to_thread(partial(
        client.chat.complete, model=LISTEN_MODEL, max_tokens=300, temperature=0.0, messages=[{
            "role": "user", "content": [
                {"type": "text", "text": "Listen to this recording and describe only what you actually "
                                          "hear — the kinds of sound (footsteps, vehicles, voices, music, "
                                          "animals, machines), how they change over time, and whether "
                                          "anyone speaks. Do not guess a setting you cannot hear. Two or "
                                          "three plain sentences."},
                {"type": "input_audio", "input_audio": b64}]}]))
    content = result.choices[0].message.content
    text = content if isinstance(content, str) else "".join(
        getattr(c, "text", "") or "" for c in content or [] if getattr(c, "type", "") != "thinking")
    _converted[key] = text.strip()
    return _converted[key]


#: How a converted file is introduced: the model must know a file *was*
#: attached and was processed for it — handed bare text, Mistral Large answered
#: "no attachment came through, I only see the text you pasted".
_INTRO = ("[Attached {what}: \"{name}\". {why}]\n{result}\n[End of \"{name}\". This is the content of the "
          "attached file — use it to answer; do not say that no file was attached.]")


async def audio_as_text(client, upload_id: str, filename: str) -> str:
    """A recording for a model that cannot listen: its transcript, or, without speech, what it sounds like."""
    transcript = await _transcribe(client, upload_id, filename)
    why = "You cannot listen to audio, so it was processed for you before this message."
    if transcript:
        return _INTRO.format(what="audio file", name=filename, why=why, sense="heard",
                             result=f"Transcript of the recording (speech-to-text):\n\"{transcript}\"")
    try:
        heard = await _listen(client, upload_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not describe recording %s: %s", upload_id, e)
        heard = ""
    result = "Speech-to-text found no speech in it, so there is nothing to transcribe." + (
        f" A model that listens to audio describes it as: \"{heard}\"" if heard else "")
    return _INTRO.format(what="audio file", name=filename, why=why, sense="heard", result=result)


async def audio_note(client, upload_id: str, filename: str) -> str:
    """The label sent with a recording to a model that listens — saying so when there is no speech.

    Asked for a transcript of a recording without speech, Voxtral answered "I'm
    unable to access or process audio files"; told there is none, it describes
    what it hears instead.
    """
    try:
        transcript = await _transcribe(client, upload_id, filename)
    except Exception:  # noqa: BLE001 — the label is a help, never a blocker
        return f"[Attached audio file: \"{filename}\"]"
    if transcript:
        return f"[Attached audio file: \"{filename}\"]"
    return (f"[Attached audio file: \"{filename}\". A speech-to-text pass found no speech in it. "
            "If asked for a transcript, say there is no speech and describe what you hear instead.]")


def _text_file(upload_id: str, filename: str) -> str:
    raw = load(upload_id)
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + f"\n[… '{filename}' truncated after {MAX_TEXT_CHARS:,} characters]"
    return text


# ── Building the content ───────────────────────────────────────────────────


def is_attachment(chunk: Any) -> bool:
    return isinstance(chunk, dict) and chunk.get("type") == "attachment" and bool(chunk.get("upload_id"))


async def chunks_for(client, attachment: dict, model: Optional[str], api: str = "chat",
                     force_text: Iterable[str] = ()) -> list[dict]:
    """The content chunks one attachment becomes for ``model`` on ``api``."""
    upload_id = str(attachment.get("upload_id"))
    filename = str(attachment.get("filename") or upload_id)
    kind = attachment.get("kind") or kind_of(filename, attachment.get("mime"))
    mime = mime_of(filename, attachment.get("mime"))
    how = support(model, api)
    if kind in set(force_text):
        how = {**how, kind: "text"}
    try:
        if kind == TEXT:
            return [{"type": "text", "text": f"[Attached file: \"{filename}\"]\n{_text_file(upload_id, filename)}"}]
        b64 = base64.b64encode(load(upload_id)).decode()
        if kind == IMAGE and how[IMAGE] == "native":
            return [{"type": "image_url", "image_url": f"data:{mime};base64,{b64}"}]
        if kind == AUDIO and how[AUDIO] == "native":
            # Named, so the model knows a recording is attached and what it is called.
            return [{"type": "text", "text": await audio_note(client, upload_id, filename)},
                    {"type": "input_audio", "input_audio": b64}]
        if kind == DOCUMENT and how[DOCUMENT] == "native":
            return [{"type": "document_url", "document_url": f"data:{mime};base64,{b64}",
                     "document_name": filename}]
        if kind == AUDIO:
            return [{"type": "text", "text": await audio_as_text(client, upload_id, filename)}]
        if kind in (IMAGE, DOCUMENT):
            text = await _ocr(client, upload_id, mime, kind)
            if kind == IMAGE:
                why = "You cannot see images, so the text in it was read for you (OCR) before this message."
                result = (f"Text found in the image:\n{text}" if text
                          else "No text was found in it; what it shows cannot be described to you.")
                return [{"type": "text", "text": _INTRO.format(
                    what="image", name=filename, why=why, result=result, sense="seen")}]
            return [{"type": "text", "text": _INTRO.format(
                what="document", name=filename, why="Its text was read for you before this message.",
                result=f"Text of the document:\n{text or '(no text found)'}", sense="read")}]
    except AttachmentError as e:
        return [{"type": "text", "text": f"[{filename}: {e}]"}]
    except Exception as e:  # noqa: BLE001 — a failed conversion is said, not raised
        logger.warning("Attachment %s could not be prepared for %s: %s", upload_id, model, e)
        return [{"type": "text", "text": f"[{filename} could not be read: {str(e)[:200]}]"}]
    return [{"type": "text", "text": f"[{filename}: unsupported file]"}]


async def resolve_content(client, content: Any, model: Optional[str], api: str = "chat",
                          force_text: Iterable[str] = ()) -> Any:
    """A message's content with every attachment reference replaced by real chunks.

    Older stored content (``image_url`` chunks) passes through; an ``image_url``
    for a model that cannot see is turned into its text when it is a data URI.
    """
    if not isinstance(content, list):
        return content
    force = set(force_text)
    out: list = []
    for chunk in content:
        if is_attachment(chunk):
            out.extend(await chunks_for(client, chunk, model, api, force))
            continue
        if isinstance(chunk, dict) and chunk.get("type") == "image_url" and \
                (IMAGE in force or support(model, api)[IMAGE] == "text"):
            out.append({"type": "text", "text": "[An image was attached; this model cannot see images.]"})
            continue
        out.append(chunk)
    texts = [c for c in out if isinstance(c, dict) and c.get("type") == "text"]
    if out and len(texts) == len(out):
        return "\n\n".join(c["text"] for c in texts)  # plain text: every model takes a string
    return out


async def resolve_messages(client, messages: list[dict], model: Optional[str], api: str = "chat",
                           force_text: Iterable[str] = ()) -> list[dict]:
    resolved = []
    for m in messages:
        if isinstance(m.get("content"), list):
            m = {**m, "content": await resolve_content(client, m["content"], model, api, force_text)}
        resolved.append(m)
    return resolved


def has_attachments(messages: Iterable[dict]) -> bool:
    return any(isinstance(m.get("content"), list) and any(
        is_attachment(c) or (isinstance(c, dict) and c.get("type") in ("image_url", "input_audio", "document_url"))
        for c in m["content"]) for m in messages or [])


def describe_support(model: Optional[str], api: str = "chat") -> dict:
    """For a client: per kind, whether it is sent as-is or converted, and the extensions."""
    how = support(model, api)
    return {kind: {"mode": how[kind], "extensions": accepted_extensions([kind])} for kind in KINDS}
