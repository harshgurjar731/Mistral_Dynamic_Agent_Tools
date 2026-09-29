"""
Execution Service — runs a stored tool or activity version.

Order of operations for one call:

    resolve   name → the active version, or ``name@N`` → that exact version
    coerce    argument values per the purpose's runtime policy
    validate  arguments against the version's input schema
    run       the module's ``run(**kwargs)``
    check     the envelope, and ``data`` against the output schema

Failures come back as an error *envelope* in the result, not as an invented
answer. The LLM fallback that used to replace any failure with made-up data is
gone for activities entirely — a workflow step that could not compute its
result must fail — and for agent tools it is opt-in and labelled ``degraded``.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import metrics
from app.config import settings
from app.models import ToolRecord
from app.synthesis import registry
from app.synthesis.profiles import get_profile
from app.synthesis.verifiers import validate_against

logger = logging.getLogger(__name__)

_TRUE = {"true", "yes", "y", "1", "on"}
_FALSE = {"false", "no", "n", "0", "off"}


# ── Argument coercion ─────────────────────────────────────────────────────


def _coerce_value(value: Any, definition: dict, lenient: bool) -> Any:
    ptype = definition.get("type")
    if isinstance(ptype, list):
        ptype = next((t for t in ptype if t != "null"), None)

    # Both policies: structured values arrive as JSON text from templated
    # workflow arguments, and numbers as their decimal text.
    if ptype in ("object", "array") and isinstance(value, str):
        text = value.strip()
        if text[:1] in ("{", "["):
            try:
                parsed = json.loads(text)
                if (ptype == "object") == isinstance(parsed, dict):
                    return parsed
            except ValueError:
                pass
    if ptype in ("number", "integer") and isinstance(value, str):
        try:
            number = float(value.strip().replace(",", "")) if lenient else float(value.strip())
            if ptype == "integer" and number.is_integer():
                return int(number)
            if ptype == "number":
                return number
        except ValueError:
            pass
    if ptype == "integer" and isinstance(value, float) and value.is_integer():
        return int(value)

    if not lenient:
        return value

    # Agent tools only: what an LLM writes for a boolean, a string or an enum.
    if ptype == "boolean" and isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _TRUE:
            return True
        if lowered in _FALSE:
            return False
    if ptype == "string" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, str):
        value = value.strip()
        enum = definition.get("enum")
        if isinstance(enum, list) and value not in enum:
            match = next((e for e in enum if isinstance(e, str) and e.lower() == value.lower()), None)
            if match is not None:
                return match
    return value


def coerce_arguments(arguments: dict, schema: dict, *, lenient: bool) -> dict:
    props = (schema or {}).get("properties") or {}
    required = set((schema or {}).get("required") or [])
    out: dict = {}
    for key, value in (arguments or {}).items():
        # An explicit null for an optional parameter means "not supplied", so
        # the code's own default applies.
        if value is None and key not in required:
            continue
        definition = props.get(key)
        out[key] = _coerce_value(value, definition, lenient) if isinstance(definition, dict) else value
    return out


def _argument_problem(schema: dict, arguments: dict) -> Optional[str]:
    if not schema or not schema.get("properties"):
        return None
    try:
        import jsonschema

        jsonschema.validate(arguments, {**schema, "type": "object"})
        return None
    except ImportError:  # pragma: no cover
        return None
    except Exception as e:  # jsonschema.ValidationError / SchemaError
        path = "/".join(str(p) for p in getattr(e, "absolute_path", []) or [])
        message = getattr(e, "message", str(e))
        return f"{path or 'arguments'}: {message}"


# ── Execution ─────────────────────────────────────────────────────────────


def _error(error_type: str, message: str, detail: str = "") -> dict:
    return {"status": "error", "error_type": error_type, "message": message, "detail": detail}


def execute_tool(db: Session, tool_name: str, arguments: dict, version: Optional[int] = None) -> dict:
    """Execute a tool by name (``name`` or ``name@N``).

    Returns ``{"result": ..., "tool_name", "version"}`` or, when the call
    never reached the code, ``{"error": ..., "reason": ...}`` for the route to
    map to a status code.
    """
    name, pinned = registry.parse_ref(tool_name)
    version = version if version is not None else pinned
    record = registry.resolve(db, name, version)

    if not record:
        what = f"version {version} of '{name}'" if version is not None else f"'{name}'"
        return {"error": f"Tool {what} does not exist. It was never synthesised, or "
                         f"synthesis failed.", "reason": "not_found", "tool_name": name}
    if record.status != "approved":
        return {"error": f"Tool '{name}' v{record.version_no} is '{record.status}', not approved.",
                "reason": "not_registered", "tool_name": name}

    profile = get_profile(record.purpose)
    policy = profile.runtime_policy()
    input_schema = registry.input_schema_of(record)

    args = coerce_arguments(arguments or {}, input_schema, lenient=policy.lenient_inputs)
    missing = [p for p in (input_schema.get("required") or []) if p not in args]
    if missing:
        return {"error": f"Tool '{name}' requires {', '.join(missing)}, which "
                         f"{'was' if len(missing) == 1 else 'were'} not supplied.",
                "reason": "bad_arguments", "tool_name": name}
    problem = _argument_problem(input_schema, args)
    if problem:
        return {"error": f"Invalid arguments for '{name}': {problem}",
                "reason": "bad_arguments", "tool_name": name}

    spec = registry.spec_of(record)
    if spec.secrets:
        allowed = settings.secrets_allowlist
        args["_secrets"] = {s: os.environ[s] for s in spec.secrets if s in allowed and s in os.environ}

    try:
        run_fn = registry.load(record)
    except Exception as e:  # noqa: BLE001
        logger.error("Tool '%s' v%s could not be loaded: %s", name, record.version_no, e)
        return {"error": f"Tool '{name}' could not be loaded: {e}", "reason": "not_registered",
                "tool_name": name}

    metrics.incr(f"execute.{record.purpose}")
    try:
        result = run_fn(**args)
    except Exception as e:  # noqa: BLE001 — the code's failure, reported as an envelope
        logger.error("Tool '%s' v%s raised: %s", name, record.version_no, e)
        metrics.incr(f"execute.{record.purpose}.crash")
        result = _error("runtime_crash", f"{name} raised an exception", f"{type(e).__name__}: {e}")

    result = _handle_file_write(result)

    if (policy.validate_output and isinstance(result, dict) and result.get("status") == "success"):
        output_schema = registry.output_schema_of(record)
        if output_schema:
            problem = validate_against(output_schema, result.get("data"))
            if problem:
                metrics.incr(f"execute.{record.purpose}.contract_violation")
                result = _error("contract_violation",
                                f"{name} returned data that does not match its output schema",
                                problem)

    if _is_failure(result) and policy.allow_fallback:
        result = _degraded(record, arguments or {}, result)

    try:
        json.dumps(result)
    except (TypeError, ValueError):
        result = _error("unexpected_error", f"{name} returned a value that is not JSON-serialisable",
                        repr(result)[:500])

    return {"result": result, "tool_name": name, "version": record.version_no}


def _is_failure(result: Any) -> bool:
    if isinstance(result, dict):
        return str(result.get("status", "")).lower() in ("error", "failed") or (
            "error" in result and "status" not in result)
    if isinstance(result, str):
        return result.lower().startswith(("error", "failed"))
    return False


def _degraded(record: ToolRecord, arguments: dict, failure: Any) -> Any:
    """An LLM-written stand-in for a failed *agent tool*, labelled as such."""
    from app.services.llm_fallback import llm_fallback

    try:
        description = json.loads(record.schema_json).get("function", {}).get("description", record.name)
    except ValueError:
        description = record.name
    message = failure.get("message") if isinstance(failure, dict) else str(failure)
    data = llm_fallback(record.name, description, arguments, str(message))
    if not isinstance(data, dict) or data.get("error"):
        return failure
    metrics.incr("execute.tool.degraded")
    return {"status": "degraded", "data": data, "source": "llm_fallback",
            "message": f"{record.name} failed ({message}); this answer was written by a "
                       f"language model and is not verified.",
            "original_error": failure}


def _handle_file_write(result: Any) -> Any:
    """Native ``create_document`` asks the service to do the I/O it may not."""
    if not (isinstance(result, dict) and result.get("_needs_file_write")):
        return result
    try:
        docs_dir = "/app/documents"
        os.makedirs(docs_dir, exist_ok=True)
        filename = os.path.basename(str(result.get("filename", "document.md"))) or "document.md"
        with open(os.path.join(docs_dir, filename), "w", encoding="utf-8") as f:
            f.write(str(result.get("content", "")))
    except OSError as e:
        logger.error("Document write failed: %s", e)
        result["write_error"] = str(e)
    # The tool itself builds a localhost:9000 link, which only resolves on the
    # developer's machine. Behind the deployment proxy, point it at the public
    # /documents route instead (unset locally, so the link is left as-is).
    public_base = os.environ.get("PUBLIC_DOCUMENTS_BASE_URL", "").rstrip("/")
    if public_base and result.get("filename"):
        result["download_url"] = f"{public_base}/{os.path.basename(str(result['filename']))}"
    result.pop("_needs_file_write", None)
    return result


def warm_cache(db: Session) -> None:
    """Load every active version at startup."""
    loaded = registry.warm(db)
    logger.info("Warmed execution cache with %d tools", loaded)
