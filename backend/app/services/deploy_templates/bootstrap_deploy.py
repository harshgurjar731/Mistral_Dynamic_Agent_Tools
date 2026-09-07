"""
bootstrap_deploy.py — Provision this workflow's dependencies on a fresh
Mistral workspace and stage it for the worker to pick up.

Run this once after filling in `.env` (copy `.env.template` to `.env` first
and set MISTRAL_API_KEY to the *target* workspace's key). Safe to re-run:
agents are matched by name and tools by content hash, so nothing is
duplicated.

Deliberately dependency-light — this script only needs `mistralai`,
`httpx` and `python-dotenv` (all already in backend/requirements.txt), so it
can run before the rest of the backend's dependencies are installed.

    pip install mistralai httpx python-dotenv
    python bootstrap_deploy.py

What it does, in order:
  1. Load .env, fail fast if MISTRAL_API_KEY is missing.
  2. Read manifest.json.
  3. Resolve-or-create every agent the workflow calls, by name.
  4. Import every dynamic tool's bundled source into the Tool Service.
  5. Print a checklist of connectors that need manual authorization.
  6. Copy the compiled workflow module into MISTRAL_WORKFLOWS_DIR.
  7. Print the command to start the worker.
"""

import json
import os
import shutil
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependency: pip install mistralai httpx python-dotenv")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "").strip()
if not MISTRAL_API_KEY or MISTRAL_API_KEY == "your_mistral_api_key_here":
    print("MISTRAL_API_KEY is not set. Copy .env.template to .env and fill it in.")
    sys.exit(1)

TOOL_SERVICE_URL = os.environ.get("TOOL_SERVICE_URL", "http://localhost:9000").rstrip("/")
# Matches the env var mistral_worker.py itself reads (WORKFLOWS_DIR, not
# MISTRAL_WORKFLOWS_DIR — that name is the FastAPI app's own setting and is
# irrelevant here since this script never imports the app). Both default to
# `<package root>/mistral_workflows`, so leaving it unset just works.
WORKFLOWS_DIR = Path(os.environ.get("WORKFLOWS_DIR", "./mistral_workflows"))

MANIFEST_PATH = HERE / "manifest.json"
if not MANIFEST_PATH.exists():
    print(f"manifest.json not found next to this script ({MANIFEST_PATH}).")
    sys.exit(1)

manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
workflow_name = manifest["workflow_name"]

import httpx
from mistralai.client import Mistral

client = Mistral(api_key=MISTRAL_API_KEY, timeout_ms=120000)
http = httpx.Client(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}"},
    timeout=30.0,
)


# ── Step 3: agents ──────────────────────────────────────────────────────────

def _existing_agents() -> dict[str, str]:
    """name -> id, for every agent already on this workspace."""
    resp = http.get("/v1/agents", params={"page": 0, "page_size": 200})
    resp.raise_for_status()
    data = resp.json()
    agent_list = data if isinstance(data, list) else data.get("data", data)
    return {a["name"]: a["id"] for a in agent_list if a.get("name") and a.get("id")}


def provision_agents() -> None:
    agents = manifest.get("agents", [])
    if not agents:
        print("No agents to provision.")
        return

    existing = _existing_agents()
    for spec in agents:
        name = spec["name"]
        if name in existing:
            print(f"  [reuse]  agent '{name}' -> {existing[name]}")
            continue

        create_kwargs = {
            "model": spec["model"],
            "name": name,
            "instructions": spec["instructions"],
        }
        if spec.get("description"):
            create_kwargs["description"] = spec["description"]
        if spec.get("tier"):
            create_kwargs["metadata"] = {"tier": spec["tier"]}
        if spec.get("tool_defs"):
            create_kwargs["tools"] = spec["tool_defs"]

        agent = client.beta.agents.create(**create_kwargs)
        print(f"  [create] agent '{name}' -> {agent.id}")

        if spec.get("connector_ids"):
            print(
                f"           NOTE: '{name}' used connectors {spec['connector_ids']} on the "
                "source workspace — reattach these from the agent's page once authorized "
                "(see the connector checklist below)."
            )


# ── Step 4: dynamic tools ────────────────────────────────────────────────────

def import_dynamic_tools() -> None:
    tools = manifest.get("dynamic_tools", [])
    if not tools:
        return

    try:
        health = httpx.get(f"{TOOL_SERVICE_URL}/health", timeout=5.0)
        health.raise_for_status()
    except Exception as e:
        print(
            f"Tool Service unreachable at {TOOL_SERVICE_URL} ({e}). "
            "Start it (e.g. `docker compose -f docker-compose.deploy.yml --profile tools up -d tool-service`) "
            "and re-run this script to import the tools below."
        )
        return

    for tool in tools:
        resp = httpx.post(
            f"{TOOL_SERVICE_URL}/tools/import",
            json={
                "name": tool["name"],
                "schema": tool["schema"],
                "source_code": tool["source_code"],
                "hash": tool["hash"],
                "version": tool.get("version", "1.0.0"),
            },
            timeout=30.0,
        )
        if resp.status_code == 200:
            print(f"  [tool]   '{tool['name']}' -> {resp.json().get('status')}")
        else:
            print(f"  [tool]   '{tool['name']}' FAILED: {resp.status_code} {resp.text[:200]}")


# ── Step 5: connectors (manual) ──────────────────────────────────────────────

def print_connector_checklist() -> bool:
    connectors = manifest.get("connectors", [])
    if not connectors:
        return True

    print("\nThis workflow uses the following Mistral Connectors:")
    for c in connectors:
        label = c.get("connector_name") or c.get("connector_id") or "unknown"
        print(f"  - {label}")
    print(
        "\nConnector credentials are workspace-bound and cannot be provisioned by this "
        "script. Authorize each one in the target workspace's Mistral console before "
        "the workflow's connector steps will work."
    )
    answer = input("\nHave you authorized these connectors? [y/N] ").strip().lower()
    return answer == "y"


# ── Step 6: stage the compiled workflow ──────────────────────────────────────

def stage_workflow_module() -> None:
    WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)
    src = HERE / "mistral_workflows" / f"workflow_{workflow_name}.py"
    dst = WORKFLOWS_DIR / f"workflow_{workflow_name}.py"
    shutil.copyfile(src, dst)
    print(f"\nStaged {dst}")


def main() -> None:
    print(f"Provisioning workflow '{workflow_name}' on the target workspace...\n")

    print("Agents:")
    provision_agents()

    print("\nDynamic tools:")
    import_dynamic_tools()

    confirmed = print_connector_checklist()

    stage_workflow_module()

    print("\nDone. Start the worker to begin serving this workflow:")
    print("  python -m app.services.mistral_worker")
    print("  (or: docker compose -f docker-compose.deploy.yml up backend)")
    if manifest.get("connectors") and not confirmed:
        print(
            "\nWARNING: connector authorization was not confirmed — connector-dependent "
            "steps will fail until you authorize them and reattach them to the agent."
        )


if __name__ == "__main__":
    main()
