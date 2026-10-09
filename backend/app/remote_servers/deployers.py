"""
Deployers — push a dynamic tool or a workflow package to a remote server.

Tool pushes are quick and synchronous. Workflow deployments build the same
.zip the "Download package" button produces, then run as a background task
recorded in ``remote_deployments``: the UI polls the row for status and log.

SSH workflow deployment, in the workflow's directory on the server:
  1. upload package.zip over SFTP and extract it (python3 zipfile, or unzip);
  2. write .env over a plain exec channel — the existing one (kept across
     redeploys) or .env.template, overlaid with the server's stored env vars
     and any deploy-time API key;
  3. run the chosen post-deploy action (bootstrap / docker compose / custom).
"""

from __future__ import annotations

import asyncio
import difflib
import io
import ipaddress
import json
import logging
import posixpath
import re
import shlex
import threading
import time
from datetime import datetime, timezone

import httpx
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal
from app.remote_server_model import RemoteServer, RemoteDeployment
from app.remote_servers import brev, checks, ssh, store
from app.remote_servers import secrets as secret_box
from app.remote_servers.checks import http_auth
from app.remote_servers.providers import (
    BOOTSTRAP_COMMAND, COMMAND_PRESETS, WORKFLOW_ACTIONS, get_provider,
)
from app.remote_servers.edge import EDGE_BLOCK_ADVICE, edge_block

logger = logging.getLogger(__name__)

# Strong references so running deployments are not garbage-collected.
_TASKS: set[asyncio.Task] = set()


class DeployError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _error_text(e: BaseException) -> str:
    # Some errors carry no message (paramiko's EOFError when a channel drops),
    # which would otherwise leave a bare "✖" as the last line of the log.
    return str(e).strip() or f"{type(e).__name__} (no details — see the backend log)"


class _DeployLog:
    """Appends to a deployment row's log, flushing at most once a second.

    Called from the event loop and from the SSH worker thread alike. Output
    that arrives within a second of a flush is saved by a timer, so the last
    lines before a quiet stretch (a long build step) still reach the UI.
    """

    def __init__(self, dep_id: int):
        self.dep_id = dep_id
        self._buf: list[str] = []
        self._lock = threading.Lock()
        self._db_lock = threading.Lock()
        self._last_flush = 0.0
        self._timer: threading.Timer | None = None

    def write(self, text: str) -> None:
        with self._lock:
            self._buf.append(text)
            due = time.monotonic() - self._last_flush > 1.0
            if not due and self._timer is None:
                self._timer = threading.Timer(1.0, self._timed_flush)
                self._timer.daemon = True
                self._timer.start()
        if due:
            self.flush()

    def _timed_flush(self) -> None:
        with self._lock:
            self._timer = None
        try:
            self.flush()
        except Exception:  # the next write or the final flush retries
            logger.warning("Deployment %s: timed log flush failed", self.dep_id, exc_info=True)

    def step(self, text: str) -> None:
        self.write(f"\n▶ {text}\n")
        self.flush()

    def flush(self, **fields) -> None:
        # One flush at a time per log: the SSH thread and the event loop both
        # flush, and two read-append-write cycles would drop a chunk.
        with self._db_lock:
            with self._lock:
                chunk = "".join(self._buf)
                self._buf.clear()
                self._last_flush = time.monotonic()
            if not chunk and not fields:
                return
            # SQLite is briefly locked under concurrent writers; losing the
            # final status write would leave the row "running" forever.
            for attempt in range(5):
                db = SessionLocal()
                try:
                    dep = db.get(RemoteDeployment, self.dep_id)
                    if dep:
                        dep.log = (dep.log or "") + chunk
                        for k, v in fields.items():
                            setattr(dep, k, v)
                        db.commit()
                    return
                except OperationalError:
                    db.rollback()
                    if attempt == 4:
                        raise
                    time.sleep(0.5 * (attempt + 1))
                finally:
                    db.close()


# ── Tool push ────────────────────────────────────────────────────────────

async def send_tool(db, server: RemoteServer, tool_id: str) -> dict:
    """POST a dynamic tool's source to a tool-purpose server's endpoint."""
    from app.services.tool_resolver import tool_resolver

    config, secrets = store.server_config(server), store.server_secrets(server)
    try:
        tools = await tool_resolver.list_tools()
    except Exception as e:
        return {"status": "error", "message": f"Failed to fetch tool: {e}"}
    tool = next((t for t in tools if str(t.get("id")) == str(tool_id)), None)
    if not tool:
        return {"status": "error", "message": f"Tool {tool_id} not found in tool service"}
    source_code = tool.get("source_code", "")
    if not source_code:
        return {"status": "error", "message": "Tool has no source code to send"}

    tool_name = tool.get("name", "unknown")
    description = (
        tool.get("description")
        or ((tool.get("schema", {}) or {}).get("function", {}) or {}).get("description")
        or f"Dynamic tool: {tool_name}"
    )
    # The remote MCP server's /submit-code contract: {name, description, code},
    # where code defines run(...).
    payload = {"name": tool_name, "description": str(description), "code": source_code}

    dep = RemoteDeployment(server_id=server.id, kind="tool", target=tool_name, status="running",
                           options=json.dumps({"tool_id": str(tool_id)}), log="")
    db.add(dep)
    db.commit()
    db.refresh(dep)

    remote_url = (config.get("url") or server.url).rstrip("/")
    headers, auth = http_auth(config, secrets)
    verify = str(config.get("verify_tls", "true")).lower() != "false"
    result: dict
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=verify) as client:
            resp = await client.post(remote_url, json=payload, headers=headers, auth=auth)
        body: object = resp.text[:2000]
        try:
            body = resp.json()
        except ValueError:
            pass
        if resp.status_code < 400:
            result = {"status": "sent", "server_name": server.name, "tool_name": tool_name,
                      "remote_status_code": resp.status_code, "remote_response": body}
        else:
            detail = body.get("detail", body) if isinstance(body, dict) else body
            result = {"status": "error", "message": f"Remote server returned {resp.status_code}: {detail}"}
    except httpx.ConnectError:
        result = {"status": "error", "message": f"Cannot reach remote server at {remote_url}"}
    except Exception as e:
        result = {"status": "error", "message": str(e)}

    dep.status = "succeeded" if result["status"] == "sent" else "failed"
    dep.error = result.get("message")
    dep.log = f"POST {remote_url}\n{json.dumps(result, indent=2, default=str)}\n"
    dep.finished_at = _now()
    db.commit()
    result["deployment_id"] = dep.id
    return result


