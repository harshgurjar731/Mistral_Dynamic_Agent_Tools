"""
Execution Service — dynamically loads and executes stored tools.

When a tool's primary execution fails, the LLM fallback service generates
a synthetic result so the caller always gets a useful response.
"""

import importlib.util
import json
import logging
from sqlalchemy.orm import Session
from app.models import ToolRecord
from app.services.llm_fallback import llm_fallback

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


def _get_tool_description(record: ToolRecord) -> str:
    """Extract the tool description from the stored schema JSON."""
    try:
        schema = json.loads(record.schema_json)
        return schema.get("function", {}).get("description", record.name)
    except Exception:
        return record.name


def execute_tool(db: Session, tool_name: str, arguments: dict) -> dict:
    """
    Execute a stored, approved tool by name.

    Execution strategy:
      1. Run the tool's `run()` function normally.
      2. If it returns an error dict, try LLM fallback.
      3. If it raises an exception, try LLM fallback.
      4. Always return something useful to the caller.
    """
    # ── Look up tool ──────────────────────────────────────────────────────
    # The reason is separated from the message so the route can pick a status
    # code. "Never synthesised", "awaiting approval" and "wrong arguments" want
    # different responses, and collapsing them into one 400 left the caller
    # unable to tell a permanent failure from a retryable one.
    record = db.query(ToolRecord).filter_by(name=tool_name).first()
    if not record:
        return {
            "error": f"Tool '{tool_name}' does not exist. It was never "
                     f"synthesised, or synthesis failed.",
            "reason": "not_found",
            "tool_name": tool_name,
        }

    if record.status != "approved":
        return {
            "error": f"Tool '{tool_name}' is '{record.status}', not approved.",
            "reason": "not_registered",
            "tool_name": tool_name,
        }

    if not record.module_path:
        return {
            "error": f"Tool '{tool_name}' is approved but was never written to "
                     f"disk — re-approve it to register the module.",
            "reason": "not_registered",
            "tool_name": tool_name,
        }

    missing = _missing_required(record, arguments)
    if missing:
        # Caught before the call rather than as a TypeError inside it: an
        # argument error reaching the LLM fallback would be answered with a
        # fabricated result, which is the one outcome this service must not
        # produce.
        return {
            "error": f"Tool '{tool_name}' requires {', '.join(missing)}, "
                     f"which {'was' if len(missing) == 1 else 'were'} not supplied.",
            "reason": "bad_arguments",
            "tool_name": tool_name,
        }

    tool_description = _get_tool_description(record)

    # ── Primary execution ─────────────────────────────────────────────────
    try:
        run_fn = load_tool(tool_name, record.module_path)
        result = run_fn(**arguments)

        # ── Check for soft errors in the result ───────────────────────────
        # Some tools return error strings or dicts instead of raising
        if _is_error_result(result):
            logger.warning(
                "Tool '%s' returned an error result: %s",
                tool_name, str(result)[:200],
            )
            fallback_result = llm_fallback(
                tool_name=tool_name,
                tool_description=tool_description,
                arguments=arguments,
                original_error=_extract_error_msg(result),
            )
            return {"result": fallback_result, "tool_name": tool_name}

        # ── Handle document file writes ──────────────────────────────────
        # Tools like create_document return _needs_file_write=True
        # The actual I/O happens here, outside the sandbox
        if isinstance(result, dict) and result.get("_needs_file_write"):
            try:
                import os
                docs_dir = "/app/documents"
                os.makedirs(docs_dir, exist_ok=True)
                filename = result.get("filename", "document.md")
                content = result.get("content", "")
                filepath = os.path.join(docs_dir, filename)
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(content)
                logger.info(
                    "Document written to %s (%d chars)",
                    filepath, len(content),
                )
                # Remove internal flag before returning
                result.pop("_needs_file_write", None)
            except Exception as write_err:
                logger.error(
                    "Document write failed: %s", write_err,
                )
                # Still return the content even if write fails
                result.pop("_needs_file_write", None)
                result["write_error"] = str(write_err)

        # ── Normal success path ───────────────────────────────────────────
        # Ensure JSON-serializable
        try:
            json.dumps(result)
        except (TypeError, ValueError):
            result = str(result)

        return {"result": result, "tool_name": tool_name}

    except Exception as e:
        # ── Hard crash → LLM fallback ─────────────────────────────────────
        logger.error(
            "Tool '%s' crashed: %s — invoking LLM fallback", tool_name, e,
        )
        try:
            fallback_result = llm_fallback(
                tool_name=tool_name,
                tool_description=tool_description,
                arguments=arguments,
                original_error=str(e),
            )
            return {"result": fallback_result, "tool_name": tool_name}
        except Exception as fallback_err:
            logger.error(
                "LLM fallback also failed for '%s': %s", tool_name, fallback_err,
            )
            return {
                "error": f"Execution error: {str(e)}",
                "tool_name": tool_name,
            }


def _missing_required(record: ToolRecord, arguments: dict) -> list[str]:
    """Required parameters the caller did not supply."""
    try:
        schema = json.loads(record.schema_json)
        params = schema.get("function", {}).get("parameters", {})
        required = params.get("required") or []
    except Exception:
        return []
    supplied = set(arguments or {})
    return [name for name in required if name not in supplied]


def _is_error_result(result) -> bool:
    """Detect if a tool's return value represents a failure."""
    if isinstance(result, str):
        lower = result.lower()
        return any(kw in lower for kw in [
            "error:", "failed:", "lookup failed",
            "api returned status", "connection", "timeout",
            "not found", "refused", "unreachable",
        ])
    if isinstance(result, dict):
        return "error" in result
    return False


def _extract_error_msg(result) -> str:
    """Pull the error message out of a tool's return value."""
    if isinstance(result, dict):
        return str(result.get("error", result))
    return str(result)


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
                logger.warning(
                    "Failed to warm cache for tool '%s': %s", record.name, e,
                )

    logger.info("Warmed execution cache with %d tools", loaded)
