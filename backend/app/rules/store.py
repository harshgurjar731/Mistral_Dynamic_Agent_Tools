"""
Rules store — CRUD for rules, agent selections and rule events.

Read functions degrade to empty when the database is unavailable; a rules
outage must never stop an agent from answering. Write functions raise
``RuleError`` with a message meant for a person.
"""

from __future__ import annotations

import json
import logging
import re
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from app.database import SessionLocal
from app.rules import catalog
from app.rules.models import Rule, RuleAssignment, RuleEvent

logger = logging.getLogger(__name__)

#: Events kept per subject. Enough for a meaningful activity view; pruned so a
#: busy agent cannot grow the table without bound.
_EVENTS_PER_SUBJECT = 1000


class RuleError(Exception):
    """A rule operation failed for a reason a person can act on."""


@contextmanager
def _session():
    if SessionLocal is None:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Serialisation ───────────────────────────────────────────────────────────


def _rule_dict(rule: Rule) -> dict:
    rule_type = catalog.get_type(rule.type)
    try:
        params = json.loads(rule.params or "{}")
    except (TypeError, ValueError):
        params = {}
    if rule_type:
        params = catalog.normalise_params(rule_type, params)
    return {
        "id": rule.id,
        "scope": rule.scope,
        "type": rule.type,
        "name": rule.name,
        "description": rule.description or (rule_type.description if rule_type else ""),
        "params": params,
        "enforcement": rule.enforcement,
        "always_on": bool(rule.always_on),
        "enabled": bool(rule.enabled),
        "source": rule.source,
        "summary": catalog.render_summary(rule_type, params) if rule_type else "",
        "category": rule_type.category if rule_type else "quality",
        "icon": rule_type.icon if rule_type else "Shield",
        "checkpoints": rule_type.checkpoints if rule_type else [],
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


# ── Cache ───────────────────────────────────────────────────────────────────
#
# Rules are read on every agent turn and every tool call, and change rarely.
# A short TTL keeps those reads off the database without letting an edit made
# on the Rules page take more than a few seconds to apply.

_CACHE_TTL = 5.0
_cache: dict[str, tuple[float, list[dict]]] = {}


def _invalidate() -> None:
    _cache.clear()


def _all_rules_cached() -> list[dict]:
    hit = _cache.get("all")
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1]
    rules = list_rules()
    _cache["all"] = (time.monotonic(), rules)
    return rules


# ── Rules CRUD ──────────────────────────────────────────────────────────────


def list_rules(scope: Optional[str] = None) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(Rule)
        if scope:
            q = q.filter(Rule.scope == scope)
        return [_rule_dict(r) for r in q.order_by(Rule.scope, Rule.name).all()]


def get_rule(rule_id: str) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        rule = db.get(Rule, rule_id)
        return _rule_dict(rule) if rule else None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:60] or "rule"


def _validated(rule_type_key: str, enforcement: Optional[str], params: Optional[dict]):
    rule_type = catalog.get_type(rule_type_key)
    if not rule_type:
        raise RuleError(f"Unknown rule type '{rule_type_key}'.")
    enforcement = enforcement or rule_type.default_enforcement
    if enforcement not in rule_type.enforcements:
        raise RuleError(
            f"'{rule_type.name}' cannot use '{enforcement}'. "
            f"Choose one of: {', '.join(rule_type.enforcements)}."
        )
    return rule_type, enforcement, catalog.normalise_params(rule_type, params)


