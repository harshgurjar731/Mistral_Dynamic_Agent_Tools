"""
Synthesis Service — database-facing entry points for dynamic tools.

Code generation and verification live in :mod:`app.synthesis`; this module is
the adapter the routes call for everything that acts on an existing version:
approval, rejection, deletion, hand edits, imports and rollbacks.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.models import ToolRecord
from app.synthesis import registry
from app.synthesis.profiles import get_profile
from app.synthesis.testplan import TestPlan
from app.synthesis.verifiers import verify_candidate, verify_static

logger = logging.getLogger(__name__)

#: Seeded native tools predate the envelope contract; they are neither deleted
#: nor held to the synthesis tests.
PREDEFINED_TOOL_NAMES = {"get_weather", "calculate", "search_knowledge", "create_document", "send_email"}


def approve_tool(db: Session, tool_id: int) -> dict:
    """Approve a pending version — install it and make it the active one."""
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found", "tool_name": ""}
    if record.status != "pending_approval":
        return {"status": "error", "tool_name": record.name,
                "message": f"Tool status is '{record.status}', not pending_approval"}
    try:
        registry.approve(db, record)
    except registry.RegistrationError as e:
        return {"status": "error", "tool_name": record.name, "message": f"Could not install: {e}"}
    logger.info("Tool '%s' v%s approved and active", record.name, record.version_no)
    return {"status": "approved", "message": f"Version {record.version_no} approved and active",
            "tool_name": record.name}


def reject_tool(db: Session, tool_id: int) -> dict:
    """Reject a version. Rejecting the active version rolls back to the previous one."""
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found", "tool_name": ""}

    was_active = bool(record.is_active)
    record.status = "rejected"
    record.is_active = False
    db.commit()
    registry.evict(record.name, record.version_no)

    message = "Tool rejected"
    if was_active:
        previous = next((v for v in registry.versions_of(db, record.name)
                         if v.status == "approved" and v.id != record.id), None)
        if previous:
            registry.activate(db, previous)
            message = f"Version {record.version_no} rejected; version {previous.version_no} is active again"
    logger.info("Tool '%s' v%s rejected", record.name, record.version_no)
    return {"status": "rejected", "message": message, "tool_name": record.name}


def delete_tool(db: Session, tool_id: int) -> dict:
    """Delete a tool.

    Deleting a pending or rejected version removes that version only. Deleting
    an approved version removes the tool — every version — since what the
    caller sees and means is "this tool".
    """
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found"}
    if record.name in PREDEFINED_TOOL_NAMES:
        return {"status": "error", "message": f"Cannot delete predefined native tool '{record.name}'"}

    name = record.name
    if record.status in ("pending_approval", "rejected") and not record.is_active:
        db.delete(record)
        db.commit()
        return {"status": "deleted", "message": f"Version {record.version_no} deleted", "tool_name": name}

    removed = registry.delete_name(db, name)
    logger.info("Tool '%s' deleted (%d version(s))", name, removed)
    return {"status": "deleted", "message": f"Tool deleted ({removed} version(s))", "tool_name": name}


def update_tool(db: Session, tool_id: int, code: str, description: str, purpose: str | None = None) -> dict:
    """Hand-edit a tool. The edit is verified like generated code and becomes a new version.

    Previously an edit got static analysis only, so an edit that broke the
    tool went live the moment it was saved. Now it runs against the test plan
    the original version was verified with, and a failing edit is refused with
    the failing cases.
    """
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found"}

    spec = registry.spec_of(record)
    spec.description = (description or spec.description).strip()
    if purpose in ("tool", "activity"):
        spec.purpose = purpose
    profile = get_profile(spec.purpose)

    if record.name in PREDEFINED_TOOL_NAMES:
        verdict = verify_static(code)
    else:
        plan = None
        if record.test_plan_json:
            try:
                plan = TestPlan.from_dict(json.loads(record.test_plan_json))
            except (ValueError, TypeError):
                plan = None
        plan = plan or profile.build_test_plan(spec, [])
        verdict = verify_candidate(spec, profile, plan, code)

    if not verdict.ok:
        logger.warning("Edit of '%s' refused at %s", record.name, verdict.stage)
        return {"status": "error", "message": f"The edited code failed verification at "
                                               f"'{verdict.stage}': {verdict.diagnostic[-3000:]}"}

    code = verdict.repaired_code or code
    status = record.status if record.status in ("approved", "pending_approval") else "pending_approval"
    try:
        new = registry.create_version(
            db, spec=spec, code=code, status=status,
            report={"history": f"hand edit of v{record.version_no}",
                    "cases": [c.__dict__ for c in verdict.cases]},
            test_plan=json.loads(record.test_plan_json) if record.test_plan_json else None,
            review_required=bool(record.review_required),
        )
    except registry.RegistrationError as e:
        return {"status": "error", "message": f"Verified, but could not install: {e}"}

    if new.id == record.id:
        return {"status": "updated", "message": "No change", "tool_name": record.name,
                "tool_id": record.id, "version": record.version_no}
    logger.info("Tool '%s' edited → v%s", record.name, new.version_no)
    return {"status": "updated", "message": f"Saved as version {new.version_no}",
            "tool_name": record.name, "tool_id": new.id, "version": new.version_no}


def import_tool(db: Session, name: str, schema: dict, source_code: str, content_hash: str,
                version: str = "1.0.0", purpose: str = "tool", version_no: int | None = None) -> dict:
    """Install a tool from known-good source, skipping codegen and verification.

    For reproducing a version vetted and approved elsewhere (a deployment
    package) — not for accepting arbitrary code from an untrusted caller.
    """
    existing = registry.find_by_hash(db, content_hash)
    if existing:
        return {"status": existing.status, "message": "Tool already present",
                "tool_name": existing.name, "tool_id": existing.id}

    fn = (schema or {}).get("function", schema or {})
    from app.synthesis.spec import SynthesisSpec

    spec = SynthesisSpec.from_request(
        name=name, description=fn.get("description", name),
        parameters=fn.get("parameters", {}), purpose=purpose, origin="import",
    )
    try:
        record = registry.create_version(
            db, spec=spec, code=source_code, status="approved",
            report={"history": "imported"}, test_plan=None,
            version_label=version, row_hash=content_hash, version_no=version_no,
        )
    except registry.RegistrationError as e:
        return {"status": "error", "message": str(e), "tool_name": name}
    logger.info("Tool '%s' imported as v%s", name, record.version_no)
    return {"status": "approved", "message": "Tool imported and registered",
            "tool_name": name, "tool_id": record.id}


def activate_version(db: Session, tool_id: int) -> dict:
    """Make an approved version the active one — a rollback or roll-forward."""
    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        return {"status": "error", "message": "Tool not found", "tool_name": ""}
    try:
        registry.activate(db, record)
    except registry.RegistrationError as e:
        return {"status": "error", "message": str(e), "tool_name": record.name}
    return {"status": "approved", "message": f"Version {record.version_no} is now active",
            "tool_name": record.name}
