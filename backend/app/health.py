"""
System health: one set of checks, two audiences.

* ``user_status()`` — for anyone signed in: is the platform live, and if not,
  what is wrong and what it affects, in plain words. Mistral is checked with
  the caller's own workspace key, and only their workspace's worker counts.
  No hostnames, ports, versions or other internals.
* ``admin_health()`` — for platform admins: every component with its latency
  and details, every workspace's key and worker.

Severity decides the overall verdict: a ``critical`` component down is an
outage, a ``major`` one makes the platform degraded, a ``minor`` one is listed
as a notice without changing "live" (the knowledge graph, for instance, is
optional infrastructure and search falls back to documents without it).

Results are cached briefly so the status indicator every user polls does not
turn into a stream of checks against Mistral and the services.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import platform
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import httpx

from app.config import settings

VERSION = "2.0.0"
STARTED_AT = time.time()

_CACHE_SECONDS = 15.0
_MISTRAL_CACHE_SECONDS = 60.0
_cache: dict[tuple, tuple[float, dict]] = {}
_mistral_cache: dict[str, tuple[float, "Check"]] = {}
_lock = asyncio.Lock()


@dataclass
class Check:
    key: str
    name: str
    #: ok | degraded | down | off
    state: str
    #: critical | major | minor
    severity: str
    message: str
    #: What a person can't do while this is not ok.
    impact: Optional[str] = None
    latency_ms: Optional[int] = None
    details: dict = field(default_factory=dict)


def _ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


# ── Individual checks ───────────────────────────────────────────────────────

def _database() -> Check:
    from sqlalchemy import text

    from app.database import engine

    start = time.perf_counter()
    try:
        if engine is None:
            raise RuntimeError("the database engine did not start")
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        details: dict[str, Any] = {"driver": settings.DATABASE_URL.split("://")[0]}
        if settings.DATABASE_URL.startswith("sqlite:///"):
            path = settings.DATABASE_URL[len("sqlite:///"):]
            if os.path.exists(path):
                details["size_mb"] = round(os.path.getsize(path) / 1_048_576, 1)
        return Check("database", "Database", "ok", "critical", "Reading and writing normally.",
                     latency_ms=_ms(start), details=details)
    except Exception as e:  # noqa: BLE001
        return Check("database", "Database", "down", "critical",
                     "The platform can't reach its database.",
                     impact="Nothing can be loaded or saved until it is back.",
                     latency_ms=_ms(start), details={"error": str(e)[:300]})


async def _tool_service() -> Check:
    from app.services.tool_resolver import tool_resolver

    start = time.perf_counter()
    ok = await tool_resolver.health_check()
    if ok:
        return Check("tool_service", "Tool service", "ok", "major", "Running tools normally.",
                     latency_ms=_ms(start), details={"url": settings.TOOL_SERVICE_URL})
    return Check("tool_service", "Tool service", "down", "major",
                 "The tool service isn't responding.",
                 impact="Agents and workflow steps that use dynamic tools will fail; new tools "
                        "can't be created.",
                 latency_ms=_ms(start), details={"url": settings.TOOL_SERVICE_URL})


async def _mistral(key: Optional[str], *, label: str = "your workspace") -> Check:
    name = "Mistral AI"
    if not key:
        return Check("mistral", name, "down", "critical",
                     f"No Mistral API key is set for {label}.",
                     impact="Agents, chat and workflow design are unavailable.")
    fp = hashlib.sha256(key.encode()).hexdigest()[:16]
    hit = _mistral_cache.get(fp)
    if hit and time.monotonic() - hit[0] < _MISTRAL_CACHE_SECONDS:
        return hit[1]
    base = (settings.MISTRAL_API_BASE_URL or "https://api.mistral.ai").rstrip("/")
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=6.0) as http:
            r = await http.get(f"{base}/v1/models", headers={"Authorization": f"Bearer {key}"})
        latency = _ms(start)
        if r.status_code == 200:
            check = Check("mistral", name, "ok", "critical", "Connected.", latency_ms=latency,
                          details={"models": len((r.json() or {}).get("data") or [])})
        elif r.status_code in (401, 403):
            check = Check("mistral", name, "down", "critical",
                          f"Mistral rejected the API key of {label}.",
                          impact="Agents, chat and workflow design are unavailable until an "
                                 "administrator replaces the key.",
                          latency_ms=latency, details={"http_status": r.status_code})
        elif r.status_code == 429:
            check = Check("mistral", name, "degraded", "critical",
                          "Mistral is rate limiting requests.",
                          impact="AI responses may be slow or fail; try again in a minute.",
                          latency_ms=latency, details={"http_status": 429})
        else:
            check = Check("mistral", name, "degraded", "critical",
                          f"Mistral is answering with errors (HTTP {r.status_code}).",
                          impact="AI responses may fail until Mistral recovers.",
                          latency_ms=latency, details={"http_status": r.status_code})
    except httpx.HTTPError as e:
        check = Check("mistral", name, "down", "critical", "Mistral can't be reached.",
                      impact="Agents, chat and workflow design are unavailable.",
                      latency_ms=_ms(start), details={"error": str(e)[:200] or type(e).__name__})
    _mistral_cache[fp] = (time.monotonic(), check)
    return check


def _knowledge_graph() -> Check:
    try:
        from app.rag import graph_store

        st = graph_store.status()
    except Exception as e:  # noqa: BLE001
        st = {"available": False, "reason": str(e)}
    if st.get("available"):
        return Check("knowledge_graph", "Knowledge graph", "ok", "minor", "Available.",
                     details={"database": st.get("database")})
    return Check("knowledge_graph", "Knowledge graph", "off", "minor",
                 "The knowledge graph is offline.",
                 impact="Graph search is off; agents still search your documents.",
                 details={"reason": st.get("reason")})


def _worker(workspace_id: Optional[str]) -> Optional[Check]:
    """Mistral-hosted workflow runs for one workspace. None when not in use."""
    if not settings.MISTRAL_WORKER_ENABLED or not workspace_id:
        return None
    from app.auth import workers

    w = workers.worker_for(workspace_id)
    if not w["published_workflows"]:
        return None
    details = {"queue": w["deployment"], "published_workflows": w["published_workflows"],
               "restarts": w.get("restarts", 0)}
    if w["state"] == "running" and not w["stale"]:
        return Check("worker", "Workflow runs", "ok", "major", "The workflow worker is running.",
                     details=details)
    message = ("The workflow worker has crashed and is restarting."
               if w["state"] == "crashed" else "The workflow worker isn't running.")
    if w["stale"]:
        message = "The workflow worker stopped reporting."
    return Check("worker", "Workflow runs", "down", "major", message,
                 impact="Workflows published to Mistral won't start; runs on the local engine "
                        "still work.",
                 details={**details, "error": w.get("last_error")})


def _observability() -> Check:
    from app import observability

    if not settings.OBSERVABILITY_ENABLED:
        return Check("observability", "Logs & traces", "off", "minor", "Turned off in settings.")
    try:
        on = observability.enabled()
    except Exception:  # noqa: BLE001
        on = False
    if on:
        return Check("observability", "Logs & traces", "ok", "minor", "Recording to Mistral.")
    return Check("observability", "Logs & traces", "down", "minor",
                 "Traces aren't being recorded.",
                 impact="New activity won't appear on the Logs page.")


def _vault() -> Check:
    try:
        from app.vault import store as vault

        info = vault.key_status()
    except Exception as e:  # noqa: BLE001
        return Check("vault", "Vault", "down", "major", "The vault can't decrypt its values.",
                     impact="Tools and connectors that need stored credentials will fail.",
                     details={"error": str(e)[:200]})
    old = int(info.get("on_old_key") or 0)
    details = {"source": info.get("source"), "key_id": info.get("primary_key_id")
               or info.get("key_id"), "on_old_key": old}
    if old:
        return Check("vault", "Vault", "degraded", "minor",
                     f"{old} value(s) are still encrypted with an older master key.",
                     impact="Re-encrypt them before removing the old key.", details=details)
    return Check("vault", "Vault", "ok", "minor", "Keys loaded.", details=details)


def _model_catalog() -> Check:
    from app.app_settings import catalog

    data = catalog.load()
    details = {"models": len(data.get("models") or []), "fetched_at": data.get("fetched_at")}
    if data.get("error"):
        return Check("model_catalog", "Model list", "degraded", "minor",
                     "The last refresh of Mistral's model list failed.",
                     details={**details, "error": str(data["error"])[:200]})
    if catalog.is_stale():
        return Check("model_catalog", "Model list", "degraded", "minor",
                     "Mistral's model list hasn't been refreshed recently.", details=details)
    return Check("model_catalog", "Model list", "ok", "minor", "Up to date.", details=details)


# ── Verdict ─────────────────────────────────────────────────────────────────

def _verdict(checks: list[Check]) -> str:
    bad = [c for c in checks if c.state in ("down", "degraded")]
    if any(c.severity == "critical" and c.state == "down" for c in bad):
        return "outage"
    if any(c.severity in ("critical", "major") for c in bad):
        return "degraded"
    return "operational"


_HEADLINES = {
    "operational": "All systems operational",
    "degraded": "Some features are affected",
    "outage": "The platform is unavailable",
}


async def _cached(key: tuple, build) -> dict:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    async with _lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
            return hit[1]
        out = await build()
        _cache[key] = (time.monotonic(), out)
        return out


def clear_cache() -> None:
    _cache.clear()
    _mistral_cache.clear()


# ── For users ───────────────────────────────────────────────────────────────

_USER_NAMES = {
    "database": "Platform",
    "mistral": "AI models (Mistral)",
    "tool_service": "Tools",
    "knowledge_graph": "Knowledge graph",
    "worker": "Workflow runs",
}


async def user_status(workspace_id: Optional[str]) -> dict:
    async def build() -> dict:
        from app.dependencies import WorkspaceKeyMissing, current_mistral_api_key

        try:
            key: Optional[str] = current_mistral_api_key()
        except WorkspaceKeyMissing:
            key = None
        db, tools, mistral, graph, worker = await asyncio.gather(
            asyncio.to_thread(_database), _tool_service(), _mistral(key),
            asyncio.to_thread(_knowledge_graph), asyncio.to_thread(_worker, workspace_id),
        )
        checks = [c for c in (db, mistral, tools, worker, graph) if c is not None]
        status = _verdict(checks)
        components = [{
            "key": c.key, "name": _USER_NAMES.get(c.key, c.name), "state": c.state,
            "message": c.message, "impact": c.impact if c.state != "ok" else None,
        } for c in checks]
        return {
            "status": status, "headline": _HEADLINES[status], "checked_at": time.time(),
            "components": components,
            "issues": [c for c in components if c["state"] in ("down", "degraded", "off")],
        }

    return await _cached(("user", workspace_id), build)


# ── For admins ──────────────────────────────────────────────────────────────

async def admin_health(*, refresh: bool = False) -> dict:
    if refresh:
        clear_cache()

    async def build() -> dict:
        from app.auth import store, workers

        db, tools, mistral, graph, obs, vault, models = await asyncio.gather(
            asyncio.to_thread(_database), _tool_service(),
            _mistral(settings.MISTRAL_API_KEY, label="the platform (Default workspace)"),
            asyncio.to_thread(_knowledge_graph), asyncio.to_thread(_observability),
            asyncio.to_thread(_vault), asyncio.to_thread(_model_catalog),
        )
        api = Check("api", "API server", "ok", "critical", "Serving requests.", details={
            "version": VERSION, "uptime_seconds": int(time.time() - STARTED_AT),
            "python": platform.python_version(), "host": platform.node(),
        })
        checks = [api, db, mistral, tools, graph, vault, obs, models]

        # Every workspace: its key as Mistral last answered, and its worker.
        workspaces = await asyncio.to_thread(store.list_workspaces)
        status_file = await asyncio.to_thread(workers.read_status)
        files = await asyncio.to_thread(workers.files_by_workspace)
        rows = []
        for ws in workspaces:
            entry = status_file["workers"].get(ws["id"]) or {}
            published = len(files.get(ws["id"], []))
            rows.append({
                "id": ws["id"], "name": ws["name"], "disabled": ws["disabled"],
                "is_default": ws["is_default"], "members": ws["members"],
                "key_status": ws["key_status"], "key_checked_at": ws["key_checked_at"],
                "key_error": ws["key_error"],
                "worker": {
                    "state": entry.get("state") or ("idle" if not published else "stopped"),
                    "published_workflows": published,
                    "deployment": workers.deployment_name(ws["id"]),
                    "restarts": entry.get("restarts", 0),
                    "last_error": entry.get("last_error"),
                },
            })
        bad_keys = [r for r in rows if r["key_status"] == "invalid" and not r["disabled"]]
        if bad_keys:
            checks.append(Check(
                "workspace_keys", "Workspace keys", "degraded", "major",
                f"Mistral rejected the key of {len(bad_keys)} workspace(s): "
                + ", ".join(r["name"] for r in bad_keys) + ".",
                impact="Their members can't use AI features until the key is replaced.",
                details={"workspaces": [r["id"] for r in bad_keys]}))
        if settings.MISTRAL_WORKER_ENABLED:
            down = [r for r in rows if r["worker"]["published_workflows"]
                    and not r["disabled"] and r["key_status"] != "invalid"
                    and (r["worker"]["state"] != "running" or status_file.get("stale"))]
            checks.append(Check(
                "workers", "Workflow workers",
                "down" if down else "ok", "major",
                (f"{len(down)} workspace worker(s) not running: "
                 + ", ".join(r["name"] for r in down) + ".") if down
                else "Every workspace with published workflows has a running worker.",
                impact="Their Mistral-hosted workflow runs won't start." if down else None,
                details={"supervisor_updated_at": status_file.get("updated_at"),
                         "stale": bool(status_file.get("stale"))}))
        else:
            checks.append(Check("workers", "Workflow workers", "off", "minor",
                                "Turned off (MISTRAL_WORKER_ENABLED=false). Workflows run on the "
                                "local engine only."))
        status = _verdict(checks)
        return {
            "status": status, "headline": _HEADLINES[status], "checked_at": time.time(),
            "components": [asdict(c) for c in checks], "workspaces": rows,
            "environment": settings.OBSERVABILITY_ENVIRONMENT,
        }

    return await _cached(("admin",), build)
