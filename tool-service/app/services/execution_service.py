"""
Execution Service — dynamically loads and executes stored tools.
"""

import importlib.util
import json
import logging
from sqlalchemy.orm import Session
from app.models import ToolRecord

logger = logging.getLogger(__name__)

# ── In-process cache ───────────────────────────────────────────────────────

_execution_cache: dict[str, callable] = {}


def load_tool(name: str, module_path: str) -> callable:
    """Load a tool module from disk and cache the run function."""
    if name in _execution_cache:
        return _execution_cache[name]

    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "run"):
        raise ValueError(f"Tool '{name}' does not have a 'run' function")

    _execution_cache[name] = module.run
    logger.info("Tool '%s' loaded from %s into cache", name, module_path)
    return _execution_cache[name]


def execute_tool(db: Session, tool_name: str, arguments: dict) -> dict:
    """
    Execute a stored, approved tool by name.
    Returns the result as a dict.
    """
    # Look up tool in database
    record = db.query(ToolRecord).filter_by(name=tool_name, status="approved").first()
    if not record:
        return {"error": f"Tool '{tool_name}' not found or not approved"}

    if not record.module_path:
        return {"error": f"Tool '{tool_name}' has no module path — needs re-approval"}

    try:
        run_fn = load_tool(tool_name, record.module_path)
        result = run_fn(**arguments)

        # Ensure JSON-serializable
        try:
            json.dumps(result)
        except (TypeError, ValueError):
            result = str(result)

        return {"result": result, "tool_name": tool_name}
    except Exception as e:
        logger.error("Error executing tool '%s': %s", tool_name, e)
        return {"error": f"Execution error: {str(e)}", "tool_name": tool_name}


def warm_cache(db: Session):
    """Load all approved tools into the execution cache on startup."""
    records = db.query(ToolRecord).filter_by(status="approved").all()
    loaded = 0
    for record in records:
        if record.module_path:
            try:
                load_tool(record.name, record.module_path)
                loaded += 1
            except Exception as e:
                logger.warning("Failed to warm cache for tool '%s': %s", record.name, e)

    logger.info("Warmed execution cache with %d tools", loaded)
