"""
Workflow Packager — builds a self-contained deployment bundle for a workflow.

A package lets an operator stand up this workflow's execution environment on
any server: the agents it calls, the tool code its steps depend on (native
code ships as part of the backend tree; dynamic/synthesized tool source
travels in the manifest and is imported via the Tool Service's
``POST /tools/import``), and the compiled Mistral Workflows SDK module,
wired through ``bootstrap_deploy.py`` so a single script visit is enough.

Connectors are the one thing this cannot provision: Mistral connector
credentials are workspace-bound platform state with no export API, so the
manifest only surfaces a checklist for manual authorization.
"""

import io
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.services.workflow_engine.models import (
    WorkflowDefinition, WorkflowStep, StepType,
    DeploymentManifest, DeploymentAgentSpec, DeploymentDynamicTool, DeploymentConnectorRef,
)
from app.services.mistral_workflows_compiler import compile_workflow_to_python

# backend/app/services/workflow_packager.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_REPO_ROOT = _BACKEND_DIR.parent
_TOOL_SERVICE_DIR = _REPO_ROOT / "tool-service"
_TEMPLATES_DIR = Path(__file__).resolve().parent / "deploy_templates"

# Directories/files never copied into a package — build artifacts, local
# state and secrets that have no business leaving this machine.
_SKIP_DIR_NAMES = {".venv", "venv", "__pycache__", ".git", "node_modules", "dynamic_tools", "db", "deploy_templates"}
_SKIP_FILE_NAMES = {".env", "sql_app.db"}


