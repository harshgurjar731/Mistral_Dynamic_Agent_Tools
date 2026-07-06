"""
Orchestrator Service — Thin pipeline adapter.

All business logic has been extracted into pluggable layers under
``app.layers``.  This module is now a slim adapter that:

1. Builds a ``PipelineContext`` from the request parameters.
2. Calls ``chat_pipeline.execute(ctx)``.
3. Returns ``ctx.result`` (JSON mode) or yields SSE events in real-time
   via an ``asyncio.Queue`` (streaming mode).

To add a new feature, create a Layer and register it in
``app/layers/__init__.py`` — no changes to this file needed.
"""

import asyncio
import logging
from typing import Optional, AsyncGenerator

from mistralai.client import Mistral

from app.core.context import PipelineContext, ImageData
from app.core.events import SSEEvent
from app.exceptions import MistralAPIError
from app.layers import chat_pipeline

logger = logging.getLogger(__name__)


def _build_context(
    client: Mistral,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    cleanup_agent: bool = False,
    tier: Optional[str] = None,
    image_base64: Optional[str] = None,
    image_mime: Optional[str] = None,
    stream: bool = False,
) -> PipelineContext:
    """Translate route parameters into a PipelineContext."""
    image = None
    if image_base64 and image_mime:
        image = ImageData(base64=image_base64, mime=image_mime)

    return PipelineContext(
        query=query,
        agent_id=agent_id,
        conversation_id=conversation_id,
        cleanup_agent=cleanup_agent,
        tier=tier,
        image=image,
        stream=stream,
        client=client,
    )


# ── JSON mode ───────────────────────────────────────────────────────────────

async def orchestrate(
    client: Mistral,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    cleanup_agent: bool = False,
    tier: Optional[str] = None,
    image_base64: Optional[str] = None,
    image_mime: Optional[str] = None,
) -> dict:
    """Main orchestration flow — returns a JSON dict."""
    ctx = _build_context(
        client, query,
        agent_id=agent_id,
        conversation_id=conversation_id,
        cleanup_agent=cleanup_agent,
        tier=tier,
        image_base64=image_base64,
        image_mime=image_mime,
        stream=False,
    )

    try:
        ctx = await chat_pipeline.execute(ctx)
    except MistralAPIError:
        raise
    except Exception as e:
        logger.error("Orchestration failed: %s", e)
        raise MistralAPIError(f"Orchestration failed: {str(e)}")

    if ctx.error:
        raise MistralAPIError(ctx.error)

    return ctx.result


# ── SSE streaming mode ──────────────────────────────────────────────────────

async def orchestrate_stream(
    client: Mistral,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    cleanup_agent: bool = False,
    tier: Optional[str] = None,
    image_base64: Optional[str] = None,
    image_mime: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming orchestration — yields SSE-formatted strings in real-time.

    The pipeline runs in a background task that pushes events to an
    ``asyncio.Queue``.  This generator pulls from the queue and yields
    each event as soon as it arrives, so the frontend sees live progress.
    """
    ctx = _build_context(
        client, query,
        agent_id=agent_id,
        conversation_id=conversation_id,
        cleanup_agent=cleanup_agent,
        tier=tier,
        image_base64=image_base64,
        image_mime=image_mime,
        stream=True,
    )

    # Attach a queue so ctx.emit() pushes events in real-time
    queue: asyncio.Queue[SSEEvent | None] = asyncio.Queue()
    ctx.event_queue = queue

    async def _run_pipeline():
        """Execute the pipeline in the background, push sentinel when done."""
        try:
            await chat_pipeline.execute(ctx)
        except Exception as e:
            logger.error("Stream orchestration failed: %s", e)
            ctx.emit("error", str(e))
        finally:
            await queue.put(None)  # sentinel to signal completion

    # Launch pipeline as a background task
    task = asyncio.create_task(_run_pipeline())

    # Yield events in real-time as they arrive
    try:
        while True:
            event = await queue.get()
            if event is None:
                break  # pipeline finished
            yield event.serialize()
    finally:
        # Ensure the task is cleaned up if the client disconnects
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
