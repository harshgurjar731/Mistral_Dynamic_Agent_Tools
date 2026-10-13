"""
Document inputs — the documents a user hands over when starting a run.

Each document input of a workflow has one Mistral library of its own, attached
to every agent step that reads the input. That is decided when the workflow is
created (and re-checked on every upload, so an edited workflow follows): the
steps that reference ``{{claim_form}}`` are the agents that need the claim
form, so the claim form's library is attached to those agents.

    run form ─upload─▶ input library ─document_library tool─▶ consuming agents
                            │
                            └─text─▶ {{claim_form}} in the step's prompt

On a run the input's value is a reference to the uploaded document, never its
bytes: the payload travels through Temporal and into traces. When a step runs,
the reference is replaced by the document's text, fetched from the library —
which works on the local engine, the Workflows worker and a remote server
alike, since all of them reach Mistral. The agent can also search the library
for anything beyond what the prompt carries.

Documents are kept until the workflow, the agent they were uploaded for, or the
library itself is deleted.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from contextlib import contextmanager
from functools import partial
from typing import Optional

from app.database import SessionLocal
from app.workflow_inputs import schema
from app.workflow_inputs.models import WorkflowInputDocument, WorkflowInputLibrary

logger = logging.getLogger(__name__)

#: Most document text placed into one step prompt per input. Beyond this the
#: agent searches the library, which holds the whole document.
MAX_PROMPT_CHARS = 60_000
PREVIEW_CHARS = 600

_TEXT_CACHE: "OrderedDict[str, str]" = OrderedDict()
_TEXT_CACHE_SIZE = 32
_locks: dict[tuple[str, str], asyncio.Lock] = {}


class DocumentInputError(Exception):
    """An upload or reference a person can act on (wrong type, too large, unreadable)."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@contextmanager
def _session():
    if SessionLocal is None:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _client():
    from app.dependencies import get_mistral_client

    return get_mistral_client()


def _agent_ids(row: WorkflowInputLibrary) -> list[str]:
    try:
        ids = json.loads(row.agent_ids or "[]")
    except (TypeError, ValueError):
        ids = []
    return [str(i) for i in ids if i]


# ── Records ─────────────────────────────────────────────────────────────────


def library_for(workflow_name: str, field: str) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = (db.query(WorkflowInputLibrary)
               .filter_by(workflow_name=workflow_name, field=field).first())
        if row is None:
            return None
        return {"library_id": row.library_id, "agent_ids": _agent_ids(row)}


def libraries_of(workflow_name: str) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        rows = db.query(WorkflowInputLibrary).filter_by(workflow_name=workflow_name).all()
        return [{"field": r.field, "library_id": r.library_id, "agent_ids": _agent_ids(r)}
                for r in rows]


def _save_library(workflow_name: str, field: str, library_id: str, agent_ids: list[str]) -> None:
    with _session() as db:
        if db is None:
            return
        row = (db.query(WorkflowInputLibrary)
               .filter_by(workflow_name=workflow_name, field=field).first())
        if row is None:
            row = WorkflowInputLibrary(workflow_name=workflow_name, field=field)
            db.add(row)
        row.library_id = library_id
        row.agent_ids = json.dumps(agent_ids)
        db.commit()


def _document_row(document_id: str) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = db.query(WorkflowInputDocument).filter_by(document_id=document_id).first()
        if row is None:
            return None
        return {"workflow_name": row.workflow_name, "field": row.field,
                "library_id": row.library_id, "document_id": row.document_id,
                "filename": row.filename}


def _record_document(**values) -> None:
    with _session() as db:
        if db is None:
            return
        db.add(WorkflowInputDocument(**values))
        db.commit()


def _forget_documents(**filters) -> int:
    with _session() as db:
        if db is None:
            return 0
        removed = db.query(WorkflowInputDocument).filter_by(**filters).delete()
        db.commit()
        return removed


def _forget_library_rows(**filters) -> int:
    with _session() as db:
        if db is None:
            return 0
        removed = db.query(WorkflowInputLibrary).filter_by(**filters).delete()
        db.commit()
        return removed


# ── Agents ──────────────────────────────────────────────────────────────────


