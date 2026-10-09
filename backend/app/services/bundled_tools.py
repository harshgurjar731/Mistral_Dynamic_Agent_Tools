"""
Bundled tools — run a deployment package's tool and activity code in-process.

A workflow package (app/services/workflow_packager.py) ships the approved
source of every dynamic tool the workflow uses into ``app/bundled_tools/``,
with a ``registry.json`` describing each version. When that registry exists,
this process is a deployed worker: those tools run here, exactly as the Tool
Service runs them, and the Tool Service is never contacted.

Same contract as tool-service/app/services/execution_service.py:

    coerce    argument values ("12" → 12; agent tools also "true" → True …)
    validate  arguments against the version's input schema
    run       the module's ``run(**kwargs)``
    check     ``data`` against the output schema, for a success envelope

so a step that passed on the platform behaves identically once deployed. The
LLM "degraded" fallback is the one thing not carried over: a deployed tool that
fails, fails.

In development there is no registry and nothing here is active.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

#: Where the packager writes the code; BUNDLED_TOOLS_DIR overrides it.
_DEFAULT_DIR = Path(__file__).resolve().parent.parent / "bundled_tools"

_lock = threading.RLock()
_registry: dict | None = None
#: (name, version_no) → run callable.
_loaded: dict[tuple[str, int], Callable] = {}

_TRUE = {"true", "yes", "y", "1", "on"}
_FALSE = {"false", "no", "n", "0", "off"}


def _dir() -> Path:
    return Path(os.environ.get("BUNDLED_TOOLS_DIR") or _DEFAULT_DIR)


def _load_registry() -> dict:
    global _registry
    with _lock:
        if _registry is None:
            path = _dir() / "registry.json"
            try:
                _registry = json.loads(path.read_text(encoding="utf-8")).get("tools", {})
                logger.info("Bundled tools: %d loaded from %s — the Tool Service is not used",
                            len(_registry), path)
            except FileNotFoundError:
                _registry = {}
            except (OSError, ValueError) as e:
                logger.error("Bundled tool registry %s is unreadable: %s", path, e)
                _registry = {}
        return _registry


def enabled() -> bool:
    """True in a deployed worker: tools come from the package, not the Tool Service."""
    return bool(_load_registry())


def names() -> list[str]:
    return sorted(_load_registry())


def _entry(name: str, version: int | None = None) -> dict | None:
    tool = _load_registry().get(name)
    if not tool:
        return None
    versions = tool.get("versions") or {}
    key = str(version if version is not None else tool.get("default_version"))
    return versions.get(key)


def has(name: str) -> bool:
    return name in _load_registry()


def schema(name: str) -> dict | None:
    """The function schema agents and argument resolution see."""
    entry = _entry(name)
    return entry.get("schema") if entry else None


def schemas() -> dict[str, dict]:
    return {n: s for n in names() if (s := schema(n))}


# ── Execution ─────────────────────────────────────────────────────────────


def _coerce_value(value: Any, definition: dict, lenient: bool) -> Any:
    ptype = definition.get("type")
    if isinstance(ptype, list):
        ptype = next((t for t in ptype if t != "null"), None)
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


def _coerce(arguments: dict, input_schema: dict, lenient: bool) -> dict:
    props = input_schema.get("properties") or {}
    required = set(input_schema.get("required") or [])
    out: dict = {}
    for key, value in (arguments or {}).items():
        if value is None and key not in required:
            continue  # an explicit null for an optional parameter means "not supplied"
        definition = props.get(key)
        out[key] = _coerce_value(value, definition, lenient) if isinstance(definition, dict) else value
    return out


def _schema_problem(schema_: dict, value: Any, label: str) -> str | None:
    try:
        import jsonschema
    except ImportError:  # pragma: no cover
        return None
    try:
        jsonschema.validate(value, schema_)
        return None
    except jsonschema.ValidationError as e:
        where = "/".join(str(p) for p in e.absolute_path)
        return f"{label}{('/' + where) if where else ''}: {e.message}"
    except jsonschema.SchemaError as e:
        return f"schema is itself invalid: {e.message}"


def _error(error_type: str, message: str, detail: str = "") -> dict:
    return {"status": "error", "error_type": error_type, "message": message, "detail": detail}


def _load(name: str, version_no: int, module_file: str) -> Callable:
    key = (name, version_no)
    with _lock:
        if key not in _loaded:
            path = _dir() / module_file
            spec = importlib.util.spec_from_file_location(f"bundled_{name}_v{version_no}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            run = getattr(module, "run", None)
            if not callable(run):
                raise RuntimeError(f"{module_file} has no callable `run`")
            _loaded[key] = run
        return _loaded[key]


def execute(name: str, arguments: dict, version: int | None = None) -> dict:
    """Run one bundled tool. Same reply shape as the Tool Service's /execute:
    ``{"result": ...}`` once the code ran, ``{"error": ...}`` when it never did."""
    entry = _entry(name, version)
    if entry is None and version is not None:
        # The package ships the version the workflow pinned; an agent may still
        # name another. The bundled default is the tested one.
        entry = _entry(name)
    if entry is None:
        return {"error": f"Tool '{name}' is not in this deployment package — rebuild and "
                         f"redeploy the package from the platform.",
                "reason": "not_found", "tool_name": name}

    version_no = int(entry.get("version_no") or 1)
    input_schema = (entry.get("schema") or {}).get("function", {}).get("parameters") or {}
    args = _coerce(arguments or {}, input_schema, lenient=entry.get("purpose") != "activity")

    missing = [p for p in (input_schema.get("required") or []) if p not in args]
    if missing:
        return {"error": f"Tool '{name}' requires {', '.join(missing)}, which "
                         f"{'was' if len(missing) == 1 else 'were'} not supplied.",
                "reason": "bad_arguments", "tool_name": name}
    if input_schema.get("properties"):
        problem = _schema_problem({**input_schema, "type": "object"}, args, "arguments")
        if problem:
            return {"error": f"Invalid arguments for '{name}': {problem}",
                    "reason": "bad_arguments", "tool_name": name}

    secrets = entry.get("secrets") or []
    if secrets:
        args["_secrets"] = {s: os.environ[s] for s in secrets if s in os.environ}

    try:
        run = _load(name, version_no, entry["module"])
    except Exception as e:  # noqa: BLE001
        logger.error("Bundled tool '%s' v%s could not be loaded: %s", name, version_no, e)
        return {"error": f"Tool '{name}' could not be loaded: {e}", "reason": "not_registered",
                "tool_name": name}

    try:
        result = run(**args)
    except Exception as e:  # noqa: BLE001 — the code's failure, reported as an envelope
        logger.error("Bundled tool '%s' v%s raised: %s", name, version_no, e)
        result = _error("runtime_crash", f"{name} raised an exception", f"{type(e).__name__}: {e}")

    output_schema = entry.get("output_schema")
    if output_schema and isinstance(result, dict) and result.get("status") == "success":
        problem = _schema_problem(output_schema, result.get("data"), "data")
        if problem:
            result = _error("contract_violation",
                            f"{name} returned data that does not match its output schema", problem)

    try:
        json.dumps(result)
    except (TypeError, ValueError):
        result = _error("unexpected_error", f"{name} returned a value that is not JSON-serialisable",
                        repr(result)[:500])
    return {"result": result, "tool_name": name, "version": version_no}
