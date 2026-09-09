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
from app.core.specs import AgentSpec, RequirementSpec, WorkflowSpec

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
    # Flattened view of ``agent_spec``, published by AgentAssemblyLayer. Kept
    # because the routes, the SSE payloads and the ontology autotagger were all
    # written against this shape.
    agent_config: Optional[dict] = None         # set by AgentAssemblyLayer
    created_agent_id: Optional[str] = None      # set by AgentAssemblyLayer
    synthesis_result: Any = None                # set by CapabilityGapLayer
    response_text: Optional[str] = None         # set by ExecutionLayer

    # ── Decision specs (one field group per decision layer) ─────────────
    # ``requirements`` is decided first and read by every layer after it;
    # ``agent_spec`` accumulates one facet per layer, including across the
    # concurrent branches of the facet ParallelGroup.
    requirements: Optional[RequirementSpec] = None
    agent_spec: AgentSpec = field(default_factory=AgentSpec)
    workflow_spec: Optional[WorkflowSpec] = None

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

    def set_layer_summary(self, name: str, text: str) -> None:
        """Record a layer's own account of what it decided.

        Read back when the layer settles and shown under its timeline row, so a
        user watching a run sees the reasoning rather than only a tick.
        """
        if text:
            self.metadata.setdefault("_layer_summaries", {})[name] = text

    def layer_summary(self, name: str) -> str:
        return (self.metadata.get("_layer_summaries") or {}).get(name, "")

    def emit_layer(
        self,
        name: str,
        state: str,
        *,
        ms: Optional[float] = None,
        summary: str = "",
        error: str = "",
    ) -> None:
        """Announce a layer's state change to the UI.

        The pipeline is a known, ordered chain, so the client is sent the whole
        manifest up front and then told as each layer moves through
        ``active`` → ``completed`` / ``skipped`` / ``failed``. That lets the
        timeline show what is still to come, which a stream of free-text status
        strings never could.

        ``summary`` carries the layer's own one-line account of what it decided
        — the reason shown under a completed row.
        """
        payload: dict = {"name": name, "state": state}
        if ms is not None:
            payload["ms"] = round(ms)
        if summary:
            payload["summary"] = summary
        if error:
            payload["error"] = error
        self.emit("layer", payload)

    def set_error(self, message: str) -> None:
        """Mark the pipeline as failed."""
        self.error = message
        self.emit("error", message)

    def snapshot(self) -> "PipelineContext":
        """Return a shallow copy suitable for parallel layer execution.

        Each parallel layer gets its own events list, metadata dict and
        ``agent_spec`` so they can write without races, while still sharing the
        immutable input fields.

        ``agent_spec`` is deep-copied rather than shared: ``copy.copy`` is
        shallow, so without this every concurrent facet layer would be mutating
        one object and ``merge`` would have nothing left to do. Branches are
        meant to decide independently and be reconciled afterwards.
        """
        ctx = copy.copy(self)
        ctx.events = []
        ctx.metadata = dict(self.metadata)
        ctx.agent_spec = self.agent_spec.copy()
        return ctx

    def merge(self, other: "PipelineContext") -> None:
        """Merge results from a parallel-branch context back into this one.

        Only non-None accumulated-state fields are copied over, and events are
        appended.
        """
        # Fold in whichever facets this branch decided. Only fields the branch
        # actually set are copied, so concurrent facet layers cannot blank out
        # each other's work.
        if other.agent_spec is not None:
            self.agent_spec.merge_from(other.agent_spec)
        if other.requirements is not None:
            self.requirements = other.requirements
        if other.workflow_spec is not None:
            self.workflow_spec = other.workflow_spec

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
