"""
The learning loop — fixes that keep recurring become build guidance.

Every applied revision (by a person, by Refine with AI, or by the planner's own
dry-run repair) records what it fixed: the validation issues it resolved, by
code, and the activity code it rebuilt. When the same kind of fix has been
needed ``PROPOSE_AFTER`` times, a guidance item is proposed on the Knowledge
page (status ``proposed``) — so the planner is told up front what it keeps
getting wrong, once a person approves it. Nothing is applied automatically.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.database import Base

logger = logging.getLogger(__name__)

PROPOSE_AFTER = 3

#: What the planner should do instead, for the fixes it needs most.
_ADVICE = {
    "dataflow.argument_shape": ("Wire activity arguments to the activity's own parameter shapes",
                                "Pass each activity exactly the record its input schema declares — the same "
                                "field names and nesting. Map fields explicitly when an upstream record differs."),
    "dataflow.unknown_output_field": ("Read only fields a step actually returns",
                                      "Reference an activity's output only by the property names in its output "
                                      "schema; never assume a field another step's prose mentions."),
    "dataflow.unwired": ("Wire every required activity parameter",
                         "Every required parameter of an activity step needs an argument from an earlier "
                         "step or a run input."),
    "transform.cannot_run": ("Write transforms for the sandbox",
                             "Transform code is one expression or statements assigning `output`, using only "
                             "the sandbox builtins (round, min, max, sum…) and json."),
    "condition.cannot_evaluate": ("Reference values in conditions with {{…}}",
                                  "Condition expressions read workflow values only as {{variable}} references, "
                                  "compared with literals."),
    "input.undeclared": ("Declare every run input a step reads",
                         "Each field a step reads from the run input must be declared, nested where the data "
                         "is nested, with a type and description."),
    "activity.code_fix": ("Specify activity behaviour precisely",
                          "Activity specifications must state formulas, rounding, units and edge cases "
                          "(missing or zero values) — these are what later code fixes kept adding."),
}


class BuildLesson(Base):
    __tablename__ = "build_lessons"
    workspace_id = Column(String, nullable=True, index=True)

    id = Column(Integer, primary_key=True, autoincrement=True)
    signature = Column(String, nullable=False, index=True)
    count = Column(Integer, nullable=False, default=0)
    #: JSON list of recent examples: {"workflow", "detail"}.
    examples = Column(Text, nullable=False, default="[]")
    proposed_item_id = Column(Integer, nullable=True)
    last_seen = Column(DateTime, nullable=True)


def signatures(revision: dict) -> list[tuple[str, str]]:
    """``(signature, detail)`` for each fix an applied revision made."""
    out: list[tuple[str, str]] = []
    for issue in ((revision.get("validation") or {}).get("resolved") or []):
        code = issue.get("code")
        if code:
            out.append((code, str(issue.get("message") or "")[:300]))
    for item in revision.get("plan") or []:
        if item.get("kind") == "code" and item.get("status") == "completed":
            out.append(("activity.code_fix", f"{item.get('tool_name')}: {item.get('detail') or item.get('title')}"[:300]))
    seen, unique = set(), []
    for sig, detail in out:
        if sig not in seen:
            seen.add(sig)
            unique.append((sig, detail))
    return unique


def record_fix(workflow_name: str, revision: dict) -> list[int]:
    """Count the fixes in ``revision``; propose guidance for any now recurring. Returns new item ids."""
    from app.database import SessionLocal

    found = signatures(revision)
    if not found or SessionLocal is None:
        return []
    proposed: list[int] = []
    with SessionLocal() as db:
        for sig, detail in found:
            row = db.query(BuildLesson).filter(BuildLesson.signature == sig).first()
            if row is None:
                row = BuildLesson(signature=sig, count=0, examples="[]")
                db.add(row)
            row.count = (row.count or 0) + 1
            examples = json.loads(row.examples or "[]")
            examples = (examples + [{"workflow": workflow_name, "detail": detail}])[-5:]
            row.examples = json.dumps(examples)
            row.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)
            if row.count >= PROPOSE_AFTER and not row.proposed_item_id:
                item_id = _propose(sig, row.count, examples)
                if item_id:
                    row.proposed_item_id = item_id
                    proposed.append(item_id)
        db.commit()
    return proposed


def _propose(signature: str, count: int, examples: list[dict]) -> Optional[int]:
    from app.knowledge import store

    title, advice = _ADVICE.get(signature, (
        f"Avoid recurring '{signature}' problems",
        f"Workflows built by the planner kept needing a fix for '{signature}'."))
    seen = "\n".join(f"- {e['workflow']}: {e['detail']}" for e in examples)
    try:
        item = store.upsert_item({
            "kind": "guidance", "category": "anti_pattern", "title": title,
            "body": f"{advice}\n\nNeeded {count} times; recent cases:\n{seen}",
            "audience": "builder", "subject": "workflow", "strength": "should",
            "status": "proposed", "rationale": "Proposed by the learning loop from repeated fixes.",
        }, key=("title", "kind"))
    except Exception as e:  # noqa: BLE001 — learning never breaks applying a fix
        logger.warning("Could not propose guidance for %s: %s", signature, e)
        return None
    logger.info("Proposed build guidance %s for recurring '%s'", item.get("id"), signature)
    return item.get("id")