# ── Workflow deployment ──────────────────────────────────────────────────

def start_workflow_deployment(db, server: RemoteServer, workflow_name: str, options: dict) -> RemoteDeployment:
    running = (
        db.query(RemoteDeployment)
        .filter(RemoteDeployment.server_id == server.id,
                RemoteDeployment.target == workflow_name,
                RemoteDeployment.status.in_(["queued", "running"]))
        .first()
    )
    if running:
        raise DeployError(f"'{workflow_name}' is already being deployed to this server (deployment #{running.id})")

    action = options.get("action") or "upload_only"
    if action not in WORKFLOW_ACTIONS:
        raise DeployError(f"Unknown action '{action}'")
    from app.services.workflow_engine.models import DeploymentSqlSetup

    # Blank answers keep what the server's .env already has.
    options = {**options, "env": {k: v for k, v in clean_env(options.get("env") or {}).items() if v}}
    sql = options.get("sql")
    if sql is not None:
        try:
            options["sql"] = DeploymentSqlSetup.model_validate(sql)
        except ValueError as e:
            raise DeployError(f"Invalid SQL database settings: {e}") from e
    # Secrets never land in the row: .env values are recorded by name only, and
    # of the SQL database only the mode (its URL holds a password).
    stored_options = {
        "action": action,
        "custom_command": options.get("custom_command") or None,
        "api_key_provided": bool(options.get("mistral_api_key")),
        "env_keys": sorted(options["env"]),
        "no_cache": bool(options.get("no_cache")),
        "sql_mode": options["sql"].mode if options.get("sql") else None,
        "sql_seeded": bool(options.get("sql") and options["sql"].seed_sql),
    }
    dep = RemoteDeployment(server_id=server.id, kind="workflow", target=workflow_name,
                           status="queued", options=json.dumps(stored_options), log="")
    db.add(dep)
    db.commit()
    db.refresh(dep)

    task = asyncio.create_task(_run_workflow_deployment(dep.id, server.id, workflow_name, options))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return dep


async def _build_package(workflow_name: str, setup=None):
    from app.dependencies import get_mistral_client
    from app.services import workflow_packager
    from app.services.workflow_engine.engine import get_workflow

    workflow = get_workflow(workflow_name)
    if not workflow:
        raise DeployError(f"Workflow '{workflow_name}' not found")
    try:
        manifest = await workflow_packager.build_deployment_manifest(workflow, get_mistral_client())
        zip_bytes = await asyncio.to_thread(workflow_packager.build_package_zip, workflow, manifest, setup)
        sql = workflow_packager._sql_setup(manifest, setup)
    except workflow_packager.PackagingError as e:
        raise DeployError(str(e)) from e
    return manifest, zip_bytes, sql


async def _run_workflow_deployment(dep_id: int, server_id: int, workflow_name: str, options: dict) -> None:
    log = _DeployLog(dep_id)
    log.flush(status="running")
    db = SessionLocal()
    try:
        server = db.get(RemoteServer, server_id)
        if not server:
            raise DeployError("Server was deleted")
        provider = get_provider(server.provider or "") or {}
        config, secrets = store.server_config(server), store.server_secrets(server)
    finally:
        db.close()

    try:
        if provider.get("provisioned") and not config.get("host"):
            raise DeployError("This server has not been provisioned yet — provision it first")
        log.step(f"Building deployment package for '{workflow_name}'")
        from app.services.workflow_engine.models import DeploymentSetup

        setup = DeploymentSetup(env=options.get("env") or {}, sql=options.get("sql"))
        manifest, zip_bytes, sql = await _build_package(workflow_name, setup)
        log.write(f"Package: {len(zip_bytes) / 1024 / 1024:.2f} MB · {len(manifest.agents)} agents · "
                  f"{len(manifest.dynamic_tools)} dynamic tools · {len(manifest.connectors)} connectors\n")
        if manifest.uses_knowledge_graph:
            log.write("Knowledge graph: Neo4j container, loaded with the agents' graph on first start\n")
        if sql is not None:
            log.write("SQL tools database: " + ("PostgreSQL container" + (" (seeded)" if sql.seed_sql else "")
                                               if sql.mode == "container" else "existing database") + "\n")

        env_overrides = store.parse_env_lines(secrets.get("env_vars"))
        env_overrides.update(options.get("env") or {})
        if sql is not None and sql.mode == "external":
            env_overrides["SQL_TOOLS_DATABASE_URL"] = sql.url
        if options.get("mistral_api_key"):
            env_overrides["MISTRAL_API_KEY"] = options["mistral_api_key"]

        if provider.get("transport") == "ssh":
            await asyncio.to_thread(_deploy_over_ssh, log, config, secrets, workflow_name,
                                    manifest, zip_bytes, env_overrides, options)
        else:
            await _deploy_over_http(log, config, secrets, workflow_name, manifest, zip_bytes, env_overrides)

        if manifest.connectors:
            names = ", ".join(c.connector_name or c.connector_id or "?" for c in manifest.connectors)
            log.write(f"\n⚠ Authorize these connectors in the target Mistral workspace: {names}\n")
        log.step("Deployment finished")
        log.flush(status="succeeded", finished_at=_now())
    except Exception as e:
        if not isinstance(e, (DeployError, ssh.SSHError)):
            logger.exception("Workflow deployment %s failed", dep_id)
        log.write(f"\n✖ {_error_text(e)}\n")
        log.flush(status="failed", error=_error_text(e), finished_at=_now())


