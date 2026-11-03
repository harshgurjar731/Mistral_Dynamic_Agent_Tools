"""
KnowledgeContextLayer — settles what the build knows before anything is decided.

Runs in both creation pipelines, right after inventory (which has resolved the
catalog scope this layer needs), and resolves two sources in one pass:

* **Process knowledge** — the process this request belongs to (uploaded, or
  matched from the process inventory), exactly as before:
  off | uploaded | inventory | none.
* **Build guidance** — best-practice items in scope, filtered by their
  conditions against the process facts and ranked once. Modes:
  off | auto (default: used whenever active guidance is in scope) | selected.

Each later decision layer reads its slice of both through
``DecisionLayer.process_block`` / ``guidance_block``. When neither source
yields anything nothing is set, and every prompt is unchanged.

After the rest of the pipeline returns, it records which elements each layer
used against the agent or workflow that was built, and annotates that subject
with the processes it implements.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Iterable, Optional

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


def guidance_request(ctx: PipelineContext) -> dict:
    """The run's guidance request: set directly, or carried in the knowledge request
    the orchestration pages send (``process_knowledge.guidance``)."""
    return ctx.guidance_request or (ctx.process_request or {}).get("guidance") or {}


async def resolve_guidance(ctx: PipelineContext, *, goal: str, concept_ids: Iterable[str],
                           facts: Optional[dict] = None, subject: str = "both",
                           process: Optional[dict] = None) -> Optional[dict]:
    """Build and attach the run's guidance pack. Returns it, or None when there is none.

    ``process``: the run's process context (``app.process.context.build``).
    With it, guidance is ranked against the process as well as the goal, and
    each stage's text is kept so a view can be ranked for one stage. Without
    it, ranking is exactly the goal-only ranking.

    Never raises: guidance improves a build, it never stops one.
    """
    from app.config import settings
    from app.knowledge import pipeline as guidance, retrieval, store

    request = guidance_request(ctx)
    mode = str(request.get("mode") or settings.GUIDANCE_DEFAULT_MODE or "auto").lower()
    item_ids = [int(i) for i in request.get("item_ids") or []]
    if mode == "off" or (mode == "selected" and not item_ids):
        return None
    try:
        if mode == "auto" and not await asyncio.to_thread(store.has_active_guidance):
            return None
        candidates = await asyncio.to_thread(
            store.list_items, kind="guidance", status="active", audiences=("builder", "both"),
            ids=item_ids if mode == "selected" else None, embedding=True)
        if not candidates:
            return None
        from app.process import context as pk_context

        use_process = bool(process) and settings.GUIDANCE_PROCESS_RANKING
        use_stages = bool(process) and settings.GUIDANCE_STAGE_RANKING
        process_text = pk_context.query_text(process) if use_process else ""
        stage_texts = pk_context.stage_texts(process) if use_stages else {}
        query_vector = process_vector = None
        stage_vectors: dict[str, list[float]] = {}
        if any(c.get("embedding") for c in candidates):
            from app.knowledge import embed

            query_vector = await embed.embed_query(ctx.client, goal)
            if query_vector is not None and (process_text or stage_texts):
                # One call for the process and all of its stages.
                keys = list(stage_texts)
                texts = ([process_text] if process_text else []) + [stage_texts[k] for k in keys]
                vectors = await embed.embed_texts(ctx.client, [t[:4000] or "-" for t in texts]) or []
                if process_text and vectors:
                    process_vector, vectors = vectors[0], vectors[1:]
                stage_vectors = dict(zip(keys, vectors))
        if query_vector is None:
            for c in candidates:
                c.pop("embedding", None)
        ranked = await asyncio.to_thread(
            retrieval.select, goal, concept_ids=list(concept_ids), facts=facts or {},
            subject=subject, item_ids=item_ids if mode == "selected" else None,
            query_vector=query_vector, limit=max(1, int(settings.GUIDANCE_PACK_SIZE)),
            items=candidates, process_text=process_text, process_vector=process_vector,
            view_min=view_min(),
            keep_vectors=bool(stage_vectors))
    except Exception as e:
        logger.warning("Guidance resolution failed: %s", e, exc_info=True)
        return None
    if not ranked:
        return None
    stages = {ref: {"text": text, **({"vector": stage_vectors[ref]} if ref in stage_vectors else {})}
              for ref, text in stage_texts.items() if text}
    pack = retrieval.build_pack(ranked, mode=mode, stages=stages)
    ctx.metadata[guidance.CONTEXT_KEY] = pack
    ctx.metadata[guidance.USAGE_KEY] = {}
    return pack


def view_min() -> int:
    """Places every layer view keeps in the pack (Settings: GUIDANCE_VIEW_MIN), ≤ the view size."""
    from app.config import settings

    return max(0, min(int(settings.GUIDANCE_VIEW_MIN), max(1, int(settings.GUIDANCE_VIEW_SIZE))))


def derived_requirements(content) -> Optional[dict]:
    """Requirement facts from the process document, when that is switched on."""
    from app.config import settings
    from app.process import context as pk_context

    if not settings.GUIDANCE_PROCESS_REQUIREMENTS:
        return None
    return pk_context.derived_requirements(content) or None


def _guidance_event(pack: Optional[dict], *, mode: str) -> dict:
    if not pack:
        return {"enabled": mode != "off", "mode": mode, "items": [], "message": "No build guidance in scope."}
    return {
        "enabled": True, "mode": pack["mode"],
        "items": [{"id": i["id"], "title": i["title"], "strength": i.get("strength"),
                   "category": i.get("category"), "concept_id": i.get("concept_id"),
                   "applies": i.get("applies"), "score": i.get("score")} for i in pack["items"]],
    }


class KnowledgeContextLayer(Layer):
    name = "knowledge_context"
    label = "Knowledge context"
    detail = ("Finds the business process this request belongs to and the build guidance in "
              "scope, and gives each later layer the part it needs.")

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

    async def _resolve_process(self, ctx: PipelineContext, goal: str, scope: dict | None) -> tuple[Optional[dict], str]:
        from app.process import context as pk_context, pipeline as pk, resolver

        request = ctx.process_request or {}
        if not request.get("enabled"):
            ctx.emit("process_knowledge", pk_context.to_event(
                None, enabled=False, message="Off — building without process knowledge."))
            return None, "Off — building without process knowledge."

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
            # The primary document's raw content: what guidance conditions are checked against.
            pc["facts"] = resolved["documents"][0].get("content") or {}
            ctx.metadata[pk.CONTEXT_KEY] = pc
            # Created here, before any concurrent group, so branch snapshots
            # share it — see app.process.pipeline.
            ctx.metadata[pk.USAGE_KEY] = {}
            summary = pk_context.summary_line(pc)
            if resolved.get("rejected"):
                summary += f" {len(resolved['rejected'])} attached document(s) were not valid and were skipped."
            ctx.emit("process_knowledge", pk_context.to_event(pc, enabled=True))
            return pc, summary

        ctx.emit("process_knowledge", pk_context.to_event(
            None, enabled=True, mode="none", message=resolved.get("message", ""),
            candidates=resolved.get("candidates"), scope_label=resolved.get("scope_label", "")))
        return None, resolved.get("message") or "No process knowledge found."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings
        from app.knowledge import pipeline as guidance, retrieval
        from app.knowledge.retrieval import facts_from, scope_ids

        goal, scope = self._goal_and_scope(ctx)
        pc, process_summary = await self._resolve_process(ctx, goal, scope)

        process_concepts = [d.get("concept_id") for d in (pc or {}).get("documents") or []]
        requirements = ctx.requirements if self.pipeline == "agent" else None
        if requirements is None and pc:
            # A workflow build has no requirement analysis; what the process
            # document settles (complexity, conversational or not) stands in,
            # so guidance conditioned on it is checked instead of "unknown".
            requirements = derived_requirements(pc.get("facts"))
        facts = facts_from((pc or {}).get("facts"), requirements)
        pack = await resolve_guidance(
            ctx, goal=goal, concept_ids=scope_ids(scope, process_concepts), facts=facts,
            subject="agent" if self.pipeline == "agent" else "both", process=pc)
        mode = str(guidance_request(ctx).get("mode") or settings.GUIDANCE_DEFAULT_MODE)
        ctx.emit("guidance", json.dumps(_guidance_event(pack, mode=mode), default=str))

        guidance_summary = retrieval.summary_line(pack) if pack else (
            "Guidance off." if mode == "off" else "No build guidance in scope.")
        ctx.set_layer_summary(self.name, f"{process_summary} {guidance_summary}".strip())

        result = await next(ctx)

        from app.process import pipeline as pk

        if pk.active(result) or guidance.active(result):
            try:
                await asyncio.to_thread(self._persist, result)
            except Exception as e:
                logger.warning("Knowledge usage could not be recorded: %s", e)
        if pk.active(result):
            result.emit("process_knowledge_applied", json.dumps({
                "usage": pk.all_usage(result),
                "documents": pk.active(result)["documents"],
                "subject": self._subject(result),
            }, default=str))
        if guidance.active(result):
            result.emit("guidance_applied", json.dumps({
                "usage": guidance.all_usage(result),
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
        from app.knowledge import pipeline as guidance
        from app.process import pipeline as pk

        def both(subject_type: str, subject_id: str, name: str, target: Any = None) -> None:
            kwargs = {} if target is None else {"target": target}
            pk.persist(ctx, subject_type, subject_id, name, **kwargs)
            guidance.persist(ctx, subject_type, subject_id, name, **kwargs)

        from app.knowledge import store as knowledge_store

        used = guidance.used_item_ids(ctx)
        if self.pipeline == "agent":
            if ctx.created_agent_id:
                both("agent", ctx.created_agent_id, (ctx.agent_config or {}).get("agent_name") or "")
                knowledge_store.record_outcome(used, accepted=True)
            return

        from app.layers.workflow import plan_control

        spec = ctx.workflow_spec
        if ctx.metadata.get(plan_control.ROLLED_BACK_KEY):
            # The person reviewing the build rolled it back: count it against
            # the guidance that shaped it.
            flagged = knowledge_store.record_outcome(used, accepted=False)
            if flagged:
                ctx.emit("guidance_flagged", json.dumps({"item_ids": flagged}))
            return
        if spec is None or not spec.definition:
            return
        both("workflow", spec.workflow_name, spec.workflow_name)
        knowledge_store.record_outcome(used, accepted=True)
        for agent in spec.provisioned_agents or []:
            if agent.get("reused") or not agent.get("agent_id"):
                continue
            both("agent", agent["agent_id"], agent.get("agent_name") or "",
                 target=agent.get("capability_id"))