async def _real_agent_id(client, agent_id: str) -> Optional[str]:
    """The agent's id on Mistral, or None when it cannot be found.

    A step may name its agent rather than give its id. Unlike the step runner
    this never creates a stand-in agent: attaching a library is not a reason
    to make one.
    """
    from app.services.workflow_engine.step_runners import _is_agent_uuid

    if _is_agent_uuid(agent_id):
        try:
            agent = await asyncio.to_thread(client.beta.agents.get, agent_id=agent_id)
            return getattr(agent, "id", None) or agent_id
        except Exception:
            return None
    try:
        agents = await asyncio.to_thread(partial(client.beta.agents.list, page=0, page_size=100))
    except Exception:
        return None
    for agent in agents or []:
        if getattr(agent, "name", None) == agent_id:
            return getattr(agent, "id", None)
    return None


async def _set_attached(client, agent_id: str, library_id: str, attached: bool) -> bool:
    """Attach the library to the agent, or detach it. Returns whether it is now as asked."""
    from app.services import agent_service

    try:
        current = await asyncio.to_thread(agent_service.current_attachments, agent_id)
        ids = list(current.get("document_library_ids") or [])
        if (library_id in ids) == attached:
            return True
        ids = ids + [library_id] if attached else [i for i in ids if i != library_id]
        await agent_service.update_agent(client, agent_id, {"document_library_ids": ids})
        return True
    except Exception as e:
        logger.warning("Could not %s library %s %s agent %s: %s",
                       "attach" if attached else "detach", library_id,
                       "to" if attached else "from", agent_id, e)
        return False


# ── The input's library ─────────────────────────────────────────────────────


async def ensure_library(definition, field_name: str) -> dict:
    """Make sure the input has its library, attached to the agents that read it.

    Idempotent: creates the library once, then on every call brings the
    attachments in line with the steps that currently read the input — an
    edited workflow may have moved the input to a different agent.
    """
    from app.services import library_service

    field = schema.field_by_name(definition, field_name)
    if field is None or not schema.is_file_field(field):
        raise DocumentInputError(f"'{field_name}' is not a document input of this workflow.", 404)

    key = (definition.name, field_name)
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        client = _client()
        existing = await asyncio.to_thread(library_for, definition.name, field_name)
        if existing:
            library_id = existing["library_id"]
            attached = existing["agent_ids"]
        else:
            label = str(field.get("label") or field_name.replace("_", " ").capitalize())
            library = await library_service.create_library(
                name=f"{label} — {definition.name} inputs"[:100],
                description=(
                    f"Documents uploaded for the '{field_name}' input when running the "
                    f"'{definition.name}' workflow."
                )[:500],
            )
            library_id = library.get("id")
            if not library_id:
                raise DocumentInputError("Mistral did not return an id for the new library.", 502)
            attached = []
            logger.info("Created input library %s for %s.%s", library_id, definition.name, field_name)

        wanted: list[str] = []
        for agent_ref in schema.consumer_agent_ids(definition, field_name):
            real = await _real_agent_id(client, agent_ref)
            if real and real not in wanted:
                wanted.append(real)

        now: list[str] = []
        for agent_id in wanted:
            if await _set_attached(client, agent_id, library_id, True):
                now.append(agent_id)
        for agent_id in attached:
            if agent_id not in wanted and not await _set_attached(client, agent_id, library_id, False):
                now.append(agent_id)  # still attached; try again next time

        await asyncio.to_thread(_save_library, definition.name, field_name, library_id, now)
        return {"library_id": library_id, "agent_ids": now}


async def ensure_all(definition) -> list[dict]:
    """``ensure_library`` for every document input. Best effort, per input."""
    out = []
    for field in schema.file_fields(definition):
        try:
            out.append({"field": field["name"], **await ensure_library(definition, field["name"])})
        except Exception as e:
            logger.warning("Input library for %s.%s not ready: %s", definition.name, field["name"], e)
            out.append({"field": field["name"], "error": str(e)})
    return out


# ── Upload ──────────────────────────────────────────────────────────────────


async def _wait_for_text(client, library_id: str, document_id: str) -> str:
    """Wait for Mistral to finish reading the document, then return its text."""
    from app.config import settings
    from app.rag.ingest import _READY, _TERMINAL_FAILURES

    attempts = max(1, settings.RAG_TEXT_POLL_ATTEMPTS)
    delay = max(1, min(settings.RAG_TEXT_POLL_SECONDS, 3))
    state = "unknown"
    for _ in range(attempts):
        try:
            status = await asyncio.to_thread(partial(
                client.beta.libraries.documents.status,
                library_id=library_id, document_id=document_id))
            state = str(getattr(status, "process_status", "") or "").lower()
        except Exception as e:
            logger.debug("Status poll failed for %s: %s", document_id, e)
            state = "unknown"
        if state in _READY:
            break
        if state in _TERMINAL_FAILURES:
            raise DocumentInputError(f"Mistral could not read this document ({state}).")
        await asyncio.sleep(delay)
    else:
        raise DocumentInputError(
            "Mistral is still reading this document. Try uploading it again in a minute.", 504)

    content = await asyncio.to_thread(partial(
        client.beta.libraries.documents.text_content,
        library_id=library_id, document_id=document_id))
    return str(getattr(content, "text", "") or "")


