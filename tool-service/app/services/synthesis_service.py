"""
Synthesis Service — database-facing entry points for dynamic tools.

Code generation and verification live in :mod:`app.synthesis`. What remains
here is everything that touches the tool record: deduplication by content hash,
the approval gate, writing the module to disk, and registration.
"""

import ast
import json
import logging
import importlib.util
from hashlib import sha256

from mistralai.client import Mistral
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ToolRecord
from app.synthesis import CodeSpec, SynthesisFailed, synthesise
from app.synthesis.model import ModelUnavailable
from app.synthesis.verifiers import verify_static

logger = logging.getLogger(__name__)

# ── Static analysis, for edited tools ─────────────────────────────────────


def _static_analyse(code: str) -> tuple[bool, str, str]:
    """Check hand-edited source with the same verifier synthesis uses.

    ``update_tool`` accepts code a user typed, which has to meet exactly the
    rules generated code does. Sharing the verifier is the point: a second
    implementation here would drift from the one that gates synthesis, and the
    two would disagree about what a valid tool looks like.
    """
    verdict = verify_static(_EDIT_SPEC, code)
    return verdict.ok, verdict.diagnostic, (verdict.repaired_code or code)


#: The static verifier takes a spec for its signature but reads nothing off it
#: for hand-edited code, so one placeholder serves every call.
_EDIT_SPEC = CodeSpec(name="edited_tool", description="")


# ── Main Pipeline ─────────────────────────────────────────────────────────

def synthesize_tool(
    db: Session,
    name: str,
    description: str,
    parameters: dict,
    required: list[str],
    api_details: str = "No external API. This is a pure computation using standard library.",
    expected_output_shape: str = "A dictionary containing the result.",
    purpose: str = "tool",
) -> dict:
    """Generate, verify and store one tool.

    A thin adapter now: the generate / verify / repair loop lives in
    ``app.synthesis``. This function owns only what touches the database —
    deduplication, the approval gate, and registration.
    """
    spec = CodeSpec.normalise(
        name=name,
        description=description,
        parameters=parameters,
        required=required,
        api_details=api_details,
        expected_output_shape=expected_output_shape,
        purpose=purpose,
    )
    content_hash = spec.content_hash()

    existing = db.query(ToolRecord).filter_by(hash=content_hash).first()
    if existing:
        if existing.status == "approved":
            return {"status": "approved", "tool_name": name,
                    "message": "Tool already exists", "tool_id": existing.id}
        if existing.status == "pending_approval":
            return {"status": "pending_approval", "tool_name": name,
                    "message": "Tool awaiting approval", "tool_id": existing.id}

    try:
        candidate = synthesise(
            spec, max_attempts=settings.TOOL_SYNTHESIS_MAX_ATTEMPTS
        )
    except ModelUnavailable as e:
        # A transport failure is not a bad tool. Reporting it as a failed
        # synthesis lets the caller retry or carry on; letting it propagate
        # returned a 500 for the whole request, discarding the attempts that
        # had already succeeded.
        logger.error("Synthesis of '%s' abandoned — model unavailable: %s", name, e)
        return {"status": "failed", "tool_name": name,
                "message": f"Code model unavailable: {e}"}
    except SynthesisFailed as e:
        logger.warning("Synthesis of '%s' failed: %s", name, e)
        return {"status": "failed", "tool_name": name, "message": str(e)}
    except Exception as e:
        logger.exception("Synthesis of '%s' raised unexpectedly", name)
        return {"status": "failed", "tool_name": name,
                "message": f"Synthesis error: {e}"}

    generated_code = candidate.code
    sandbox_output = candidate.history()
    tool_schema = spec.tool_schema()
    logger.info(
        "Tool '%s' verified via %s (%s)", name, candidate.model_used, sandbox_output
    )

    if settings.AUTO_APPROVE_DYNAMIC_TOOLS:
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
            purpose=purpose,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        logger.info("Tool '%s' auto-approved and registered", name)
        return {"status": "approved", "tool_name": name,
                "message": "Tool synthesized and approved", "tool_id": record.id}

    record = ToolRecord(
        name=name,
        hash=content_hash,
        version="1.0.0",
        schema_json=json.dumps(tool_schema),
        source_code=generated_code,
        status="pending_approval",
        sandbox_output=sandbox_output,
        purpose=purpose,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    logger.info("Tool '%s' stored as pending_approval (id=%d)", name, record.id)
    return {"status": "pending_approval", "tool_name": name,
            "message": "Tool awaiting approval", "tool_id": record.id}


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


def import_tool(db: Session, name: str, schema: dict, source_code: str, content_hash: str, version: str = "1.0.0", purpose: str = "tool") -> dict:
    """Install a tool from known-good source, skipping codegen/lint/sandbox.

    For reproducing a tool that was already vetted and approved elsewhere (a
    deployment package) — not for accepting arbitrary code from an untrusted
    caller. The source is trusted the same way approve_tool() trusts a
    record's stored source_code: it already went through synthesis once.
    """
    existing = db.query(ToolRecord).filter_by(hash=content_hash).first()
    if existing:
        return {
            "status": "approved" if existing.status == "approved" else existing.status,
            "message": "Tool already present",
            "tool_name": existing.name,
            "tool_id": existing.id,
        }

    module_path = _write_and_register(source_code, name, content_hash)

    record = ToolRecord(
        name=name,
        hash=content_hash,
        version=version,
        schema_json=json.dumps(schema),
        source_code=source_code,
        module_path=module_path,
        status="approved",
        purpose=purpose,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    logger.info("Tool '%s' imported and registered at %s", name, module_path)
    return {"status": "approved", "message": "Tool imported and registered", "tool_name": name, "tool_id": record.id}


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


def update_tool(db: Session, tool_id: int, code: str, description: str, purpose: str | None = None) -> dict:
    """Update a tool's code and description. `purpose` left as None keeps it unchanged."""
    import os
    import hashlib

    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found"}

    if purpose:
        record.purpose = purpose

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
