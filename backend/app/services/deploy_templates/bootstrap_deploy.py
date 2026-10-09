"""
bootstrap_deploy.py — Set up this workflow on the target Mistral workspace.
Runs before the worker on every start (the Docker image and run.sh both do
this); safe to repeat — connectors and agents are matched by name, and the
knowledge graph is loaded once.

In order:
  1. connectors — found by name; a custom one missing on the target is
     created; credentials from .env are stored; each is activated. One that
     still needs an OAuth sign-in prints its authorization link.
  2. agents — created if missing, with their connectors attached by name.
  3. knowledge — the agents' graph and domain knowledge (seed/knowledge.json),
     loaded into this deployment's Neo4j and database.

The tool and activity code needs no provisioning: it is bundled into this
backend (app/bundled_tools/) and runs inside the worker.

Reads its settings from the environment, or from .env here or one level up.
"""

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def fail(message: str) -> None:
    # The deploy flow watches the worker's log for this marker.
    print(f"Bootstrap failed: {message}", flush=True)
    sys.exit(1)


try:
    from dotenv import load_dotenv

    for env_file in (HERE / ".env", HERE.parent / ".env"):
        if env_file.exists():
            load_dotenv(env_file, override=False)
except ImportError:
    pass


def env(key: str) -> str:
    return os.environ.get(key, "").strip().strip("\"'") if key else ""


MISTRAL_API_KEY = env("MISTRAL_API_KEY")
if not MISTRAL_API_KEY or MISTRAL_API_KEY == "your_mistral_api_key_here":
    fail("MISTRAL_API_KEY is not set — put it in .env")

MANIFEST_PATH = HERE / "deploy_manifest.json"
if not MANIFEST_PATH.exists():
    fail(f"{MANIFEST_PATH.name} not found next to this script")
manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

import httpx

http = httpx.Client(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}"},
    timeout=60.0,
)

#: Scope the deployment's connector credentials and activation live at.
SCOPE = "workspace"


def api(method: str, path: str, what: str, **kwargs):
    resp = http.request(method, path, **kwargs)
    if resp.status_code == 401:
        fail("MISTRAL_API_KEY was rejected (401)")
    if resp.status_code >= 400:
        raise RuntimeError(f"{what} returned {resp.status_code}: {resp.text[:300]}")
    return resp.json() if resp.content else None


def items(payload) -> list:
    if isinstance(payload, list):
        return payload
    for key in ("data", "items", "connectors"):
        if isinstance(payload, dict) and isinstance(payload.get(key), list):
            return payload[key]
    return []


# ── 1. Connectors ────────────────────────────────────────────────────────


def setup_connectors() -> dict[str, str]:
    """Name → id on this workspace, for every connector the workflow uses."""
    wanted = manifest.get("connectors", [])
    if not wanted:
        return {}
    existing = {c.get("name"): c for c in items(api("GET", "/v1/connectors", "listing connectors",
                                                     params={"page_size": 200}))}
    ids: dict[str, str] = {}
    problems: list[str] = []
    for spec in wanted:
        name = spec["connector_name"]
        keys = spec.get("env_keys") or {}
        connector = existing.get(name)
        if connector:
            print(f"  [reuse]  connector '{name}' -> {connector.get('id')}")
        elif spec.get("is_directory"):
            problems.append(f"'{name}' is a directory connector — install it from Studio on this "
                            "workspace, then restart")
            continue
        elif not spec.get("server"):
            problems.append(f"'{name}' has no server URL to create it with")
            continue
        else:
            body = {"name": name, "description": spec.get("description") or name,
                    "server": spec["server"]}
            if env(keys.get("client_id", "")) and env(keys.get("client_secret", "")):
                body["auth_data"] = {"client_id": env(keys["client_id"]),
                                     "client_secret": env(keys["client_secret"])}
            connector = api("POST", "/v1/connectors", f"creating connector '{name}'", json=body)
            print(f"  [create] connector '{name}' -> {connector.get('id')}")
        cid = connector.get("id")
        ids[name] = cid

        token = env(keys.get("token", ""))
        if token:
            api("POST", f"/v1/connectors/{cid}/{SCOPE}/credentials", f"storing credentials for '{name}'",
                json={"name": spec.get("credentials_name") or "default",
                      "credentials": {"bearer_token": token}, "is_default": True})
            print(f"           credentials stored ({spec.get('credentials_name') or 'default'})")
        try:
            api("POST", f"/v1/connectors/{cid}/{SCOPE}/activate", f"activating '{name}'", json={})
        except RuntimeError as e:
            print(f"           WARNING: could not activate: {e}")

        fresh = api("GET", f"/v1/connectors/{cid}", f"reading '{name}'") or {}
        if spec.get("auth") != "none" and not fresh.get("is_authenticated"):
            if spec.get("auth") == "oauth2":
                params = {"credentials_name": spec["credentials_name"]} if spec.get("credentials_name") else None
                link = (api("GET", f"/v1/connectors/{cid}/auth_url", f"auth link for '{name}'",
                            params=params) or {}).get("auth_url")
                print(f"  ACTION   '{name}' needs a sign-in — open this link once: {link}")
            else:
                print(f"  ACTION   '{name}' has no credentials — set {keys.get('token')} in .env and restart")
    if problems:
        fail("; ".join(problems))
    return ids


