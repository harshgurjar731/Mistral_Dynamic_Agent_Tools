"""
Workflow Planner Service — Thin pipeline adapter.

Planning is a chain of single-decision layers under ``app.layers.workflow``,
assembled into ``workflow_pipeline`` in ``app.layers``.

This module is a slim adapter that:
1. Builds a ``PipelineContext`` from the goal string.
2. Runs ``workflow_pipeline.execute(ctx)`` in a background task.
3. Yields SSE events in real-time via an ``asyncio.Queue``.
"""

import asyncio
import logging
from typing import AsyncGenerator

from mistralai.client import Mistral

from app.core.context import PipelineContext
from app.core.events import SSEEvent
from app.layers import workflow_pipeline

logger = logging.getLogger(__name__)


async def plan_workflow_stream(
    client: Mistral,
    goal: str,
) -> AsyncGenerator[str, None]:
    """5-phase async generator that streams SSE events for workflow planning."""
    ctx = PipelineContext(
        query=goal,
        stream=True,
        client=client,
    )

    # Attach a queue so ctx.emit() pushes events in real-time
    queue: asyncio.Queue[SSEEvent | None] = asyncio.Queue()
    ctx.event_queue = queue

    async def _run_pipeline():
        try:
            await workflow_pipeline.execute(ctx)
        except Exception as e:
            logger.error("Workflow planning failed: %s", e)
            ctx.emit("error", str(e))
        finally:
            await queue.put(None)  # sentinel

    # Launch pipeline as a background task
    task = asyncio.create_task(_run_pipeline())

    # Yield events in real-time
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event.serialize()
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
