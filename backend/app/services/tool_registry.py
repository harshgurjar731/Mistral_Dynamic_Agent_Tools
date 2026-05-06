"""
Tool Registry — 3-tier routing: native → dynamic (Docker) → MCP (Docker).
Native tools execute locally. Dynamic and MCP tools proxy to Docker Tool Service.
"""

import json
import math
import logging
from typing import List
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

# ── Native Tool Definitions ────────────────────────────────────────────────

BUILTIN_TOOLS = {
    "web_search": {"type": "web_search"},
    "code_interpreter": {"type": "code_interpreter"},
    "image_generation": {"type": "image_generation"},
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





# Native tool executor map
NATIVE_EXECUTORS = {
    "execute_sql_query": _execute_sql_query,
    "get_database_schema": _execute_get_database_schema,
}


# ── Public API ──────────────────────────────────────────────────────────────

async def refresh_dynamic_tools():
    """Fetch dynamic tool schemas from Docker Tool Service."""
    global _dynamic_tool_schemas
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

    logger.info("Refreshed %d dynamic tools from Docker Tool Service", len(_dynamic_tool_schemas))


def get_tools(tool_keys: List[str]) -> List[dict]:
    """Resolve a list of tool key names into their full tool definitions."""
    tools = []
    for key in tool_keys:
        key = key.strip().lower()
        if key in ALL_TOOLS:
            tools.append(ALL_TOOLS[key])
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