async def build_deployment_manifest(workflow_def: WorkflowDefinition, client) -> DeploymentManifest:
    """Walk a workflow's steps and capture everything needed to reproduce
    its execution environment on a different Mistral workspace.
    """
    from app.services import agent_service
    from app.services.tool_registry import ALL_TOOLS, BUILTIN_TOOLS
    from app.services.tool_resolver import tool_resolver

    all_agents = (await agent_service.list_agents(client, page=0, page_size=200))["items"]
    by_id = {a["id"]: a for a in all_agents if a.get("id")}
    by_name = {a["name"]: a for a in all_agents if a.get("name")}

    agent_specs: dict[str, DeploymentAgentSpec] = {}
    native_tools: set[str] = set()
    dynamic_tool_names: set[str] = set()
    connectors: list[DeploymentConnectorRef] = []
    seen_connector_keys: set[tuple] = set()
    uses_kg = False

    for step in workflow_def.steps:
        cfg = step.config or {}

        if step.type == StepType.AGENT:
            ref = cfg.get("agent_id", "")
            agent = by_id.get(ref) or by_name.get(ref)
            if agent and agent["id"] not in agent_specs:
                raw_tools = agent.get("tools") or []
                tool_defs = [t for t in raw_tools if isinstance(t, dict) and t.get("type") != "connector"]
                connector_ids = [
                    c.get("connector_id") for c in (agent.get("connectors") or []) if c.get("connector_id")
                ]
                agent_specs[agent["id"]] = DeploymentAgentSpec(
                    source_agent_id=agent["id"],
                    name=agent.get("name") or agent["id"],
                    model=agent.get("model") or "mistral-large-latest",
                    description=agent.get("description"),
                    instructions=agent.get("instructions") or "",
                    tier=agent.get("tier"),
                    tool_defs=tool_defs,
                    connector_ids=connector_ids,
                )
                if agent.get("knowledge_graph"):
                    uses_kg = True

        elif step.type == StepType.TOOL:
            tool_name = cfg.get("tool_name", "")
            if not tool_name:
                continue
            if tool_name in ALL_TOOLS or tool_name in BUILTIN_TOOLS:
                native_tools.add(tool_name)
            else:
                dynamic_tool_names.add(tool_name)

        elif step.type == StepType.CONNECTOR:
            key = (cfg.get("connector_name") or "", cfg.get("connector_id") or "", cfg.get("credentials_name") or "")
            if (key[0] or key[1]) and key not in seen_connector_keys:
                seen_connector_keys.add(key)
                connectors.append(DeploymentConnectorRef(
                    connector_id=cfg.get("connector_id") or None,
                    connector_name=cfg.get("connector_name") or None,
                    credentials_name=cfg.get("credentials_name") or None,
                ))

    dynamic_tools: list[DeploymentDynamicTool] = []
    if dynamic_tool_names:
        records = await tool_resolver.list_tools()
        by_tool_name = {r.get("name"): r for r in records if r.get("name")}
        for name in dynamic_tool_names:
            record = by_tool_name.get(name)
            if not record or record.get("status") != "approved" or not record.get("source_code"):
                continue
            dynamic_tools.append(DeploymentDynamicTool(
                name=name,
                schema=record.get("schema", {}) or {},
                source_code=record["source_code"],
                hash=record.get("hash", ""),
                version=record.get("version", "1.0.0"),
            ))

    return DeploymentManifest(
        workflow_name=workflow_def.name,
        description=workflow_def.description,
        agents=list(agent_specs.values()),
        native_tools=sorted(native_tools),
        dynamic_tools=dynamic_tools,
        connectors=connectors,
        uses_knowledge_graph=uses_kg,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _name_based_definition(workflow_def: WorkflowDefinition, manifest: DeploymentManifest) -> WorkflowDefinition:
    """Copy of the definition with AGENT steps addressed by name, not UUID.

    ``step_runners._resolve_agent_id`` already resolves a non-UUID agent_id by
    name at runtime, so this is all the compiler needs to produce a module
    that works on a workspace where the source's agent UUIDs don't exist.
    """
    id_to_name = {a.source_agent_id: a.name for a in manifest.agents}
    new_steps: list[WorkflowStep] = []
    for step in workflow_def.steps:
        if step.type == StepType.AGENT:
            cfg = dict(step.config or {})
            ref = cfg.get("agent_id", "")
            if ref in id_to_name:
                cfg["agent_id"] = id_to_name[ref]
            step = step.model_copy(update={"config": cfg})
        new_steps.append(step)
    return workflow_def.model_copy(update={"steps": new_steps})


def _iter_source_tree(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_NAMES]
        for filename in filenames:
            if filename in _SKIP_FILE_NAMES or filename.endswith((".pyc", ".pyo")):
                continue
            full = Path(dirpath) / filename
            yield full, full.relative_to(root)


def _render_env_template(manifest: DeploymentManifest) -> str:
    lines = [
        "# Copy this file to .env and fill in MISTRAL_API_KEY before running",
        "# bootstrap_deploy.py.",
        "MISTRAL_API_KEY=your_mistral_api_key_here",
        "",
        f"DEPLOYMENT_NAME={manifest.workflow_name}-worker",
        "MISTRAL_WORKER_ENABLED=true",
        "DATABASE_URL=sqlite:///./sql_app.db",
    ]
    if manifest.dynamic_tools:
        lines += ["", "# Dynamic tools this workflow uses need the Tool Service reachable here.", "TOOL_SERVICE_URL=http://localhost:9000"]
    if manifest.uses_knowledge_graph:
        lines += [
            "",
            "# This workflow uses the knowledge-graph tool.",
            "NEO4J_URI=bolt://localhost:7687",
            "NEO4J_USER=neo4j",
            "NEO4J_PASSWORD=mistral-graph-rag",
        ]
    return "\n".join(lines) + "\n"


def _render_readme(manifest: DeploymentManifest) -> str:
    lines = [
        f"# Deploying `{manifest.workflow_name}`",
        "",
        f"Generated {manifest.generated_at}.",
        "",
        "## What's in this package",
        "",
        f"- **Agents** ({len(manifest.agents)}): " + (", ".join(a.name for a in manifest.agents) or "none"),
        f"- **Native tools** ({len(manifest.native_tools)}, ship with the backend code): "
        + (", ".join(manifest.native_tools) or "none"),
        f"- **Dynamic tools** ({len(manifest.dynamic_tools)}, source bundled, auto-installed): "
        + (", ".join(t.name for t in manifest.dynamic_tools) or "none"),
        f"- **Connectors** ({len(manifest.connectors)}, require manual authorization): "
        + (", ".join(c.connector_name or c.connector_id or "?" for c in manifest.connectors) or "none"),
        "",
        "## Steps",
        "",
        "1. `cp .env.template .env` and set `MISTRAL_API_KEY` to the **target** workspace's key.",
    ]
    if manifest.connectors:
        lines.append(
            "2. In the target Mistral console, authorize these connectors before continuing: "
            + ", ".join(c.connector_name or c.connector_id or "?" for c in manifest.connectors) + "."
        )
    step_n = 3 if manifest.connectors else 2
    if manifest.dynamic_tools:
        lines.append(f"{step_n}. Start the Tool Service: `docker compose -f docker-compose.deploy.yml --profile tools up -d tool-service`.")
        step_n += 1
    if manifest.uses_knowledge_graph:
        lines.append(f"{step_n}. Start Neo4j: `docker compose -f docker-compose.deploy.yml --profile knowledge-graph up -d neo4j`.")
        step_n += 1
    lines.append(f"{step_n}. `pip install mistralai httpx python-dotenv && python bootstrap_deploy.py` — creates/reuses the agents above and imports the dynamic tools.")
    step_n += 1
    lines.append(f"{step_n}. Start serving: `docker compose -f docker-compose.deploy.yml up backend` (or, from inside `backend/`: `pip install -r requirements.txt && pip install mistralai-workflows && python -m app.services.mistral_worker`).")
    lines += [
        "",
        "Re-running `bootstrap_deploy.py` is safe — agents are matched by name and tools by content hash, so nothing is duplicated.",
    ]
    return "\n".join(lines) + "\n"


def build_package_zip(workflow_def: WorkflowDefinition, manifest: DeploymentManifest) -> bytes:
    """Assemble the full deployment .zip for a workflow, in memory."""
    named_def = _name_based_definition(workflow_def, manifest)
    compiled_code = compile_workflow_to_python(named_def)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # ── Backend source tree ──────────────────────────────────────────
        # zip entries must use forward slashes regardless of host OS — a
        # Windows-style backslash arcname is read back as one flat filename
        # (not a nested path) by unzip on Linux/Mac.
        for full, rel in _iter_source_tree(_BACKEND_DIR):
            zf.write(full, (Path("backend") / rel).as_posix())
        zf.write(_TEMPLATES_DIR / "Dockerfile", "backend/Dockerfile")

        # ── Tool Service source tree (only if this workflow needs it) ────
        if manifest.dynamic_tools and _TOOL_SERVICE_DIR.exists():
            for full, rel in _iter_source_tree(_TOOL_SERVICE_DIR):
                zf.write(full, (Path("tool-service") / rel).as_posix())

        # ── Compiled workflow ─────────────────────────────────────────────
        zf.writestr(f"mistral_workflows/workflow_{workflow_def.name}.py", compiled_code)

        # ── Manifest + bootstrap + docs ───────────────────────────────────
        zf.writestr("manifest.json", manifest.model_dump_json(indent=2))
        zf.write(_TEMPLATES_DIR / "bootstrap_deploy.py", "bootstrap_deploy.py")
        zf.write(_TEMPLATES_DIR / "docker-compose.deploy.yml", "docker-compose.deploy.yml")
        zf.writestr(".env.template", _render_env_template(manifest))
        zf.writestr("README.md", _render_readme(manifest))

    return buf.getvalue()
