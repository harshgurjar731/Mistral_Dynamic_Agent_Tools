"""
Tool Registry — 3-tier routing: native → dynamic (Docker) → MCP (Docker).
Native tools execute locally. Dynamic and MCP tools proxy to Docker Tool Service.
"""

import json
import logging
from contextvars import ContextVar
from typing import List

from app.config import settings

logger = logging.getLogger(__name__)

#: Canonical name of the industry knowledge tool.
#:
#: Referenced from agent creation, the builder catalogue and the backfill, so it
#: is defined once — a typo in any of those would silently attach nothing.
INDUSTRY_KNOWLEDGE_TOOL = "query_industry_knowledge"

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
    # The industry knowledge graph. Executed in this process — there is no
    # Docker round trip and no network hop, because the corpus and the domain
    # hierarchy it is retrieved through both live in the local database.
    INDUSTRY_KNOWLEDGE_TOOL: {
        "type": "function",
        "function": {
            "name": INDUSTRY_KNOWLEDGE_TOOL,
            "description": (
                "Look up authoritative industry knowledge — regulations, processes, "
                "metrics, risks and definitions — for the business domain this agent "
                "serves. Call this BEFORE answering any question that depends on "
                "domain expertise, and ground the answer in what it returns. "
                "Results are automatically scoped to the calling agent's industry, "
                "so you normally only need to pass the question. "
                "IMPORTANT: what this returns is your only sourced material. Any "
                "specific figure, rate, threshold or named regulation you state "
                "that did not come from it must be marked '(unverified)'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "What you need to know, in natural language. "
                            "e.g. 'affordability stress test rules' or 'claims fraud indicators'."
                        ),
                    },
                    "domain": {
                        "type": "string",
                        "description": (
                            "Optional concept id to search instead of the agent's own "
                            "domain, e.g. 'domain.lending.mortgage'. Leave empty to use "
                            "the agent's annotated industry."
                        ),
                    },
                    "kind": {
                        "type": "string",
                        "description": (
                            "Optional filter: definition, regulation, process, metric, "
                            "risk, best_practice or glossary."
                        ),
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum entries to return. Defaults to 5.",
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





def _execute_industry_knowledge(arguments: dict) -> str:
    """Retrieve industry knowledge, scoped to the calling agent by default.

    Scoping order:
      1. an explicit ``domain`` argument, when the model asks for one;
      2. the domains the executing agent is annotated with;
      3. unscoped, which searches the whole corpus.

    (2) is what makes this useful without prompt engineering — a mortgage agent
    gets mortgage knowledge because of what it *is*, not because its
    instructions remembered to say so.
    """
    from app.ontology import knowledge

    query = str(arguments.get("query") or "").strip()
    explicit = str(arguments.get("domain") or "").strip()
    kind = str(arguments.get("kind") or "").strip() or None

    try:
        limit = max(1, min(10, int(arguments.get("limit") or 5)))
    except (TypeError, ValueError):
        limit = 5

    agent_id = CURRENT_AGENT.get()
    if explicit:
        domains = [explicit]
        scope_note = f"domain '{explicit}' (requested)"
    else:
        domains = knowledge.domains_for_agent(agent_id) if agent_id else []
        scope_note = (
            f"this agent's domains: {', '.join(domains)}" if domains
            else "all industries (this agent has no domain annotation)"
        )

    try:
        results = knowledge.search(query, domains=domains or None, kind=kind, limit=limit)
    except Exception as e:
        logger.warning("Industry knowledge lookup failed: %s", e)
        return f"Industry knowledge is unavailable right now ({e}). Answer from general knowledge."

    logger.info(
        "Industry knowledge: query=%.60r scope=%s -> %d entries",
        query, scope_note, len(results),
    )
    return f"Scope: {scope_note}\n\n{knowledge.render_for_prompt(results)}"


# Native tool executor map
NATIVE_EXECUTORS = {
    "execute_sql_query": _execute_sql_query,
    "get_database_schema": _execute_get_database_schema,
    INDUSTRY_KNOWLEDGE_TOOL: _execute_industry_knowledge,
}


# Track which tools are MCP-published (tool_name -> server_name)
_mcp_published_tools: dict[str, str] = {}


async def refresh_dynamic_tools():
    """Fetch dynamic tool schemas from Docker Tool Service."""
    global _dynamic_tool_schemas, _mcp_published_tools
    from app.services.tool_resolver import tool_resolver

    tools = await tool_resolver.list_tools()
    for tool in tools:
        if tool.get("status") == "approved":
            schema = tool.get("schema", {})
            name = schema.get("function", {}).get("name", tool.get("name", ""))
            if name and name not in ALL_TOOLS:
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
            tools.append(ALL_TOOLS[lower_key])

    if connectors:
        from app.services.connector_service import build_connector_tool_specs
        tools.extend(build_connector_tool_specs(connectors))

    return tools


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


async def execute_tool(tool_name: str, arguments: dict) -> str:
    """
    3-tier tool execution router:
    1. Native tool → execute locally
    2. Dynamic tool → proxy to Docker Tool Service
    3. MCP tool → proxy via Docker Tool Service to MCP server
    """
    # Tier 1: Native tools
    if tool_name in NATIVE_EXECUTORS:
        logger.info("Executing native tool: %s", tool_name)
        return NATIVE_EXECUTORS[tool_name](arguments)

    # Tier 2: Dynamic tools (Docker Tool Service)
    if tool_name in _dynamic_tool_schemas or tool_name not in ALL_TOOLS:
        logger.info("Proxying dynamic tool to Docker Tool Service: %s", tool_name)
        from app.services.tool_resolver import tool_resolver
        result = await tool_resolver.execute_tool(tool_name, arguments)
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