def create_rule(
    *,
    type: str,
    name: str,
    description: str = "",
    params: Optional[dict] = None,
    enforcement: Optional[str] = None,
    always_on: bool = False,
    enabled: bool = True,
    source: str = "user",
    rule_id: Optional[str] = None,
) -> dict:
    rule_type, enforcement, params = _validated(type, enforcement, params)
    if not (name or "").strip():
        raise RuleError("A rule needs a name.")

    with _session() as db:
        if db is None:
            raise RuleError("The rules database is unavailable.")
        base = rule_id or f"{rule_type.scope}.{_slug(name)}"
        new_id, n = base, 2
        while db.get(Rule, new_id) is not None:
            new_id, n = f"{base}_{n}", n + 1
        db.add(Rule(
            id=new_id, scope=rule_type.scope, type=rule_type.key, name=name.strip(),
            description=(description or "").strip() or None, params=json.dumps(params),
            enforcement=enforcement, always_on=bool(always_on), enabled=bool(enabled),
            source=source,
        ))
        db.commit()
    _invalidate()
    return get_rule(new_id) or {}


def update_rule(rule_id: str, changes: dict) -> dict:
    with _session() as db:
        if db is None:
            raise RuleError("The rules database is unavailable.")
        rule = db.get(Rule, rule_id)
        if not rule:
            raise RuleError(f"Rule '{rule_id}' not found.")

        _, enforcement, params = _validated(
            rule.type,
            changes.get("enforcement", rule.enforcement),
            changes["params"] if "params" in changes else json.loads(rule.params or "{}"),
        )
        rule.enforcement = enforcement
        rule.params = json.dumps(params)
        if "name" in changes:
            if not (changes["name"] or "").strip():
                raise RuleError("A rule needs a name.")
            rule.name = changes["name"].strip()
        if "description" in changes:
            rule.description = (changes["description"] or "").strip() or None
        if "always_on" in changes:
            rule.always_on = bool(changes["always_on"])
        if "enabled" in changes:
            rule.enabled = bool(changes["enabled"])
        rule.updated_at = datetime.now(timezone.utc)
        db.commit()
    _invalidate()
    return get_rule(rule_id) or {}


def delete_rule(rule_id: str) -> dict:
    with _session() as db:
        if db is None:
            raise RuleError("The rules database is unavailable.")
        rule = db.get(Rule, rule_id)
        if not rule:
            raise RuleError(f"Rule '{rule_id}' not found.")
        if rule.source == "recommended":
            raise RuleError(
                "Recommended rules can be switched off or edited, but not deleted."
            )
        db.query(RuleAssignment).filter(RuleAssignment.rule_id == rule_id).delete(
            synchronize_session=False
        )
        db.delete(rule)
        db.commit()
    _invalidate()
    return {"deleted": rule_id}


def replace_rule(rule_id: str, values: dict) -> dict:
    """Overwrite a rule's configuration wholesale (used by "Restore default")."""
    with _session() as db:
        if db is None:
            raise RuleError("The rules database is unavailable.")
        rule = db.get(Rule, rule_id)
        if not rule:
            raise RuleError(f"Rule '{rule_id}' not found.")
        _, enforcement, params = _validated(rule.type, values.get("enforcement"), values.get("params"))
        rule.name = values.get("name", rule.name)
        rule.description = values.get("description")
        rule.params = json.dumps(params)
        rule.enforcement = enforcement
        rule.always_on = bool(values.get("always_on", False))
        rule.enabled = bool(values.get("enabled", True))
        rule.updated_at = datetime.now(timezone.utc)
        db.commit()
    _invalidate()
    return get_rule(rule_id) or {}


def insert_if_missing(values: dict) -> bool:
    """Seed one rule unless a row with its id already exists."""
    with _session() as db:
        if db is None or db.get(Rule, values["id"]) is not None:
            return False
    create_rule(
        rule_id=values["id"], type=values["type"], name=values["name"],
        description=values.get("description", ""), params=values.get("params"),
        enforcement=values.get("enforcement"), always_on=values.get("always_on", False),
        enabled=values.get("enabled", True), source="recommended",
    )
    return True


# ── Effective rules ─────────────────────────────────────────────────────────


def effective_rules(scope: str, selected_ids: Iterable[str] = ()) -> list[dict]:
    """Enabled rules of ``scope`` that are always on, plus the selected ones."""
    selected = set(selected_ids or ())
    return [
        r for r in _all_rules_cached()
        if r["scope"] == scope and r["enabled"] and (r["always_on"] or r["id"] in selected)
    ]


