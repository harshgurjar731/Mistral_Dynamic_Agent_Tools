"""
SSEEvent — Typed SSE event model replacing the scattered _sse() helpers.
"""

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SSEEvent:
    """A single Server-Sent Event with a typed event name and payload."""

    event: str  # "status", "text_chunk", "agent_config", "done", "error", etc.
    data: Any   # str, dict, or any JSON-serializable object

    def serialize(self) -> str:
        """Format as SSE wire format: ``event: <name>\ndata: <payload>\n\n``."""
        if isinstance(self.data, str):
            payload = self.data
        else:
            try:
                payload = json.dumps(self.data)
            except (TypeError, ValueError):
                payload = str(self.data)
        # Multi-line payloads must repeat the ``data:`` prefix on each line.
        payload = payload.replace("\n", "\ndata: ")
        return f"event: {self.event}\ndata: {payload}\n\n"

    # Convenience alias so callers can use str(event) in generators.
    def __str__(self) -> str:
        return self.serialize()
