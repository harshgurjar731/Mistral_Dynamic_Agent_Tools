"""
PatternExpansionLayer — adds the sub-agents a multi-agent capability needs.

Deterministic; runs after CapabilityReuseLayer (only capabilities that will be
created are expanded — a reused agent keeps its own setup) and before
AgentDesignLayer, so each added sub-agent is designed and created like any
other agent.

A capability whose archetype has ``multi_agent`` or ``planner_executor`` and
names sub-agents (from the process document's agent design) gets one child
capability per sub-agent. Children are **handoff targets, not workflow steps**:
the topology layer leaves them out, and after provisioning the parent agent is
given ``handoffs`` to them (``wire_handoffs``). At run time the parent's step
runs through the Conversations API with server-side handoff execution, so
Mistral routes each sub-task to the right sub-agent.

A planner–executor capability *without* named sub-agents is not expanded: one
agent writes its plan as JSON and then executes it, as its instructions say.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

from app.core.context import PipelineContext
from app.core.layer import NextFn
from app.core.specs import ArchetypeSpec, CapabilitySpec, OversightSpec
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

_SUB = {"task": ("task", []), "goal": ("goal", ["planner_executor"]), "conversational": ("conversational", []),
        "planner": ("task", ["planner_executor"]), "critic": ("task", ["reflective"])}


def _slug(text: str) -> str:
    return "_".join(re.findall(r"[a-z0-9]+", (text or "").lower()))[:40] or "sub"


def children_of(spec, parent_id: str) -> list[CapabilitySpec]:
    return [c for c in spec.capabilities if c.expanded_from == parent_id]


class PatternExpansionLayer(WorkflowStepLayer):
    name = "pattern_expansion"
    label = "Expand multi-agent patterns"
    detail = "Adds the sub-agents a multi-agent capability delegates to, as handoff targets."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        spec = ctx.workflow_spec
        added: list[str] = []
        for cap in list(spec.capabilities):
            arch = cap.archetype
            if (cap.kind != "agent" or arch is None or cap.reuse_agent_id or cap.expanded_from
                    or not ({"multi_agent", "planner_executor"} & set(arch.patterns)) or not arch.sub_agents):
                continue
            taken = {c.id for c in spec.capabilities}
            for sub in arch.sub_agents:
                if not isinstance(sub, dict) or not sub.get("name") or sub.get("capability_id"):
                    continue
                child_id = f"{cap.id}__{_slug(sub['name'])}"
                n = 2
                while child_id in taken:
                    child_id, n = f"{cap.id}__{_slug(sub['name'])}_{n}", n + 1
                taken.add(child_id)
                primary, patterns = _SUB.get(sub.get("type") or "task", ("task", []))
                child_arch = ArchetypeSpec(
                    primary_type=primary, patterns=["tool_using_react", *patterns],
                    action_authority=arch.action_authority, reversibility=arch.reversibility,
                    # The parent's step is what people review; a sub-agent's work
                    # reaches them through it.
                    oversight=OversightSpec(model="not_applicable"),
                    reflection_criteria=list(arch.reflection_criteria) if "reflective" in patterns else [],
                    source="document", rationale=f"Sub-agent '{sub['name']}' of {cap.name or cap.id}.")
                spec.capabilities.append(CapabilitySpec(
                    id=child_id, name=str(sub["name"]), tier="use_case",
                    purpose=str(sub.get("role") or sub["name"]), inputs=list(cap.inputs), outputs=[],
                    kind="agent", agent_needs_tools=cap.agent_needs_tools, archetype=child_arch,
                    expanded_from=cap.id, process_stage=(sub.get("stages") or [None])[0]))
                sub["capability_id"] = child_id
                added.append(child_id)
            if "multi_agent" not in arch.patterns:
                arch.patterns.append("multi_agent")

        if added:
            ctx.emit("pattern_expansion", json.dumps({"added": added}))
        ctx.set_layer_summary(self.name, f"Added {len(added)} sub-agent(s): {', '.join(added)}."
                              if added else "No multi-agent capability to expand.")
        return await next(ctx)


async def wire_handoffs(ctx: PipelineContext) -> list[str]:
    """Give each provisioned parent agent handoffs to its sub-agents. Never raises."""
    spec = ctx.workflow_spec
    by_cap = {a["capability_id"]: a["agent_id"] for a in spec.provisioned_agents or [] if a.get("agent_id")}
    wired = []
    for cap in spec.capabilities:
        if cap.expanded_from or cap.id not in by_cap:
            continue
        targets = [by_cap[c.id] for c in children_of(spec, cap.id) if c.id in by_cap]
        if not targets:
            continue
        try:
            await asyncio.to_thread(ctx.client.beta.agents.update, agent_id=by_cap[cap.id], handoffs=targets)
            wired.append(cap.id)
        except Exception as e:
            logger.warning("Handoffs for %s could not be set: %s", cap.id, e)
            ctx.emit("status", f"Sub-agents of {cap.name or cap.id} could not be linked: {str(e)[:200]}")
    return wired
