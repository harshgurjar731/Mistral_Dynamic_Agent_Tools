"""
Tool Registry — 3-tier routing: native → dynamic (Docker) → MCP (Docker).
Native tools execute locally. Dynamic and MCP tools proxy to Docker Tool Service.
"""

import inspect
import json
import logging
from contextvars import ContextVar
from typing import List

from app.config import settings

logger = logging.getLogger(__name__)

#: Canonical name of the grounded-knowledge tool.
#:
#: One tool covering both non-verbatim sources: the knowledge graph built from
#: an agent's documents, and the curated industry knowledge for its domain. It
#: replaced two separate tools that competed for the same question — three
#: retrieval tools on one agent is a tool-selection problem the model solves
#: badly, and a wrong choice returns nothing useful while looking like an
#: answer.
#:
#: Its partner is the built-in ``document_library``. The split a model can
#: actually apply: ask the library what a passage *says*, ask this what we
#: *know*.
#:
#: Referenced from agent creation, the builder catalogue and the reconcile, so
#: it is defined once — a typo in any of those would silently attach nothing.
DOMAIN_SEARCH_TOOL = "search_domain_knowledge"

#: Retired names, kept so the reconcile can strip them off agents created
#: before the consolidation. Never attached to anything new.
LEGACY_RETRIEVAL_TOOLS = ("query_industry_knowledge", "query_knowledge_graph")

#: Which agent is currently executing, for automatic knowledge scoping.
#:
#: The tool-call payload carries no agent identity, and asking the model to pass
#: its own domain would make correctness depend on the prompt. The runtimes set
#: this before invoking an agent instead, so the tool can look up that agent's
#: `serves_domain` annotations itself.
CURRENT_AGENT: ContextVar[str | None] = ContextVar("current_agent", default=None)

# ── Native Tool Definitions ────────────────────────────────────────────────

BUILTIN_TOOLS = {
    "web_search": {"type": "web_search"},
    "code_interpreter": {"type": "code_interpreter"},
    "image_generation": {"type": "image_generation"},
    "document_library": {"type": "document_library"},
}

FUNCTION_TOOLS = {
    "execute_sql_query": {
        "type": "function",
        "function": {
            "name": "execute_sql_query",
            "description": "Execute a SQL query against the database. Can be used for SELECT to fetch data or INSERT/UPDATE/DELETE to modify data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The valid SQL query string to execute."},
                },
                "required": ["query"],
            },
        },
    },
    "get_database_schema": {
        "type": "function",
        "function": {
            "name": "get_database_schema",
            "description": "Get the schema and list of tables in the database to understand its structure.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # Both non-verbatim sources behind one name. Executed in this process:
    # the graph is a local Bolt hop and the corpus is a SQLite scan, so a
    # Docker round trip would be pure latency.
    DOMAIN_SEARCH_TOOL: {
        "type": "function",
        "function": {
            "name": DOMAIN_SEARCH_TOOL,
            "description": (
                "Search everything this agent knows about its domain: the "
                "knowledge graph built from its own uploaded documents, and the "
                "curated industry knowledge for the business domain it serves. "
                "Returns entities, how they connect, the sentences they were "
                "extracted from, and any relevant industry regulation, metric, "
                "process or risk. "
                "Call this BEFORE answering anything that depends on the user's "
                "documents or on domain expertise — questions about "
                "relationships, dependencies, ownership, obligations, "
                "who-connects-to-what, regulations, thresholds or definitions. "
                "Use document_library instead when you need the exact wording of "
                "a specific passage; use both when you need the connection and "
                "the quotation. "
                "Results are scoped automatically to this agent's libraries and "
                "domain. "
                "IMPORTANT: what this returns is your sourced material. Any "
                "figure, rate, threshold, date or named regulation you state "
                "that did not come from it must be marked '(unverified)'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "What you need to know, in natural language. Name the "
                            "entities you care about — matching starts from them. "
                            "e.g. 'which suppliers is Contoso bound to under the "
                            "master agreement'."
                        ),
                    },
                    "library_id": {
                        "type": "string",
                        "description": (
                            "Optional. Search one specific library instead of all "
                            "of this agent's libraries."
                        ),
                    },
                    "domain": {
                        "type": "string",
                        "description": (
                            "Optional concept id to search industry knowledge "
                            "under, e.g. 'domain.lending.mortgage'. Leave empty "
                            "to use the agent's own domain."
                        ),
                    },
                    "hops": {
                        "type": "integer",
                        "description": (
                            "How far to walk out from the matched entities: 1 for "
                            "direct connections, 2 (the default) to include what "
                            "those connect to. Maximum 3."
                        ),
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return. Defaults to 12.",
                    },
                },
                "required": ["query"],
            },
        },
    },
}

