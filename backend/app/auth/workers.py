"""
One Mistral Workflows worker per workspace.

A worker process can serve only one Mistral key: the Workflows SDK reads its
key and task queue from process-wide environment variables, and its activity
registry is global. So the supervisor (``app/services/mistral_worker.py``)
runs one worker process per workspace that has published workflows, each on
that workspace's key and its own task queue, loading only that workspace's
compiled workflows. This module holds what the supervisor, the API (which
registers and starts runs on those queues) and the admin console share.

Task queues: the Default workspace keeps ``DEPLOYMENT_NAME`` exactly, so
workflows published before workspaces existed — and remote servers set up for
them — keep working. Every other workspace gets ``<DEPLOYMENT_NAME>-<id8>``,
which stays distinct even when two platform workspaces hold keys to the same
Mistral workspace.
"""

from __future__ import annotations

import glob
import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

STATUS_FILE = ".worker_status.json"


# ── Task queues ─────────────────────────────────────────────────────────────

def base_deployment() -> str:
    from app.config import settings

    return (os.environ.get("DEPLOYMENT_NAME") or settings.DEPLOYMENT_NAME or "default").strip()


_default_ws_cache: Optional[str] = None


def _default_workspace() -> Optional[str]:
    global _default_ws_cache
    from app.auth import scoping

    ws = scoping.default_workspace_id()
    if ws:
        return ws
    if _default_ws_cache is None:
        try:
            from app.auth.models import Workspace
            from app.database import SessionLocal

            with SessionLocal() as db:
                row = db.query(Workspace.id).filter(Workspace.is_default.is_(True)).first()
                _default_ws_cache = row[0] if row else ""
        except Exception:
            return None
    return _default_ws_cache or None


def deployment_name(workspace_id: Optional[str]) -> str:
    """The task queue of a workspace's worker."""
    base = base_deployment()
    if not workspace_id or workspace_id == _default_workspace():
        return base
    return f"{base}-{workspace_id[:8]}"


def current_deployment_name() -> str:
    """The task queue for the caller's workspace (the request's, or the worker's)."""
    from app.auth.context import current_workspace_id

    return deployment_name(current_workspace_id())


# ── Which compiled workflow belongs to which workspace ──────────────────────

def workflows_dir() -> str:
    from app.config import settings

    backend = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    raw = os.environ.get("WORKFLOWS_DIR") or settings.MISTRAL_WORKFLOWS_DIR or "../mistral_workflows"
    return os.path.abspath(raw if os.path.isabs(raw) else os.path.join(backend, raw))


def _workflow_owners() -> dict[str, Optional[str]]:
    """Workflow name → owning workspace, for every workflow in the database."""
    from app.auth.context import unscoped
    from app.services.workflow_engine import engine as wf

    with unscoped(), wf._Session() as db:
        return {name: ws for name, ws in db.query(wf._WorkflowRecord.name,
                                                   wf._WorkflowRecord.workspace_id).all()}


def files_by_workspace(directory: Optional[str] = None,
                       owners: Optional[dict[str, Optional[str]]] = None) -> dict[str, list[str]]:
    """Compiled ``workflow_<name>.py`` files, grouped by the workspace that owns
    ``<name>``. A file with no workflow record (compiled before workspaces, or
    by hand) belongs to the Default workspace, which is where it ran before."""
    directory = directory or workflows_dir()
    owners = _workflow_owners() if owners is None else owners
    default = _default_workspace()
    out: dict[str, list[str]] = {}
    for path in sorted(glob.glob(os.path.join(directory, "workflow_*.py"))):
        name = os.path.basename(path)[len("workflow_"):-len(".py")]
        ws = owners.get(name) or default
        if ws:
            out.setdefault(ws, []).append(os.path.basename(path))
    return out


# ── What should be running ──────────────────────────────────────────────────

@dataclass(frozen=True)
class WorkerSpec:
    workspace_id: str
    workspace_name: str
    deployment: str
    key_fingerprint: str
    files: tuple[str, ...]

    def same_process(self, other: "WorkerSpec") -> bool:
        """Can a running worker for ``other`` keep serving this spec?"""
        return (self.deployment, self.key_fingerprint, self.files) == \
            (other.deployment, other.key_fingerprint, other.files)


def fingerprint(key: str) -> str:
    return hashlib.sha256((key or "").encode()).hexdigest()[:16]


def desired_workers(workspaces: Iterable[dict], keys: dict[str, Optional[str]],
                    files: dict[str, list[str]]) -> dict[str, WorkerSpec]:
    """One worker per enabled workspace with a key and at least one published
    workflow. Pure: the supervisor feeds it the database's state."""
    out: dict[str, WorkerSpec] = {}
    for ws in workspaces:
        wid = ws["id"]
        if ws.get("disabled") or ws.get("key_status") == "invalid":
            continue
        key = keys.get(wid)
        own = files.get(wid) or []
        if not key or not own:
            continue
        out[wid] = WorkerSpec(
            workspace_id=wid, workspace_name=ws.get("name") or wid,
            deployment=deployment_name(wid), key_fingerprint=fingerprint(key),
            files=tuple(sorted(own)),
        )
    return out


# ── Status, written by the supervisor and read by the admin console ─────────

@dataclass
class WorkerStatus:
    workspace_id: str
    workspace_name: str = ""
    #: running | starting | crashed | stopped
    state: str = "stopped"
    deployment: str = ""
    pid: Optional[int] = None
    workflows: int = 0
    started_at: Optional[float] = None
    restarts: int = 0
    last_exit_code: Optional[int] = None
    last_error: Optional[str] = None
    extra: dict = field(default_factory=dict)


def status_path(directory: Optional[str] = None) -> str:
    return os.path.join(directory or workflows_dir(), STATUS_FILE)


def write_status(statuses: dict[str, WorkerStatus], *, directory: Optional[str] = None) -> None:
    payload = {"updated_at": time.time(), "workers": {k: asdict(v) for k, v in statuses.items()}}
    path = status_path(directory)
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp, path)
    except OSError as e:
        logger.debug("Worker status not written: %s", e)


def read_status(directory: Optional[str] = None) -> dict:
    """``{"enabled", "updated_at", "workers": {workspace_id: {...}}}``."""
    from app.config import settings

    out = {"enabled": bool(settings.MISTRAL_WORKER_ENABLED), "updated_at": None, "workers": {}}
    try:
        with open(status_path(directory), encoding="utf-8") as f:
            data = json.load(f)
        out["updated_at"] = data.get("updated_at")
        out["workers"] = data.get("workers") or {}
    except (OSError, ValueError):
        pass
    # A supervisor that stopped writing (crashed, or the app restarted with the
    # worker off) leaves a stale file: report it as such rather than "running".
    if out["updated_at"] and time.time() - out["updated_at"] > 180:
        out["stale"] = True
    return out


def worker_for(workspace_id: str) -> dict:
    """The admin console's view of one workspace's worker."""
    status = read_status()
    entry = status["workers"].get(workspace_id)
    files = files_by_workspace().get(workspace_id, [])
    return {
        "enabled": status["enabled"],
        "stale": bool(status.get("stale")),
        "deployment": deployment_name(workspace_id),
        "published_workflows": len(files),
        "state": (entry or {}).get("state") or ("idle" if not files else "stopped"),
        "pid": (entry or {}).get("pid"),
        "started_at": (entry or {}).get("started_at"),
        "restarts": (entry or {}).get("restarts", 0),
        "last_error": (entry or {}).get("last_error"),
        "updated_at": status["updated_at"],
    }