async def upload(definition, field_name: str, filename: str, content: bytes,
                 content_type: Optional[str]) -> dict:
    """Check the file against the input, store it in the input's library, and read it.

    Returns the reference the run form sends, with what was read so the person
    can see the document arrived intact before starting the run.
    """
    from app.services import library_service

    field = schema.field_by_name(definition, field_name)
    if field is None or not schema.is_file_field(field):
        raise DocumentInputError(f"'{field_name}' is not a document input of this workflow.", 404)
    filename = (filename or "document").strip() or "document"
    if not content:
        raise DocumentInputError(f"'{filename}' is empty.")
    if not schema.accepts_file(field, filename, content_type):
        raise DocumentInputError(
            f"'{filename}' is not a file this input accepts. Accepted: {schema.describe_accept(field)}.")
    limit = schema.max_size_mb(field)
    if len(content) > limit * 1024 * 1024:
        raise DocumentInputError(
            f"'{filename}' is {len(content) / 1048576:.1f} MB; this input accepts up to {limit} MB.")

    library = await ensure_library(definition, field_name)
    library_id = library["library_id"]
    try:
        doc = await library_service.upload_document(
            library_id=library_id, filename=filename, file_content=content,
            content_type=content_type or "application/octet-stream")
    except Exception as e:
        raise DocumentInputError(f"Could not store '{filename}' in the input library: {e}", 502)
    document_id = doc.get("id")
    if not document_id:
        raise DocumentInputError("The library did not return an id for the document.", 502)

    client = _client()
    try:
        text = await _wait_for_text(client, library_id, document_id)
    except Exception as e:
        # A document the run cannot read is not left behind in the library.
        try:
            await library_service.delete_document(library_id, document_id)
        except Exception:
            pass
        if isinstance(e, DocumentInputError):
            raise
        raise DocumentInputError(f"Could not read '{filename}': {e}", 502)
    if not text.strip():
        try:
            await library_service.delete_document(library_id, document_id)
        except Exception:
            pass
        raise DocumentInputError(
            f"No text could be read from '{filename}'. If it is a scan, try a clearer copy.")

    _cache_text(document_id, text)
    await asyncio.to_thread(
        _record_document, workflow_name=definition.name, field=field_name,
        library_id=library_id, document_id=document_id, filename=filename,
        mime=content_type, size=len(content), chars=len(text))
    logger.info("Uploaded run input %s.%s: %s (%d chars)",
                definition.name, field_name, filename, len(text))
    return {
        "ref": schema.make_ref(library_id, document_id, filename, content_type, len(content)),
        "name": filename,
        "mime": content_type or "",
        "size": len(content),
        "chars": len(text),
        "preview": text[:PREVIEW_CHARS],
        "library_id": library_id,
        "agent_ids": library["agent_ids"],
    }


async def remove_upload(workflow_name: str, field_name: str, document_id: str) -> dict:
    """Take back a document uploaded on the run form (before or instead of running)."""
    from app.services import library_service

    row = await asyncio.to_thread(_document_row, document_id)
    if row is None or row["workflow_name"] != workflow_name or row["field"] != field_name:
        raise DocumentInputError("That document was not uploaded for this input.", 404)
    try:
        await library_service.delete_document(row["library_id"], document_id)
    except Exception as e:
        logger.warning("Could not delete input document %s: %s", document_id, e)
    await asyncio.to_thread(_forget_documents, document_id=document_id)
    _TEXT_CACHE.pop(document_id, None)
    return {"deleted": True, "document_id": document_id}


def check_refs(workflow_name: str, field_name: str, refs: list[dict]) -> list[str]:
    """Problems with the documents a run references for one input."""
    problems = []
    for ref in refs:
        row = _document_row(str(ref.get("document_id") or ""))
        name = ref.get("name") or ref.get("document_id")
        if row is None:
            problems.append(f"'{name}' is not an uploaded document (it may have been deleted)")
        elif row["workflow_name"] != workflow_name or row["field"] != field_name:
            problems.append(f"'{name}' was uploaded for a different input")
    return problems