def _merge_env(base: str, overrides: dict[str, str]) -> str:
    lines = base.splitlines()
    seen: set[str] = set()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in overrides:
            lines[i] = f"{key}={overrides[key]}"
            seen.add(key)
    extra = [f"{k}={v}" for k, v in overrides.items() if k not in seen]
    if extra:
        lines += ["", "# Added by remote deployment", *extra]
    return "\n".join(lines) + "\n"


def _missing_env(base: str, template: str) -> dict[str, str]:
    """Template entries whose key ``base`` does not have, with the template's value."""
    have = _env_keys(base)
    out: dict[str, str] = {}
    for line in template.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, value = stripped.split("=", 1)
            if key.strip() not in have:
                out[key.strip()] = value.strip()
    return out


def _env_keys(text: str) -> set[str]:
    keys = set()
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            keys.add(stripped.split("=", 1)[0].strip())
    return keys


def _env_typo_warnings(base: str, overrides: dict[str, str]) -> list[str]:
    """A new key that is a near-miss of one already in .env is likely a typo
    (DEPLOYEMENT_NAME for DEPLOYMENT_NAME): it would be added, not replace."""
    known = _env_keys(base)
    warnings = []
    for key in overrides:
        if key in known:
            continue
        match = difflib.get_close_matches(key, known, n=1, cutoff=0.85)
        if match:
            warnings.append(f"⚠ {key} is not in .env — did you mean {match[0]}? "
                            f"It was added as a new variable; {match[0]} is unchanged.\n")
    return warnings


# .env is read and written over plain exec channels rather than SFTP: Brev's
# SSH gateway drops SFTP sessions now and then, while commands keep working.
_MISSING = 3


def _read_remote_file(client, path: str) -> str | None:
    """A remote file's text, or None when it does not exist."""
    q = shlex.quote(path)
    code, out = ssh.run(client, f"if [ -e {q} ]; then cat {q}; else exit {_MISSING}; fi", timeout=30)
    if code == _MISSING:
        return None
    if code != 0:
        raise DeployError(f"Could not read {path}: {out.strip() or f'exit status {code}'}")
    return out


def _write_remote_file(client, path: str, content: str) -> None:
    """Replace a remote file with mode 600, atomically (temp file + mv)."""
    q, tmp = shlex.quote(path), shlex.quote(path + ".tmp")
    code, out = ssh.run(client, f"umask 077 && cat > {tmp} && chmod 600 {tmp} && mv -f {tmp} {q}",
                        timeout=30, stdin=content.encode())
    if code != 0:
        raise DeployError(f"Could not write {path}: {out.strip() or f'exit status {code}'}")


_BOOTSTRAP = BOOTSTRAP_COMMAND


def _deploy_over_ssh(log: _DeployLog, config: dict, secrets: dict, workflow_name: str,
                     manifest, zip_bytes: bytes, env_overrides: dict, options: dict) -> None:
    log.step(f"Connecting to {config.get('username')}@{config.get('host')}:{config.get('port') or 22}")
    client = ssh.connect(config, secrets, expected_fingerprint=config.get("host_fingerprint") or None)
    try:
        base = config.get("deploy_path") or "~/workflow-deployments"
        code, out = ssh.run(client, f"mkdir -p {ssh.shell_path(base)} && cd {ssh.shell_path(base)} && pwd", timeout=30)
        if code != 0:
            raise DeployError(f"Cannot create deploy directory: {out.strip()}")
        workdir = posixpath.join(out.strip().splitlines()[-1], workflow_name)
        qdir = ssh.shell_path(workdir)
        ssh.run(client, f"mkdir -p {qdir}", timeout=30)
        log.write(f"Workflow directory: {workdir}\n")

        log.step("Uploading package")
        try:
            sftp = client.open_sftp()
            try:
                sftp.putfo(io.BytesIO(zip_bytes), posixpath.join(workdir, "package.zip"))
            finally:
                sftp.close()
        except Exception as e:  # paramiko raises EOFError/SSHException when the session drops
            raise DeployError(f"Uploading the package over SFTP failed: {e!r}") from e

        log.step("Extracting package")
        code, out = ssh.run(
            client,
            # The bundled code and compiled module are replaced, not merged: a
            # tool dropped from the workflow must not linger in the worker.
            f"cd {qdir} && rm -rf backend/app/bundled_tools mistral_workflows"
            " && (python3 -m zipfile -e package.zip . 2>/dev/null || unzip -o -q package.zip)"
            " && rm -f package.zip && ls -1",
            timeout=300, on_output=log.write,
        )
        if code != 0:
            raise DeployError("Extraction failed — the server needs python3 or unzip")

        log.step("Writing .env")
        env_path = posixpath.join(workdir, ".env")
        base_env = _read_remote_file(client, env_path)
        template_env = _read_remote_file(client, posixpath.join(workdir, ".env.template"))
        if base_env is not None:
            # Keys this package adds (a database password generated at build
            # time, a new tool's secret) join the existing .env; values already
            # there are never replaced from the template — a database keeps the
            # password it was created with.
            added = _missing_env(base_env, template_env or "")
            if added:
                base_env = _merge_env(base_env, added)
                log.write(f"Keeping existing .env; added {', '.join(sorted(added))}\n")
            else:
                log.write("Keeping existing .env\n")
        else:
            base_env = template_env
            if base_env is None:
                raise DeployError(f"Neither .env nor .env.template exists in {workdir}")
            log.write("Created .env from .env.template\n")
        for warning in _env_typo_warnings(base_env, env_overrides):
            log.write(warning)
        env_text = _merge_env(base_env, env_overrides)
        _write_remote_file(client, env_path, env_text)
        if env_overrides:
            log.write(f"Set: {', '.join(sorted(env_overrides))}\n")

        action = options.get("action") or "upload_only"
        commands: list[tuple[str, str, int]] = []
        if action == "full":
            # Fail before a long build rather than with a worker that can't log in.
            _check_worker_env(log, env_text)
            cmd = _start_worker_command(no_cache=bool(options.get("no_cache")))
            commands.append(("Building and starting the worker (creates the agents first)",
                             f"{_PLAIN_OUTPUT} bash -lc {shlex.quote(cmd)}", 3600))
        elif action == "bootstrap":
            commands.append(("Running bootstrap_deploy.py", _BOOTSTRAP, 900))
        elif action == "bootstrap_compose":
            commands.append(("Building and starting the worker (creates the agents first)",
                             f"{_PLAIN_OUTPUT} bash -lc {shlex.quote(_start_worker_command(no_cache=False))}",
                             3600))
        elif action == "custom":
            cmd = (options.get("custom_command") or config.get("post_deploy_command") or "").strip()
            if not cmd:
                raise DeployError("No custom command given and the server has no default command")
            commands.append((f"Running: {cmd}", cmd, 1800))

        for label, cmd, timeout in commands:
            log.step(label)
            code, _ = ssh.run(client, f"cd {qdir} && {cmd}", timeout=timeout, on_output=log.write)
            if code != 0:
                raise DeployError(f"{label} exited with status {code}")
        if action == "full":
            _wait_for_worker(log, client, qdir)
    finally:
        client.close()


