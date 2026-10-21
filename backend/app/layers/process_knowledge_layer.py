"""
ProcessKnowledgeLayer — grounds a build in the business process it belongs to.

Runs in both creation pipelines, right after inventory (which has resolved the
ontology scope this layer needs):

* **off** — the request did not turn the feature on. Nothing is set, so every
  later layer's prompt is exactly what it was before this feature existed.
* **uploaded** — documents attached on the orchestration page are used.
* **inventory** — otherwise the scope is walked to the processes linked under
  it and the best match is used, with its subprocesses.
* **none** — nothing matched; the build continues and the timeline says why.

After the rest of the pipeline returns, it records which elements each layer
used against the agent or workflow that was built, and annotates that subject
with the processes it implements — which is what puts it under the process on
the ontology graph.
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class ProcessKnowledgeLayer(Layer):
    name = "process_knowledge"
    label = "Process knowledge"
    detail = ("Finds the business process this request belongs to — uploaded or from the "
              "process inventory — and gives each later layer the part it needs.")

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

    def _goal_and_scope(self, ctx: PipelineContext) -> tuple[str, dict | None]:
        if self.pipeline == "workflow":
            spec = ctx.workflow_spec
            return spec.goal, (spec.inventory or {}).get("scope")
        from app.layers.agent.inventory_layer import INVENTORY_KEY

        goal = ctx.query
        if ctx.requirements:
            goal = " ".join(filter(None, [ctx.query, ctx.requirements.intent,
                                          ctx.requirements.domain]))
        return goal, (ctx.metadata.get(INVENTORY_KEY) or {}).get("scope")

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.process_knowledge import context as pk_context, pipeline as pk, resolver

        request = ctx.process_request or {}
        if not request.get("enabled"):
            ctx.emit("process_knowledge", pk_context.to_event(
                None, enabled=False, message="Off — building without process knowledge."))
            ctx.set_layer_summary(self.name, "Off — building without process knowledge.")
            return await next(ctx)

        goal, scope = self._goal_and_scope(ctx)
        ctx.emit("status", "Looking for process knowledge…")
        try:
            resolved = await asyncio.to_thread(
                resolver.resolve, goal, scope, list(request.get("document_ids") or []))
        except Exception as e:
            logger.warning("Process knowledge resolution failed: %s", e, exc_info=True)
            resolved = {"mode": "none", "documents": [], "candidates": [],
                        "message": "Process knowledge could not be loaded — continuing without it."}

        if resolved["documents"]:
            pc = pk_context.build(
                resolved["documents"], mode=resolved["mode"], message=resolved.get("message", ""),
                candidates=resolved.get("candidates"), scope_label=resolved.get("scope_label", ""),
            )
            ctx.metadata[pk.CONTEXT_KEY] = pc
            # Created here, before any concurrent group, so branch snapshots
            # share it — see app.process_knowledge.pipeline.
            ctx.metadata[pk.USAGE_KEY] = {}
            summary = pk_context.summary_line(pc)
            if resolved.get("rejected"):
                summary += f" {len(resolved['rejected'])} attached document(s) were not valid and were skipped."
            ctx.emit("process_knowledge", pk_context.to_event(pc, enabled=True))
            ctx.set_layer_summary(self.name, summary)
        else:
            ctx.emit("process_knowledge", pk_context.to_event(
                None, enabled=True, mode="none", message=resolved.get("message", ""),
                candidates=resolved.get("candidates"), scope_label=resolved.get("scope_label", "")))
            ctx.set_layer_summary(self.name, resolved.get("message") or "No process knowledge found.")

        result = await next(ctx)

        if pk.active(result):
            try:
                await asyncio.to_thread(self._persist, result)
            except Exception as e:
                logger.warning("Process usage could not be recorded: %s", e)
            result.emit("process_knowledge_applied", json.dumps({
                "usage": pk.all_usage(result),
                "documents": pk.active(result)["documents"],
                "subject": self._subject(result),
            }, default=str))
        return result

    def _subject(self, ctx: PipelineContext) -> dict:
        if self.pipeline == "workflow":
            spec = ctx.workflow_spec
            return {"type": "workflow", "id": getattr(spec, "workflow_name", None)}
        return {"type": "agent", "id": ctx.created_agent_id,
                "name": (ctx.agent_config or {}).get("agent_name")}

    def _persist(self, ctx: PipelineContext) -> None:
        from app.process_knowledge import pipeline as pk

        if self.pipeline == "agent":
            if ctx.created_agent_id:
                pk.persist(ctx, "agent", ctx.created_agent_id,
                           (ctx.agent_config or {}).get("agent_name") or "")
            return

        from app.layers.workflow import plan_control

        spec = ctx.workflow_spec
        if ctx.metadata.get(plan_control.ROLLED_BACK_KEY) or spec is None or not spec.definition:
            return
        pk.persist(ctx, "workflow", spec.workflow_name, spec.workflow_name)
        for agent in spec.provisioned_agents or []:
            if agent.get("reused") or not agent.get("agent_id"):
                continue
            pk.persist(ctx, "agent", agent["agent_id"], agent.get("agent_name") or "",
                       target=agent.get("capability_id"))
