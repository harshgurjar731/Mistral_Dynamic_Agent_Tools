"""
Remote Server Routes — deployment targets for tools and workflow packages.

CRUD, provider catalog, diagnostics (per server, bulk, and for unsaved
config), tool push, workflow package deployment and deployment history.
Static paths are declared before ``/remote-servers/{server_id}`` so they are
not captured by it.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.remote_server_model import RemoteServer, RemoteDeployment
from app.remote_servers import checks, deployers, store
from app.remote_servers import secrets as secret_box
from app.remote_servers.providers import catalog, get_provider

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Remote Servers"])


def _require_db(db: Optional[Session]) -> Session:
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")
    return db


def _get_server(db: Session, server_id: int) -> RemoteServer:
    server = db.get(RemoteServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


def _save_check(db: Session, server: RemoteServer, result: dict) -> None:
    # The check may have re-resolved a Brev server's settings and saved them
    # from another session; don't write the stale copy back over them.
    db.refresh(server)
    server.last_status = result["status"]
    server.last_check = json.dumps(result, default=str)
    server.last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    # Trust on first use: remember the SSH host key the first time we see it.
    fp = result.get("host_fingerprint")
    config = store.server_config(server)
    if fp and not config.get("host_fingerprint"):
        config["host_fingerprint"] = fp
        server.config = json.dumps(config)
    db.commit()


def _parse_body(body: dict) -> tuple[str, str, dict, dict]:
    """Accept the structured body, and the legacy {name, url, description} one."""
    provider = body.get("provider") or "mcp_code_endpoint"
    purpose = body.get("purpose") or ("tool" if provider == "mcp_code_endpoint" else "workflow")
    config = dict(body.get("config") or {})
    if "url" in body and "url" not in config:
        config["url"] = body["url"]
    return provider, purpose, config, dict(body.get("secrets") or {})


# ── Catalog ──────────────────────────────────────────────────────────────

@router.get("/remote-servers/providers")
async def list_providers():
    """Server kinds, the fields each needs, and workflow post-deploy actions."""
    return catalog()


# ── List / create ────────────────────────────────────────────────────────

@router.get("/remote-servers")
async def list_remote_servers(purpose: Optional[str] = None, db: Session = Depends(get_db)):
    if not db:
        return []
    q = db.query(RemoteServer)
    if purpose:
        q = q.filter(RemoteServer.purpose == purpose)
    return [store.to_dict(s) for s in q.order_by(RemoteServer.created_at.desc()).all()]


@router.post("/remote-servers")
async def add_remote_server(request: Request, db: Session = Depends(get_db)):
    db = _require_db(db)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    provider, purpose, config, secrets = _parse_body(body)
    try:
        config, secrets = store.normalise(provider, purpose, config, secrets)
    except store.ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    server = RemoteServer(
        name=name,
        description=(body.get("description") or "").strip(),
        purpose=purpose,
        provider=provider,
        url=store.display_address(provider, config),
        config=json.dumps(config),
        secrets=secret_box.encrypt(secrets),
    )
    # A test run from the add form can hand its result over, so the new
    # server starts with a known status instead of "not checked".
    initial_check = body.get("initial_check")
    db.add(server)
    db.commit()
    db.refresh(server)
    if isinstance(initial_check, dict) and initial_check.get("status"):
        _save_check(db, server, initial_check)
        db.refresh(server)
    out = store.to_dict(server)
    # Provisioned providers (Brev) get their connection details now; the UI
    # follows the returned deployment's log.
    if (get_provider(provider) or {}).get("provisioned"):
        out["provision_deployment_id"] = deployers.start_brev_provision(db, server).id
    return out


# ── Diagnostics ──────────────────────────────────────────────────────────

@router.post("/remote-servers/test")
async def test_connection(request: Request, db: Session = Depends(get_db)):
    """Run diagnostics on unsaved settings (the add/edit form).

    With ``server_id``, blank secrets fall back to that server's stored ones,
    so the edit form can test without re-typing a password.
    """
    body = await request.json()
    provider, purpose, config, secrets = _parse_body(body)
    stored: dict = {}
    if body.get("server_id") and db:
        existing = db.get(RemoteServer, int(body["server_id"]))
        if existing:
            stored = store.server_secrets(existing)
            config.setdefault("host_fingerprint", store.server_config(existing).get("host_fingerprint"))
    try:
        fp = config.get("host_fingerprint")
        config, secrets = store.normalise(provider, purpose, config, secrets, stored_secrets=stored)
        if fp:
            config["host_fingerprint"] = fp
    except store.ValidationError as e:
        return {"status": "unreachable", "ok": False, "reachable": False, "checks": [
            {"id": "config", "label": "Configuration", "status": "fail", "detail": str(e)}
        ], "system": {}}
    return await checks.run_checks(provider, config, secrets)


@router.post("/remote-servers/check-all")
async def check_all(purpose: Optional[str] = None, db: Session = Depends(get_db)):
    """Run diagnostics on every saved server concurrently."""
    db = _require_db(db)
    q = db.query(RemoteServer)
    if purpose:
        q = q.filter(RemoteServer.purpose == purpose)
    servers = q.all()
    sem = asyncio.Semaphore(6)

    async def one(s: RemoteServer):
        async with sem:
            return await checks.run_checks(s.provider or "mcp_code_endpoint",
                                           store.server_config(s), store.server_secrets(s))

    results = await asyncio.gather(*(one(s) for s in servers))
    summary = {"healthy": 0, "degraded": 0, "unreachable": 0}
    out = []
    for s, r in zip(servers, results):
        _save_check(db, s, r)
        summary[r["status"]] = summary.get(r["status"], 0) + 1
        out.append({"id": s.id, "name": s.name, "status": r["status"]})
    return {"summary": summary, "results": out}


@router.post("/remote-servers/check")
async def check_reachability(request: Request):
    """Legacy: quick reachability of a bare URL."""
    body = await request.json()
    url = (body.get("url") or "").strip()
    if not url:
        return {"reachable": False, "error": "No URL provided"}
    result = await checks.run_checks("mcp_code_endpoint", {"url": url}, {})
    return {"reachable": result["reachable"], "url": url, "health": result.get("health")}


@router.get("/remote-servers/deployments/{deployment_id}")
async def get_deployment(deployment_id: int, db: Session = Depends(get_db)):
    db = _require_db(db)
    dep = db.get(RemoteDeployment, deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return store.deployment_to_dict(dep)


@router.post("/remote-servers/deployments/{deployment_id}/cancel")
async def cancel_deployment(deployment_id: int, db: Session = Depends(get_db)):
    """Stop a running console command (e.g. a `logs -f`)."""
    db = _require_db(db)
    dep = db.get(RemoteDeployment, deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if dep.kind != "command":
        raise HTTPException(status_code=422, detail="Only console commands can be stopped")
    if deployers.cancel_command(deployment_id):
        return {"status": "stopping", "id": deployment_id}
    if dep.status in ("queued", "running"):
        # Nothing in this process runs it any more (its task ended without
        # recording a final status): close the row so the UI stops waiting.
        dep.status = "failed"
        dep.error = "Not running any more — stopped tracking it"
        dep.log = (dep.log or "") + "\n■ Stopped (no longer running on the backend)\n"
        dep.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return {"status": "cleared", "id": deployment_id}
    raise HTTPException(status_code=409, detail="This command has already finished")


@router.get("/remote-servers/deployments")
async def list_all_deployments(workflow_name: Optional[str] = None, limit: int = 50,
                               db: Session = Depends(get_db)):
    """Recent deployments across servers — optionally for one workflow."""
    db = _require_db(db)
    q = db.query(RemoteDeployment)
    if workflow_name:
        q = q.filter(RemoteDeployment.kind == "workflow", RemoteDeployment.target == workflow_name)
    deps = q.order_by(RemoteDeployment.id.desc()).limit(min(limit, 200)).all()
    names = {s.id: s.name for s in db.query(RemoteServer).all()}
    return [{**store.deployment_to_dict(d, include_log=False), "server_name": names.get(d.server_id)} for d in deps]


# ── Single server ────────────────────────────────────────────────────────

@router.get("/remote-servers/{server_id}")
async def get_remote_server(server_id: int, db: Session = Depends(get_db)):
    return store.to_dict(_get_server(_require_db(db), server_id))


@router.put("/remote-servers/{server_id}")
async def update_remote_server(server_id: int, request: Request, db: Session = Depends(get_db)):
    db = _require_db(db)
    server = _get_server(db, server_id)
    body = await request.json()

    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name is required")
        server.name = name
    if "description" in body:
        server.description = (body["description"] or "").strip()

    provider = body.get("provider") or server.provider or "mcp_code_endpoint"
    purpose = body.get("purpose") or server.purpose or "tool"
    old_config = store.server_config(server)
    config = dict(old_config)
    if "config" in body:
        config.update(body.get("config") or {})
    if "url" in body:
        config["url"] = body["url"]
    try:
        clean, secrets = store.normalise(provider, purpose, config, body.get("secrets") or {},
                                         stored_secrets=store.server_secrets(server))
    except store.ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Keep the stored host key unless the host changed or the user cleared it.
    same_host = (clean.get("host"), clean.get("port")) == (old_config.get("host"), old_config.get("port"))
    fp = config.get("host_fingerprint", old_config.get("host_fingerprint"))
    if fp and same_host and provider == server.provider:
        clean["host_fingerprint"] = fp

    connection_changed = clean != old_config or provider != server.provider
    secrets_changed = any(v != "" for v in (body.get("secrets") or {}).values())
    server.provider, server.purpose = provider, purpose
    server.config = json.dumps(clean)
    server.secrets = secret_box.encrypt(secrets)
    server.url = store.display_address(provider, clean)
    if connection_changed or secrets_changed:
        server.last_status = None  # previous diagnostics no longer describe this config
    db.commit()
    db.refresh(server)
    return store.to_dict(server)


@router.delete("/remote-servers/{server_id}")
async def delete_remote_server(server_id: int, db: Session = Depends(get_db)):
    db = _require_db(db)
    server = _get_server(db, server_id)
    db.query(RemoteDeployment).filter(RemoteDeployment.server_id == server_id).delete()
    db.delete(server)
    db.commit()
    return {"status": "deleted", "id": server_id}


@router.post("/remote-servers/{server_id}/check")
async def check_server(server_id: int, db: Session = Depends(get_db)):
    """Full diagnostics for a saved server; the result is stored on it."""
    db = _require_db(db)
    server = _get_server(db, server_id)
    result = await checks.run_checks(server.provider or "mcp_code_endpoint",
                                     store.server_config(server), store.server_secrets(server))
    _save_check(db, server, result)
    return result


@router.post("/remote-servers/{server_id}/provision")
async def provision_server(server_id: int, db: Session = Depends(get_db)):
    """(Re-)resolve a Brev server's SSH access and prepare the VM; poll the returned deployment."""
    db = _require_db(db)
    server = _get_server(db, server_id)
    if not (get_provider(server.provider or "") or {}).get("provisioned"):
        raise HTTPException(status_code=422, detail=f"'{server.name}' is not a provisioned server type")
    try:
        dep = deployers.start_brev_provision(db, server)
    except deployers.DeployError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return store.deployment_to_dict(dep)


