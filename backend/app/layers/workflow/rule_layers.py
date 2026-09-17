"""
Workflow rule layers — the planner picks rules for each agent and the workflow.

Two layers, because agent rules and workflow rules are separate families:

* ``WorkflowAgentRulesLayer`` runs after AgentDesignLayer and before
  AgentProvisioningLayer. Each new agent gets its own agent-rule selection —
  the same question the chat pipeline asks — so provisioning can enforce them
  at creation.
* ``WorkflowRuleSelectionLayer`` runs after the workflow guardrail review and
  before validation. It picks workflow rules for the assembled path, using the
  review's missing gates and data exposure as evidence, and writes them onto
  the definition so validation checks them and the engine enforces them.

Both only choose from rules people defined; neither can invent one.
"""

import asyncio
import json
import logging

from app.core.context import PipelineContext
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: Same bound as agent design: one small completion per new agent.
_SELECTION_CONCURRENCY = 4


class WorkflowAgentRulesLayer(WorkflowStepLayer):
    """Choose optional agent rules for every agent the workflow will create."""

    name = "agent_rule_selection"
    label = "Choose rules for each agent"
    detail = "Decides which of your optional agent rules each new agent must follow."

    async def process(self, ctx: PipelineContext, next):
        from app.rules import select, store

        spec = ctx.workflow_spec
        to_select = [
            c for c in spec.capabilities
            if c.kind == "agent" and not c.reuse_agent_id and c.spec
        ]
        if not to_select or not store.selectable_rules("agent"):
            for cap in to_select:
                cap.spec.rules = []
            ctx.set_layer_summary(self.name, "Only always-on agent rules apply.")
            return await next(ctx)

        ctx.emit("status", f"Choosing rules for {len(to_select)} agent(s)…")
        semaphore = asyncio.Semaphore(_SELECTION_CONCURRENCY)

        async def _one(cap):
            async with semaphore:
                agent = cap.spec
                subject = select.agent_subject(
                    name=agent.agent_name or cap.name,
                    description=agent.description or cap.purpose,
                    instructions=agent.agent_instructions or "",
                    tier=agent.tier or cap.tier,
                    model=agent.model or "",
                    tools=agent.tools or [],
                    connectors=agent.connectors or [],
                    libraries=agent.document_library_ids or [],
                    requirements=json.dumps({"goal": spec.goal, "purpose": cap.purpose}),
                )
                result = await select.select_rules(
                    ctx.client, "agent", subject, phase=f"rule selection ({cap.id})"
                )
                return cap, result

        results = await asyncio.gather(*[_one(c) for c in to_select], return_exceptions=True)
        chosen = 0
        for item in results:
            if isinstance(item, Exception):
                logger.warning("Agent rule selection failed: %s", item)
                continue
            cap, result = item
            cap.spec.rules = result["selected"]
            chosen += len(result["selected"])
            ctx.emit("agent_rules_selected", json.dumps({
                "capability": cap.id,
                "agent_name": cap.spec.agent_name,
                "selected": result["selected"],
                "reasoning": result["reasoning"],
                "decided": result["decided"],
            }))
        for cap in to_select:
            if cap.spec.rules is None:
                cap.spec.rules = []

        ctx.set_layer_summary(
            self.name, f"{chosen} optional rule(s) across {len(to_select)} agent(s)."
        )
        return await next(ctx)


class WorkflowRuleSelectionLayer(WorkflowStepLayer):
    """Choose optional workflow rules for the assembled workflow."""

    name = "workflow_rule_selection"
    label = "Choose workflow rules"
    detail = "Decides which of your optional workflow rules this workflow must follow."

    async def process(self, ctx: PipelineContext, next):
        from app.rules import select, store

        spec = ctx.workflow_spec
        if not spec.dag:
            return await next(ctx)

        ctx.emit("status", "Choosing workflow rules…")
        result = await select.select_rules(
            ctx.client, "workflow",
            select.workflow_subject(spec.dag, goal=spec.goal, guardrail_review=spec.guardrails),
            phase="workflow rule selection",
        )
        spec.dag["rules"] = [
            {"rule_id": s["rule_id"], "source": "ai", "reason": s.get("reason", "")}
            for s in result["selected"]
        ]
        spec.rationale["rules"] = result["reasoning"]

        ctx.emit("workflow_rules_selected", json.dumps({
            "scope": "workflow",
            "selected": result["selected"],
            "always_on": [
                {"rule_id": r["id"], "name": r["name"], "summary": r["summary"]}
                for r in store.always_on_rules("workflow")
            ],
            "reasoning": result["reasoning"],
            "decided": result["decided"],
        }))
        ctx.set_layer_summary(self.name, result["reasoning"])
        return await next(ctx)
