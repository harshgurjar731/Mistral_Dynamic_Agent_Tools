"""
The creation gate — one function every agent-creation path calls.

Agents are created in several places (the chat pipeline, the workflow planner,
the agents API, the Le Chat gateway, the step runner's stand-in agents). Each
one calls :func:`prepare_agent` with the configuration it is about to send and
:func:`finish_agent` once the agent exists, so the same rules hold whichever way
an agent came to be — the same reason ``agent_service.build_guardrails`` is the
one builder of guardrail payloads.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from app.rules import engine, runtime, store

logger = logging.getLogger(__name__)


@dataclass
class PreparedAgent:
    model: str
    tool_keys: list[str]
    connector_ids: list[str]
    #: Guardrail request dicts, as ``agent_service.build_guardrails`` consumes.
    guardrails: list[dict]
    rules: list[dict] = field(default_factory=list)
    outcomes: list[dict] = field(default_factory=list)

    @property
    def blocked(self) -> list[dict]:
        return engine.blocking(self.outcomes)

    def block_message(self) -> str:
        return " ".join(f"{o['rule_name']}: {o['message']}" for o in self.blocked)

    def filter_connector_refs(self, refs: list) -> list:
        """Keep only the connector refs whose id survived the rules."""
        keep = set(self.connector_ids)
        out = []
        for ref in refs or []:
            cid = ref.get("connector_id") if isinstance(ref, dict) else ref
            if cid in keep:
                out.append(ref)
        return out


def _selected_ids(selection: Optional[list]) -> list[str]:
    ids = []
    for item in selection or []:
        rule_id = item.get("rule_id") if isinstance(item, dict) else item
        if rule_id:
            ids.append(str(rule_id))
    return ids


def prepare_agent(
    *,
    model: str,
    instructions: str,
    tool_keys: list[str] | None,
    connector_ids: list[str] | None,
    guardrails: list[dict] | None,
    selection: Optional[list] = None,
    mode: str = "manual",
) -> PreparedAgent:
    """Apply creation-time rules to a configuration about to be created.

    ``selection`` is the rules chosen for this agent (``[{rule_id, ...}]`` or
    bare ids); always-on rules are added automatically. Never raises: a rules
    failure leaves the configuration exactly as it was given.
    """
    prepared = PreparedAgent(
        model=model, tool_keys=list(tool_keys or []), connector_ids=list(connector_ids or []),
        guardrails=[g for g in (guardrails or []) if g],
    )
    try:
        prepared.rules = store.effective_rules("agent", _selected_ids(selection))
        config, outcomes = engine.check_agent_config(
            {
                "model": model,
                "instructions": instructions,
                "tools": prepared.tool_keys,
                "connectors": prepared.connector_ids,
                "guardrails": prepared.guardrails,
            },
            prepared.rules,
            mode=mode,
        )
        prepared.model = config.get("model") or model
        prepared.tool_keys = config["tools"]
        prepared.connector_ids = config["connectors"]
        prepared.guardrails = config.get("guardrails") or []
        prepared.outcomes = outcomes
    except Exception as e:
        logger.warning("Creation rules skipped: %s", e)
    return prepared


def finish_agent(agent_id: str, prepared: PreparedAgent, selection: Optional[list],
                 default_source: str = "user") -> list[dict]:
    """Store the agent's selection and record the creation outcomes."""
    if not agent_id:
        return []
    items = []
    for item in selection or []:
        if isinstance(item, dict):
            items.append(item)
        elif item:
            items.append({"rule_id": str(item)})
    try:
        store.set_agent_rules(agent_id, items, default_source=default_source)
        runtime.record(prepared.outcomes, scope="agent", subject_id=agent_id)
    except Exception as e:
        logger.warning("Could not store rules for agent %s: %s", agent_id, e)
    return runtime.summarise(prepared.outcomes)
