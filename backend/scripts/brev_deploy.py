"""
Provision an NVIDIA Brev VM and deploy a workflow package to it.

    python scripts/brev_deploy.py up <workflow_name> [--create-args "..."]
    python scripts/brev_deploy.py stop
    python scripts/brev_deploy.py delete

`up` is safe to re-run: it reuses (or starts) the instance, prepares the VM
(python3-venv, unzip, Docker), registers it under Remote Servers as
`brev-<instance>` — updating the entry if the IP changed — and deploys through
the app's own `/remote-servers/{id}/deploy-workflow`, so the deployment and
its log also show up in the UI.

Needs the backend running (default http://localhost:8000/api) and the Brev
CLI. On Windows the CLI lives in WSL, so every brev / ssh / cat call here runs
through `wsl -e`; its SSH config and brev.pem are the ones in the WSL home.

Environment:
    BREV_TOKEN        optional — `brev login --token`; otherwise log in once by hand
    MISTRAL_API_KEY   read from here or backend/.env — must be the SAME workspace
                      as this backend, or executions never reach the VM
    BREV_WSL_DISTRO   optional — WSL distro holding the Brev CLI
    BREV_NATIVE=1     optional — call brev/ssh directly even on Windows

Brev CLI flags differ between versions, so instance shape is passed through
verbatim: check `brev create --help` and use e.g. --create-args "--gpu <type>".
"""

import argparse
import os
import shlex
import sys
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.remote_servers import brev                        # noqa: E402
from app.remote_servers.brev import BrevError, instance_status, ssh_details  # noqa: E402

sh = brev.run


# ── Brev instance ────────────────────────────────────────────────────────

def ensure_running(name: str, create_args: list[str]) -> bool:
    """Create or start the instance and wait for RUNNING. True if newly created."""
    if os.environ.get("BREV_TOKEN"):
        brev.login(os.environ["BREV_TOKEN"])

    created = False
    status = instance_status(name)
    if status is None:
        print(f"▶ Creating Brev instance '{name}' {' '.join(create_args)}")
        sh("brev", "create", name, *create_args, timeout=1800)
        created = True
    elif status == "STOPPED":
        print(f"▶ Starting stopped instance '{name}'")
        sh("brev", "start", name, timeout=1800)

    deadline = time.time() + 1800
    while (status := instance_status(name)) != "RUNNING":
        if status and any(s in status for s in ("FAIL", "ERROR")):
            sys.exit(f"Instance '{name}' is {status} — check the Brev console")
        if time.time() > deadline:
            sys.exit(f"Instance '{name}' did not reach RUNNING (last status: {status})")
        print(f"  … {status or 'not listed yet'}")
        time.sleep(15)
    print(f"✓ '{name}' is RUNNING")
    return created


def prepare_vm(name: str) -> None:
    print("▶ Preparing VM (python3-venv, unzip, Docker)")
    out = sh("ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
             name, "bash -s", input=brev.PREP_SCRIPT, timeout=1200)
    print("  " + "\n  ".join(out.strip().splitlines()[-5:]))


# ── App API ──────────────────────────────────────────────────────────────

def mistral_api_key() -> str:
    key = os.environ.get("MISTRAL_API_KEY") or dotenv_values(BACKEND_DIR / ".env").get("MISTRAL_API_KEY")
    if not key:
        sys.exit("MISTRAL_API_KEY is not set (env or backend/.env)")
    return key


def fail(resp: httpx.Response, what: str) -> None:
    if resp.status_code >= 400:
        sys.exit(f"{what} failed: HTTP {resp.status_code} {resp.text[:500]}")


def register_server(api: httpx.Client, instance: str, ssh: dict, env_lines: list[str],
                    forget_host_key: bool) -> dict:
    name = f"brev-{instance}"
    body = {
        "name": name,
        "description": f"NVIDIA Brev instance '{instance}' (managed by scripts/brev_deploy.py)",
        "purpose": "workflow",
        "provider": "ssh",
        "config": {"host": ssh["host"], "port": ssh["port"], "username": ssh["username"],
                   "auth_method": "private_key", "deploy_path": "~/workflow-deployments"},
        "secrets": {"private_key": ssh["private_key"], "env_vars": "\n".join(env_lines)},
    }
    resp = api.get("/remote-servers", params={"purpose": "workflow"})
    fail(resp, "Listing remote servers")
    existing = next((s for s in resp.json() if s["name"] == name), None)
    if existing:
        # A recreated instance has a new host key; the stored one would reject it.
        if forget_host_key:
            body["config"]["host_fingerprint"] = ""
        resp = api.put(f"/remote-servers/{existing['id']}", json=body)
    else:
        resp = api.post("/remote-servers", json=body)
    fail(resp, "Saving the remote server")
    server = resp.json()
    print(f"✓ Remote server '{name}' (#{server['id']}) → {server['url']}")
    return server


