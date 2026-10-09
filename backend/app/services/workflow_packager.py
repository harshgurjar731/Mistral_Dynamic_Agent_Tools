"""
Workflow Packager — builds a self-contained deployment bundle for a workflow.

The package runs the workflow's Mistral worker — no Tool Service — plus the
databases its tools need:

    backend/                     the backend source, plus:
      app/bundled_tools/         the approved, tested code of every dynamic
        registry.json            tool the workflow uses — activities (TOOL
        <name>_v<N>.py           steps) and agent tools — run in-process by
                                 app/services/bundled_tools.py
      seed/knowledge.json        the agents' knowledge graph and domain
                                 knowledge (app/services/deploy_knowledge.py)
      requirements-tools.txt     third-party packages that code imports, and
                                 the SQL driver
      bootstrap_deploy.py        connectors, agents, knowledge — on every start
      deploy_manifest.json
      Dockerfile                 bootstrap, then the worker
    mistral_workflows/           the compiled workflow module
    db/seed.sql                  optional: loaded into a new SQL container
    docker-compose.deploy.yml    the worker, plus Neo4j when an agent searches
                                 the knowledge graph and PostgreSQL when the
                                 SQL tools get a container database
    run.sh                       the worker without Docker (no databases)
    .env.template, manifest.json, README.md, and .env when built with answers

What the operator must supply — the Mistral key, the tool code's secrets,
connector credentials, the SQL database choice — is the manifest's ``setup``;
the UI asks for it before building (``DeploymentSetup``).

The compiled module's activities are thin wrappers (``run_step``); the code a
TOOL step executes is the dynamic tool's own source, so that source is what is
bundled. Native tools ship as part of the backend tree.

Packaging refuses rather than ships a package that cannot run: a tool the
workflow uses that is unreachable, unknown, unapproved or without source code
is a ``PackagingError`` naming each one.

Connectors are the one thing this cannot provision: Mistral connector
credentials are workspace-bound platform state with no export API, so the
manifest only surfaces a checklist for manual authorization.
"""

import ast
import io
import json
import os
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.services.mistral_workflows_compiler import compile_workflow_to_python
from app.services.workflow_engine.models import (
    DeploymentAgentSpec,
    DeploymentConnectorRef,
    DeploymentDynamicTool,
    DeploymentManifest,
    DeploymentSetup,
    DeploymentSetupField,
    StepType,
    WorkflowDefinition,
    WorkflowStep,
)

# backend/app/services/workflow_packager.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_TEMPLATES_DIR = Path(__file__).resolve().parent / "deploy_templates"

# Directories/files never copied into a package — build artifacts, local
# state and secrets that have no business leaving this machine.
_SKIP_DIR_NAMES = {".venv", "venv", "__pycache__", ".git", "node_modules", "dynamic_tools", "db",
                   "deploy_templates", "bundled_tools"}
_SKIP_FILE_NAMES = {".env", "sql_app.db"}

#: Third-party imports generated code may use (tool-service/app/synthesis/policy.py),
#: by import name → pip name. Everything else it imports is standard library.
_TOOL_REQUIREMENTS = {"requests": "requests", "pandas": "pandas", "numpy": "numpy",
                      "bs4": "beautifulsoup4", "lxml": "lxml"}


class PackagingError(ValueError):
    """The workflow cannot be packaged as it stands; the message says why."""


def _is_native(name: str) -> bool:
    """Built into the backend, so it ships with the backend tree.

    Checked against the fixed native tables, never ``ALL_TOOLS``: dynamic tools
    are added to that one at runtime, and would then look native and be left
    out of the package.
    """
    from app.services.tool_registry import BUILTIN_TOOLS, FUNCTION_TOOLS

    return name in FUNCTION_TOOLS or name in BUILTIN_TOOLS


def _agent_function_names(tool_defs: list[dict]) -> list[str]:
    names = []
    for t in tool_defs:
        if isinstance(t, dict) and t.get("type") == "function":
            name = (t.get("function") or {}).get("name")
            if name:
                names.append(name)
    return names