# ── At run time ─────────────────────────────────────────────────────────────


def _cache_text(document_id: str, text: str) -> None:
    _TEXT_CACHE[document_id] = text
    _TEXT_CACHE.move_to_end(document_id)
    while len(_TEXT_CACHE) > _TEXT_CACHE_SIZE:
        _TEXT_CACHE.popitem(last=False)


async def _text_of(ref: dict) -> str:
    document_id = str(ref.get("document_id") or "")
    if document_id in _TEXT_CACHE:
        _TEXT_CACHE.move_to_end(document_id)
        return _TEXT_CACHE[document_id]
    content = await asyncio.to_thread(partial(
        _client().beta.libraries.documents.text_content,
        library_id=ref.get("library_id"), document_id=document_id))
    text = str(getattr(content, "text", "") or "")
    _cache_text(document_id, text)
    return text


async def _render(refs: list[dict]) -> str:
    parts = []
    for ref in refs:
        name = ref.get("name") or "document"
        try:
            text = await _text_of(ref)
        except Exception as e:
            logger.warning("Could not read input document %s: %s", ref.get("document_id"), e)
            text = ""
        if not text.strip():
            text = ("[The text of this document could not be read here. Search the document "
                    "library for it by name.]")
        parts.append(f"[Document: {name}]\n{text}")
    rendered = "\n\n".join(parts)
    if len(rendered) > MAX_PROMPT_CHARS:
        rendered = (rendered[:MAX_PROMPT_CHARS]
                    + "\n\n[… document truncated here. The full document is in your document "
                      "library — search it for anything beyond this point.]")
    return rendered


async def materialise(variables: dict) -> dict:
    """The variables with each document reference replaced by the document's text.

    Returns the same dict when nothing references a document, so a workflow
    without document inputs pays nothing.
    """
    if not isinstance(variables, dict):
        return variables
    keys = [k for k, v in variables.items() if schema.holds_documents(v)]
    if not keys:
        return variables
    out = dict(variables)
    for key in keys:
        out[key] = await _render(schema.document_refs(variables[key]))
    return out


# ── Retention: kept until the workflow, the agent or the library goes ───────


async def forget_workflow(workflow_name: str) -> dict:
    """Delete the workflow's input libraries — and with them every uploaded document."""
    from app.services import library_service

    client = None
    removed = []
    for lib in await asyncio.to_thread(libraries_of, workflow_name):
        if client is None:
            client = _client()
        for agent_id in lib["agent_ids"]:
            await _set_attached(client, agent_id, lib["library_id"], False)
        try:
            await library_service.delete_library(lib["library_id"])
            removed.append(lib["library_id"])
        except Exception as e:
            logger.warning("Could not delete input library %s: %s", lib["library_id"], e)
    await asyncio.to_thread(_forget_documents, workflow_name=workflow_name)
    await asyncio.to_thread(_forget_library_rows, workflow_name=workflow_name)
    return {"libraries_deleted": removed}


async def forget_agent(agent_id: str) -> dict:
    """An agent is gone: delete the input libraries that existed only for it."""
    from app.services import library_service

    with _session() as db:
        rows = [] if db is None else [
            {"workflow_name": r.workflow_name, "field": r.field,
             "library_id": r.library_id, "agent_ids": _agent_ids(r)}
            for r in db.query(WorkflowInputLibrary).all()
        ]
    removed = []
    for row in rows:
        if agent_id not in row["agent_ids"]:
            continue
        others = [a for a in row["agent_ids"] if a != agent_id]
        if others:
            await asyncio.to_thread(_save_library, row["workflow_name"], row["field"],
                                    row["library_id"], others)
            continue
        try:
            await library_service.delete_library(row["library_id"])
            removed.append(row["library_id"])
        except Exception as e:
            logger.warning("Could not delete input library %s: %s", row["library_id"], e)
            # The rows go regardless: the next upload creates a fresh library.
            forget_library(row["library_id"])
    return {"libraries_deleted": removed}


def forget_library(library_id: str) -> None:
    """A library was deleted: its input records go with it. Never raises."""
    try:
        _forget_documents(library_id=library_id)
        _forget_library_rows(library_id=library_id)
    except Exception as e:
        logger.debug("Could not forget input library %s: %s", library_id, e)
