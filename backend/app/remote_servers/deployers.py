"""
Deployers — push a dynamic tool or a workflow package to a remote server.

Tool pushes are quick and synchronous. Workflow deployments build the same
.zip the "Download package" button produces, then run as a background task
recorded in ``remote_deployments``: the UI polls the row for status and log.

SSH workflow deployment, in the workflow's directory on the server:
  1. upload package.zip over SFTP and extract it (python3 zipfile, or unzip);
  2. write .env — the existing one (kept across redeploys) or .env.template,
     overlaid with the server's stored env vars and any deploy-time API key;
  3. run the chosen post-deploy action (bootstrap / docker compose / custom).
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import json
import logging
import posixpath
import shlex
import threading
import time
from datetime import datetime, timezone

import httpx

from app.database import SessionLocal
from app.remote_server_model import RemoteServer, RemoteDeployment
from app.remote_servers import brev, checks, ssh, store
from app.remote_servers import secrets as secret_box
from app.remote_servers.checks import http_auth
from app.remote_servers.providers import get_provider, WORKFLOW_ACTIONS
from app.remote_servers.edge import EDGE_BLOCK_ADVICE, edge_block

logger = logging.getLogger(__name__)

# Strong references so running deployments are not garbage-collected.
_TASKS: set[asyncio.Task] = set()


class DeployError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class _DeployLog:
    """Appends to a deployment row's log, flushing at most once a second.

    Called from the event loop and from the SSH worker thread alike.
    """

    def __init__(self, dep_id: int):
        self.dep_id = dep_id
        self._buf: list[str] = []
        self._lock = threading.Lock()
        self._last_flush = 0.0

    def write(self, text: str) -> None:
        with self._lock:
            self._buf.append(text)
        if time.monotonic() - self._last_flush > 1.0:
            self.flush()

    def step(self, text: str) -> None:
        self.write(f"\n▶ {text}\n")
        self.flush()

    def flush(self, **fields) -> None:
        with self._lock:
            chunk = "".join(self._buf)
            self._buf.clear()
            self._last_flush = time.monotonic()
        if not chunk and not fields:
            return
        db = SessionLocal()
        try:
            dep = db.get(RemoteDeployment, self.dep_id)
            if dep:
                dep.log = (dep.log or "") + chunk
                for k, v in fields.items():
                    setattr(dep, k, v)
                db.commit()
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
    # Secrets never land in the row.
    stored_options = {
        "action": action,
        "custom_command": options.get("custom_command") or None,
        "api_key_provided": bool(options.get("mistral_api_key")),
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


async def _build_package(workflow_name: str):
    from app.dependencies import get_mistral_client
    from app.services import workflow_packager
    from app.services.workflow_engine.engine import get_workflow

    workflow = get_workflow(workflow_name)
    if not workflow:
        raise DeployError(f"Workflow '{workflow_name}' not found")
    manifest = await workflow_packager.build_deployment_manifest(workflow, get_mistral_client())
    zip_bytes = await asyncio.to_thread(workflow_packager.build_package_zip, workflow, manifest)
    return manifest, zip_bytes


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
        manifest, zip_bytes = await _build_package(workflow_name)
        log.write(f"Package: {len(zip_bytes) / 1024 / 1024:.2f} MB · {len(manifest.agents)} agents · "
                  f"{len(manifest.dynamic_tools)} dynamic tools · {len(manifest.connectors)} connectors\n")

        env_overrides = store.parse_env_lines(secrets.get("env_vars"))
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
        log.write(f"\n✖ {e}\n")
        log.flush(status="failed", error=str(e), finished_at=_now())


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


def _compose_command(manifest) -> str:
    parts = ['DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"']
    if manifest.dynamic_tools:
        parts.append("$DC -f docker-compose.deploy.yml --profile tools up -d --build tool-service")
    if manifest.uses_knowledge_graph:
        parts.append("$DC -f docker-compose.deploy.yml --profile knowledge-graph up -d neo4j")
    return " && ".join(parts)


_BOOTSTRAP = (
    "python3 -m venv .deploy-venv"
    " && .deploy-venv/bin/pip install -q --disable-pip-version-check mistralai httpx python-dotenv"
    " && .deploy-venv/bin/python bootstrap_deploy.py"
)


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
        sftp = client.open_sftp()
        try:
            sftp.putfo(io.BytesIO(zip_bytes), posixpath.join(workdir, "package.zip"))

            log.step("Extracting package")
            code, out = ssh.run(
                client,
                f"cd {qdir} && (python3 -m zipfile -e package.zip . 2>/dev/null || unzip -o -q package.zip)"
                " && rm -f package.zip && ls -1",
                timeout=300, on_output=log.write,
            )
            if code != 0:
                raise DeployError("Extraction failed — the server needs python3 or unzip")

            log.step("Writing .env")
            env_path = posixpath.join(workdir, ".env")
            try:
                with sftp.open(env_path, "r") as fh:
                    base_env = fh.read().decode()
                log.write("Keeping existing .env\n")
            except IOError:
                with sftp.open(posixpath.join(workdir, ".env.template"), "r") as fh:
                    base_env = fh.read().decode()
                log.write("Created .env from .env.template\n")
            with sftp.open(env_path, "w") as fh:
                fh.write(_merge_env(base_env, env_overrides).encode())
            sftp.chmod(env_path, 0o600)
            if env_overrides:
                log.write(f"Set: {', '.join(sorted(env_overrides))}\n")
        finally:
            sftp.close()

        action = options.get("action") or "upload_only"
        commands: list[tuple[str, str, int]] = []
        if action == "bootstrap":
            commands.append(("Running bootstrap_deploy.py", _BOOTSTRAP, 900))
        elif action == "bootstrap_compose":
            if manifest.dynamic_tools or manifest.uses_knowledge_graph:
                commands.append(("Starting supporting services", _compose_command(manifest), 1800))
            commands.append(("Running bootstrap_deploy.py", _BOOTSTRAP, 900))
            commands.append((
                "Starting backend with docker compose",
                'DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose";'
                " $DC -f docker-compose.deploy.yml up -d --build backend && $DC -f docker-compose.deploy.yml ps",
                1800,
            ))
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
    finally:
        client.close()


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
        details.update(host=public_host, port=public_port or 22)
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
        log.write(f"\n✖ {e}\n")
        log.flush(status="failed", error=str(e), finished_at=_now())


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
