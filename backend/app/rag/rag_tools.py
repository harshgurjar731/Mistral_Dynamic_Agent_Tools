"""
Attaching the graph tool to agents.

The rule is one sentence: **the graph tool rides with the document library.**
An agent that searches a library should also be able to traverse the graph
built from that library, and an agent with no library has nothing to traverse.
That keeps "is this a RAG agent" a property of what the agent already carries
rather than a flag someone has to remember to set.

Five places in this codebase create an agent, so the merge lives here and every
creation path calls it — the same reason ``knowledge_tool`` exists. Attaching is
additive and idempotent: an agent's ``tools`` array mixes plain strings, built-in
type dicts and function specs, and a naive append produces duplicates the
Mistral API rejects.

The reconcile at boot goes both ways, like the knowledge tool's. Attaching
everywhere was the obvious first move and the wrong one: an agent whose
libraries hold no graph pays a tool-call round trip to be told nothing matched,
then answers from the library anyway. So the tool is attached where a lookup
would return something and removed where it would not, which makes the whole
thing self-healing — graph a library and its agents pick the tool up on the next
restart, delete that graph and they give it back.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable, Optional

from app.services.tool_registry import KNOWLEDGE_GRAPH_TOOL

logger = logging.getLogger(__name__)

_DOCUMENT_LIBRARY = "document_library"


def _key_matches(key: Any, name: str) -> bool:
    """Whether a tool *key* names this tool.

    Library keys arrive in two forms — the bare ``document_library`` and the
    encoded ``document_library:id1,id2`` that ``get_tools`` also accepts — so a
    plain equality check would miss half of them and re-append a duplicate.
    """
    if not isinstance(key, str):
        return False
    cleaned = key.strip().lower()
    return cleaned == name or cleaned.startswith(f"{name}:")


def tool_key_present(tool_keys: Iterable[Any], name: str = KNOWLEDGE_GRAPH_TOOL) -> bool:
    return any(_key_matches(key, name) for key in tool_keys or [])


def with_rag_tools(
    tool_keys: Optional[Iterable[Any]],
    library_ids: Optional[Iterable[str]] = None,
) -> list[Any]:
    """Return ``tool_keys`` with the RAG pair completed.

    Does nothing to an agent that has no library and is not being given one:
    the graph tool alone would search a graph the agent has no documents in,
    which is worse than not having it.
    """
    keys = list(tool_keys or [])
    ids = [lid for lid in (library_ids or []) if lid]

    has_library = tool_key_present(keys, _DOCUMENT_LIBRARY) or bool(ids)
    if not has_library:
        return keys

    if ids and not tool_key_present(keys, _DOCUMENT_LIBRARY):
        keys.append(_DOCUMENT_LIBRARY)
    if not tool_key_present(keys, KNOWLEDGE_GRAPH_TOOL):
        keys.append(KNOWLEDGE_GRAPH_TOOL)
    return keys


def spec_present(tools: Iterable[Any], name: str = KNOWLEDGE_GRAPH_TOOL) -> bool:
    """Whether a resolved ``tools`` array already carries this tool.

    Entries arrive in three shapes — plain strings, ``{"type": ...}`` for
    built-ins and ``{"type": "function", "function": {...}}`` for functions —
    plus SDK objects from the client, so all four are checked or the reconcile
    re-adds the tool on every run.
    """
    for tool in tools or []:
        if isinstance(tool, str):
            if _key_matches(tool, name):
                return True
        elif isinstance(tool, dict):
            candidate = (tool.get("function") or {}).get("name") or tool.get("type")
            if _key_matches(str(candidate), name):
                return True
        else:
            function = getattr(tool, "function", None)
            candidate = getattr(function, "name", None) or getattr(tool, "type", None)
            if candidate and _key_matches(str(candidate), name):
                return True
    return False


def library_ids_of(tools: Iterable[Any]) -> list[str]:
    """The libraries a resolved ``tools`` array searches."""
    from app.rag.scope import library_ids_from_tools

    return library_ids_from_tools(tools)


def agent_has_coverage(tools: Iterable[Any]) -> bool:
    """Whether the graph tool would return anything for this agent.

    Two conditions, both necessary: the agent must search at least one library,
    and at least one of those libraries must actually hold a graph.
    """
    from app.rag import graph_store

    ids = library_ids_of(tools)
    return bool(ids) and graph_store.has_coverage(ids)


async def attach_to_agent(client, agent_id: str, existing_tools: list) -> bool:
    """Add the graph tool to one live agent. Returns True when it wrote."""
    from functools import partial

    from app.services.tool_registry import ALL_TOOLS

    if spec_present(existing_tools):
        return False

    spec = ALL_TOOLS.get(KNOWLEDGE_GRAPH_TOOL)
    if not spec:
        return False

    await asyncio.to_thread(
        partial(
            client.beta.agents.update,
            agent_id=agent_id,
            tools=[*(existing_tools or []), spec],
        )
    )
    _invalidate(agent_id)
    return True


async def detach_from_agent(client, agent_id: str, existing_tools: list) -> bool:
    """Remove the graph tool from one agent, leaving its others alone."""
    from functools import partial

    if not spec_present(existing_tools):
        return False

    remaining = [tool for tool in (existing_tools or []) if not spec_present([tool])]
    await asyncio.to_thread(
        partial(client.beta.agents.update, agent_id=agent_id, tools=remaining)
    )
    _invalidate(agent_id)
    return True


def _invalidate(agent_id: str) -> None:
    """Drop this agent's cached library scope after its tools change."""
    try:
        from app.rag import scope

        scope.invalidate(agent_id)
    except Exception:
        pass


async def backfill_rag_tool(client, page_size: int = 200) -> dict:
    """Reconcile every agent against graph coverage. Idempotent, both ways."""
    from app.rag import graph_store
    from app.services import agent_service

    summary = {"checked": 0, "attached": 0, "detached": 0, "unchanged": 0, "failed": 0}

    if not graph_store.available():
        # Without a graph, coverage is false for everyone and the reconcile
        # would strip the tool off every agent — then put it back on the next
        # boot. Doing nothing is the correct response to "the graph is down".
        summary["skipped"] = "knowledge graph unavailable"
        return summary

    try:
        listing = await agent_service.list_agents(client, page=0, page_size=page_size)
    except Exception as e:
        logger.warning("RAG tool sync: could not list agents: %s", e)
        return summary

    for item in listing.get("items", []):
        agent_id = item.get("id")
        if not agent_id:
            continue
        summary["checked"] += 1
        tools = item.get("tools") or []

        try:
            if agent_has_coverage(tools):
                if await attach_to_agent(client, agent_id, tools):
                    summary["attached"] += 1
                else:
                    summary["unchanged"] += 1
            else:
                if await detach_from_agent(client, agent_id, tools):
                    summary["detached"] += 1
                else:
                    summary["unchanged"] += 1
        except Exception as e:
            summary["failed"] += 1
            logger.debug("Could not sync graph tool on %s: %s", agent_id, e)

    if summary["attached"] or summary["detached"] or summary["failed"]:
        logger.info("Knowledge graph tool sync: %s", summary)
    return summary