def _requirements(source: str) -> list[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            roots.add(node.module.split(".")[0])
    return sorted(_TOOL_REQUIREMENTS[r] for r in roots if r in _TOOL_REQUIREMENTS)


async def _resolve_dynamic_tools(wanted: dict[str, tuple[int | None, str]]) -> list[DeploymentDynamicTool]:
    """The approved source of every dynamic tool, or a PackagingError naming
    each one that cannot be shipped and why."""
    from app.services.tool_resolver import tool_resolver

    if not wanted:
        return []
    if not await tool_resolver.health_check():
        raise PackagingError(
            "The Tool Service is not reachable, so the code of "
            f"{', '.join(sorted(wanted))} cannot be packaged. Start it and try again.")

    by_name = {r.get("name"): r for r in await tool_resolver.list_tools() if r.get("name")}
    tools: list[DeploymentDynamicTool] = []
    problems: list[str] = []
    for name, (pin, used_by) in sorted(wanted.items()):
        record = by_name.get(name)
        if pin is not None and (not record or record.get("version_no") != pin):
            # The workflow was planned against a version that is no longer the
            # active one — ship exactly that version's code.
            record = next((v for v in await tool_resolver.get_tool_versions(name)
                           if v.get("version_no") == pin), None)
        what = f"'{name}'" + (f" v{pin}" if pin is not None else "") + f" ({used_by})"
        if not record:
            problems.append(f"{what} does not exist in the Tool Service")
            continue
        if record.get("status") != "approved":
            problems.append(f"{what} is '{record.get('status')}' — approve it first")
            continue
        if not record.get("source_code"):
            problems.append(f"{what} has no source code")
            continue
        spec = record.get("spec") or {}
        tools.append(DeploymentDynamicTool(
            name=name,
            schema=record.get("schema", {}) or {},
            source_code=record["source_code"],
            hash=record.get("hash", ""),
            version=record.get("version", "1.0.0"),
            version_no=record.get("version_no"),
            purpose=record.get("purpose") or "tool",
            output_schema=record.get("output_schema"),
            secrets=[str(s) for s in (spec.get("secrets") or [])],
            requirements=_requirements(record["source_code"]),
        ))
    if problems:
        raise PackagingError("Cannot package this workflow: " + "; ".join(problems) + ".")
    return tools


_SQL_TOOLS = {"execute_sql_query", "get_database_schema"}


def _env_slug(name: str) -> str:
    return re.sub(r"[^0-9A-Za-z]+", "_", name).strip("_").upper() or "CONNECTOR"


def _auth_kind(connector: dict) -> str:
    """What credentials the setup form asks for: "bearer", "oauth2" or "none"."""
    methods = " ".join(str(m) for m in (connector.get("supported_auth_methods") or [])).lower()
    methods += " " + str(connector.get("auth_type") or "").lower()
    if "oauth" in methods:
        return "oauth2"
    if any(k in methods for k in ("bearer", "token", "api_key", "apikey", "header")):
        return "bearer"
    return "none"


async def _describe_connectors(refs: dict[str, dict]) -> list[DeploymentConnectorRef]:
    """Each connector as the target needs it: how to create it and what
    credentials to ask for. ``refs``: connector name or id → what uses it."""
    from app.exceptions import MistralAPIError
    from app.services import connector_service

    out: list[DeploymentConnectorRef] = []
    for ref, info in refs.items():
        try:
            c = await connector_service.get_connector(ref)
        except MistralAPIError as e:
            raise PackagingError(f"Connector '{ref}' ({', '.join(info['used_by'])}) could not be "
                                 f"read: {e.message}") from e
        name = c.get("name") or ref
        auth = _auth_kind(c)
        slug = _env_slug(name)
        if auth == "bearer":
            env_keys = {"token": f"CONNECTOR_{slug}_TOKEN"}
        elif auth == "oauth2" and not c.get("is_directory"):
            env_keys = {"client_id": f"CONNECTOR_{slug}_CLIENT_ID",
                        "client_secret": f"CONNECTOR_{slug}_CLIENT_SECRET"}
        else:
            env_keys = {}
        out.append(DeploymentConnectorRef(
            connector_id=c.get("id") or ref,
            connector_name=name,
            credentials_name=info.get("credentials_name"),
            is_directory=bool(c.get("is_directory")),
            server=c.get("server"),
            description=c.get("description") or name,
            auth=auth,
            used_by=info["used_by"],
            env_keys=env_keys,
        ))
    return out


def _setup_fields(name: str, tools: list[DeploymentDynamicTool],
                  connectors: list[DeploymentConnectorRef], uses_kg: bool) -> list[DeploymentSetupField]:
    fields = [
        DeploymentSetupField(key="MISTRAL_API_KEY", label="Mistral API key", secret=True, required=True,
                             help="Key of the workspace the worker runs in. Runs started from this "
                                  "app reach it only if it is this app's workspace."),
        DeploymentSetupField(key="DEPLOYMENT_NAME", label="Worker queue", required=True,
                             default=f"{name}-worker",
                             help="The task queue the worker polls. Must differ from any other worker's."),
    ]
    by_secret: dict[str, list[str]] = {}
    for t in tools:
        for secret in t.secrets:
            by_secret.setdefault(secret, []).append(t.name)
    for secret, users in sorted(by_secret.items()):
        fields.append(DeploymentSetupField(
            key=secret, label=secret, secret=True, required=True, group="tool",
            help=f"Read by {', '.join(users)} (third-party API credential)."))
    for c in connectors:
        where = ", ".join(c.used_by)
        if c.auth == "bearer":
            fields.append(DeploymentSetupField(
                key=c.env_keys["token"], label=f"{c.connector_name} — access token", secret=True,
                group="connector",
                help=f"Used by {where}. Stored as the connector's credential on the target workspace. "
                     "Leave blank if the connector is already connected there."))
        elif c.env_keys:
            fields.append(DeploymentSetupField(
                key=c.env_keys["client_id"], label=f"{c.connector_name} — OAuth client ID",
                group="connector", help=f"Used by {where}. Needed only if the connector does not exist "
                                        "on the target workspace yet."))
            fields.append(DeploymentSetupField(
                key=c.env_keys["client_secret"], label=f"{c.connector_name} — OAuth client secret",
                secret=True, group="connector",
                help="After the first start, sign in through the authorization link in the worker log."))
    if uses_kg:
        fields.append(DeploymentSetupField(
            key="NEO4J_PASSWORD", label="Neo4j password", secret=True, group="database",
            help="For the knowledge-graph database started with the worker. Blank: one is generated. "
                 "Keep it once the database exists — it is set on first start only."))
    return fields


async def build_deployment_manifest(workflow_def: WorkflowDefinition, client) -> DeploymentManifest:
    """Walk a workflow's steps and capture everything needed to reproduce
    its execution environment on a different Mistral workspace.
    """
    from app.rag.scope import library_ids_from_tools
    from app.services import agent_service
    from app.services.tool_registry import DOMAIN_SEARCH_TOOL

    all_agents = (await agent_service.list_agents(client, page=0, page_size=200))["items"]
    by_id = {a["id"]: a for a in all_agents if a.get("id")}
    by_name = {a["name"]: a for a in all_agents if a.get("name")}

    agent_specs: dict[str, DeploymentAgentSpec] = {}
    native_tools: set[str] = set()
    #: name → (the version steps pin — None: the active one, who uses it).
    wanted: dict[str, tuple[int | None, str]] = {}
    #: connector name or id → {used_by, credentials_name}
    connector_refs: dict[str, dict] = {}
    graph_libraries: set[str] = set()
    uses_kg = False

    def want(name: str, pin: int | None, used_by: str) -> None:
        if ":" in name:
            raise PackagingError(f"'{name}' ({used_by}) is an MCP tool, which runs through the "
                                 "Tool Service and cannot be packaged.")
        if _is_native(name):
            native_tools.add(name)
        elif name not in wanted or pin is not None:
            wanted[name] = (pin, used_by)

    def use_connector(ref: str, used_by: str, credentials_name: str | None = None) -> None:
        entry = connector_refs.setdefault(ref, {"used_by": [], "credentials_name": credentials_name})
        if used_by not in entry["used_by"]:
            entry["used_by"].append(used_by)
        entry["credentials_name"] = entry["credentials_name"] or credentials_name

    for step in workflow_def.steps:
        cfg = step.config or {}

        if step.type == StepType.AGENT:
            ref = cfg.get("agent_id", "")
            agent = by_id.get(ref) or by_name.get(ref)
            if not agent:
                raise PackagingError(f"Step '{step.id}' uses agent '{ref}', which no longer exists.")
            if agent["id"] not in agent_specs:
                label = f"agent '{agent.get('name')}'"
                raw_tools = agent.get("tools") or []
                tool_defs = [t for t in raw_tools if isinstance(t, dict) and t.get("type") != "connector"]
                attached = [c for c in (agent.get("connectors") or []) if c.get("connector_id")]
                agent_specs[agent["id"]] = DeploymentAgentSpec(
                    source_agent_id=agent["id"],
                    name=agent.get("name") or agent["id"],
                    model=agent.get("model") or "mistral-large-latest",
                    description=agent.get("description"),
                    instructions=agent.get("instructions") or "",
                    tier=agent.get("tier"),
                    tool_defs=tool_defs,
                    connector_ids=[c["connector_id"] for c in attached],
                    connectors=[{"connector_id": c["connector_id"],
                                 "tool_configuration": {k: c[k] for k in
                                                        ("include", "exclude", "requires_confirmation")
                                                        if c.get(k)}} for c in attached],
                )
                for c in attached:
                    use_connector(c["connector_id"], label)
                # Agent tools run in the worker when the agent calls them.
                functions = _agent_function_names(tool_defs)
                for name in functions:
                    want(name, None, f"tool of {label}")
                if agent.get("knowledge_graph") or DOMAIN_SEARCH_TOOL in functions:
                    uses_kg = True
                    graph_libraries.update(library_ids_from_tools(raw_tools))

        elif step.type == StepType.TOOL:
            tool_name = cfg.get("tool_name", "")
            if tool_name:
                want(tool_name, cfg.get("tool_version"), f"step '{step.id}'")

        elif step.type == StepType.CONNECTOR:
            ref = cfg.get("connector_name") or cfg.get("connector_id")
            if ref:
                use_connector(ref, f"step '{step.id}'", cfg.get("credentials_name"))

    dynamic_tools = await _resolve_dynamic_tools(wanted)
    connectors = await _describe_connectors(connector_refs)
    # Agents reference connectors by name on the target; ids are workspace-bound.
    by_ref = {}
    for ref, c in zip(connector_refs, connectors):
        by_ref[ref] = c.connector_name
    for spec in agent_specs.values():
        for c in spec.connectors:
            c["connector_name"] = by_ref.get(c["connector_id"], c["connector_id"])
    uses_kg = uses_kg or DOMAIN_SEARCH_TOOL in native_tools
    return DeploymentManifest(
        workflow_name=workflow_def.name,
        description=workflow_def.description,
        agents=list(agent_specs.values()),
        native_tools=sorted(native_tools),
        dynamic_tools=dynamic_tools,
        connectors=connectors,
        uses_knowledge_graph=uses_kg,
        graph_library_ids=sorted(graph_libraries),
        uses_sql_tools=bool(native_tools & _SQL_TOOLS),
        setup=_setup_fields(workflow_def.name, dynamic_tools, connectors, uses_kg),
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
            if filename in _SKIP_FILE_NAMES or filename.endswith((".pyc", ".pyo", ".secret")):
                continue
            full = Path(dirpath) / filename
            yield full, full.relative_to(root)


# ── Bundled tool code ─────────────────────────────────────────────────────


def _module_file(tool: DeploymentDynamicTool) -> str:
    return f"{re.sub(r'[^0-9A-Za-z_]', '_', tool.name)}_v{tool.version_no or 1}.py"


def _bundled_registry(manifest: DeploymentManifest) -> dict:
    """What app/services/bundled_tools.py reads: every tool, by name and version."""
    tools: dict[str, dict] = {}
    for t in manifest.dynamic_tools:
        version_no = t.version_no or 1
        entry = tools.setdefault(t.name, {"default_version": version_no, "versions": {}})
        entry["versions"][str(version_no)] = {
            "module": _module_file(t),
            "version_no": version_no,
            "purpose": t.purpose,
            "schema": t.tool_schema,
            "output_schema": t.output_schema,
            "secrets": t.secrets,
            "hash": t.hash,
        }
    return {"workflow": manifest.workflow_name, "generated_at": manifest.generated_at, "tools": tools}


# ── Databases ─────────────────────────────────────────────────────────────

#: SQL driver a URL's scheme needs, beyond SQLite which Python ships with.
_SQL_DRIVERS = {"postgresql": "psycopg2-binary", "postgres": "psycopg2-binary",
                "mysql": "pymysql", "mariadb": "pymysql"}
_SQL_CONTAINER_URL = "postgresql+psycopg2://app:${SQL_DB_PASSWORD:?set SQL_DB_PASSWORD in .env}@sqldb:5432/app"


def _sql_setup(manifest: DeploymentManifest, setup: DeploymentSetup | None):
    """The SQL tools' database for this package: None, or a validated choice."""
    from app.services.workflow_engine.models import DeploymentSqlSetup

    if not manifest.uses_sql_tools:
        return None
    sql = (setup.sql if setup else None) or DeploymentSqlSetup(mode="container")
    if sql.mode not in ("container", "external"):
        raise PackagingError(f"Unknown SQL database mode '{sql.mode}' — use container or external")
    if sql.mode == "external":
        url = (sql.url or "").strip()
        if "://" not in url:
            raise PackagingError("The SQL tools need a database: give its connection URL "
                                 "(e.g. postgresql://user:pass@host:5432/db), or choose the container.")
        scheme = url.split("://", 1)[0].split("+", 1)[0].lower()
        if scheme not in _SQL_DRIVERS and scheme != "sqlite":
            raise PackagingError(f"Unsupported database '{scheme}' — use PostgreSQL, MySQL/MariaDB or SQLite.")
        # SQLAlchemy picks MySQLdb for a bare mysql:// URL; the package ships PyMySQL.
        if scheme in ("mysql", "mariadb") and "+" not in url.split("://", 1)[0]:
            url = "mysql+pymysql://" + url.split("://", 1)[1]
        sql = sql.model_copy(update={"url": url})
    return sql


def _db_requirements(sql) -> list[str]:
    if sql is None:
        return []
    if sql.mode == "container":
        return [_SQL_DRIVERS["postgresql"]]
    scheme = sql.url.split("://", 1)[0].split("+", 1)[0].lower()
    return [_SQL_DRIVERS[scheme]] if scheme in _SQL_DRIVERS else []


def _secret_names(manifest: DeploymentManifest) -> list[str]:
    return sorted({s for t in manifest.dynamic_tools for s in t.secrets})


def _generated_password() -> str:
    import secrets as _secrets

    return _secrets.token_urlsafe(18)


# ── Rendered files ────────────────────────────────────────────────────────


def _env_values(manifest: DeploymentManifest, sql, setup: DeploymentSetup | None,
                generated: dict[str, str]) -> list[tuple[str, str, str]]:
    """(group comment, key, value) for every .env entry, defaults filled in.

    Generated passwords are fixed here, at build time: a database keeps the
    password it was first started with, so a later deploy only adds keys the
    server's .env is missing (remote_servers/deployers.py) and never rotates them.
    """
    given = dict(setup.env) if setup else {}
    rows: list[tuple[str, str, str]] = []
    for f in manifest.setup:
        value = given.get(f.key, f.default or "")
        if f.key == "NEO4J_PASSWORD" and not value:
            value = generated["NEO4J_PASSWORD"]
        rows.append((f.group, f.key, value))
    rows += [("worker", "MISTRAL_WORKER_ENABLED", "true"),
             ("worker", "DATABASE_URL", "sqlite:///./sql_app.db")]
    if sql is not None and sql.mode == "container":
        rows.append(("database", "SQL_DB_PASSWORD", given.get("SQL_DB_PASSWORD") or generated["SQL_DB_PASSWORD"]))
    if sql is not None and sql.mode == "external":
        rows.append(("database", "SQL_TOOLS_DATABASE_URL", sql.url))
    known = {key for _, key, _ in rows}
    rows += [("other", k, v) for k, v in given.items() if k not in known]
    order = list(_GROUP_TITLES)
    return sorted(rows, key=lambda r: order.index(r[0]) if r[0] in order else len(order))


_GROUP_TITLES = {
    "worker": "Worker",
    "tool": "Secrets the bundled tool code reads",
    "connector": "Connector credentials (applied to the target workspace on start)",
    "database": "Databases",
    "other": "Other",
}


def _render_env(manifest: DeploymentManifest, sql, setup: DeploymentSetup | None,
                generated: dict[str, str], *, blank_secrets: bool) -> str:
    secret_keys = {f.key for f in manifest.setup if f.secret} | {"SQL_TOOLS_DATABASE_URL"}
    generated_keys = {"NEO4J_PASSWORD", "SQL_DB_PASSWORD"}
    lines = ["# No quotes around values."]
    group = None
    for g, key, value in _env_values(manifest, sql, setup, generated):
        if g != group:
            lines += ["", f"# {_GROUP_TITLES.get(g, g)}"]
            group = g
        if blank_secrets and key in secret_keys and key not in generated_keys:
            value = ""
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def _render_compose(manifest: DeploymentManifest, sql) -> str:
    graph = manifest.uses_knowledge_graph
    seeded = sql is not None and sql.mode == "container" and bool(sql.seed_sql)
    lines = [
        "# Runs this workflow's Mistral worker"
        + (" and the databases its tools use" if graph or (sql and sql.mode == "container") else "") + ".",
        "#",
        "#   docker compose -f docker-compose.deploy.yml up -d --build",
        "#   docker compose -f docker-compose.deploy.yml logs -f backend",
        "",
        "services:",
        "  backend:",
        "    build: ./backend",
        "    env_file: ./.env",
        "    environment:",
        "      WORKFLOWS_DIR: /mistral_workflows",
    ]
    if graph:
        lines += ["      NEO4J_URI: bolt://neo4j:7687", "      NEO4J_USER: neo4j"]
    if sql is not None and sql.mode == "container":
        lines.append(f"      SQL_TOOLS_DATABASE_URL: {_SQL_CONTAINER_URL}")
    lines += ["    volumes:", "      - ./mistral_workflows:/mistral_workflows"]
    deps = (["neo4j"] if graph else []) + (["sqldb"] if sql is not None and sql.mode == "container" else [])
    if deps:
        lines.append("    depends_on:")
        for d in deps:
            lines += [f"      {d}:", "        condition: service_healthy"]
    lines.append("    restart: unless-stopped")
    if graph:
        lines += [
            "",
            "  # Knowledge graph; loaded with the agent's graph by bootstrap on first start.",
            "  neo4j:",
            "    image: neo4j:5-community",
            "    environment:",
            "      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:?set NEO4J_PASSWORD in .env}",
            "      NEO4J_server_memory_heap_max__size: 512M",
            "      NEO4J_server_memory_pagecache_size: 256M",
            "    volumes:",
            "      - neo4j-data:/data",
            "    healthcheck:",
            '      test: ["CMD-SHELL", "wget -qO- http://localhost:7474 >/dev/null 2>&1 || exit 1"]',
            "      interval: 10s",
            "      timeout: 5s",
            "      retries: 18",
            "      start_period: 30s",
            "    restart: unless-stopped",
        ]
    if sql is not None and sql.mode == "container":
        lines += [
            "",
            "  # The SQL tools' database" + ("; db/seed.sql runs once, into a new database." if seeded else "."),
            "  sqldb:",
            "    image: postgres:16-alpine",
            "    environment:",
            "      POSTGRES_USER: app",
            "      POSTGRES_DB: app",
            "      POSTGRES_PASSWORD: ${SQL_DB_PASSWORD:?set SQL_DB_PASSWORD in .env}",
            "    volumes:",
            "      - sql-data:/var/lib/postgresql/data",
        ]
        if seeded:
            lines.append("      - ./db/seed.sql:/docker-entrypoint-initdb.d/seed.sql:ro")
        lines += [
            "    healthcheck:",
            '      test: ["CMD-SHELL", "pg_isready -U app -d app"]',
            "      interval: 5s",
            "      timeout: 5s",
            "      retries: 24",
            "    restart: unless-stopped",
        ]
    volumes = (["neo4j-data"] if graph else []) + (["sql-data"] if sql is not None and sql.mode == "container" else [])
    if volumes:
        lines += ["", "volumes:"] + [f"  {v}:" for v in volumes]
    return "\n".join(lines) + "\n"


def _render_readme(manifest: DeploymentManifest, sql, knowledge: dict | None) -> str:
    activities = [t.name for t in manifest.dynamic_tools if t.purpose == "activity"]
    agent_tools = [t.name for t in manifest.dynamic_tools if t.purpose != "activity"]
    lines = [
        f"# Deploying `{manifest.workflow_name}`",
        "",
        f"Generated {manifest.generated_at}. The tool and activity code is bundled into the",
        "worker; no Tool Service is needed.",
        "",
        "## What's in this package",
        "",
        f"- **Agents** ({len(manifest.agents)}, created on first start): "
        + (", ".join(a.name for a in manifest.agents) or "none"),
        f"- **Activities** ({len(activities)}, bundled in `backend/app/bundled_tools/`): "
        + (", ".join(activities) or "none"),
        f"- **Agent tools** ({len(agent_tools)}, bundled): " + (", ".join(agent_tools) or "none"),
        f"- **Native tools** ({len(manifest.native_tools)}, part of the backend): "
        + (", ".join(manifest.native_tools) or "none"),
    ]
    for c in manifest.connectors:
        how = ("directory connector — install it from Studio on the target first" if c.is_directory
               else "created on the target if missing")
        lines.append(f"- **Connector** `{c.connector_name}` ({how}; auth: {c.auth}; used by "
                     f"{', '.join(c.used_by)})")
    if manifest.uses_knowledge_graph:
        from app.services import deploy_knowledge

        lines.append("- **Knowledge graph**: Neo4j container, loaded on first start with "
                     + (deploy_knowledge.summary(knowledge) if knowledge else "no data"))
    if sql is not None:
        lines.append("- **SQL database**: " + (
            "PostgreSQL container" + (", seeded from db/seed.sql" if sql.seed_sql else ", empty")
            if sql.mode == "container" else "existing database at SQL_TOOLS_DATABASE_URL"))
    lines += [
        "",
        "## Run it",
        "",
        "1. Fill in `.env` (`cp .env.template .env` if it isn't there).",
        "2. `docker compose -f docker-compose.deploy.yml up -d --build`",
        "",
        "On start, bootstrap sets up the connectors and agents and loads the knowledge graph, then",
        "the worker polls `DEPLOYMENT_NAME` — ready when the log shows `Starting Temporal worker`:",
        "`docker compose -f docker-compose.deploy.yml logs -f backend`. Start runs with that same",
        "deployment name as the worker queue.",
    ]
    if any(c.auth == "oauth2" for c in manifest.connectors):
        lines += ["", ("OAuth connectors: on first start the log prints an authorization link per "
                       "connector that is not connected yet — open it once to sign in.")]
    return "\n".join(lines) + "\n"


def _needs_docker(manifest: DeploymentManifest, sql) -> bool:
    return manifest.uses_knowledge_graph or (sql is not None and sql.mode == "container")


def build_package_zip(workflow_def: WorkflowDefinition, manifest: DeploymentManifest,
                      setup: DeploymentSetup | None = None) -> bytes:
    """Assemble the full deployment .zip for a workflow, in memory.

    ``setup`` carries the operator's answers: with ``env`` the package gets a
    filled-in ``.env`` (a download), and ``sql`` picks the SQL tools' database.
    """
    from app.services import deploy_knowledge

    sql = _sql_setup(manifest, setup)
    knowledge = None
    if manifest.uses_knowledge_graph:
        try:
            knowledge = deploy_knowledge.export_knowledge(manifest.graph_library_ids)
        except deploy_knowledge.KnowledgeExportError as e:
            raise PackagingError(str(e)) from e
    named_def = _name_based_definition(workflow_def, manifest)
    compiled_code = compile_workflow_to_python(named_def)
    # The code lives in its own files; the manifest only describes it.
    manifest_json = manifest.model_dump_json(
        indent=2, exclude={"dynamic_tools": {"__all__": {"source_code"}}})
    requirements = sorted({r for t in manifest.dynamic_tools for r in t.requirements}
                          | set(_db_requirements(sql)))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # zip entries must use forward slashes regardless of host OS — a
        # Windows-style backslash arcname is read back as one flat filename
        # (not a nested path) by unzip on Linux/Mac.
        for full, rel in _iter_source_tree(_BACKEND_DIR):
            if rel.as_posix() == "Dockerfile":
                continue  # the platform's image; the package ships its own below
            zf.write(full, (Path("backend") / rel).as_posix())
        zf.write(_TEMPLATES_DIR / "Dockerfile", "backend/Dockerfile")
        zf.write(_TEMPLATES_DIR / "bootstrap_deploy.py", "backend/bootstrap_deploy.py")
        zf.writestr("backend/deploy_manifest.json", manifest_json)
        zf.writestr("backend/requirements-tools.txt",
                    "".join(f"{r}\n" for r in requirements) or "# none\n")
        if knowledge is not None:
            zf.writestr("backend/seed/knowledge.json", json.dumps(knowledge))

        # ── Tool and activity code, verbatim ──────────────────────────────
        for tool in manifest.dynamic_tools:
            zf.writestr(f"backend/app/bundled_tools/{_module_file(tool)}", tool.source_code)
        if manifest.dynamic_tools:
            zf.writestr("backend/app/bundled_tools/registry.json",
                        json.dumps(_bundled_registry(manifest), indent=2))

        # ── Compiled workflow ─────────────────────────────────────────────
        zf.writestr(f"mistral_workflows/workflow_{workflow_def.name}.py", compiled_code)

        # ── Databases ─────────────────────────────────────────────────────
        if sql is not None and sql.mode == "container" and sql.seed_sql:
            zf.writestr("db/seed.sql", sql.seed_sql)

        # ── Run files + docs ──────────────────────────────────────────────
        zf.writestr("manifest.json", manifest_json)
        zf.writestr("docker-compose.deploy.yml", _render_compose(manifest, sql))
        run_sh = (_TEMPLATES_DIR / "run.sh").read_text(encoding="utf-8")
        if _needs_docker(manifest, sql):
            run_sh = ("#!/usr/bin/env sh\n"
                      "echo 'This workflow needs databases that run in Docker. Start it with:'\n"
                      "echo '  docker compose -f docker-compose.deploy.yml up -d --build'\n"
                      "exit 1\n")
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        # LF only: a checkout with CRLF endings would break the script under sh.
        zf.writestr(info, run_sh.replace("\r\n", "\n"))
        # One set of generated passwords per package, the same in both files.
        generated = {"NEO4J_PASSWORD": _generated_password(), "SQL_DB_PASSWORD": _generated_password()}
        zf.writestr(".env.template", _render_env(manifest, sql, setup, generated, blank_secrets=True))
        if setup and setup.env:
            zf.writestr(".env", _render_env(manifest, sql, setup, generated, blank_secrets=False))
        zf.writestr("README.md", _render_readme(manifest, sql, knowledge))

    return buf.getvalue()
