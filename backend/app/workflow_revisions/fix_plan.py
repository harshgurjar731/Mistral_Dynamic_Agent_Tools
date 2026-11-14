"""
The fix plan of a Refine-with-AI turn — what will be done, shown before it is done and updated as it happens.

A turn used to be one opaque request: the model's edits came back as a finished
proposal, and a fault inside an activity's *code* could not be fixed at all —
the user had to leave the workflow, find the activity and rebuild it by hand.

Now a turn is planned first and carried out item by item:

1. **Diagnosis** (no model): the failed run being fixed — the given execution,
   or the latest run when it failed — is read: which steps failed, with what
   error and input, and the code of each failing activity.
2. **Analysis** (the ``workflow_revision`` route on the Settings page): the
   instruction and that diagnosis become workflow edits *and* code fixes.
3. **Plan**: one item per edit and per code fix, plus the checks, published as
   a ``fix_plan`` event and re-published whenever an item changes, so the UI
   shows each item move from pending to done (or failed) live.
4. Each code fix rebuilds the activity through the code pipeline (its model
   routes are on the Settings page too), tested against its worked examples and
   the input it failed on; the proposal pins the workflow step to the new
   version, so applying the proposal adopts the fixed code.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

#: Item statuses, in the order an item moves through them.
STATUSES = ("pending", "in_progress", "completed", "failed", "skipped")
_CODE_BUDGET = 6000
_PREVIEW_BUDGET = 2000


# ── Diagnosis ─────────────────────────────────────────────────────────────


def _step_for(name: str, steps: list[dict]) -> Optional[dict]:
    """The workflow step a progress entry belongs to (by id, then by activity name)."""
    name = str(name or "")
    for s in steps:
        if s.get("id") == name:
            return s
    for s in steps:
        if s.get("id") and (name.endswith(s["id"]) or s["id"] in name.split(".")):
            return s
    for s in steps:
        if (s.get("config") or {}).get("tool_name") == name:
            return s
    return None


async def _latest_execution(workflow_name: str) -> Optional[str]:
    from app.services.workflow_engine import executions

    try:
        listing = await executions.list_runs(workflow_identifier=workflow_name, page_size=5)
    except Exception as e:  # noqa: BLE001
        logger.debug("No runs listed for %s: %s", workflow_name, e)
        return None
    items = listing.get("executions") or listing.get("items") or []
    if not items:
        return None
    latest = items[0]
    status = str(latest.get("status") or "").upper()
    return latest.get("execution_id") if status in ("FAILED", "TIMED_OUT") else None


async def _activity_record(tool_name: str, version: Optional[int]) -> Optional[dict]:
    from app.services.tool_resolver import tool_resolver

    versions = await tool_resolver.get_tool_versions(tool_name)
    chosen = None
    for v in versions:
        if version is not None and v.get("version_no") == version:
            chosen = v
            break
        if version is None and v.get("is_active"):
            chosen = v
            break
    chosen = chosen or (versions[0] if versions else None)
    if chosen and not chosen.get("source_code") and chosen.get("id") is not None:
        full = await tool_resolver.get_tool(int(chosen["id"]))
        chosen = full or chosen
    return chosen


async def diagnose(workflow_name: str, base: dict, execution_id: Optional[str]) -> dict:
    """What went wrong in the run being fixed. Never raises; {} when there is nothing to read."""
    from app.services.workflow_engine import executions

    try:
        execution_id = execution_id or await _latest_execution(workflow_name)
        if not execution_id:
            return {}
        detail = await executions.fetch_execution(execution_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not read run %s for the fix: %s", execution_id, e)
        return {}
    if detail is None:
        return {}

    steps = [s for s in (base or {}).get("steps") or [] if isinstance(s, dict)]
    failed = []
    for entry in detail.steps:
        if entry.status != "FAILED" or entry.internal:
            continue
        step = _step_for(entry.name, steps) or {}
        config = step.get("config") or {}
        row = {
            "step_id": step.get("id") or entry.name,
            "step_type": step.get("type"),
            "error": (entry.error or "")[:_PREVIEW_BUDGET],
            "input_preview": (entry.input_preview or "")[:_PREVIEW_BUDGET],
        }
        if step.get("type") == "tool" and config.get("tool_name"):
            row["tool_name"] = config["tool_name"]
            row["tool_version"] = config.get("tool_version")
            try:
                record = await _activity_record(config["tool_name"], config.get("tool_version"))
            except Exception as e:  # noqa: BLE001
                logger.debug("No record for %s: %s", config["tool_name"], e)
                record = None
            if record:
                row["tool_id"] = record.get("id")
                row["code"] = str(record.get("source_code") or "")[:_CODE_BUDGET]
        failed.append(row)

    if not failed and detail.error:
        failed.append({"step_id": None, "error": detail.error[:_PREVIEW_BUDGET]})
    return {
        "execution_id": execution_id,
        "status": detail.status,
        "error": (detail.error or "")[:_PREVIEW_BUDGET],
        "failed_steps": failed,
    }


def diagnosis_for_prompt(diagnosis: dict) -> str:
    if not diagnosis or not diagnosis.get("failed_steps"):
        return "(no failed run to fix)"
    return json.dumps(diagnosis, indent=2, default=str)


# ── The plan ──────────────────────────────────────────────────────────────


def _item(item_id: str, kind: str, title: str, detail: str = "", **extra) -> dict:
    return {"id": item_id, "kind": kind, "title": title.strip()[:200], "detail": detail.strip()[:600],
            "status": "pending", "note": "", **extra}


def _op_title(op: dict) -> str:
    kind = op.get("op")
    sid = op.get("step_id") or (op.get("step") or {}).get("id") or ""
    return {
        "add_step": f"Add step '{sid}'",
        "remove_step": f"Remove step '{sid}'",
        "update_step": f"Update step '{sid}'",
        "rename_step": f"Rename '{sid}' to '{op.get('new_id')}'",
        "move_step": f"Move step '{sid}'",
        "set_next_steps": f"Reconnect step '{sid}'",
        "set_parallel_group": "Change which steps run in parallel",
        "set_entry_step": f"Start the workflow at '{sid}'",
        "update_workflow": "Update the workflow description",
        "upsert_input": f"Declare run input '{(op.get('field') or {}).get('name', '')}'",
        "remove_input": f"Remove run input '{op.get('name', '')}'",
    }.get(kind, str(kind or "Edit").replace("_", " ").capitalize())


def build_plan(spec) -> list[dict]:
    """One item per workflow edit, per code fix, then the checks that close the turn."""
    plan: list[dict] = []
    for i, op in enumerate(spec.operations):
        plan.append(_item(f"op{i}", "workflow", _op_title(op), str(op.get("reason") or ""), op_index=i))
    for i, fix in enumerate(spec.code_fixes):
        plan.append(_item(f"code{i}", "code",
                          f"Fix the code of activity '{fix.get('tool_name')}'",
                          f"{fix.get('problem', '')} → {fix.get('change', '')}".strip(" →"),
                          fix_index=i, step_id=fix.get("step_id")))
    plan.append(_item("validate", "check", "Check the workflow still runs",
                      "The same structural checks and workflow rules as publishing."))
    plan.append(_item("propose", "check", "Prepare the change for your review",
                      "Nothing is saved until you apply it."))
    return plan


def publish(ctx, spec) -> None:
    """Send the whole plan; the UI replaces its copy with the latest one."""
    ctx.emit("fix_plan", {"items": spec.plan, "diagnosis": {
        k: spec.diagnosis.get(k) for k in ("execution_id", "status", "error")} if spec.diagnosis else None})


def mark(ctx, spec, item_id: str, status: str, note: str = "") -> None:
    for item in spec.plan:
        if item["id"] == item_id:
            if item["status"] == status and (not note or item.get("note") == note):
                return
            item["status"] = status
            if note:
                item["note"] = note[:400]
            publish(ctx, spec)
            return


def item_for(spec, *, op_index: Optional[int] = None, fix_index: Optional[int] = None) -> Optional[dict]:
    for item in spec.plan:
        if op_index is not None and item.get("op_index") == op_index:
            return item
        if fix_index is not None and item.get("fix_index") == fix_index:
            return item
    return None


def clean_code_fixes(raw: Any, base: dict) -> list[dict]:
    """The model's code fixes, kept only for activities the workflow actually runs."""
    tools = {(s.get("config") or {}).get("tool_name"): s.get("id")
             for s in (base or {}).get("steps") or [] if s.get("type") == "tool"}
    out, seen = [], set()
    for fix in raw if isinstance(raw, list) else []:
        if not isinstance(fix, dict):
            continue
        name = str(fix.get("tool_name") or "").strip()
        if name not in tools or name in seen:
            continue
        change = str(fix.get("change") or "").strip()
        if not change:
            continue
        seen.add(name)
        out.append({"tool_name": name, "step_id": fix.get("step_id") or tools[name],
                    "problem": str(fix.get("problem") or "").strip()[:600], "change": change[:2000]})
    return out[:5]
