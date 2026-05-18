"""
Synthesis Service — 6-stage pipeline for generating, validating, and storing dynamic tools.
Stage 1: Prompt Builder
Stage 2: Codestral Call
Stage 3: Static Analysis (AST + forbidden imports + ruff)
Stage 3a: Self-Heal Retry Loop
Stage 4: Sandbox Test
Stage 5: Approval Gate
Stage 6: Write & Register
"""

import ast
import json
import subprocess
import logging
import importlib.util
from hashlib import sha256

from mistralai.client import Mistral
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ToolRecord
from app.services.sandbox import run_in_sandbox, generate_test_inputs
from app.prompts import CODEGEN_SYSTEM_PROMPT, CODEGEN_USER_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

MAX_RETRIES = 3

FORBIDDEN_IMPORTS = {
    "os", "subprocess", "socket", "shutil", "sys", "ctypes",
    "multiprocessing", "threading", "signal", "importlib",
}



# NOTE: The actual execution cache lives in execution_service._execution_cache.
# _write_and_register below imports and updates it directly.


# ── Stage 1: Prompt Builder ───────────────────────────────────────────────

def _build_prompt(
    name: str, description: str, parameters: dict, required: list[str],
    api_details: str, expected_output_shape: str
) -> str:
    """Build a structured Codestral prompt from the tool schema."""
    params_desc = []
    for pname, pdef in parameters.get("properties", {}).items():
        if isinstance(pdef, dict):
            ptype = pdef.get("type", "string")
            pdesc = pdef.get("description", "")
        else:
            ptype = "string"
            pdesc = str(pdef)
        req = "(required)" if pname in required else "(optional)"
        params_desc.append(f"  - {pname}: {ptype} {req} — {pdesc}")

    params_str = "\n".join(params_desc) if params_desc else "  (no parameters)"

    return CODEGEN_USER_PROMPT_TEMPLATE.format(
        description=description,
        params_str=params_str,
        api_details=api_details,
        expected_output_shape=expected_output_shape,
    )


# ── Stage 2: Codestral Call ───────────────────────────────────────────────

def _call_codestral(messages: list[dict]) -> str:
    """Call Codestral to generate Python code."""
    client = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=120000)
    response = client.chat.complete(
        model=settings.MISTRAL_CODING_MODEL,
        messages=messages,
        temperature=0.1,
    )
    content = response.choices[0].message.content

    # Strip markdown fences if present
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    return content.strip()


# ── Stage 3: Static Analysis ─────────────────────────────────────────────