# Combined registry
ALL_TOOLS = {**BUILTIN_TOOLS, **FUNCTION_TOOLS}
AVAILABLE_TOOL_KEYS = list(ALL_TOOLS.keys())

# Track which tools are dynamic (from Docker Tool Service)
_dynamic_tool_schemas: dict[str, dict] = {}
_mcp_tool_schemas: dict[str, dict] = {}  # key: "server:tool_name"


# ── Native Tool Execution (wired to real APIs) ──────────────────────────────


def _execute_sql_query(arguments: dict) -> str:
    """Execute SQL against the local SQLite database."""
    query = arguments.get("query", "")
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(text(query))
        if query.strip().upper().startswith("SELECT"):
            rows = [dict(row) for row in result.mappings()]
            return json.dumps(rows, default=str)
        db.commit()
        return f"Executed SQL query: {query}. (Success)"
    except Exception as e:
        db.rollback()
        return f"Database error: {str(e)}"
    finally:
        db.close()


def _execute_get_database_schema(arguments: dict) -> str:
    """Get database schema from SQLite."""
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(text("SELECT sql FROM sqlite_master WHERE type='table';"))
        schemas = [row[0] for row in result if row[0]]
        return "\n".join(schemas) if schemas else "No tables found in database."
    except Exception as e:
        return f"Database error: {str(e)}"
    finally:
        db.close()





async def _execute_domain_search(arguments: dict) -> str:
    """Search the agent's graph and its domain knowledge, as one result.

    Async, unlike the other native executors, because the path it drives is
    genuinely asynchronous: the optimiser is a model call, the traversal is a
    network hop, and the two sources run concurrently.

    Scoping order matches what the two tools it replaced did, so an agent's
    behaviour is unchanged apart from having one tool instead of two:
      1. an explicit argument, when the model asks for one;
      2. the agent's own libraries and domain annotations;
      3. unscoped.

    (2) is what makes this useful without prompt engineering — a mortgage agent
    gets mortgage material because of what it *is*.
    """
    from app.dependencies import get_mistral_client
    from app.ontology import knowledge
    from app.rag import domain_search, scope, timeline

    query = str(arguments.get("query") or "").strip()
    if not query:
        return "No query was supplied. Ask a question about this agent's domain."

    explicit_library = str(arguments.get("library_id") or "").strip()
    explicit_domain = str(arguments.get("domain") or "").strip()
    try:
        hops = max(1, min(3, int(arguments.get("hops") or 2)))
    except (TypeError, ValueError):
        hops = 2
    try:
        limit = max(1, min(30, int(arguments.get("limit") or 12)))
    except (TypeError, ValueError):
        limit = 12

    agent_id = CURRENT_AGENT.get()
    client = get_mistral_client()

    libraries = [explicit_library] if explicit_library else scope.resolve(client, agent_id)
    domains = (
        [explicit_domain] if explicit_domain
        else (knowledge.domains_for_agent(agent_id) if agent_id else [])
    )

    scope_parts = []
    if libraries:
        scope_parts.append(f"libraries {', '.join(libraries)}")
    if domains:
        scope_parts.append(f"domain {', '.join(domains)}")
    scope_note = "; ".join(scope_parts) or "everything (this agent has no library or domain)"

    timeline.ensure("query", f"agent:{agent_id or 'unknown'}")

    try:
        with timeline.stage(
            "domain_search",
            meta={"query": query[:200], "libraries": libraries or "all",
                  "domains": domains or "all", "hops": hops},
        ) as st:
            result = await domain_search.search(
                client, query, library_ids=libraries, domains=domains,
                hops=hops, limit=limit,
            )
            graph = result.get("graph") or {}
            st.set(
                entities=len(graph.get("entities") or []),
                relations=len(graph.get("relations") or []),
                knowledge_entries=len((result.get("knowledge") or {}).get("entries") or []),
            )
            if not result.get("found"):
                st.note("nothing matched in either source")
    except Exception as e:
        logger.warning("Domain search failed: %s", e)
        return (
            f"Domain knowledge is unavailable right now ({e}). Use the document "
            "library tool instead, and mark anything you state from your own "
            'knowledge with "(unverified)".'
        )

    logger.info(
        "Domain search: query=%.60r scope=%s -> %d entities, %d relations, %d notes",
        query, scope_note,
        len((result.get("graph") or {}).get("entities") or []),
        len((result.get("graph") or {}).get("relations") or []),
        len((result.get("knowledge") or {}).get("entries") or []),
    )
    return domain_search.render(result, scope_note=scope_note)


# Native tool executor map. Values may be sync or async — `execute_tool` awaits
# whatever they return, so a native tool that needs the network does not have to
# block the event loop to stay in this table.
NATIVE_EXECUTORS = {
    "execute_sql_query": _execute_sql_query,
    "get_database_schema": _execute_get_database_schema,
    DOMAIN_SEARCH_TOOL: _execute_domain_search,
}