def _env_value(env_text: str, key: str) -> str:
    """The last value of ``key`` in .env text, without surrounding quotes."""
    value = ""
    for line in env_text.splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            value = stripped.split("=", 1)[1].strip().strip("\"'")
    return value


def _check_worker_env(log: _DeployLog, env_text: str) -> None:
    """What the worker needs from .env to be reachable by runs from this app."""
    from app.config import settings

    key = _env_value(env_text, "MISTRAL_API_KEY")
    if not key:
        raise DeployError("MISTRAL_API_KEY is empty in the workflow's .env — enter it in the API key "
                          "field (it is written to the server's .env, never stored here)")
    deployment = _env_value(env_text, "DEPLOYMENT_NAME")
    if not deployment:
        raise DeployError("DEPLOYMENT_NAME is missing from the workflow's .env — set the worker queue")
    log.write(f"Worker queue (DEPLOYMENT_NAME): {deployment}\n")
    if settings.MISTRAL_API_KEY and key != settings.MISTRAL_API_KEY:
        log.write("⚠ MISTRAL_API_KEY on the server is not this app's key: the worker will poll another "
                  "workspace, and runs started from here won't reach it.\n")
    if settings.MISTRAL_WORKER_ENABLED and deployment == (settings.DEPLOYMENT_NAME or "default"):
        log.write(f"⚠ This app's own worker also polls '{deployment}', so it may take runs meant for "
                  "the server. Give the server its own worker queue.\n")


def _start_worker_command(*, no_cache: bool) -> str:
    """The package's only service: the worker, which creates the agents on
    start and runs the bundled tool code in-process. Recreated so it reads the
    .env just written; orphans are containers of an older package layout (its
    tool service, Neo4j)."""
    return build_compose_command(services=["backend"], no_cache=no_cache, start=True,
                                 force_recreate=True, remove_orphans=True)


_WORKER_READY = "Starting Temporal worker"
_WORKER_FAILED = ("Bootstrap failed:", "Inner worker crashed", "Failed to initialize Mistral client",
                  "Traceback (most recent call last)")


def _wait_for_worker(log: _DeployLog, client, qdir: str, timeout: float = 180.0) -> None:
    """Follow the fresh worker container's log until it polls its task queue."""
    log.step("Waiting for the worker to start polling")
    cmd = (f'cd {qdir} && DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"; '
           "$DC -f docker-compose.deploy.yml logs --no-color --tail 400 backend 2>&1")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        _, out = ssh.run(client, cmd, timeout=60)
        ready = next((line for line in out.splitlines() if _WORKER_READY in line), None)
        if ready:
            queue = re.search(r"task_queue=(\S+)", ready)
            log.write(f"✔ Worker is up and polling task queue '{queue.group(1) if queue else '?'}'\n")
            return
        if any(marker in out for marker in _WORKER_FAILED):
            log.write("\n".join(out.strip().splitlines()[-40:]) + "\n")
            raise DeployError("The worker failed to start — see its log above")
        time.sleep(5)
    log.write(f"⚠ The worker hasn't reported ready within {int(timeout)}s — check Worker logs "
              "before running.\n")


async def _deploy_over_http(log: _DeployLog, config: dict, secrets: dict, workflow_name: str,
                            manifest, zip_bytes: bytes, env_overrides: dict) -> None:
    url = config.get("url") or ""
    headers, auth = http_auth(config, secrets)
    verify = str(config.get("verify_tls", "true")).lower() != "false"
    log.step(f"Uploading package to {url}")
    async with httpx.AsyncClient(timeout=300.0, verify=verify) as client:
        resp = await client.post(
            url, headers=headers, auth=auth,
            files={"file": (f"workflow_{workflow_name}_deploy.zip", zip_bytes, "application/zip")},
            data={
                "workflow_name": workflow_name,
                "manifest": manifest.model_dump_json(),
                "env": json.dumps(env_overrides),
            },
        )
    blocked = edge_block(resp)
    if blocked:
        # The body is a browser challenge page — noise in the log, and the
        # service never saw the upload.
        log.write(f"{blocked}\n")
        raise DeployError(f"{blocked}. {EDGE_BLOCK_ADVICE}")
    log.write(f"HTTP {resp.status_code}\n{resp.text[:4000]}\n")
    if resp.status_code >= 400:
        raise DeployError(f"Deploy endpoint returned HTTP {resp.status_code}")