# ── 2. Agents ────────────────────────────────────────────────────────────


def existing_agents() -> dict[str, str]:
    """name → id, for every agent already on this workspace."""
    found: dict[str, str] = {}
    page = 0
    while True:
        batch = items(api("GET", "/v1/agents", "listing agents", params={"page": page, "page_size": 100}))
        found.update({a["name"]: a["id"] for a in batch if a.get("name") and a.get("id")})
        if len(batch) < 100:
            return found
        page += 1


def provision_agents(connector_ids: dict[str, str]) -> dict[str, str]:
    """Source agent id → id on this workspace."""
    agents = manifest.get("agents", [])
    if not agents:
        print("  none")
        return {}
    existing = existing_agents()
    mapping: dict[str, str] = {}
    for spec in agents:
        name = spec["name"]
        if name in existing:
            print(f"  [reuse]  agent '{name}' -> {existing[name]}")
            mapping[spec["source_agent_id"]] = existing[name]
            continue
        tools = list(spec.get("tool_defs") or [])
        for c in spec.get("connectors") or []:
            cid = connector_ids.get(c.get("connector_name"))
            if cid:
                tool = {"type": "connector", "connector_id": cid}
                if c.get("tool_configuration"):
                    tool["tool_configuration"] = c["tool_configuration"]
                tools.append(tool)
        body = {"model": spec["model"], "name": name, "instructions": spec["instructions"]}
        if spec.get("description"):
            body["description"] = spec["description"]
        if spec.get("tier"):
            body["metadata"] = {"tier": spec["tier"]}
        if tools:
            body["tools"] = tools
        created = api("POST", "/v1/agents", f"creating agent '{name}'", json=body)
        print(f"  [create] agent '{name}' -> {created.get('id')}")
        mapping[spec["source_agent_id"]] = created.get("id")
    return mapping


# ── 3. Knowledge ─────────────────────────────────────────────────────────


def load_knowledge(agent_ids: dict[str, str]) -> None:
    seed = HERE / "seed" / "knowledge.json"
    if not seed.exists():
        return
    from app.services import deploy_knowledge

    print("Knowledge:")
    data = json.loads(seed.read_text(encoding="utf-8"))
    print(f"  {deploy_knowledge.import_knowledge(data, agent_ids)}")


def main() -> None:
    name = manifest["workflow_name"]
    print(f"Bootstrapping '{name}' — queue {env('DEPLOYMENT_NAME') or '(DEPLOYMENT_NAME unset)'}")
    if manifest.get("connectors"):
        print("Connectors:")
    connector_ids = setup_connectors()
    print("Agents:")
    agent_ids = provision_agents(connector_ids)
    load_knowledge(agent_ids)
    tools = manifest.get("dynamic_tools", [])
    if tools:
        print(f"Bundled code: {', '.join(t['name'] for t in tools)}")
    print("Bootstrap complete.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (httpx.HTTPError, RuntimeError) as e:
        fail(str(e))
