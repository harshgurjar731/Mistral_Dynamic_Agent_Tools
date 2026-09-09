"""
CapabilityGapLayer — Decides whether the platform is missing a capability.

Formerly ``SynthesisLayer``. The decision itself is unchanged; what changed is
its input. It now reads the requirement spec rather than the raw query, so the
question it answers is "does the stated deliverable need a capability the
catalogue lacks" instead of "does this sentence sound like it needs a tool".

Runs before tool selection and not inside the facet ParallelGroup, because a
tool synthesised here has to be visible to ToolSelectionLayer — that ordering
was load-bearing in the original pipeline and remains so.

Not a ``DecisionLayer`` subclass: the decision is followed by an ``await`` on
the tool service, and the base class's ``apply`` hook is synchronous.
"""

import logging

from app.core.context import PipelineContext
from app.core.decision import decide, parse_json
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class CapabilityGapLayer(Layer):
    """Check for a missing capability and synthesise it if one is needed.

    * **Skips when**: an agent was pre-selected or this is a follow-up.
    * **Writes**: ``ctx.synthesis_result``
    * **Failure policy**: non-fatal. A failed synthesis leaves the agent
      without that capability, which is a worse agent but still an answer;
      failing the request outright would be a regression.
    """

    name = "capability_gap"
    label = "Check for a missing capability"
    detail = "Decides whether the platform lacks a tool this request needs, and builds it."

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings
        from app.prompts import SYNTHESIS_CHECK_SYSTEM_PROMPT, SYNTHESIS_CHECK_USER_PROMPT
        from app.services.tool_registry import get_tool_descriptions, refresh_dynamic_tools
        from app.services.tool_resolver import tool_resolver

        ctx.emit("status", "Checking for missing capabilities…")

        # The requirement spec is the authoritative statement of the need; the
        # raw query is kept for wording the synthesised tool's description.
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
                model=settings.MISTRAL_CODING_MODEL,
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

            tool_name = data.get("tool_name", "unknown")
            ctx.emit("status", f"Synthesising capability: {tool_name}…")

            synthesis_result = await tool_resolver.trigger_synthesis(
                name=tool_name,
                description=data.get("tool_description", ""),
                parameters=data.get("parameters", {}),
                required=data.get("required", []),
                # A single dynamic agent calls this itself — it is an agent
                # capability, not a standalone workflow step.
                purpose="tool",
            )
            logger.info("Synthesis result: %s", synthesis_result)

            if synthesis_result.get("status") in ("failed", "error"):
                msg = synthesis_result.get("message", "Unknown synthesis error")
                logger.warning("Capability synthesis failed (non-fatal, continuing): %s", msg)
                ctx.synthesis_result = False
                return await next(ctx)

            await refresh_dynamic_tools()
            ctx.synthesis_result = synthesis_result.get("status") == "approved"
            if ctx.synthesis_result:
                ctx.emit("tool_new", {"tool_name": tool_name, "status": "approved"})

        except Exception as e:
            logger.error("Capability gap check failed: %s", e)
            ctx.synthesis_result = False

        return await next(ctx)