# ── Brev provisioning ────────────────────────────────────────────────────
#
# For an already-running Brev instance: resolve its SSH access with the Brev
# CLI, prepare the VM, store host/key on the server and run diagnostics.
# Recorded as a kind="provision" deployment so the UI shows its log.

def start_brev_provision(db, server: RemoteServer) -> RemoteDeployment:
    running = (
        db.query(RemoteDeployment)
        .filter(RemoteDeployment.server_id == server.id,
                RemoteDeployment.kind == "provision",
                RemoteDeployment.status.in_(["queued", "running"]))
        .first()
    )
    if running:
        raise DeployError(f"'{server.name}' is already being provisioned (deployment #{running.id})")
    instance = (store.server_config(server).get("instance_name") or "").strip()
    if not instance:
        raise DeployError("Instance name is required")

    dep = RemoteDeployment(server_id=server.id, kind="provision", target=instance, status="queued",
                           options=json.dumps({"instance_name": instance}), log="")
    db.add(dep)
    db.commit()
    db.refresh(dep)

    task = asyncio.create_task(_run_brev_provision(dep.id, server.id, instance))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return dep


def _is_overlay_address(host: str) -> bool:
    """100.64.0.0/10 — the shared/CGNAT range Brev's private network hands out."""
    try:
        return ipaddress.ip_address(host) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False


def _resolve_brev(log: _DeployLog, instance: str, token: str | None,
                  public_host: str | None, public_port: int | None) -> dict:
    if token:
        log.step("Logging in to Brev")
        brev.login(token)
    log.step(f"Checking Brev instance '{instance}'")
    brev.require_running(instance)
    log.write("RUNNING\n")

    log.step("Resolving SSH access (brev refresh)")
    details = brev.ssh_details(instance)
    log.write(f"{details['username']}@{details['host']}:{details['port']}"
              + (" (through Brev's SSH proxy)" if details["proxied"] else "") + "\n")
    cert = brev.cert_params(instance)
    details.update(cert or {"brev_env": "", "brev_port_id": "", "brev_linux_user": ""})
    if cert:
        log.write(f"Logins use short-lived Brev certificates (environment {cert['brev_env']})\n")
    if details["proxied"] and not public_host:
        raise DeployError("Brev reaches this instance through an SSH proxy (cloudflared), which this "
                          "backend cannot use. Expose TCP port 22 in the instance's Access tab and set "
                          "'Public IP override' / 'Public SSH port' to the endpoint it shows.")
    if public_host:
        details.update(host=public_host, port=brev.override_port(details, public_host, public_port))
        log.write(f"Using the public IP override: {public_host}:{details['port']}\n")
    elif _is_overlay_address(details["host"]):
        log.write("⚠ This is a Brev private-network address — it is only reachable where the Brev CLI "
                  "runs. If the steps below time out, expose TCP port 22 in the instance's Access tab "
                  "and set 'Public IP override'.\n")
    return details


def _prepare_brev_vm(log: _DeployLog, details: dict) -> str:
    """Install the deploy prerequisites; returns the host key fingerprint seen."""
    log.step("Preparing VM (python3-venv, unzip, Docker)")
    # Provisioning trusts what the Brev CLI reports, so the host key is
    # re-pinned here rather than checked against a possibly stale one.
    client = ssh.connect(details, {"private_key": details["private_key"]}, timeout=20)
    try:
        code, _ = ssh.run(client, "bash -c " + shlex.quote(brev.PREP_SCRIPT),
                          timeout=1200, on_output=log.write)
        fp = client.host_fingerprint
    finally:
        client.close()
    if code != 0:
        raise DeployError(f"VM preparation exited with status {code}")
    return fp


def _save_brev_connection(server_id: int, details: dict, fingerprint: str | None) -> tuple[str, dict, dict]:
    """Store host / port / user / key on the server; returns (provider, config, secrets)."""
    db = SessionLocal()
    try:
        server = db.get(RemoteServer, server_id)
        if not server:
            raise DeployError("Server was deleted")
        config = store.server_config(server)
        config.update({k: details[k] for k in ("host", "port", "username",
                                               "brev_env", "brev_port_id", "brev_linux_user")})
        # Provisioning trusts what the Brev CLI reports: drop the pinned host
        # key and re-pin whatever the prep connection sees.
        config.pop("host_fingerprint", None)
        if fingerprint:
            config["host_fingerprint"] = fingerprint
        secrets = {**store.server_secrets(server), "private_key": details["private_key"]}
        server.config = json.dumps(config)
        server.secrets = secret_box.encrypt(secrets)
        server.url = store.display_address(server.provider, config)
        db.commit()
        return server.provider, config, secrets
    finally:
        db.close()


