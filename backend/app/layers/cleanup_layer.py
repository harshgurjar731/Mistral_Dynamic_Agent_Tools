"""
CleanupLayer — Deletes the dynamic agent after execution if requested.

Runs as a post-processing step: it calls ``next(ctx)`` first (so downstream
layers execute), then cleans up in a ``finally`` block.
"""

import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class CleanupLayer(Layer):
    """Delete the dynamically-created agent after the pipeline finishes.

    Only acts when ``ctx.cleanup_agent`` is ``True`` and a
    ``ctx.created_agent_id`` exists.  Always runs — even on errors — by
    wrapping ``next(ctx)`` in ``try/finally``.
    """

    name = "cleanup"

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        try:
            ctx = await next(ctx)
        finally:
            if ctx.cleanup_agent and ctx.created_agent_id:
                try:
                    ctx.client.beta.agents.delete(agent_id=ctx.created_agent_id)
                    logger.info("Cleaned up dynamic agent: %s", ctx.created_agent_id)
                    # Update result to reflect that the agent was deleted
                    if ctx.result and "agent_id" in ctx.result:
                        ctx.result["agent_id"] = None
                    ctx.created_agent_id = None
                except Exception as cleanup_err:
                    logger.warning("Failed to cleanup agent: %s", cleanup_err)
        return ctx
