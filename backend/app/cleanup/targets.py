"""
The areas Settings → Cleanup can delete, each with a preview and a purge.

``TARGETS`` is listed in the order a complete cleanup runs them. Things that
hold references go before what they reference — agents before the libraries
they attach — and the vocabulary goes last, since every other purge removes its
own annotations from it.

A purge does what it can and reports what it could not: one unreachable
service must not leave the rest of the project half cleaned. Whatever was
selected, the run ends by preparing the database again, so the built-in rows a
fresh install has (rules, vocabulary, process template, safety rules) are back.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable

import httpx
from sqlalchemy import bindparam, inspect, text

from app.config import settings

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
UPLOADS_DIR = BACKEND_DIR / "uploads"
#: Backups written by the old cleanup_fresh_start.py script.
ARCHIVED_WORKFLOWS_DIR = BACKEND_DIR / "_archived_workflows"

_MISTRAL = "https://api.mistral.ai"
_TIMEOUT = httpx.Timeout(30.0, connect=5.0)
#: Parallel deletes against Mistral — enough to be quick, few enough not to
#: trip the rate limit on a workspace with hundreds of conversations.
_CONCURRENCY = 4

Counts = dict[str, int]


@dataclass(frozen=True)
class Target:
    id: str
    title: str
    description: str
    group: str
    #: Deletes on Mistral's side too, not only here.
    remote: bool
    count: Callable[[], Awaitable[Counts]]
    purge: Callable[[], Awaitable[dict[str, Any]]]


# ── Helpers ───────────────────────────────────────────────────────────────


def _engine():
    from app.database import engine

    return engine


def _existing(tables: Iterable[str]) -> list[str]:
    names = set(inspect(_engine()).get_table_names())
    return [t for t in tables if t in names]


def _count_rows(table: str, where: str = "", **params) -> int:
    if not _existing([table]):
        return 0
    with _engine().connect() as conn:
        return conn.execute(text(f'SELECT COUNT(*) FROM "{table}" {where}'), params).scalar() or 0


def _clear_tables(*tables: str) -> int:
    """Delete every row of these tables, in this order. Returns the rows removed."""
    removed = 0
    with _engine().begin() as conn:
        for table in _existing(tables):
            removed += conn.execute(text(f'DELETE FROM "{table}"')).rowcount or 0
    return removed


def _forget_annotations(*subject_types: str, keep: Iterable[str] = ()) -> int:
    """Remove the graph edges of every subject of these types, but ``keep``."""
    if not _existing(["ontology_annotations"]):
        return 0
    keep = list(keep)
    sql = "DELETE FROM ontology_annotations WHERE subject_type IN :types"
    params: dict[str, Any] = {"types": list(subject_types)}
    stmt = text(sql + (" AND subject_id NOT IN :keep" if keep else ""))
    stmt = stmt.bindparams(bindparam("types", expanding=True))
    if keep:
        stmt = stmt.bindparams(bindparam("keep", expanding=True))
        params["keep"] = keep
    with _engine().begin() as conn:
        return conn.execute(stmt, params).rowcount or 0


def _files(directory: Path, pattern: str = "*") -> list[Path]:
    if not directory.is_dir():
        return []
    return [p for p in directory.glob(pattern) if p.is_file()]


def _remove(paths: Iterable[Path]) -> int:
    removed = 0
    for path in paths:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            removed += 1
        except OSError as e:
            logger.warning("Cleanup could not remove %s: %s", path, e)
    return removed


def _mistral() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=_MISTRAL,
        headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
        timeout=_TIMEOUT,
    )


async def _paged(path: str, page_size: int = 100, max_pages: int = 50) -> list[dict]:
    """Every item of a page-numbered Mistral listing."""
    items: list[dict] = []
    async with _mistral() as http:
        for page in range(max_pages):
            resp = await http.get(path, params={"page": page, "page_size": page_size})
            resp.raise_for_status()
            data = resp.json()
            batch = data if isinstance(data, list) else data.get("data", [])
            items.extend(b for b in batch if isinstance(b, dict))
            if len(batch) < page_size:
                break
    return items


async def _delete_each(ids: list[str], delete: Callable[[str], Awaitable[Any]]) -> dict[str, Any]:
    """Run ``delete`` for every id, a few at a time. Returns deleted/failed counts."""
    gate = asyncio.Semaphore(_CONCURRENCY)
    errors: list[str] = []

    async def one(item_id: str) -> bool:
        async with gate:
            try:
                await delete(item_id)
                return True
            except Exception as e:  # noqa: BLE001 — reported, the rest carry on
                errors.append(f"{item_id}: {str(e)[:160]}")
                return False

    done = await asyncio.gather(*(one(i) for i in ids))
    return {"deleted": sum(done), "failed": len(errors), "errors": errors[:5]}


async def _mistral_delete(path: str) -> None:
    async with _mistral() as http:
        resp = await http.delete(path)
    # Already gone is what we wanted.
    if resp.status_code != 404:
        resp.raise_for_status()


def _forget_executions() -> int:
    """Drop the in-memory workflow executions and their log buffers."""
    from app.services.workflow_engine import engine as workflow_engine
    from app.services.workflow_engine import execution_logs

    removed = len(workflow_engine._execution_store)
    workflow_engine._execution_store.clear()
    with execution_logs._buffers_lock:
        execution_logs._buffers.clear()
    return removed


# ── Conversations ─────────────────────────────────────────────────────────


async def _count_conversations() -> Counts:
    return {"conversations on Mistral": len(await _paged("/v1/conversations"))}


async def _purge_conversations() -> dict[str, Any]:
    ids = [c["id"] for c in await _paged("/v1/conversations") if c.get("id")]
    return await _delete_each(ids, lambda i: _mistral_delete(f"/v1/conversations/{i}"))


# ── Agents ────────────────────────────────────────────────────────────────


async def _user_agents() -> tuple[list[dict], list[str]]:
    """(agents to delete, ids of the platform's own agents to keep)."""
    from app.rag import optimizer
    from app.services.delete_rules import _all_agents_raw

    agents = await asyncio.to_thread(_all_agents_raw)
    keep = [a["id"] for a in agents if optimizer.is_protected(a.get("id"), a.get("metadata"))]
    return [a for a in agents if a.get("id") and a["id"] not in keep], keep


async def _count_agents() -> Counts:
    agents, keep = await _user_agents()
    return {
        "agents on Mistral": len(agents),
        "rule assignments": _count_rows("rule_assignments"),
    }


async def _purge_agents() -> dict[str, Any]:
    agents, keep = await _user_agents()
    result = await _delete_each(
        [a["id"] for a in agents], lambda i: _mistral_delete(f"/v1/agents/{i}")
    )
    with _engine().begin() as conn:
        if _existing(["rule_assignments"]):
            stmt = text(
                "DELETE FROM rule_assignments"
                + (" WHERE agent_id NOT IN :keep" if keep else "")
            )
            if keep:
                stmt = stmt.bindparams(bindparam("keep", expanding=True))
            result["rule assignments"] = conn.execute(stmt, {"keep": keep} if keep else {}).rowcount
    result["classifications"] = _forget_annotations("agent", keep=keep)
    result["platform agents kept"] = len(keep)
    from app.rules import store as rules_store

    rules_store._invalidate()
    return result


# ── Connectors ────────────────────────────────────────────────────────────


async def _own_connectors() -> tuple[list[dict], list[str]]:
    """(connectors added here, ids of Mistral's directory connectors to keep)."""
    from app.services import connector_service

    items: list[dict] = []
    cursor = None
    for _ in range(20):
        page = await connector_service.list_connectors(cursor=cursor)
        items.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            break
    keep = [c["id"] for c in items if c.get("is_directory")]
    return [c for c in items if c.get("id") and not c.get("is_directory")], keep


async def _count_connectors() -> Counts:
    own, _ = await _own_connectors()
    return {"connectors on Mistral": len(own)}


async def _purge_connectors() -> dict[str, Any]:
    from app.services import connector_service

    own, keep = await _own_connectors()
    result = await _delete_each([c["id"] for c in own], connector_service.delete_connector)
    result["classifications"] = _forget_annotations("connector", keep=keep)
    return result


# ── Workflows ─────────────────────────────────────────────────────────────

_WORKFLOW_TABLES = (
    "workflow_versions",
    "workflow_revisions",
    "workflow_input_documents",
    "workflow_input_libraries",
    "workflow_definitions",
)


def _compiled_workflows() -> list[Path]:
    directory = Path(settings.MISTRAL_WORKFLOWS_DIR)
    if not directory.is_absolute():
        directory = (BACKEND_DIR / directory).resolve()
    return _files(directory, "workflow_*.py") + [
        p for p in [directory / "__pycache__"] if p.is_dir()
    ]


async def _remote_workflows() -> list[dict]:
    async with _mistral() as http:
        resp = await http.get("/v1/workflows")
    resp.raise_for_status()
    return [w for w in resp.json().get("workflows", []) if isinstance(w, dict)]


async def _count_workflows() -> Counts:
    counts = {
        "workflows": _count_rows("workflow_definitions"),
        "saved revisions": _count_rows("workflow_revisions") + _count_rows("workflow_versions"),
        "compiled workflow files": len(_compiled_workflows()),
        "archived backups": len(list(ARCHIVED_WORKFLOWS_DIR.glob("*")))
        if ARCHIVED_WORKFLOWS_DIR.is_dir() else 0,
    }
    try:
        counts["active on Mistral"] = sum(
            1 for w in await _remote_workflows() if not w.get("archived")
        )
    except Exception as e:  # noqa: BLE001 — the local counts still stand
        logger.info("Cleanup preview could not list Mistral workflows: %s", e)
    return counts


async def _purge_workflows() -> dict[str, Any]:
    from app.services import library_service
    from app.services.workflow_engine import engine as workflow_engine

    result: dict[str, Any] = {}

    # Mistral archives a workflow rather than deleting it. Each name is also
    # recorded as deleted here, or the workflow list would bring it back as a
    # remote-only entry.
    try:
        remote = await _remote_workflows()
        active = [w for w in remote if w.get("id") and not w.get("archived")]

        async def archive(workflow_id: str) -> None:
            async with _mistral() as http:
                resp = await http.put(f"/v1/workflows/{workflow_id}/archive")
            resp.raise_for_status()

        result.update(await _delete_each([w["id"] for w in active], archive))
        result["archived on Mistral"] = result.pop("deleted")
        for w in remote:
            if w.get("name"):
                workflow_engine.delete_workflow(w["name"])
    except Exception as e:  # noqa: BLE001
        result["errors"] = [f"Mistral workflows: {str(e)[:200]}"]

    # The libraries holding documents uploaded on run forms exist only for
    # their workflow.
    if _existing(["workflow_input_libraries"]):
        with _engine().connect() as conn:
            library_ids = [r[0] for r in conn.execute(
                text("SELECT DISTINCT library_id FROM workflow_input_libraries")
            ) if r[0]]
        removed = await _delete_each(library_ids, library_service.delete_library)
        result["input libraries"] = removed["deleted"]

    result["records"] = _clear_tables(*_WORKFLOW_TABLES)
    result["compiled files"] = _remove(_compiled_workflows())
    if ARCHIVED_WORKFLOWS_DIR.is_dir():
        result["archived backups"] = _remove(ARCHIVED_WORKFLOWS_DIR.glob("*"))
    result["executions"] = _forget_executions()
    result["classifications"] = _forget_annotations("workflow")
    return result


# ── Tools & activities (Tool Service) ─────────────────────────────────────


async def _tool_service(method: str, path: str, timeout: float = 30.0) -> dict:
    url = f"{settings.TOOL_SERVICE_URL.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0)) as http:
            resp = await http.request(method, url)
    except httpx.TransportError:
        raise RuntimeError(f"Tool Service unreachable at {settings.TOOL_SERVICE_URL}") from None
    resp.raise_for_status()
    return resp.json()


async def _count_tools() -> Counts:
    data = await _tool_service("GET", "/admin/cleanup")
    return {
        "tools & activities": data.get("tools", 0),
        "synthesis jobs": data.get("synthesis_jobs", 0),
        "generated documents": data.get("documents", 0),
    }


async def _purge_tools() -> dict[str, Any]:
    from app.services.tool_registry import refresh_dynamic_tools

    result = await _tool_service("POST", "/admin/cleanup", timeout=120.0)
    result["classifications"] = _forget_annotations("tool", "activity")
    try:
        await refresh_dynamic_tools()
    except Exception as e:  # noqa: BLE001 — the backend's tool list catches up on its own
        logger.warning("Tool list refresh after cleanup failed: %s", e)
    return result


# ── Libraries & knowledge graph ───────────────────────────────────────────

_RAG_TABLES = (
    "rag_extraction_drafts",
    "rag_documents",
    "rag_library_ontology",
    "rag_extraction_rules",
)


async def _count_libraries() -> Counts:
    from app.rag import graph_store
    from app.services import library_service

    counts = {
        "libraries on Mistral": len(await library_service.list_libraries()),
        "indexed documents": _count_rows("rag_documents"),
    }
    totals = (await asyncio.to_thread(graph_store.stats)).get("totals") or {}
    if totals:
        counts["graph entities"] = int(totals.get("entities") or 0)
    return counts


async def _purge_libraries() -> dict[str, Any]:
    from app.rag import graph_store
    from app.services import library_service

    libraries = await library_service.list_libraries()
    result = await _delete_each([l["id"] for l in libraries if l.get("id")],
                                library_service.delete_library)
    result["records"] = _clear_tables(*_RAG_TABLES)
    # What a deleted library's purge missed: graphs of libraries deleted
    # elsewhere. The taxonomy mirror (Concept nodes) belongs to the vocabulary.
    if await asyncio.to_thread(graph_store.available):
        rows = await asyncio.to_thread(
            graph_store._run,
            "MATCH (n) WHERE n:Document OR n:Entity OR n:Library "
            "DETACH DELETE n RETURN count(n) AS removed",
        )
        result["graph nodes"] = rows[0]["removed"] if rows else 0
    result["classifications"] = _forget_annotations("library")
    return result


# ── Process knowledge ─────────────────────────────────────────────────────


async def _count_processes() -> Counts:
    return {
        "process documents": _count_rows("process_documents"),
        "custom templates": _count_rows("process_templates", "WHERE builtin = :b", b=False),
    }


async def _purge_processes() -> dict[str, Any]:
    from app.process_knowledge import templates

    removed = _clear_tables("process_usage", "process_documents", "process_templates")
    templates.ensure_builtin()
    return {"records": removed}


# ── Rules, safety, vault, remote servers ──────────────────────────────────


async def _count_rules() -> Counts:
    return {
        "rules": _count_rows("rules"),
        "categories": _count_rows("rule_categories"),
        "rule events": _count_rows("rule_events"),
    }


async def _purge_rules() -> dict[str, Any]:
    from app.rules import seed as rules_seed, store as rules_store

    removed = _clear_tables("rule_events", "rule_assignments", "rules", "rule_categories")
    rules_store._invalidate()
    return {"records": removed, "recommended rules restored": rules_seed.load_seed()}


async def _count_safety() -> Counts:
    return {"safety rules": _count_rows("tool_safety_rules")}


async def _purge_safety() -> dict[str, Any]:
    from app.safety import store as safety_store

    removed = _clear_tables("tool_safety_rules")
    return {"records": removed, "built-in rules restored": safety_store.seed()}


async def _count_vault() -> Counts:
    return {
        "secrets": _count_rows("vault_secrets"),
        "audit events": _count_rows("vault_audit"),
    }


async def _purge_vault() -> dict[str, Any]:
    return {"records": _clear_tables("vault_audit", "vault_secret_versions", "vault_secrets")}


async def _count_remote_servers() -> Counts:
    return {
        "servers": _count_rows("remote_servers"),
        "deployments": _count_rows("remote_deployments"),
        "provider accounts": _count_rows("remote_provider_accounts"),
    }


async def _purge_remote_servers() -> dict[str, Any]:
    return {"records": _clear_tables(
        "remote_deployments", "remote_servers", "remote_provider_accounts"
    )}


# ── History, uploads, settings ────────────────────────────────────────────


async def _count_history() -> Counts:
    from app.services.workflow_engine import engine as workflow_engine

    return {
        "background runs": _count_rows("pipeline_runs"),
        "rule & RAG events": _count_rows("rule_events") + _count_rows("rag_events"),
        "executions in memory": len(workflow_engine._execution_store),
    }


async def _purge_history() -> dict[str, Any]:
    removed = _clear_tables("pipeline_run_events", "pipeline_runs", "rule_events", "rag_events")
    return {"records": removed, "executions": _forget_executions()}


async def _count_uploads() -> Counts:
    return {"uploaded files": len(_files(UPLOADS_DIR))}


async def _purge_uploads() -> dict[str, Any]:
    return {"files": _remove(_files(UPLOADS_DIR))}


def _overrides(sections: list[dict]) -> int:
    return sum(
        1 for s in sections for i in s.get("settings", []) if i.get("source") == "override"
    )


async def _count_settings() -> Counts:
    from app.app_settings import tool_service
    from app.app_settings.store import get_store

    counts = {"changed settings": _overrides(get_store().export()["sections"])}
    try:
        counts["changed settings"] += _overrides((await tool_service.get_settings())["sections"])
    except Exception as e:  # noqa: BLE001
        logger.info("Cleanup preview could not read Tool Service settings: %s", e)
    return counts


async def _purge_settings() -> dict[str, Any]:
    from app.app_settings import tool_service
    from app.app_settings.store import get_store

    result: dict[str, Any] = {"backend settings": len(get_store().reset())}
    try:
        result["tool service settings"] = len((await tool_service.reset()).get("reset", []))
    except Exception as e:  # noqa: BLE001
        result["errors"] = [f"Tool Service: {str(e)[:200]}"]
    return result


# ── Vocabulary ────────────────────────────────────────────────────────────


async def _count_ontology() -> Counts:
    return {
        "concepts": _count_rows("ontology_concepts"),
        "classifications": _count_rows("ontology_annotations"),
        "knowledge entries": _count_rows("industry_knowledge"),
    }


async def _purge_ontology() -> dict[str, Any]:
    from app.ontology.seed_loader import load_seed
    from app.rag import unified_graph

    removed = _clear_tables(
        "ontology_annotations",
        "ontology_concept_links",
        "ontology_rule_exceptions",
        "ontology_rules",
        "industry_knowledge",
        "ontology_concepts",
        "ontology_schemes",
    )
    seeded = load_seed()
    await asyncio.to_thread(unified_graph.sync_taxonomy)
    return {"records": removed, "concepts restored": seeded.get("concepts_added", 0)}


# ── Registry ──────────────────────────────────────────────────────────────

TARGETS: list[Target] = [
    Target("conversations", "Chat conversations",
           "Every conversation thread on Mistral — chat and agent sessions.",
           "Build artefacts", True, _count_conversations, _purge_conversations),
    Target("agents", "Agents",
           "Every agent on Mistral, with its rule assignments and classifications. "
           "The platform's own agents (query optimiser, ontology architect) are kept.",
           "Build artefacts", True, _count_agents, _purge_agents),
    Target("workflows", "Workflows",
           "Workflow definitions, revisions, compiled workflow files, run-form document "
           "libraries and executions. Workflows on Mistral are archived.",
           "Build artefacts", True, _count_workflows, _purge_workflows),
    Target("tools", "Tools & activities",
           "Every synthesised tool and activity in the Tool Service, its synthesis jobs and "
           "generated documents. The predefined native tools are kept.",
           "Build artefacts", False, _count_tools, _purge_tools),
    Target("connectors", "Connectors",
           "MCP connectors added on Mistral. Mistral's directory connectors are kept.",
           "Build artefacts", True, _count_connectors, _purge_connectors),
    Target("libraries", "Libraries & knowledge graph",
           "Every document library on Mistral, the indexed documents, extraction drafts and "
           "the knowledge graph built from them in Neo4j.",
           "Knowledge", True, _count_libraries, _purge_libraries),
    Target("processes", "Process knowledge",
           "Uploaded process documents and custom templates. The built-in template returns.",
           "Knowledge", False, _count_processes, _purge_processes),
    Target("rules", "Rules",
           "Every rule, category and assignment. The recommended rules are seeded again.",
           "Governance", False, _count_rules, _purge_rules),
    Target("safety", "Tool safety rules",
           "Tool safety rules go back to the built-in set, switched off.",
           "Governance", False, _count_safety, _purge_safety),
    Target("vault", "Vault",
           "Every stored credential and service URL, their versions and the audit log.",
           "Governance", False, _count_vault, _purge_vault),
    Target("remote_servers", "Remote servers",
           "Saved servers, provider accounts and deployment records. The servers "
           "themselves are not touched.",
           "Governance", False, _count_remote_servers, _purge_remote_servers),
    Target("history", "Run history & logs",
           "Background runs and their events, rule and RAG event logs, and in-memory "
           "workflow executions.",
           "Files & history", False, _count_history, _purge_history),
    Target("uploads", "Uploaded images & files",
           "Every file in the backend's uploads folder.",
           "Files & history", False, _count_uploads, _purge_uploads),
    Target("settings", "Settings",
           "Every value changed on the Settings page, on the backend and the Tool Service, "
           "goes back to .env or built-in defaults.",
           "Configuration", False, _count_settings, _purge_settings),
    Target("ontology", "Vocabulary & classifications",
           "Concepts, domain classifications and industry knowledge. The shipped vocabulary "
           "is seeded again; everything's domain classification is lost.",
           "Configuration", False, _count_ontology, _purge_ontology),
]

_BY_ID = {t.id: t for t in TARGETS}


def _describe(t: Target) -> dict[str, Any]:
    return {"id": t.id, "title": t.title, "description": t.description,
            "group": t.group, "remote": t.remote}


def busy() -> list[str]:
    """What is running now and would break if its data disappeared under it."""
    from app.runs.manager import manager
    from app.services.workflow_engine import engine as workflow_engine

    running = [f"{r.kind}: {r.title}" for r in manager.active()]
    running += [
        f"workflow execution: {e.workflow_name}"
        for e in list(workflow_engine._execution_store.values())
        if str(getattr(e.status, "value", e.status)) in ("PENDING", "RUNNING")
    ]
    return running


async def preview() -> dict[str, Any]:
    """Every target with what it would remove now."""

    async def one(t: Target) -> dict[str, Any]:
        try:
            counts = await asyncio.wait_for(t.count(), timeout=30)
            return {**_describe(t), "counts": counts, "error": None}
        except Exception as e:  # noqa: BLE001 — shown on the target's row
            return {**_describe(t), "counts": {}, "error": str(e)[:300] or type(e).__name__}

    return {"targets": await asyncio.gather(*(one(t) for t in TARGETS)), "busy": busy()}


async def run(target_ids: Iterable[str]) -> dict[str, Any]:
    """Purge these targets in registry order, then restore the fresh-install baseline."""
    from app.db_setup import prepare_database

    wanted = set(target_ids)
    unknown = wanted - _BY_ID.keys()
    if unknown:
        raise ValueError(f"Unknown cleanup target(s): {', '.join(sorted(unknown))}")

    results = []
    for t in (t for t in TARGETS if t.id in wanted):
        started = time.monotonic()
        try:
            removed = await t.purge()
            errors = removed.pop("errors", None) or []
            ok = not errors and not removed.get("failed")
            results.append({**_describe(t), "ok": ok, "removed": removed, "errors": errors})
        except Exception as e:  # noqa: BLE001 — the next target still runs
            logger.exception("Cleanup of %s failed", t.id)
            results.append({**_describe(t), "ok": False, "removed": {},
                            "errors": [str(e)[:300] or type(e).__name__]})
        results[-1]["seconds"] = round(time.monotonic() - started, 2)
        logger.info("Cleanup %s: %s", t.id, results[-1])

    await asyncio.to_thread(prepare_database, seed_rules=True)
    return {"results": results, "ok": all(r["ok"] for r in results)}