async def _run_brev_provision(dep_id: int, server_id: int, instance: str) -> None:
    log = _DeployLog(dep_id)
    log.flush(status="running")
    db = SessionLocal()
    try:
        server = db.get(RemoteServer, server_id)
        if not server:
            raise DeployError("Server was deleted")
        token = store.server_secrets(server).get("brev_token")
        server_config = store.server_config(server)
    finally:
        db.close()

    try:
        details = await asyncio.to_thread(
            _resolve_brev, log, instance, token,
            (server_config.get("public_host") or "").strip() or None, server_config.get("public_port"),
        )
        # Saved before connecting, so a failed prep still leaves the key and
        # host on the server for diagnostics and a later retry.
        await asyncio.to_thread(_save_brev_connection, server_id, details, None)
        log.write("Saved host and private key on the server\n")

        fp = await asyncio.to_thread(_prepare_brev_vm, log, details)
        provider_id, config, secrets = await asyncio.to_thread(_save_brev_connection, server_id, details, fp)

        log.step("Running diagnostics")
        result = await checks.run_checks(provider_id, config, secrets)
        db = SessionLocal()
        try:
            server = db.get(RemoteServer, server_id)
            if server:
                server.last_status = result["status"]
                server.last_check = json.dumps(result, default=str)
                server.last_checked_at = _now()
                db.commit()
        finally:
            db.close()
        log.write(f"Status: {result['status']}\n")
        for c in result.get("checks", []):
            if c.get("status") in ("fail", "warn"):
                log.write(f"  {c['status']}: {c.get('label')} — {c.get('detail')}\n")
        if result["status"] == "unreachable":
            raise DeployError("Provisioned, but the diagnostics cannot reach the VM")

        log.step("Provisioning finished — the server is ready for workflow deployments")
        log.flush(status="succeeded", finished_at=_now())
    except Exception as e:
        if not isinstance(e, (DeployError, ssh.SSHError, brev.BrevError)):
            logger.exception("Brev provisioning %s failed", dep_id)
        log.write(f"\n✖ {_error_text(e)}\n")
        log.flush(status="failed", error=_error_text(e), finished_at=_now())


# ── Console commands ─────────────────────────────────────────────────────
#
# A command run from a server's console, recorded as a kind="command"
# deployment so the UI streams its log with the same polling. Runs in the
# deploy directory, or in a deployed workflow's directory under it.

_CANCEL: dict[int, threading.Event] = {}
_WORKFLOW_DIR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_MAX_COMMAND_LOG = 1_000_000  # characters; `logs -f` could otherwise grow the row without bound


def start_remote_command(db, server: RemoteServer, *, command: str = "", preset: str = "",
                         workflow: str = "", timeout: int = 600, action: str = "",
                         env: dict[str, str] | None = None, target: str = "") -> RemoteDeployment:
    """``env`` is merged into the workflow's .env before the command runs.
    ``target`` names the run in the history when it is not ``workflow``."""
    if env and not workflow:
        raise DeployError(".env overrides need a workflow directory")
    if preset:
        spec = COMMAND_PRESETS.get(preset)
        if not spec:
            raise DeployError(f"Unknown preset '{preset}'")
        if spec["scope"] == "workflow" and not workflow:
            raise DeployError(f"'{spec['label']}' runs in a workflow's directory — choose a workflow")
        command = spec["command"]
        if spec.get("long_running"):
            timeout = max(timeout, 3600)
    command = (command or "").strip()
    if not command:
        raise DeployError("Enter a command")
    if workflow and not _WORKFLOW_DIR.match(workflow):
        raise DeployError(f"Invalid workflow directory '{workflow}'")
    timeout = min(max(int(timeout or 600), 5), 3600)

    dep = RemoteDeployment(server_id=server.id, kind="command", target=target or workflow or "~",
                           status="queued", log="",
                           # .env values can be secrets: only their names are kept.
                           options=json.dumps({"action": action or preset or "command", "command": command,
                                               "workflow": workflow or None, "timeout": timeout,
                                               "env_keys": sorted(env or {}) or None}))
    db.add(dep)
    db.commit()
    db.refresh(dep)

    cancel = _CANCEL[dep.id] = threading.Event()
    task = asyncio.create_task(_run_remote_command(dep.id, server.id, command, workflow, timeout,
                                                   cancel, env or {}))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return dep


def cancel_command(dep_id: int) -> bool:
    event = _CANCEL.get(dep_id)
    if not event:
        return False
    event.set()
    return True


async def _run_remote_command(dep_id: int, server_id: int, command: str, workflow: str,
                              timeout: int, cancel: threading.Event, env: dict[str, str]) -> None:
    log = _DeployLog(dep_id)
    log.flush(status="running")
    try:
        db = SessionLocal()
        try:
            server = db.get(RemoteServer, server_id)
            if not server:
                raise DeployError("Server was deleted")
            config, secrets = store.server_config(server), store.server_secrets(server)
        finally:
            db.close()
        if (get_provider(server.provider or "") or {}).get("transport") != "ssh":
            raise DeployError("Commands can only run on SSH servers")

        code = await asyncio.to_thread(_command_over_ssh, log, config, secrets, command,
                                       workflow, timeout, cancel, env)
        log.write(f"\n▶ exit code {code}\n")
        log.flush(status="succeeded" if code == 0 else "failed",
                  error=None if code == 0 else f"Exited with status {code}", finished_at=_now())
    except Exception as e:
        stopped = cancel.is_set()
        if not stopped and not isinstance(e, (DeployError, ssh.SSHError, brev.BrevError)):
            logger.exception("Remote command %s failed", dep_id)
        log.write("\n■ Stopped\n" if stopped else f"\n✖ {_error_text(e)}\n")
        log.flush(status="failed", error="Stopped" if stopped else _error_text(e), finished_at=_now())
    finally:
        _CANCEL.pop(dep_id, None)


