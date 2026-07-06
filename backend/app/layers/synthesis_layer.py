"""
SynthesisLayer — Checks if a new tool needs to be synthesized.

Extracted from orchestrator_service.py:113-163.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class SynthesisLayer(Layer):
    """Check whether the user's query requires synthesising a brand-new tool.

    * **Skips when**: ``ctx.agent_id`` is set (existing agent) or
      ``ctx.conversation_id`` is set (follow-up).
    * **Writes**: ``ctx.synthesis_result``
    * **Emits**: ``status`` events describing progress.
    """

    name = "synthesis"

    def should_run(self, ctx: PipelineContext) -> bool:
        # Skip for follow-ups and pre-selected agents.
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings
        from app.prompts import SYNTHESIS_CHECK_SYSTEM_PROMPT, SYNTHESIS_CHECK_USER_PROMPT
        from app.services.tool_registry import get_tool_descriptions, refresh_dynamic_tools
        from app.services.tool_resolver import tool_resolver

        ctx.emit("status", "Checking if new tools are needed…")

        try:
            result = ctx.client.chat.complete(
                model=settings.MISTRAL_CODING_MODEL,
                messages=[
                    {"role": "system", "content": SYNTHESIS_CHECK_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": SYNTHESIS_CHECK_USER_PROMPT.format(
                            tool_descriptions=get_tool_descriptions(),
                            user_query=ctx.query,
                        ),
                    },
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )

            raw = result.choices[0].message.content
            data = json.loads(raw)

            if not data.get("needs_new_tool", False):
                logger.info("No new tools needed for query")
                ctx.synthesis_result = False
                return await next(ctx)

            # Trigger synthesis on Docker Tool Service
            synthesis_result = await tool_resolver.trigger_synthesis(
                name=data.get("tool_name", "unknown"),
                description=data.get("tool_description", ""),
                parameters=data.get("parameters", {}),
                required=data.get("required", []),
            )

            logger.info("Synthesis result: %s", synthesis_result)

            if synthesis_result.get("status") in ("failed", "error"):
                msg = synthesis_result.get("message", "Unknown synthesis error")
                logger.warning("Tool synthesis failed (non-fatal, continuing): %s", msg)
                ctx.synthesis_result = False
                return await next(ctx)

            # Refresh dynamic tools cache
            await refresh_dynamic_tools()
            ctx.synthesis_result = synthesis_result.get("status") == "approved"

        except Exception as e:
            logger.error("Synthesis check failed: %s", e)
            ctx.synthesis_result = False

        return await next(ctx)