@router.post("/remote-servers/{server_id}/commands")
async def run_command(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Run a console command (or a preset) over SSH; poll the returned deployment.

    Body: {command? | preset?, workflow?, timeout?} — ``workflow`` runs it in
    that deployed workflow's directory, otherwise in the deploy directory.
    """
    db = _require_db(db)
    server = _get_server(db, server_id)
    if (get_provider(server.provider or "") or {}).get("transport") != "ssh":
        raise HTTPException(status_code=422, detail=f"'{server.name}' is not an SSH server")
    body = await request.json()
    try:
        dep = deployers.start_remote_command(
            db, server,
            command=str(body.get("command") or ""),
            preset=str(body.get("preset") or ""),
            workflow=str(body.get("workflow") or "").strip(),
            timeout=int(body.get("timeout") or 600),
        )
    except (deployers.DeployError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return store.deployment_to_dict(dep)


def _require_ssh(server: RemoteServer) -> None:
    if (get_provider(server.provider or "") or {}).get("transport") != "ssh":
        raise HTTPException(status_code=422, detail=f"'{server.name}' is not an SSH server")


@router.post("/remote-servers/{server_id}/build")
async def build_workflow(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Build (and optionally start) a deployed workflow's Docker stack on the server.

    Body: {workflow, services[], no_cache, pull, run_bootstrap, start,
    force_recreate, remove_orphans, build_args{}, env{}} — ``env`` is merged
    into the workflow's .env first. Poll the returned deployment for the log.
    """
    db = _require_db(db)
    server = _get_server(db, server_id)
    _require_ssh(server)
    body = await request.json()
    workflow = str(body.get("workflow") or "").strip()
    if not workflow:
        raise HTTPException(status_code=422, detail="Choose a deployed workflow")
    try:
        command = deployers.build_compose_command(
            services=list(body.get("services") or ["backend"]),
            no_cache=bool(body.get("no_cache")),
            pull=bool(body.get("pull")),
            run_bootstrap=bool(body.get("run_bootstrap")),
            start=body.get("start", True) is not False,
            force_recreate=bool(body.get("force_recreate")),
            remove_orphans=bool(body.get("remove_orphans")),
            build_args=body.get("build_args") or {},
        )
        dep = deployers.start_remote_command(
            db, server, command=command, workflow=workflow, timeout=3600, action="build",
            env=deployers.clean_env(body.get("env") or {}),
        )
    except (deployers.DeployError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return store.deployment_to_dict(dep)


@router.post("/remote-servers/{server_id}/delete-workflow")
async def delete_remote_workflow(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Delete a deployed workflow package from the server; poll the returned deployment.

    Body: {workflow, confirm, stop_containers=true, remove_volumes=false,
    remove_images=false} — ``confirm`` must repeat the workflow name.
    """
    db = _require_db(db)
    server = _get_server(db, server_id)
    _require_ssh(server)
    body = await request.json()
    workflow = str(body.get("workflow") or "").strip()
    if not workflow:
        raise HTTPException(status_code=422, detail="Choose a deployed workflow")
    if str(body.get("confirm") or "").strip() != workflow:
        raise HTTPException(status_code=422, detail="Type the workflow name to confirm the deletion")
    try:
        command = deployers.build_delete_command(
            workflow,
            stop_containers=body.get("stop_containers", True) is not False,
            remove_volumes=bool(body.get("remove_volumes")),
            remove_images=bool(body.get("remove_images")),
        )
        # Runs in the deploy directory: the workflow's own directory is what goes.
        dep = deployers.start_remote_command(db, server, command=command, timeout=600,
                                             action="delete", target=workflow)
    except (deployers.DeployError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return store.deployment_to_dict(dep)


@router.post("/remote-servers/{server_id}/run-workflow")
async def run_workflow_on_server(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Start a run of a deployed workflow on this server's worker.

    Mistral routes a run to the worker polling the run's deployment name, so
    this sends it with the DEPLOYMENT_NAME from the workflow's .env on the
    server (or ``deployment_name`` from the body). Body: {workflow, input{},
    deployment_name?}.
    """
    import hashlib

    from app.config import settings
    from app.routes.workflows import WORKER_DEPLOYMENT, _check_required_inputs, mistral_execute
    from app.services.workflow_engine.engine import get_workflow

    db = _require_db(db)
    server = _get_server(db, server_id)
    _require_ssh(server)
    body = await request.json()
    workflow = str(body.get("workflow") or "").strip()
    inputs = body.get("input") or {}
    if not workflow:
        raise HTTPException(status_code=422, detail="Choose a deployed workflow")
    if not isinstance(inputs, dict):
        raise HTTPException(status_code=422, detail="input must be an object")

    local = get_workflow(workflow)
    if local:
        _check_required_inputs(local, inputs)

    warnings: list[str] = []
    try:
        info = await asyncio.to_thread(deployers.remote_env_info, store.server_config(server),
                                       store.server_secrets(server), workflow)
    except (deployers.DeployError, Exception) as e:
        raise HTTPException(status_code=422, detail=f"Could not read the workflow's .env on the server: {e}")

    deployment = str(body.get("deployment_name") or "").strip() or info["deployment_name"]
    if not deployment:
        raise HTTPException(status_code=422, detail="The workflow's .env on the server has no DEPLOYMENT_NAME "
                                                    "— set one (Build panel → .env overrides) and restart the worker")
    empty_hash = hashlib.sha256(b"").hexdigest()
    local_hash = hashlib.sha256((settings.MISTRAL_API_KEY or "").encode()).hexdigest()
    if info["key_hash"] in ("", empty_hash):
        raise HTTPException(status_code=422, detail="The workflow's .env on the server has no MISTRAL_API_KEY")
    if info["key_hash"] != local_hash:
        raise HTTPException(status_code=422, detail=(
            "The server's MISTRAL_API_KEY belongs to a different key than this app's, so its worker "
            "polls another workspace and would never pick up this run. Set the same key in the "
            "server's .env (Build panel → .env overrides) and restart the worker."))
    if deployment == WORKER_DEPLOYMENT and settings.MISTRAL_WORKER_ENABLED:
        warnings.append(f"This app's own worker also polls '{deployment}', so it may take this run "
                        "instead of the server. Give the server its own DEPLOYMENT_NAME, or set "
                        "MISTRAL_WORKER_ENABLED=false for this app.")

    try:
        data = await mistral_execute(workflow, inputs, deployment)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "execution_id": data.get("execution_id", data.get("id", "")),
        "status": str(data.get("status", "RUNNING")).upper(),
        "workflow_name": workflow,
        "deployment_name": deployment,
        "warnings": warnings,
    }


@router.get("/remote-servers/{server_id}/remote-workflows")
async def remote_workflows(server_id: int, db: Session = Depends(get_db)):
    """Workflows currently unpacked on an SSH server, with their containers."""
    db = _require_db(db)
    server = _get_server(db, server_id)
    provider = get_provider(server.provider or "") or {}
    if provider.get("transport") != "ssh":
        return {"supported": False, "items": []}
    try:
        items = await asyncio.to_thread(deployers.list_remote_workflows,
                                        store.server_config(server), store.server_secrets(server))
    except Exception as e:
        return {"supported": True, "items": [], "error": str(e)}
    return {"supported": True, "items": items}


@router.get("/remote-servers/{server_id}/deployments")
async def list_server_deployments(server_id: int, db: Session = Depends(get_db)):
    db = _require_db(db)
    _get_server(db, server_id)
    deps = (db.query(RemoteDeployment).filter(RemoteDeployment.server_id == server_id)
            .order_by(RemoteDeployment.id.desc()).limit(50).all())
    return [store.deployment_to_dict(d, include_log=False) for d in deps]


@router.post("/remote-servers/{server_id}/send-tool")
async def send_tool_to_remote(server_id: int, request: Request, db: Session = Depends(get_db)):
    """POST a dynamic tool's source code to a tool-deployment server."""
    db = _require_db(db)
    server = _get_server(db, server_id)
    if (server.purpose or "tool") != "tool":
        return {"status": "error", "message": f"'{server.name}' is a workflow deployment server"}
    body = await request.json()
    tool_id = body.get("tool_id")
    if not tool_id:
        return {"status": "error", "message": "tool_id is required"}
    return await deployers.send_tool(db, server, str(tool_id))


@router.post("/remote-servers/{server_id}/deploy-workflow")
async def deploy_workflow(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Start deploying a workflow package; poll the returned deployment."""
    db = _require_db(db)
    server = _get_server(db, server_id)
    if server.purpose != "workflow":
        raise HTTPException(status_code=422, detail=f"'{server.name}' is not a workflow deployment server")
    body = await request.json()
    workflow_name = (body.get("workflow_name") or "").strip()
    if not workflow_name:
        raise HTTPException(status_code=422, detail="workflow_name is required")
    try:
        dep = deployers.start_workflow_deployment(db, server, workflow_name, body)
    except deployers.DeployError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return store.deployment_to_dict(dep)
