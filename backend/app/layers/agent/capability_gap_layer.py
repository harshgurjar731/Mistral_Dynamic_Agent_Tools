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
        from app.core.specs import CodeNeed
        from app.layers.codegen import resolve_code_need
        from app.prompts import SYNTHESIS_CHECK_SYSTEM_PROMPT, SYNTHESIS_CHECK_USER_PROMPT
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
                system=SYNTHESIS_CHECK_SYSTEM_PROMPT,
                user=SYNTHESIS_CHECK_USER_PROMPT.format(
                    tool_descriptions=get_tool_descriptions(),
                    user_query=query_block,
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
            )

            def relay(event: dict) -> None:
                if event.get("stage") in ("reuse", "author", "submit", "build"):
                    ctx.emit("status", str(event.get("message", ""))[:200])

            resolution = await resolve_code_need(need, client=ctx.client, on_event=relay)
            logger.info("Capability resolution: %s %s (%s)", resolution.status,
                        resolution.name, resolution.message[:200])

            if resolution.status == "blocked":
                ctx.emit("status", f"Not building '{tool_name}': {resolution.message}")
            ctx.synthesis_result = resolution.usable
            if resolution.status == "built":
                ctx.emit("tool_new", {"tool_name": resolution.name, "status": "approved",
                                      "version": resolution.version})

        except Exception as e:
            logger.error("Capability gap check failed: %s", e)
            ctx.synthesis_result = False

        return await next(ctx)
