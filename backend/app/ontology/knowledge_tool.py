"""
Attaching the industry-knowledge tool to agents.

The tool is only useful if agents actually carry it, and there are five places
in this codebase that create an agent. Rather than repeat the same list-merge
logic five times — and get it subtly wrong in one of them — the merge lives
here and every creation path calls it.

Attaching is *additive and idempotent*. An agent's ``tools`` array is a mix of
plain strings, built-in type dicts and function specs, so a naive append
produces duplicates that the Mistral API then rejects.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable, Optional

from app.services.tool_registry import INDUSTRY_KNOWLEDGE_TOOL

logger = logging.getLogger(__name__)


def tool_key_present(tool_keys: Iterable[Any]) -> bool:
    """Whether the knowledge tool is already in a list of tool *keys*."""
    for key in tool_keys or []:
        if isinstance(key, str) and key.strip().lower() == INDUSTRY_KNOWLEDGE_TOOL:
            return True
    return False


def with_knowledge_tool(tool_keys: Optional[Iterable[Any]]) -> list[Any]:
    """Return ``tool_keys`` with the knowledge tool appended if absent.

    Takes the *key* form used at creation time, not the resolved spec, because
    every creation path builds its tool array by passing keys to ``get_tools``.
    """
    keys = list(tool_keys or [])
    if not tool_key_present(keys):
        keys.append(INDUSTRY_KNOWLEDGE_TOOL)
    return keys


def spec_present(tools: Iterable[Any]) -> bool:
    """Whether a resolved ``tools`` array already carries the knowledge tool.

    Entries arrive in three shapes — plain strings, ``{"type": "..."}`` for
    built-ins and ``{"type": "function", "function": {...}}`` for functions —
    so all three have to be checked or the backfill re-adds it every run.
    """
    for tool in tools or []:
        if isinstance(tool, str):
            if tool.strip().lower() == INDUSTRY_KNOWLEDGE_TOOL:
                return True
        elif isinstance(tool, dict):
            name = (tool.get("function") or {}).get("name") or tool.get("type")
            if str(name).strip().lower() == INDUSTRY_KNOWLEDGE_TOOL:
                return True
    return False


async def attach_to_agent(client, agent_id: str, existing_tools: list) -> bool:
    """Add the tool to one live agent. Returns True when it wrote something."""
    from functools import partial

    from app.services.tool_registry import ALL_TOOLS

    if spec_present(existing_tools):
        return False

    spec = ALL_TOOLS.get(INDUSTRY_KNOWLEDGE_TOOL)
    if not spec:
        return False

    await asyncio.to_thread(
        partial(
            client.beta.agents.update,
            agent_id=agent_id,
            tools=[*(existing_tools or []), spec],
        )
    )
    return True


async def detach_from_agent(client, agent_id: str, existing_tools: list) -> bool:
    """Remove the knowledge tool from one agent, leaving its others alone."""
    from functools import partial

    if not spec_present(existing_tools):
        return False

    remaining = [
        tool for tool in (existing_tools or [])
        if not spec_present([tool])
    ]
    await asyncio.to_thread(
        partial(client.beta.agents.update, agent_id=agent_id, tools=remaining)
    )
    return True


async def backfill_all_agents(client, page_size: int = 200) -> dict:
    """Reconcile every agent against knowledge coverage.

    Attaching the tool everywhere was the obvious first move and the wrong one:
    for an agent whose industry has no entries, it buys a tool-call round trip
    that returns "nothing matched" and then answers from general knowledge
    anyway — pure latency and tokens. Measurement showed 7 of 13 industries with
    no content at all.

    So this reconciles rather than backfills: attach where a lookup would return
    something, detach where it would not. Both directions are idempotent and it
    runs on every boot, which makes it self-healing — write knowledge for an
    industry and its agents pick the tool up next restart; delete it and they
    give it back.
    """
    from app.ontology import knowledge
    from app.services import agent_service

    summary = {"checked": 0, "attached": 0, "detached": 0, "unchanged": 0, "failed": 0}

    try:
        listing = await agent_service.list_agents(client, page=0, page_size=page_size)
    except Exception as e:
        logger.warning("Knowledge tool sync: could not list agents: %s", e)
        return summary

    for item in listing.get("items", []):
        agent_id = item.get("id")
        if not agent_id:
            continue
        summary["checked"] += 1
        tools = item.get("tools") or []

        try:
            if knowledge.agent_has_coverage(agent_id):
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
            logger.debug("Could not sync knowledge tool on %s: %s", agent_id, e)

    if summary["attached"] or summary["detached"] or summary["failed"]:
        logger.info("Industry knowledge tool sync: %s", summary)
    return summary