# Track which tools are MCP-published (tool_name -> server_name)
_mcp_published_tools: dict[str, str] = {}


async def refresh_dynamic_tools():
    """Fetch dynamic tool schemas from Docker Tool Service."""
    global _dynamic_tool_schemas, _mcp_published_tools
    from app.services.tool_resolver import tool_resolver

    tools = await tool_resolver.list_tools()

    # Forget dynamic tools the service no longer has (deleted or rejected), so
    # agents stop being offered them. An empty listing is treated as the
    # service being unreachable rather than as "every tool was deleted".
    if tools:
        live = {
            (t.get("schema") or {}).get("function", {}).get("name", t.get("name", ""))
            for t in tools if t.get("status") == "approved" and t.get("is_active", True)
        }
        for name in [n for n in _dynamic_tool_schemas if n not in live]:
            _dynamic_tool_schemas.pop(name, None)
            ALL_TOOLS.pop(name, None)
            _mcp_published_tools.pop(name, None)
            if name in AVAILABLE_TOOL_KEYS:
                AVAILABLE_TOOL_KEYS.remove(name)

    for tool in tools:
        # With versioning, the listing holds each tool's active version (plus
        # pending ones). Only the active approved version is registered.
        if tool.get("status") == "approved" and tool.get("is_active", True):
            schema = tool.get("schema", {})
            name = schema.get("function", {}).get("name", tool.get("name", ""))
            if not name:
                continue
            if name in ALL_TOOLS and name not in _dynamic_tool_schemas:
                continue  # a native tool of the same name wins
            # Replace, not only add: a new version may change the parameters,
            # and the previous check (`name not in ALL_TOOLS`) kept serving the
            # first version's schema for the life of the process.
            _dynamic_tool_schemas[name] = schema
            ALL_TOOLS[name] = schema
            if name not in AVAILABLE_TOOL_KEYS:
                AVAILABLE_TOOL_KEYS.append(name)

            # Track MCP-published status
            if tool.get("mcp_published"):
                _mcp_published_tools[name] = tool.get("mcp_server_name", "")

    logger.info("Refreshed %d dynamic tools (%d MCP-published) from Docker Tool Service",
                len(_dynamic_tool_schemas), len(_mcp_published_tools))


def get_mcp_published_tools() -> dict[str, str]:
    """Return dict of tool names that are published to remote MCP (name -> server)."""
    return _mcp_published_tools


def _is_usable_tool_spec(key: str, spec: object) -> bool:
    """Reject a tool definition the API will not accept.

    Dynamic tools arrive from the Tool Service and go into ``ALL_TOOLS``
    unvalidated. A malformed one is accepted by agent creation but rejected
    when a conversation is started, which surfaces as a bare 500 with no
    indication of which tool caused it — long after the agent was made.
    """
    if not isinstance(spec, dict) or not spec.get("type"):
        logger.warning("Skipping tool '%s': definition is not a typed object", key)
        return False

    if spec["type"] != "function":
        return True  # built-ins carry no schema of their own

    fn = spec.get("function")
    if not isinstance(fn, dict) or not fn.get("name"):
        logger.warning("Skipping tool '%s': function definition has no name", key)
        return False

    params = fn.get("parameters")
    if not isinstance(params, dict) or params.get("type") != "object" \
            or not isinstance(params.get("properties"), dict):
        logger.warning(
            "Skipping tool '%s': parameters are not a JSON-Schema object", fn["name"],
        )
        return False

    return True


def get_tools(
    tool_keys: List[str],
    document_library_ids: List[str] | None = None,
    connectors: List[dict] | None = None,
) -> List[dict]:
    """Resolve a list of tool key names into their full tool definitions.

    Handles document_library specially:
    - If `document_library_ids` is provided and 'document_library' is in tool_keys,
      builds the proper {type: document_library, library_ids: [...]} spec.
    - Also supports encoded keys like 'document_library:lib-id-1,lib-id-2'
      where library IDs are embedded in the key itself.

    `connectors` are Mistral Connectors (MCP servers registered with Mistral).
    They ride in the same array as everything else, as entries of type
    "connector", and are appended after the named tools.
    """
    tools = []
    for key in tool_keys:
        raw_key = key.strip()
        lower_key = raw_key.lower()

        # Handle document_library with encoded library IDs (e.g. "document_library:id1,id2")
        if lower_key.startswith("document_library:"):
            _, ids_str = raw_key.split(":", 1)
            lib_ids = [lid.strip() for lid in ids_str.split(",") if lid.strip()]
            if lib_ids:
                tools.append({"type": "document_library", "library_ids": lib_ids})
            continue

        # Handle plain "document_library" key with separately-provided IDs
        if lower_key == "document_library":
            if document_library_ids:
                tools.append({"type": "document_library", "library_ids": document_library_ids})
            # Skip if no library IDs — document_library requires at least one
            continue

        if lower_key in ALL_TOOLS:
            spec = ALL_TOOLS[lower_key]
            if _is_usable_tool_spec(lower_key, spec):
                tools.append(spec)

    if connectors:
        from app.services.connector_service import build_connector_tool_specs
        tools.extend(build_connector_tool_specs(connectors))

    return tools


