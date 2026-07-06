"""
PipelineContext — Shared data object that flows through every pipeline layer.

Replaces the scattered dict returns and ad-hoc function parameters in the
original orchestrator_service.py.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core.events import SSEEvent

logger = logging.getLogger(__name__)


@dataclass
class ImageData:
    """Encapsulates optional multimodal image payload."""
    base64: str
    mime: str


@dataclass
class PipelineContext:
    """Mutable bag of state carried through every layer in the pipeline."""

    # ── Input (set once by the route / adapter) ─────────────────────────
    query: str = ""
    agent_id: Optional[str] = None
    conversation_id: Optional[str] = None
    image: Optional[ImageData] = None
    tier: Optional[str] = None
    cleanup_agent: bool = False
    stream: bool = False            # True when invoked via the /stream route

    # ── Accumulated state (layers write here) ───────────────────────────
    agent_config: Optional[dict] = None         # set by AgentResolverLayer
    created_agent_id: Optional[str] = None      # set by AgentResolverLayer
    synthesis_result: Any = None                 # set by SynthesisLayer
    response_text: Optional[str] = None         # set by ExecutionLayer

    # ── Output ──────────────────────────────────────────────────────────
    events: list[SSEEvent] = field(default_factory=list)
    result: dict = field(default_factory=dict)   # final JSON response
    error: Optional[str] = None

    # ── Metadata (extensible bag for custom / future layers) ────────────
    metadata: dict = field(default_factory=dict)

    # ── Mistral client (injected by the adapter) ────────────────────────
    client: Any = None  # Mistral client instance; typed as Any to avoid import

    # ── Real-time streaming queue (set by orchestrate_stream) ───────────
    event_queue: Any = None  # asyncio.Queue; typed as Any to avoid dataclass issues

    # ── Helpers ─────────────────────────────────────────────────────────

    def emit(self, event: str, data: Any) -> None:
        """Append an SSEEvent to the output buffer.

        When ``event_queue`` is set (streaming mode), the event is also
        pushed to the queue so the HTTP response generator can yield it
        in real-time.
        """
        sse = SSEEvent(event=event, data=data)
        self.events.append(sse)
        if self.event_queue is not None:
            self.event_queue.put_nowait(sse)

    def set_error(self, message: str) -> None:
        """Mark the pipeline as failed."""
        self.error = message
        self.emit("error", message)

    def snapshot(self) -> "PipelineContext":
        """Return a shallow copy suitable for parallel layer execution.

        Each parallel layer gets its own events list and metadata dict so they
        can write without races, while still sharing the immutable input fields.
        """
        ctx = copy.copy(self)
        ctx.events = []
        ctx.metadata = dict(self.metadata)
        return ctx

    def merge(self, other: "PipelineContext") -> None:
        """Merge results from a parallel-branch context back into this one.

        Only non-None accumulated-state fields are copied over, and events are
        appended.
        """
        # Merge accumulated state (only overwrite if the other ctx set it)
        if other.agent_config is not None:
            self.agent_config = other.agent_config
        if other.created_agent_id is not None:
            self.created_agent_id = other.created_agent_id
        if other.synthesis_result is not None:
            self.synthesis_result = other.synthesis_result
        if other.response_text is not None:
            self.response_text = other.response_text
        if other.error is not None:
            self.error = other.error

        # Append events and metadata
        self.events.extend(other.events)
        self.metadata.update(other.metadata)