def _command_over_ssh(log: _DeployLog, config: dict, secrets: dict, command: str, workflow: str,
                      timeout: int, cancel: threading.Event, env: dict[str, str] | None = None) -> int:
    base = ssh.shell_path(config.get("deploy_path") or "~/workflow-deployments")
    where = f"mkdir -p {base} && cd {base}" + (f" && cd {shlex.quote(workflow)}" if workflow else "")
    # Every slow step before the command gets a line, so a stall or failure is
    # visible in the UI instead of an empty log.
    log.step(f"Connecting to {config.get('username')}@{config.get('host')}:{config.get('port') or 22}"
             + (" (minting a Brev certificate)" if config.get("brev_env") else ""))
    client = ssh.connect(config, secrets, expected_fingerprint=config.get("host_fingerprint") or None)
    written = 0

    def capped(text: str) -> None:
        nonlocal written
        # Progress UIs redraw lines with \r; in a text log that hides them.
        text = ANSI_ESCAPE.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
        if written < _MAX_COMMAND_LOG:
            log.write(text[:_MAX_COMMAND_LOG - written])
            written += len(text)
            if written >= _MAX_COMMAND_LOG:
                log.write("\n… output truncated — the command keeps running until it ends or is stopped\n")

    try:
        log.write("Connected\n")
        if env:
            log.step("Updating the workflow's .env")
            _merge_remote_env(log, client, where, env)
        log.step(f"Running in {workflow or 'the deploy directory'}")
        log.write(f"$ {command}\n")
        log.flush()
        # A login shell, so PATH matches an interactive session (e.g.
        # ~/.local/bin). Plain, colourless progress: there is no terminal.
        code, _ = ssh.run(client, f"{where} && {_PLAIN_OUTPUT} bash -lc {shlex.quote(command)}",
                          timeout=timeout, on_output=capped, cancel=cancel)
    finally:
        client.close()
    return code


ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# docker compose / BuildKit otherwise draw an animated progress view.
_PLAIN_OUTPUT = ("env COMPOSE_PROGRESS=plain BUILDKIT_PROGRESS=plain COMPOSE_ANSI=never "
                 "NO_COLOR=1 DEBIAN_FRONTEND=noninteractive")


_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def clean_env(values: dict | None, what: str = ".env") -> dict[str, str]:
    """Validate KEY=VALUE pairs: shell-safe names, single-line values."""
    out: dict[str, str] = {}
    for key, value in (values or {}).items():
        key = str(key).strip()
        if not key:
            continue
        if not _ENV_KEY.match(key):
            raise DeployError(f"Invalid {what} name '{key}'")
        value = "" if value is None else str(value)
        if "\n" in value or "\r" in value:
            raise DeployError(f"{what} value for '{key}' must be a single line")
        out[key] = value
    return out


def _merge_remote_env(log: _DeployLog, client, where: str, env: dict[str, str]) -> None:
    code, out = ssh.run(client, f"{where} && pwd", timeout=30)
    if code != 0:
        raise DeployError(f"Workflow directory not found: {out.strip()}")
    path = posixpath.join(out.strip().splitlines()[-1], ".env")
    base_env = _read_remote_file(client, path) or ""
    for warning in _env_typo_warnings(base_env, env):
        log.write(warning)
    _write_remote_file(client, path, _merge_env(base_env, env))
    log.write(f"Updated .env: {', '.join(sorted(env))}\n")


# A package runs one service; tool and activity code is bundled into it.
BUILD_SERVICES = ("backend",)


def build_compose_command(*, services: list[str], no_cache: bool = False, pull: bool = False,
                          run_bootstrap: bool = False, start: bool = True, force_recreate: bool = False,
                          remove_orphans: bool = False, build_args: dict[str, str] | None = None) -> str:
    """The shell for building (and optionally starting) a deployed workflow's worker.

    ``run_bootstrap`` also runs bootstrap_deploy.py on the host first; the
    worker image runs it on every start anyway.
    """
    unknown = [s for s in services if s not in BUILD_SERVICES]
    if unknown or not services:
        raise DeployError(f"Choose services from: {', '.join(BUILD_SERVICES)}")
    dc = "$DC -f docker-compose.deploy.yml"
    args = " ".join(f"--build-arg {shlex.quote(f'{k}={v}')}"
                    for k, v in clean_env(build_args, "build arg").items())

    steps = ['DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"']
    flags = " ".join(f for f, on in (("--no-cache", no_cache), ("--pull", pull)) if on)
    steps.append(" ".join(x for x in (dc, "build", flags, args, *services) if x))
    if run_bootstrap:
        steps.append(BOOTSTRAP_COMMAND)
    if start:
        up_flags = " ".join(f for f, on in (("--force-recreate", force_recreate),
                                            ("--remove-orphans", remove_orphans)) if on)
        steps.append(" ".join(x for x in (dc, "up -d", up_flags, *services) if x))
        steps.append(f"{dc} ps")
    return steps[0] + "; " + " && ".join(steps[1:])