def describe_tool(key: str) -> str:
    """One tool's description, for showing why an agent was given it."""
    tool = ALL_TOOLS.get(key) or {}
    if tool.get("type") == "function":
        return str((tool.get("function") or {}).get("description") or "")
    return f"Built-in {tool['type']} capability" if tool.get("type") else ""


def get_tool_descriptions() -> str:
    """Return a formatted string describing all available tools."""
    lines = []
    for key, tool in ALL_TOOLS.items():
        if tool.get("type") == "function":
            func = tool["function"]
            lines.append(f"- **{key}** (function): {func['description']}")
        else:
            lines.append(f"- **{key}** (built-in): {tool['type']} capability")
    return "\n".join(lines)


def _tool_tier(tool_name: str) -> str:
    if tool_name in NATIVE_EXECUTORS:
        return "native"
    if tool_name in _dynamic_tool_schemas or tool_name not in ALL_TOOLS:
        return "dynamic"
    if ":" in tool_name:
        return "mcp"
    return "unknown"


async def execute_tool(tool_name: str, arguments: dict, version: int | None = None) -> str:
    """Route one tool call, traced as a GenAI ``execute_tool`` span on Mistral.

    The span carries the arguments and the result, and any rule verdict from
    the tool gate nests under it — so a refused call shows which rule refused.
    """
    from app.observability import tracing

    attrs = {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": tool_name,
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.arguments": arguments,
        "gen_ai.agent.id": CURRENT_AGENT.get(),
        "app.tool.tier": _tool_tier(tool_name),
        "app.tool.version": version,
    }
    with tracing.span(f"execute_tool {tool_name}", kind="tool", attrs=attrs) as span:
        result = await _route_tool(tool_name, arguments, version)
        text = result if isinstance(result, str) else json.dumps(result, default=str)
        tracing.set_attrs(span, {"gen_ai.tool.call.result": text})
        lowered = text.lstrip()[:200].lower()
        if lowered.startswith("error") or lowered.startswith("blocked by rule") or (
            lowered.startswith("tool '") and "not found" in lowered
        ):
            tracing.mark_error(span, text[:1000], error_type="tool_error")
        return result


async def _route_tool(tool_name: str, arguments: dict, version: int | None = None) -> str:
    """
    3-tier tool execution router:
    1. Native tool → execute locally
    2. Dynamic tool → proxy to Docker Tool Service
    3. MCP tool → proxy via Docker Tool Service to MCP server
    """
    # Rules in force for the running agent (read-only database, blocked
    # tools). A refusal is returned as the tool's result, so the model can
    # explain it instead of the turn failing. Every tool call from chat and
    # from workflow agent steps passes through here, which is why the gate
    # lives here rather than in each caller.
    from app.rules import runtime as rules_runtime

    refusal = rules_runtime.guard_tool_call(tool_name, arguments)
    if refusal:
        return refusal

    # Tier 1: Native tools. Executors may be sync or async — the graph tool
    # drives model calls and a Bolt hop, which must not block the event loop.
    if tool_name in NATIVE_EXECUTORS:
        logger.info("Executing native tool: %s", tool_name)
        result = NATIVE_EXECUTORS[tool_name](arguments)
        if inspect.isawaitable(result):
            result = await result
        return result

    # Tier 2: Dynamic tools (Docker Tool Service)
    if tool_name in _dynamic_tool_schemas or tool_name not in ALL_TOOLS:
        logger.info("Proxying dynamic tool to Docker Tool Service: %s", tool_name)
        from app.services.tool_resolver import tool_resolver
        result = await tool_resolver.execute_tool(tool_name, arguments, version=version)
        if "error" in result:
            return f"Error: {result['error']}"
        return json.dumps(result.get("result", result))

    # Tier 3: MCP tools
    if ":" in tool_name:
        server, mcp_tool = tool_name.split(":", 1)
        logger.info("Proxying MCP tool to Docker Tool Service: %s -> %s", server, mcp_tool)
        from app.services.tool_resolver import tool_resolver
        result = await tool_resolver.execute_mcp_tool(server, mcp_tool, arguments)
        if "error" in result:
            return f"Error: {result['error']}"
        return json.dumps(result.get("result", result))

    # Fallback: tool not found
    logger.warning("Tool '%s' not found in any tier", tool_name)
    return f"Tool '{tool_name}' not found"