def selectable_rules(scope: str) -> list[dict]:
    """Enabled rules a person or the orchestrator may attach (i.e. not always on)."""
    return [
        r for r in _all_rules_cached()
        if r["scope"] == scope and r["enabled"] and not r["always_on"]
    ]


def always_on_rules(scope: str) -> list[dict]:
    return [r for r in _all_rules_cached() if r["scope"] == scope and r["enabled"] and r["always_on"]]


# ── Agent selections ────────────────────────────────────────────────────────


def agent_assignments(agent_id: str) -> list[dict]:
    with _session() as db:
        if db is None or not agent_id:
            return []
        rows = db.query(RuleAssignment).filter(RuleAssignment.agent_id == agent_id).all()
        return [
            {"rule_id": r.rule_id, "source": r.source, "reason": r.reason or ""}
            for r in rows
        ]


def rules_for_agent(agent_id: Optional[str]) -> list[dict]:
    """Effective agent rules for one agent — always-on plus its selection."""
    selected = [a["rule_id"] for a in agent_assignments(agent_id)] if agent_id else []
    return effective_rules("agent", selected)


def agent_rule_entries(agent_id: str) -> list[dict]:
    """Every rule that applies to an agent, with who put it there and why."""
    assigned = {a["rule_id"]: a for a in agent_assignments(agent_id)}
    out = []
    for rule in effective_rules("agent", assigned.keys()):
        entry = assigned.get(rule["id"])
        out.append({
            **rule,
            "applied_by": "always" if rule["always_on"] else (entry["source"] if entry else "user"),
            "reason": (entry or {}).get("reason", ""),
        })
    return out


def set_agent_rules(agent_id: str, selection: list[dict], default_source: str = "user") -> list[dict]:
    """Replace an agent's selection. ``selection`` items: ``{rule_id, source?, reason?}``.

    Always-on and unknown rule ids are dropped — an always-on rule applies by
    itself, and storing it would make switching it off later look like it had
    been removed from this agent specifically.
    """
    valid = {r["id"] for r in selectable_rules("agent")}
    clean: dict[str, dict] = {}
    for item in selection or []:
        rule_id = str((item or {}).get("rule_id") or "").strip()
        if rule_id in valid:
            clean[rule_id] = item

    with _session() as db:
        if db is None:
            return []
        db.query(RuleAssignment).filter(RuleAssignment.agent_id == agent_id).delete(
            synchronize_session=False
        )
        for rule_id, item in clean.items():
            db.add(RuleAssignment(
                agent_id=agent_id, rule_id=rule_id,
                source=item.get("source") or default_source,
                reason=str(item.get("reason") or "")[:500] or None,
            ))
        db.commit()
    return agent_assignments(agent_id)


# ── Events ──────────────────────────────────────────────────────────────────


def record_events(events: list[dict]) -> None:
    """Persist rule outcomes. Best effort — never raises."""
    if not events:
        return
    try:
        with _session() as db:
            if db is None:
                return
            for e in events:
                db.add(RuleEvent(
                    rule_id=e.get("rule_id", ""),
                    rule_name=e.get("rule_name") or e.get("rule_id", ""),
                    scope=e.get("scope", "agent"),
                    subject_id=str(e.get("subject_id") or "unknown"),
                    checkpoint=e.get("checkpoint", ""),
                    outcome=e.get("outcome", "passed"),
                    message=(e.get("message") or "")[:2000] or None,
                    detail=json.dumps(e.get("detail")) if e.get("detail") else None,
                    conversation_id=e.get("conversation_id"),
                    execution_id=e.get("execution_id"),
                    step_id=e.get("step_id"),
                ))
            db.commit()
    except Exception as ex:
        logger.warning("Could not record %d rule event(s): %s", len(events), ex)


