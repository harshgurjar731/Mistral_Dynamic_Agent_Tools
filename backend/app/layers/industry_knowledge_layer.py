"""
IndustryKnowledgeLayer — the industry facts a build plans with.

Runs in both creation pipelines right after KnowledgeContextLayer, so it can
use both what inventory matched and what process knowledge found:

* **Scope** — the domains the goal matched (the same scope the planner
  narrows agents with), plus the domain of the process document in use. Each
  is widened to the nodes above it (what it inherits) and, when Settings
  allow, the nodes below it that match the request.
* **Pack** — the best-ranked approved items in scope
  (``app.knowledge.industry``), set on the context for every later layer.

Each later decision reads its slice through ``DecisionLayer.industry_block``
(views by category: regulations reach decomposition, guardrails and rules;
metrics and standards reach data flow and design; …), and tool and activity
code generation reads ``industry_pipeline.code_items``. When nothing is in
scope nothing is set, and every prompt is unchanged.

After the rest of the pipeline returns, it records which items each layer
used against the agent or workflow that was built.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


def run_concepts(scope: Optional[dict], process: Optional[dict]) -> list[str]:
    """The concept ids a run is about: its matched domains plus its process nodes."""
    out = list((scope or {}).get("domains") or []) if (scope or {}).get("scoped", True) else []
    out += [d.get("concept_id") for d in (process or {}).get("documents") or [] if d.get("concept_id")]
    return list(dict.fromkeys(c for c in out if c))


class IndustryKnowledgeLayer(Layer):
    name = "industry_knowledge"
    label = "Industry knowledge"
    detail = ("Finds the reviewed facts about the industry this request belongs to — regulations, "
              "standards, rules, metrics, risks — and gives each later decision the ones it needs.")

    def __init__(self, pipeline: str):
        #: "workflow" | "agent" — where scope and goal are read from.
        self.pipeline = pipeline

    def should_run(self, ctx: PipelineContext) -> bool:
        if not self.enabled:
            return False
        if self.pipeline == "workflow":
            from app.layers.workflow.base import workflow_ready

            return workflow_ready(ctx)
        return not ctx.agent_id and not ctx.conversation_id

    def _goal_and_scope(self, ctx: PipelineContext) -> tuple[str, Optional[dict]]:
        if self.pipeline == "workflow":
            spec = ctx.workflow_spec
            return spec.goal, (spec.inventory or {}).get("scope")
        from app.layers.agent.inventory_layer import INVENTORY_KEY

        goal = ctx.query
        if ctx.requirements:
            goal = " ".join(filter(None, [ctx.query, ctx.requirements.intent, ctx.requirements.domain]))
        return goal, (ctx.metadata.get(INVENTORY_KEY) or {}).get("scope")

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.knowledge import industry, industry_pipeline as ik
        from app.process import pipeline as pk

        request = ik.industry_request(ctx)
        mode = str(request.get("mode") or industry.setting("INDUSTRY_KNOWLEDGE_MODE", "auto")).lower()
        goal, scope = self._goal_and_scope(ctx)
        pc = pk.active(ctx)
        concepts = run_concepts(scope, pc)
        ctx.emit("status", "Looking for industry knowledge…")
        pack = await industry.resolve(ctx.client, goal=goal, concept_ids=concepts, process=pc, mode=mode)
        # Replaces a pack resolved early for a tool built before planning (it
        # is now ranked against the process too); usage recorded so far stays.
        ik.attach(ctx, pack)
        message = ""
        if not pack:
            message = ("Off — planning without industry knowledge." if mode == "off" else
                       "No industry matched the request." if not industry.run_domains(concepts) else
                       "No approved industry knowledge for this industry yet.")
        ctx.emit("industry_knowledge", json.dumps(industry.to_event(pack, mode=mode, message=message),
                                                  default=str))
        ctx.set_layer_summary(self.name, industry.summary_line(pack) if pack else message)

        result = await next(ctx)

        if ik.active(result):
            try:
                await asyncio.to_thread(self._persist, result)
            except Exception as e:
                logger.warning("Industry knowledge usage could not be recorded: %s", e)
            result.emit("industry_knowledge_applied", json.dumps({
                "usage": ik.all_usage(result), "subject": self._subject(result),
            }, default=str))
        return result

    def _subject(self, ctx: PipelineContext) -> dict:
        if self.pipeline == "workflow":
            spec = ctx.workflow_spec
            return {"type": "workflow", "id": getattr(spec, "workflow_name", None)}
        return {"type": "agent", "id": ctx.created_agent_id,
                "name": (ctx.agent_config or {}).get("agent_name")}

    def _persist(self, ctx: PipelineContext) -> None:
        from app.knowledge import industry_pipeline as ik, store

        used = ik.used_item_ids(ctx)
        if self.pipeline == "agent":
            if ctx.created_agent_id:
                ik.persist(ctx, "agent", ctx.created_agent_id, (ctx.agent_config or {}).get("agent_name") or "")
                store.bump_stats(used, "accepted_builds")
            return

        from app.layers.workflow import plan_control

        spec = ctx.workflow_spec
        if ctx.metadata.get(plan_control.ROLLED_BACK_KEY):
            # Counted, never sent back to review: a rolled-back plan says
            # nothing about whether a regulation is true.
            store.bump_stats(used, "rolled_back_builds")
            return
        if spec is None or not spec.definition:
            return
        ik.persist(ctx, "workflow", spec.workflow_name, spec.workflow_name)
        store.bump_stats(used, "accepted_builds")
        for agent in spec.provisioned_agents or []:
            if agent.get("reused") or not agent.get("agent_id"):
                continue
            ik.persist(ctx, "agent", agent["agent_id"], agent.get("agent_name") or "",
                       target=agent.get("capability_id"))
