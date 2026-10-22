"""
Tool safety rules — storage, the built-in set, and where a rule can apply.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Iterable, Optional

from app.database import SessionLocal
from app.safety.models import SafetyRule

logger = logging.getLogger(__name__)

#: Every place a rule can apply. ``kind`` is guidance (added to a prompt) or
#: screen (a check before code is built that can block it).
POINTS: dict[str, dict] = {
    "capability_gap": {
        "kind": "guidance", "label": "Deciding a new tool is needed",
        "detail": "Agent orchestrator: when it decides the request needs a tool that does not exist.",
    },
    "tool_selection": {
        "kind": "guidance", "label": "Choosing an agent's tools",
        "detail": "Agent orchestrator: when it picks which platform tools a new agent gets.",
    },
    "workflow_agent_design": {
        "kind": "guidance", "label": "Designing workflow agents",
        "detail": "Workflow planner: when it designs each new agent and its tools.",
    },
    "spec_authoring": {
        "kind": "guidance", "label": "Writing a tool or activity spec",
        "detail": "Code pipeline: when it writes the specification code is generated from.",
    },
    "screen_tool_build": {
        "kind": "screen", "label": "Before building an agent tool",
        "detail": "Checks a new agent tool request; can block the build.",
    },
    "screen_activity_build": {
        "kind": "screen", "label": "Before building a workflow activity",
        "detail": "Checks a new workflow activity request; can block the build.",
    },
    "screen_rebuild": {
        "kind": "screen", "label": "Before a rebuild from an error",
        "detail": "Checks a 'rebuild from this error' request; can block the rebuild.",
    },
}

#: What each strictness means, at each kind of point.
STRICTNESS: dict[str, dict] = {
    "advise": {
        "label": "Advise",
        "guidance": "Avoid where you can",
        "screen": "Reports a likely violation as a warning; never blocks",
    },
    "standard": {
        "label": "Standard",
        "guidance": "Do not",
        "screen": "Blocks a clear violation only",
    },
    "strict": {
        "label": "Strict",
        "guidance": "Never — and if in doubt, don't",
        "screen": "Blocks a clear or likely violation, and blocks when the check cannot run",
    },
}

#: The rules the platform ships with. All off; switching one on applies it at
#: every point by default, which can then be narrowed.
BUILTIN: list[dict] = [
    {"id": "no_arbitrary_code", "title": "No arbitrary code execution",
     "rule": "Executes arbitrary code or shell commands supplied at run time (e.g. exec, eval, "
             "bash, subprocess)."},
    {"id": "no_unguarded_destructive_writes", "title": "No unguarded deletes or bulk changes",
     "rule": "Deletes, drops, or bulk-modifies data without an explicit dry_run parameter."},
    {"id": "no_credential_exfiltration", "title": "No credential or PII exfiltration",
     "rule": "Sends credentials, tokens, or personal data to an external endpoint."},
    {"id": "no_impersonation", "title": "No impersonation",
     "rule": "Impersonates another user or service."},
    {"id": "no_auth_bypass", "title": "No authentication bypass",
     "rule": "Bypasses authentication or authorization checks."},
    {"id": "no_metadata_injection", "title": "No instructions in tool metadata",
     "rule": "Has a name or description that overrides, ignores, or redefines the platform's "
             "instructions (prompt injection via tool metadata)."},
]


class SafetyRuleError(ValueError):
    """A rule write the store refuses; the message is for the user."""


def _loads(raw: Optional[str]) -> list[str]:
    try:
        value = json.loads(raw or "[]")
        return [str(v) for v in value] if isinstance(value, list) else []
    except Exception:
        return []


def _to_dict(row: SafetyRule) -> dict:
    return {
        "id": row.id, "title": row.title, "rule": row.rule, "enabled": bool(row.enabled),
        "strictness": row.strictness if row.strictness in STRICTNESS else "standard",
        "applies_to": [p for p in _loads(row.applies_to) if p in POINTS],
        "builtin": bool(row.builtin), "sort": row.sort,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _clean_points(points: Iterable[str]) -> list[str]:
    unknown = [p for p in points if p not in POINTS]
    if unknown:
        raise SafetyRuleError(f"Unknown place(s): {', '.join(unknown)}.")
    return [p for p in POINTS if p in set(points)]  # canonical order


def _session():
    if SessionLocal is None:
        raise RuntimeError("The database is unavailable.")
    return SessionLocal()


def seed() -> int:
    """Insert missing built-in rules, off. Never touches an existing row, so a
    rule the user switched on or narrowed stays as they left it."""
    if SessionLocal is None:
        return 0
    db = SessionLocal()
    added = 0
    try:
        for i, raw in enumerate(BUILTIN):
            if db.query(SafetyRule).filter(SafetyRule.id == raw["id"]).first():
                continue
            db.add(SafetyRule(id=raw["id"], title=raw["title"], rule=raw["rule"], enabled=False,
                              strictness="standard", applies_to=json.dumps(list(POINTS)),
                              builtin=True, sort=i))
            added += 1
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Tool safety rules seed skipped: %s", e)
    finally:
        db.close()
    return added


def list_rules() -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        rows = db.query(SafetyRule).order_by(SafetyRule.sort, SafetyRule.created_at).all()
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def rules_for(point: str) -> list[dict]:
    """The rules switched on for one place. Empty unless someone turned one on."""
    try:
        return [r for r in list_rules() if r["enabled"] and point in r["applies_to"]]
    except Exception as e:  # the feature must never break the pipelines
        logger.warning("Tool safety rules unavailable: %s", e)
        return []


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:48] or "rule"


def create_rule(*, title: str, rule: str, strictness: str = "standard",
                applies_to: Iterable[str] = (), enabled: bool = False) -> dict:
    title, rule = (title or "").strip(), (rule or "").strip()
    if len(title) < 3 or len(rule) < 10:
        raise SafetyRuleError("Give the rule a title and describe what it forbids.")
    if strictness not in STRICTNESS:
        raise SafetyRuleError(f"Strictness must be one of {', '.join(STRICTNESS)}.")
    points = _clean_points(list(applies_to))
    db = _session()
    try:
        base, n = f"custom_{_slug(title)}", 2
        rule_id = base
        while db.query(SafetyRule).filter(SafetyRule.id == rule_id).first():
            rule_id, n = f"{base}_{n}", n + 1
        row = SafetyRule(id=rule_id, title=title, rule=rule, enabled=bool(enabled),
                         strictness=strictness, applies_to=json.dumps(points), builtin=False,
                         sort=1000)
        db.add(row)
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def update_rule(rule_id: str, *, title: Optional[str] = None, rule: Optional[str] = None,
                strictness: Optional[str] = None, applies_to: Optional[Iterable[str]] = None,
                enabled: Optional[bool] = None) -> dict:
    db = _session()
    try:
        row = db.query(SafetyRule).filter(SafetyRule.id == rule_id).first()
        if not row:
            raise LookupError(f"Rule '{rule_id}' not found.")
        if (title is not None or rule is not None) and row.builtin:
            raise SafetyRuleError("A built-in rule's wording is fixed — add your own rule instead.")
        if title is not None:
            if len(title.strip()) < 3:
                raise SafetyRuleError("The title is too short.")
            row.title = title.strip()
        if rule is not None:
            if len(rule.strip()) < 10:
                raise SafetyRuleError("Describe what the rule forbids.")
            row.rule = rule.strip()
        if strictness is not None:
            if strictness not in STRICTNESS:
                raise SafetyRuleError(f"Strictness must be one of {', '.join(STRICTNESS)}.")
            row.strictness = strictness
        if applies_to is not None:
            row.applies_to = json.dumps(_clean_points(list(applies_to)))
        if enabled is not None:
            row.enabled = bool(enabled)
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def delete_rule(rule_id: str) -> None:
    db = _session()
    try:
        row = db.query(SafetyRule).filter(SafetyRule.id == rule_id).first()
        if not row:
            raise LookupError(f"Rule '{rule_id}' not found.")
        if row.builtin:
            raise SafetyRuleError("Built-in rules cannot be deleted — switch it off instead.")
        db.delete(row)
        db.commit()
    finally:
        db.close()


def turn_all_off() -> int:
    db = _session()
    try:
        n = db.query(SafetyRule).filter(SafetyRule.enabled.is_(True)).update(
            {SafetyRule.enabled: False}, synchronize_session=False)
        db.commit()
        return n
    finally:
        db.close()
