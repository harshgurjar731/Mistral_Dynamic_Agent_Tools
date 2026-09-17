"""
Rule selection — the LLM decides which optional rules fit one subject.

Shared by the chat pipeline's ``AgentRuleSelectionLayer``, the workflow
pipeline's two rule layers, and the "Suggest with AI" button in manual
creation, so every path asks the same question the same way.

The model only ever picks from the enabled, optional rules of the right scope;
anything else it names is dropped, the same policy the facet layers apply to
invented tool keys.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from app.rules import store

logger = logging.getLogger(__name__)


def _rules_block(rules: list[dict]) -> str:
    if not rules:
        return "None."
    return "\n".join(
        f"- id: {r['id']}\n  name: {r['name']}\n  does: {r.get('summary') or ''}\n"
        f"  why it exists: {r.get('description') or ''}"
        for r in rules
    )


def build_prompt(scope: str, subject: str) -> tuple[str, str]:
    from app.prompts_decisions import (
        AGENT_RULE_SELECTION_USER_PROMPT,
        RULE_SELECTION_SYSTEM_PROMPT,
        WORKFLOW_RULE_SELECTION_USER_PROMPT,
    )

    template = AGENT_RULE_SELECTION_USER_PROMPT if scope == "agent" else WORKFLOW_RULE_SELECTION_USER_PROMPT
    return (
        RULE_SELECTION_SYSTEM_PROMPT,
        template.format(
            subject=subject,
            always_on=_rules_block(store.always_on_rules(scope)),
            selectable=_rules_block(store.selectable_rules(scope)),
        ),
    )


def parse_selection(data: dict, scope: str) -> tuple[list[dict], str]:
    """Keep only real, optional rule ids. Returns ``(selection, reasoning)``."""
    selectable = {r["id"]: r for r in store.selectable_rules(scope)}
    selection, dropped, seen = [], [], set()
    for item in (data or {}).get("rules") or []:
        if isinstance(item, str):
            item = {"rule_id": item}
        if not isinstance(item, dict):
            continue
        rule_id = str(item.get("rule_id") or "").strip()
        if rule_id in selectable and rule_id not in seen:
            seen.add(rule_id)
            selection.append({
                "rule_id": rule_id,
                "name": selectable[rule_id]["name"],
                "reason": str(item.get("reason") or "")[:500],
                "source": "ai",
            })
        elif rule_id:
            dropped.append(rule_id)
    if dropped:
        logger.warning("Dropped %d unknown or non-optional rule id(s): %s", len(dropped), dropped)
    return selection, str((data or {}).get("reasoning") or "")


def agent_subject(
    *,
    name: str = "",
    description: str = "",
    instructions: str = "",
    tier: str = "",
    model: str = "",
    tools: Optional[list] = None,
    connectors: Optional[list] = None,
    libraries: Optional[list] = None,
    domain: str = "",
    requirements: str = "",
) -> str:
    return json.dumps(
        {
            "name": name, "description": description, "tier": tier, "model": model,
            "domain": domain, "tools": tools or [], "connectors": connectors or [],
            "document_libraries": libraries or [],
            "instructions_excerpt": (instructions or "")[:1500],
            "requirements": requirements,
        },
        indent=2,
    )


def workflow_subject(definition: dict, *, goal: str = "", guardrail_review: Optional[dict] = None) -> str:
    steps = [
        {
            "id": s.get("id"), "type": s.get("type"), "description": s.get("description"),
            "agent_id": (s.get("config") or {}).get("agent_id"),
            "connector_id": (s.get("config") or {}).get("connector_id"),
            "tool_name": (s.get("config") or {}).get("tool_name"),
        }
        for s in (definition or {}).get("steps") or []
    ]
    payload = {
        "name": (definition or {}).get("name"),
        "description": (definition or {}).get("description"),
        "goal": goal,
        "inputs": [f.get("name") for f in (definition or {}).get("input_schema") or []],
        "steps": steps,
    }
    if guardrail_review:
        payload["safety_review"] = {
            "missing_gates": guardrail_review.get("missing_gates"),
            "data_exposure": guardrail_review.get("data_exposure"),
        }
    return json.dumps(payload, indent=2, default=str)


async def select_rules(client, scope: str, subject: str, *, phase: str = "rule selection") -> dict:
    """Ask the model which optional rules fit. Never raises.

    Returns ``{"selected": [...], "reasoning": str, "decided": bool}``.
    """
    from app.config import settings
    from app.core.decision import decide, parse_json

    if not store.selectable_rules(scope):
        return {"selected": [], "reasoning": "No optional rules are defined for this scope.", "decided": True}

    try:
        system, user = build_prompt(scope, subject)
        raw = await decide(
            client, model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            system=system, user=user, phase=phase,
        )
        data = parse_json(raw, {}) or {}
        selected, reasoning = parse_selection(data, scope)
        return {"selected": selected, "reasoning": reasoning, "decided": True}
    except Exception as e:
        logger.warning("Rule selection (%s) failed: %s", scope, e)
        return {"selected": [], "reasoning": "Rule selection could not be made — only always-on rules apply.",
                "decided": False}