def _event_dict(e: RuleEvent) -> dict:
    try:
        detail = json.loads(e.detail) if e.detail else None
    except (TypeError, ValueError):
        detail = None
    return {
        "id": e.id,
        "rule_id": e.rule_id,
        "rule_name": e.rule_name,
        "scope": e.scope,
        "subject_id": e.subject_id,
        "checkpoint": e.checkpoint,
        "outcome": e.outcome,
        "message": e.message or "",
        "detail": detail,
        "conversation_id": e.conversation_id,
        "execution_id": e.execution_id,
        "step_id": e.step_id,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def list_events(
    *,
    scope: Optional[str] = None,
    subject_id: Optional[str] = None,
    rule_id: Optional[str] = None,
    outcome: Optional[str] = None,
    include_passed: bool = True,
    limit: int = 100,
) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(RuleEvent)
        if scope:
            q = q.filter(RuleEvent.scope == scope)
        if subject_id:
            q = q.filter(RuleEvent.subject_id == subject_id)
        if rule_id:
            q = q.filter(RuleEvent.rule_id == rule_id)
        if outcome:
            q = q.filter(RuleEvent.outcome == outcome)
        elif not include_passed:
            q = q.filter(RuleEvent.outcome != "passed")
        rows = q.order_by(RuleEvent.id.desc()).limit(max(1, min(limit, 500))).all()
        return [_event_dict(e) for e in rows]


def agent_activity(agent_id: str) -> list[dict]:
    """Per-rule outcome counts and latest events for one agent."""
    entries = agent_rule_entries(agent_id)
    events = list_events(scope="agent", subject_id=agent_id, limit=500)
    by_rule: dict[str, list[dict]] = {}
    for e in events:
        by_rule.setdefault(e["rule_id"], []).append(e)

    out = []
    for rule in entries:
        rule_events = by_rule.get(rule["id"], [])
        counts = {o: 0 for o in catalog.OUTCOMES}
        for e in rule_events:
            counts[e["outcome"]] = counts.get(e["outcome"], 0) + 1
        out.append({
            "rule": rule,
            "counts": counts,
            "last": rule_events[0] if rule_events else None,
            "recent": rule_events[:10],
        })
    return out


def rule_usage() -> dict[str, dict]:
    """For the Rules page cards: agents using each rule and last-7-day outcomes."""
    usage: dict[str, dict] = {}
    with _session() as db:
        if db is None:
            return usage
        for rule_id, in db.query(RuleAssignment.rule_id).all():
            usage.setdefault(rule_id, {"agents": 0})["agents"] = usage.get(rule_id, {}).get("agents", 0) + 1
        since = datetime.now(timezone.utc) - timedelta(days=7)
        rows = (
            db.query(RuleEvent.rule_id, RuleEvent.outcome)
            .filter(RuleEvent.created_at >= since.replace(tzinfo=None))
            .all()
        )
        for rule_id, outcome in rows:
            bucket = usage.setdefault(rule_id, {"agents": 0})
            bucket[outcome] = bucket.get(outcome, 0) + 1
    return usage


def prune_events() -> int:
    """Keep the newest ``_EVENTS_PER_SUBJECT`` events per subject."""
    removed = 0
    try:
        with _session() as db:
            if db is None:
                return 0
            subjects = db.query(RuleEvent.scope, RuleEvent.subject_id).distinct().all()
            for scope, subject_id in subjects:
                cutoff = (
                    db.query(RuleEvent.id)
                    .filter(RuleEvent.scope == scope, RuleEvent.subject_id == subject_id)
                    .order_by(RuleEvent.id.desc())
                    .offset(_EVENTS_PER_SUBJECT)
                    .first()
                )
                if cutoff:
                    removed += (
                        db.query(RuleEvent)
                        .filter(
                            RuleEvent.scope == scope,
                            RuleEvent.subject_id == subject_id,
                            RuleEvent.id <= cutoff[0],
                        )
                        .delete(synchronize_session=False)
                    )
            db.commit()
    except Exception as e:
        logger.warning("Rule event prune skipped: %s", e)
    return removed