def _static_analyse(code: str) -> tuple[bool, str, str]:
    """
    Run ruff format, AST parse, strict import whitelist check, and ruff lint.
    Returns (ok, error_message, formatted_code).
    """
    import sys

    # 1. Pre-lint Auto-format (Self-Healing Formatting)
    try:
        format_result = subprocess.run(
            ["ruff", "format", "-"],
            input=code.encode(),
            capture_output=True,
            timeout=5,
        )
        if format_result.returncode == 0:
            code = format_result.stdout.decode(errors="replace")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # 2. AST parse — catches syntax errors
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"SyntaxError: {e}", code

    # 3. Strict Import Whitelist Check
    ALLOWED_IMPORTS = {
        "requests", "pandas", "numpy", "bs4", "beautifulsoup4", "lxml", "sqlalchemy",
        "httpx", "pydantic", "mistralai", "PIL", "pillow", "sklearn", "scipy",
        "aiohttp", "certifi", "charset_normalizer", "idna", "urllib3",
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_module = alias.name.split(".")[0]
                if root_module in FORBIDDEN_IMPORTS:
                    return False, f"Forbidden import: {alias.name}", code
                if root_module not in sys.stdlib_module_names and root_module not in ALLOWED_IMPORTS:
                    return False, f"ImportError: '{root_module}' is not installed. You MUST use only standard libraries or the explicitly allowed packages: {', '.join(ALLOWED_IMPORTS)}", code
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_module = node.module.split(".")[0]
                if root_module in FORBIDDEN_IMPORTS:
                    return False, f"Forbidden import from: {node.module}", code
                if root_module not in sys.stdlib_module_names and root_module not in ALLOWED_IMPORTS:
                    return False, f"ImportError: '{root_module}' is not installed. You MUST use only standard libraries or the explicitly allowed packages: {', '.join(ALLOWED_IMPORTS)}", code

    # 4. Verify `run` function exists
    has_run = any(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "run"
        for node in ast.walk(tree)
    )
    if not has_run:
        return False, "Missing required function: `run`. The code must define a function named `run`.", code

    # 5. ruff lint (best effort — skip if ruff not available)
    try:
        result = subprocess.run(
            ["ruff", "check", "--stdin-filename", "tool.py", "-", "--select", "E,F", "--ignore", "E501,F401,F841"],
            input=code.encode(),
            capture_output=True,
            timeout=10,
        )
        if result.returncode != 0:
            lint_output = result.stdout.decode(errors="replace").strip()
            if lint_output:
                return False, f"Lint errors:\n" + "\n".join(lint_output.split("\n")[:8]), code
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass  # ruff not available, skip

    return True, "", code


# ── Main Pipeline ─────────────────────────────────────────────────────────

def synthesize_tool(
    db: Session,
    name: str,
    description: str,
    parameters: dict,
    required: list[str],
    api_details: str = "No external API. This is a pure computation using standard library.",
    expected_output_shape: str = "A dictionary containing the result.",
) -> dict:
    """
    Run the full 6-stage synthesis pipeline.
    Returns dict with status, tool_name, message, and optional tool_id.
    """
    # Flatten double-nested properties if the LLM generated them
    if "properties" in parameters:
        props = parameters["properties"]
        if isinstance(props, dict) and "properties" in props and props.get("type") == "object":
            parameters["properties"] = props["properties"]

    # Content hash for deduplication
    schema_str = json.dumps({"name": name, "description": description, "parameters": parameters}, sort_keys=True)
    content_hash = sha256(schema_str.encode()).hexdigest()

    # Check if tool already exists
    existing = db.query(ToolRecord).filter_by(hash=content_hash).first()
    if existing:
        if existing.status == "approved":
            return {"status": "approved", "tool_name": name, "message": "Tool already exists", "tool_id": existing.id}
        elif existing.status == "pending_approval":
            return {"status": "pending_approval", "tool_name": name, "message": "Tool awaiting approval", "tool_id": existing.id}

    # Stage 1: Build prompt
    prompt = _build_prompt(name, description, parameters, required, api_details, expected_output_shape)

    # Stage 2 + 3 + 3a: Generate code with self-heal retry
    messages = [
        {"role": "system", "content": CODEGEN_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    generated_code = _call_codestral(messages)
    logger.info("Stage 2: Codestral generated %d chars of code for tool '%s'", len(generated_code), name)

    ok = False
    error = ""
    for attempt in range(MAX_RETRIES):
        # Stage 3: Static analysis
        ok, error, formatted_code = _static_analyse(generated_code)
        if ok:
            generated_code = formatted_code
            break

        logger.warning("Stage 3: Static analysis failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, error)

        # Stage 3a: Self-heal retry
        messages.append({"role": "assistant", "content": generated_code})
        messages.append({
            "role": "user",
            "content": f"The code failed with this error:\n\n{error}\n\nFix it and return only the corrected Python code. Remember: the function MUST be named `run`.",
        })
        generated_code = _call_codestral(messages)

    if not ok:
        return {"status": "failed", "tool_name": name, "message": f"Static analysis failed after {MAX_RETRIES} retries: {error}"}

    logger.info("Stage 3: Static analysis passed for tool '%s'", name)

    # Stage 4: Sandbox test
    test_inputs = generate_test_inputs(parameters, required)
    sandbox_ok, sandbox_output = run_in_sandbox(generated_code, test_inputs)

    if not sandbox_ok:
        # Retry with sandbox error feedback
        for attempt in range(MAX_RETRIES):
            logger.warning("Stage 4: Sandbox failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, sandbox_output[:200])
            messages.append({"role": "assistant", "content": generated_code})
            messages.append({
                "role": "user",
                "content": f"The code failed during execution with this error:\n\n{sandbox_output}\n\nFix it and return only the corrected Python code.",
            })
            generated_code = _call_codestral(messages)

            # Re-run static analysis
            ok, error, formatted_code = _static_analyse(generated_code)
            if not ok:
                continue
            generated_code = formatted_code

            # Re-run sandbox
            sandbox_ok, sandbox_output = run_in_sandbox(generated_code, test_inputs)
            if sandbox_ok:
                break

        if not sandbox_ok:
            return {"status": "failed", "tool_name": name, "message": f"Sandbox test failed: {sandbox_output[:500]}"}

    logger.info("Stage 4: Sandbox test passed for tool '%s'", name)

    # Build tool schema for storage
    tool_schema = {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": parameters.get("properties", {}),
                "required": required,
            },
        },
    }

    # Stage 5: Approval gate
    if settings.AUTO_APPROVE_DYNAMIC_TOOLS:
        # Stage 6: Write and register
        module_path = _write_and_register(generated_code, name, content_hash)

        record = ToolRecord(
            name=name,
            hash=content_hash,
            version="1.0.0",
            schema_json=json.dumps(tool_schema),
            source_code=generated_code,
            module_path=module_path,
            status="approved",
            sandbox_output=sandbox_output,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        logger.info("Stage 6: Tool '%s' auto-approved and registered", name)
        return {"status": "approved", "tool_name": name, "message": "Tool synthesized and approved", "tool_id": record.id}
    else:
        # Store as pending
        record = ToolRecord(
            name=name,
            hash=content_hash,
            version="1.0.0",
            schema_json=json.dumps(tool_schema),
            source_code=generated_code,
            status="pending_approval",
            sandbox_output=sandbox_output,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        logger.info("Stage 5: Tool '%s' stored as pending_approval (id=%d)", name, record.id)
        return {"status": "pending_approval", "tool_name": name, "message": "Tool awaiting approval", "tool_id": record.id}


def approve_tool(db: Session, tool_id: int) -> dict:
    """Approve a pending tool — writes to disk and registers."""
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found", "tool_name": ""}

    if record.status != "pending_approval":
        return {"status": "error", "message": f"Tool status is '{record.status}', not pending_approval", "tool_name": record.name}

    module_path = _write_and_register(record.source_code, record.name, record.hash)
    record.module_path = module_path
    record.status = "approved"
    db.commit()

    logger.info("Tool '%s' approved and registered at %s", record.name, module_path)
    return {"status": "approved", "message": "Tool approved and registered", "tool_name": record.name}


def reject_tool(db: Session, tool_id: int) -> dict:
    """Reject a pending tool."""
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found", "tool_name": ""}

    record.status = "rejected"
    db.commit()

    logger.info("Tool '%s' rejected", record.name)
    return {"status": "rejected", "message": "Tool rejected", "tool_name": record.name}


def delete_tool(db: Session, tool_id: int) -> dict:
    """Delete a tool from DB, disk, and cache."""
    import os
    from app.services.execution_service import _execution_cache
    
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found"}

    PREDEFINED_TOOL_NAMES = {"get_weather", "calculate", "search_knowledge", "create_document", "send_email"}
    if record.name in PREDEFINED_TOOL_NAMES:
        return {"status": "error", "message": f"Cannot delete predefined native tool '{record.name}'"}

    # Remove from disk if exists
    if record.module_path and os.path.exists(record.module_path):
        os.remove(record.module_path)
        logger.info("Deleted file %s", record.module_path)

    # Remove from cache
    if record.name in _execution_cache:
        del _execution_cache[record.name]

    db.delete(record)
    db.commit()

    logger.info("Tool '%s' deleted", record.name)
    return {"status": "deleted", "message": "Tool deleted", "tool_name": record.name}


def update_tool(db: Session, tool_id: int, code: str, description: str) -> dict:
    """Update a tool's code and description."""
    import os
    import hashlib
    
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found"}

    # Re-verify static analysis
    ok, error, formatted_code = _static_analyse(code)
    if not ok:
        logger.warning("Tool update rejected for '%s' (id=%d): %s", record.name, tool_id, error)
        return {"status": "error", "message": f"Static analysis failed: {error}"}
    code = formatted_code

    # Update schema description
    try:
        schema = json.loads(record.schema_json)
        schema["function"]["description"] = description
        record.schema_json = json.dumps(schema)
    except Exception as e:
        logger.error("Failed to parse schema json: %s", e)

    record.source_code = code

    # If it's already approved, we need to rewrite to disk and update cache
    if record.status == "approved":
        # Remove old file
        if record.module_path and os.path.exists(record.module_path):
            os.remove(record.module_path)
            
        new_hash = hashlib.sha256(code.encode()).hexdigest()
        record.hash = new_hash
        
        module_path = _write_and_register(code, record.name, new_hash)
        record.module_path = module_path

    db.commit()
    logger.info("Tool '%s' updated", record.name)
    return {"status": "updated", "message": "Tool updated successfully", "tool_name": record.name}


# ── Stage 6: Write and Register ──────────────────────────────────────────

def _write_and_register(code: str, name: str, content_hash: str) -> str:
    """Write tool to disk and load it into the execution cache."""
    import os
    from app.services.execution_service import _execution_cache

    module_path = f"dynamic_tools/{name}_{content_hash[:8]}.py"
    os.makedirs("dynamic_tools", exist_ok=True)

    with open(module_path, "w", encoding="utf-8") as f:
        f.write(code)

    # Dynamic import — verify it loads
    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Warm the REAL execution cache (execution_service._execution_cache)
    if hasattr(module, "run"):
        _execution_cache[name] = module.run
        logger.info("Tool '%s' loaded into execution cache", name)

    return module_path