def check_server(api: httpx.Client, server_id: int) -> None:
    resp = api.post(f"/remote-servers/{server_id}/check", timeout=120)
    fail(resp, "Server check")
    result = resp.json()
    print(f"✓ Check: {result['status']}")
    if result["status"] == "unreachable":
        for c in result.get("checks", []):
            if c.get("status") == "fail":
                print(f"  ✖ {c.get('label')}: {c.get('detail')}")
        sys.exit("The app cannot reach the VM over SSH")


def deploy(api: httpx.Client, server_id: int, workflow: str, action: str) -> bool:
    resp = api.post(f"/remote-servers/{server_id}/deploy-workflow",
                    json={"workflow_name": workflow, "action": action})
    fail(resp, "Starting the deployment")
    dep, shown = resp.json(), 0
    print(f"▶ Deployment #{dep['id']} ({action})")
    while True:
        dep = api.get(f"/remote-servers/deployments/{dep['id']}").json()
        log = dep.get("log") or ""
        print(log[shown:], end="", flush=True)
        shown = len(log)
        if dep["status"] not in ("queued", "running"):
            break
        time.sleep(3)
    print(f"\n{'✓' if dep['status'] == 'succeeded' else '✖'} Deployment {dep['status']}"
          + (f": {dep['error']}" if dep.get("error") else ""))
    return dep["status"] == "succeeded"


def remind_routing(deployment_name: str) -> None:
    local = dotenv_values(BACKEND_DIR / ".env")
    if (local.get("DEPLOYMENT_NAME") or "default") == deployment_name \
            and str(local.get("MISTRAL_WORKER_ENABLED", "true")).lower() == "false":
        return
    print(f"\nTo run executions on this VM, set in backend/.env and restart the backend:\n"
          f"  DEPLOYMENT_NAME={deployment_name}\n"
          f"  MISTRAL_WORKER_ENABLED=false   # so the local worker does not take the runs\n"
          f"Executions that report source=\"mistral\" ran on the VM; anything else fell back to local.")


# ── Commands ─────────────────────────────────────────────────────────────

def cmd_up(args) -> None:
    created = ensure_running(args.instance, shlex.split(args.create_args))
    details = ssh_details(args.instance)
    if details.pop("proxied"):
        sys.exit(f"Brev reaches '{args.instance}' through an SSH proxy, which the app cannot use. "
                 "Expose TCP port 22 in its Access tab and add the server in the app as an "
                 "'NVIDIA Brev instance' with that endpoint as the public IP override.")
    if not args.skip_prep:
        prepare_vm(args.instance)

    env_lines = [f"MISTRAL_API_KEY={mistral_api_key()}", f"DEPLOYMENT_NAME={args.deployment_name}",
                 *args.env]
    with httpx.Client(base_url=args.app_url.rstrip("/"), timeout=60) as api:
        server = register_server(api, args.instance, details, env_lines, forget_host_key=created)
        check_server(api, server["id"])
        ok = deploy(api, server["id"], args.workflow, args.action)
    if not ok:
        sys.exit(1)
    remind_routing(args.deployment_name)


def cmd_stop(args) -> None:
    sh("brev", "stop", args.instance, timeout=600)
    print(f"✓ Stopped '{args.instance}' (its IP may change on start — re-run `up` to update the app)")


def cmd_delete(args) -> None:
    sh("brev", "delete", args.instance, timeout=600)
    print(f"✓ Deleted Brev instance '{args.instance}'")
    with httpx.Client(base_url=args.app_url.rstrip("/"), timeout=60) as api:
        servers = api.get("/remote-servers", params={"purpose": "workflow"}).json()
        for s in servers:
            if s["name"] == f"brev-{args.instance}":
                fail(api.delete(f"/remote-servers/{s['id']}"), "Removing the remote server")
                print(f"✓ Removed remote server '{s['name']}' and its deployment history")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--instance", default="wf-worker", help="Brev instance name")
    parser.add_argument("--app-url", default="http://localhost:8000/api", help="This backend's API base URL")
    sub = parser.add_subparsers(dest="command", required=True)

    up = sub.add_parser("up", help="Create/start the VM and deploy a workflow to it")
    up.add_argument("workflow")
    up.add_argument("--create-args", default="", help='Extra `brev create` flags, e.g. "--gpu <type>"')
    up.add_argument("--deployment-name", default="brev-worker",
                    help="Task queue the VM's worker polls (DEPLOYMENT_NAME)")
    up.add_argument("--action", default="bootstrap_compose",
                    choices=["upload_only", "bootstrap", "bootstrap_compose"])
    up.add_argument("--env", action="append", default=[], metavar="KEY=VALUE",
                    help="Extra .env entry for the workflow (repeatable)")
    up.add_argument("--skip-prep", action="store_true", help="Skip installing python3-venv / Docker")
    up.set_defaults(func=cmd_up)

    sub.add_parser("stop", help="Stop the Brev instance").set_defaults(func=cmd_stop)
    sub.add_parser("delete", help="Delete the instance and its Remote Servers entry").set_defaults(func=cmd_delete)

    args = parser.parse_args()
    try:
        args.func(args)
    except BrevError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
