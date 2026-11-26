"""
CapabilityGapLayer — Decides whether the platform is missing a capability.

The decision reads the requirement spec rather than the raw query, so the
question it answers is "does the stated deliverable need a capability the
catalogue lacks" instead of "does this sentence sound like it needs a tool".

When it does, building is handed to the code-requirement pipeline
(``app.layers.codegen``), which checks the catalogue for an equivalent tool,
screens the request, writes a full specification — descriptions an agent can
choose from, output contract, examples — and builds it. The gap decision's own
parameters travel as a draft the pipeline refines, not as the final spec.

Runs before tool selection and not inside the facet ParallelGroup, because a
tool built here has to be visible to ToolSelectionLayer.
"""

import logging

from app.core.context import PipelineContext
from app.core.decision import decide, parse_json
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class CapabilityGapLayer(Layer):
    """Check for a missing capability and build it if one is needed.

    * **Skips when**: an agent was pre-selected or this is a follow-up.
    * **Writes**: ``ctx.synthesis_result``
    * **Failure policy**: non-fatal. A failed build leaves the agent without
      that capability, which is a worse agent but still an answer.
    """

    name = "capability_gap"
    label = "Check for a missing capability"
    detail = "Decides whether the platform lacks a tool this request needs, and builds it."

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.build_prereqs import guidance as prerequisites
        from app.build_prereqs.code_check import CodeCheck
        from app.core.specs import CodeNeed
        from app.layers.codegen import resolve_code_need
        from app.prompts import SYNTHESIS_CHECK_SYSTEM_PROMPT, SYNTHESIS_CHECK_USER_PROMPT
        from app.safety import apply as safety
        from app.services.tool_registry import get_tool_descriptions

        ctx.emit("status", "Checking for missing capabilities…")

        if ctx.requirements:
            query_block = (
                f"{ctx.query}\n\n"
                f"STRUCTURED REQUIREMENT ANALYSIS:\n{ctx.requirements.as_prompt_block()}"
            )
        else:
            query_block = ctx.query

        try:
            raw = await decide(
                ctx.client,
                route="capability_gap",
                system=safety.apply(SYNTHESIS_CHECK_SYSTEM_PROMPT, "capability_gap"),
                user=SYNTHESIS_CHECK_USER_PROMPT.format(
                    tool_descriptions=get_tool_descriptions(),
                    user_query=query_block + prerequisites.block(ctx),
                ),
                phase="capability gap",
            )
            data = parse_json(raw, {}) or {}

            if not data.get("needs_new_tool", False):
                logger.info("No capability gap for this request")
                ctx.synthesis_result = False
                return await next(ctx)

            tool_name = data.get("tool_name", "") or ""
            ctx.emit("status", f"Building capability: {tool_name or 'new tool'}…")

            # This runs before planning has resolved the industry pack, so
            # resolve it now (IndustryKnowledgeLayer re-ranks it later with
            # the process document). The tool's code follows the industry's
            # rules, formulas and standards.
            industry_items = await self._industry_items(
                ctx, f"{tool_name} {data.get('tool_description') or ctx.query}")

            need = CodeNeed(
                purpose="tool",
                origin="chat",
                intent=data.get("tool_description") or ctx.query,
                name_hint=tool_name,
                goal=ctx.query,
                draft={
                    "name": tool_name,
                    "description": data.get("tool_description", ""),
                    "parameters": data.get("parameters", {}),
                    "required": data.get("required", []),
                },
                guidance=prerequisites.code_guidance(ctx),
                industry_knowledge=industry_items,
            )

            def relay(event: dict) -> None:
                if event.get("stage") in ("reuse", "author", "submit", "build", "credentials"):
                    ctx.emit("status", str(event.get("message", ""))[:200])

            resolution = await resolve_code_need(need, client=ctx.client, on_event=relay,
                                                 code_check=CodeCheck(ctx))
            logger.info("Capability resolution: %s %s (%s)", resolution.status,
                        resolution.name, resolution.message[:200])

            if resolution.status == "blocked":
                ctx.emit("status", f"Not building '{tool_name}': {resolution.message}")
            elif resolution.status == "failed":
                # Said out loud: an agent quietly created without the tool it
                # needed looks like a working agent that answers badly.
                ctx.emit("status", f"Could not build '{resolution.name or tool_name}' — the agent "
                                   f"is created without it. {resolution.message[:240]}")
            ctx.synthesis_result = resolution.usable
            req = resolution.requirement
            if resolution.status in ("built", "pending_approval") and req is not None and req.industry_refs:
                from app.knowledge import industry_pipeline

                industry_pipeline.record_items(ctx, self.name, req.industry_refs,
                                               how=f"applied in the code of {resolution.name}")
            if resolution.status == "built":
                ctx.emit("tool_new", {"tool_name": resolution.name, "status": "approved",
                                      "version": resolution.version})

        except Exception as e:
            logger.error("Capability gap check failed: %s", e)
            ctx.synthesis_result = False

        return await next(ctx)

    async def _industry_items(self, ctx: PipelineContext, purpose: str) -> list[dict]:
        """The industry items the tool's code should follow; [] when none are in scope."""
        from app.knowledge import industry, industry_pipeline

        if not bool(industry.setting("INDUSTRY_IN_CODEGEN", True)):
            return []
        try:
            from app.catalog import match

            goal = ctx.query
            if ctx.requirements and ctx.requirements.domain not in ("", "general"):
                goal = f"{ctx.requirements.domain} {ctx.requirements.intent}"
            scope = match.scope_for_goal(goal)
            await industry_pipeline.ensure(ctx, goal=" ".join(filter(None, [ctx.query, goal])),
                                           concept_ids=scope.get("domains") or [])
            return industry_pipeline.code_items(ctx, purpose)
        except Exception as e:
            logger.debug("Industry knowledge for the capability gap skipped: %s", e)
            return []
