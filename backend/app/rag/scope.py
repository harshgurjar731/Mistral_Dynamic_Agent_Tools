"""
Which libraries a graph lookup may search.

The graph tool has to answer this without being told, for the same reason the
industry-knowledge tool does: the tool-call payload carries no agent identity,
and asking the model to pass its own library ids would make correctness depend
on the prompt.

The answer is already on the agent. An agent that does RAG carries a
``document_library`` tool listing exactly the libraries it searches, so the
graph searches those and no others — the two retrieval paths cannot end up
looking at different documents, which is the failure that would make an answer
citing both incoherent.

Resolution order:

1. ``CURRENT_LIBRARIES``, when a runtime knows better than the agent record —
   a workflow step configured against a specific library, for instance.
2. the calling agent's own ``document_library`` tool.
3. nothing, which searches every library.

The agent lookup is a live API call, so it is cached. Without that, every tool
call on the hot path of every RAG turn would spend a round trip re-reading an
agent definition that changes maybe once a week.
"""

from __future__ import annotations

import logging
import threading
import time
from contextvars import ContextVar
from typing import Optional

logger = logging.getLogger(__name__)

#: Explicit override, set by a runtime that knows the scope directly.
CURRENT_LIBRARIES: ContextVar[Optional[list[str]]] = ContextVar(
    "rag_current_libraries", default=None
)

#: agent_id -> (libraries, fetched_at)
_cache: dict[str, tuple[list[str], float]] = {}
_cache_lock = threading.Lock()
_TTL_SECONDS = 300.0


def library_ids_from_tools(tools) -> list[str]:
    """Pull library ids out of a resolved ``tools`` array.

    Entries arrive as SDK objects from the client and as plain dicts from the
    HTTP layer, so both shapes are read — the same reason the knowledge tool's
    presence check handles three forms.
    """
    ids: list[str] = []
    for tool in tools or []:
        if isinstance(tool, dict):
            kind = tool.get("type")
            values = tool.get("library_ids")
        else:
            kind = getattr(tool, "type", None)
            values = getattr(tool, "library_ids", None)
        if kind != "document_library":
            continue
        for value in values or []:
            text = str(value).strip()
            if text and text not in ids:
                ids.append(text)
    return ids


def invalidate(agent_id: Optional[str] = None) -> None:
    """Drop cached scope after an agent's tools change."""
    with _cache_lock:
        if agent_id:
            _cache.pop(agent_id, None)
        else:
            _cache.clear()


def libraries_for_agent(client, agent_id: Optional[str]) -> list[str]:
    """The libraries this agent searches. Cached, and never fatal."""
    if not agent_id:
        return []

    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(agent_id)
        if cached and (now - cached[1]) < _TTL_SECONDS:
            return list(cached[0])

    try:
        agent = client.beta.agents.get(agent_id=agent_id)
        ids = library_ids_from_tools(getattr(agent, "tools", None))
    except Exception as e:
        logger.debug("Could not read libraries for agent %s: %s", agent_id, e)
        # Cache the empty answer too. A missing agent asked about on every tool
        # call would otherwise re-fail an API round trip each time.
        ids = []

    with _cache_lock:
        _cache[agent_id] = (list(ids), now)
    return ids


def resolve(client, agent_id: Optional[str]) -> list[str]:
    """The scope for a graph lookup, following the order above."""
    override = CURRENT_LIBRARIES.get()
    if override:
        return [lid for lid in override if lid]
    return libraries_for_agent(client, agent_id)