def build_delete_command(workflow: str, *, stop_containers: bool = True,
                         remove_volumes: bool = False, remove_images: bool = False) -> str:
    """The shell for deleting a deployed workflow package; runs in the deploy directory.

    Only a directory holding manifest.json is touched, so a mistyped name
    cannot remove anything that is not a workflow package. When the stack's
    ``down`` fails the files are kept, or its containers would be orphaned
    with no compose file left to manage them.
    """
    if not _WORKFLOW_DIR.match(workflow or ""):
        raise DeployError(f"Invalid workflow directory '{workflow}'")
    if (remove_volumes or remove_images) and not stop_containers:
        raise DeployError("Removing volumes or images needs the containers stopped too")
    wf = shlex.quote(workflow)
    lines = [
        f"WF={wf}",
        '[ -f "$WF/manifest.json" ] || { echo "No workflow package named $WF in $PWD"; exit 2; }',
    ]
    if stop_containers:
        flags = " ".join(f for f, on in (("-v", remove_volumes), ("--rmi local", remove_images)) if on)
        lines += [
            'if [ -f "$WF/docker-compose.deploy.yml" ] && command -v docker >/dev/null 2>&1; then',
            '  echo "Stopping and removing the workflow\'s containers…"',
            '  DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"',
            # down reads env_file: ./.env; an empty one keeps it from failing without it.
            '  (cd "$WF" && { [ -f .env ] || : > .env; } && '
            f'$DC -f docker-compose.deploy.yml --profile tools --profile knowledge-graph down --remove-orphans {flags}) '
            '|| { echo "docker compose down failed — keeping the files so the stack can still be managed"; exit 1; }',
            "fi",
        ]
    lines += [
        'echo "Deleting $PWD/$WF"',
        'rm -rf -- "$WF" 2>/dev/null',
        # Containers can leave root-owned files (e.g. __pycache__ in mounted dirs).
        '[ -e "$WF" ] && sudo -n rm -rf -- "$WF" 2>/dev/null',
        'if [ -e "$WF" ]; then echo "Some files could not be removed (owned by another user?):"; '
        'find "$WF" ! -user "$(id -un)" | head -20; exit 1; fi',
        'echo "Deleted $WF"',
    ]
    return "\n".join(lines)


def remote_env_info(config: dict, secrets: dict, workflow: str) -> dict:
    """DEPLOYMENT_NAME from a deployed workflow's .env, and a hash of its
    MISTRAL_API_KEY (computed on the server, so the key itself never travels)."""
    if not _WORKFLOW_DIR.match(workflow or ""):
        raise DeployError(f"Invalid workflow directory '{workflow}'")
    base = ssh.shell_path(config.get("deploy_path") or "~/workflow-deployments")
    script = (
        f"cd {base}/{shlex.quote(workflow)} 2>/dev/null || {{ echo MISSING; exit 0; }}; "
        "[ -f .env ] || { echo NOENV; exit 0; }; "
        # Quotes and CRs are dropped, as docker compose does when it reads .env —
        # MISTRAL_API_KEY="sk-…" must hash like the bare key.
        "echo \"name=$(sed -n 's/^DEPLOYMENT_NAME=//p' .env | tail -1 | tr -d \"\\\"'\\r\")\"; "
        "key=$(sed -n 's/^MISTRAL_API_KEY=//p' .env | tail -1 | tr -d \"\\\"'\\r\"); "
        "printf %s \"$key\" | sha256sum | cut -c1-64"
    )
    client = ssh.connect(config, secrets, expected_fingerprint=config.get("host_fingerprint") or None)
    try:
        _, out = ssh.run(client, script, timeout=30)
    finally:
        client.close()
    lines = [line.strip() for line in out.splitlines() if line.strip()]
    if "MISSING" in lines:
        raise DeployError(f"'{workflow}' is not deployed on this server")
    if "NOENV" in lines:
        raise DeployError(f"'{workflow}' has no .env on the server — deploy it again or set its environment")
    name = next((line[5:] for line in lines if line.startswith("name=")), "").strip()
    key_hash = lines[-1] if lines and len(lines[-1]) == 64 else ""
    return {"deployment_name": name, "key_hash": key_hash}


# ── Inspecting what is deployed ──────────────────────────────────────────

_LIST_SCRIPT = r"""
cd {base} 2>/dev/null || exit 0
for d in */; do
  d="${{d%/}}"
  [ -f "$d/manifest.json" ] || continue
  echo "@@ $d"
  echo "modified=$(date -r "$d/manifest.json" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  [ -f "$d/.env" ] && echo "env=yes" || echo "env=no"
  grep -o '"generated_at": *"[^"]*"' "$d/manifest.json" | head -1 | sed 's/.*: *"\(.*\)"/generated_at=\1/'
done
if command -v docker >/dev/null 2>&1; then
  echo "@@__containers__"
  docker ps --format '{{{{.Names}}}}|{{{{.Status}}}}|{{{{.Label "com.docker.compose.project"}}}}' 2>/dev/null
fi
"""


def list_remote_workflows(config: dict, secrets: dict) -> list[dict]:
    """Workflows unpacked under the server's deploy directory, with container state."""
    client = ssh.connect(config, secrets, expected_fingerprint=config.get("host_fingerprint") or None)
    try:
        base = config.get("deploy_path") or "~/workflow-deployments"
        _, out = ssh.run(client, _LIST_SCRIPT.format(base=ssh.shell_path(base)), timeout=30)
    finally:
        client.close()

    items: dict[str, dict] = {}
    containers: list[dict] = []
    current: str | None = None
    for line in out.splitlines():
        if line.startswith("@@ "):
            current = line[3:].strip()
            items[current] = {"name": current, "containers": []}
        elif line.startswith("@@__containers__"):
            current = "__containers__"
        elif current == "__containers__" and "|" in line:
            name, status, project = (line.split("|") + ["", ""])[:3]
            containers.append({"name": name, "status": status, "project": project})
        elif current and "=" in line:
            k, _, v = line.partition("=")
            items[current][k] = v
    for item in items.values():
        # docker compose names the project after the directory, lower-cased.
        project = item["name"].lower()
        item["containers"] = [c for c in containers if c["project"] == project]
        item["env"] = item.get("env") == "yes"
    return sorted(items.values(), key=lambda i: i.get("modified") or "", reverse=True)


def recover_interrupted() -> None:
    """Deployments in flight when the backend stopped died with it."""
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        stale = db.query(RemoteDeployment).filter(RemoteDeployment.status.in_(["queued", "running"])).all()
        for dep in stale:
            dep.status = "failed"
            dep.error = "Interrupted: the backend restarted during this deployment"
            dep.finished_at = _now()
        if stale:
            db.commit()
    except Exception as e:
        logger.warning("Could not recover interrupted deployments: %s", e)
    finally:
        db.close()
