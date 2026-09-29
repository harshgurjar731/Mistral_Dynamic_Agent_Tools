"""
Delete rules — what a delete is refused over, what it detaches, and what it
takes out of the knowledge graph.

The rules, per thing deleted:

    agent     deleted alone. Its tools are not deleted — they are only
              detached, which deleting the agent does by itself.
    tool      detached from every agent that uses it, then deleted.
    activity  refused while any workflow step uses it (archived workflows
              included: they can be restored). The same holds for an agent
              tool used directly as a workflow step — the step could not run.
    workflow  deleted alone; its agents, tools and activities stay.
    library   refused while any agent has it attached.

Cascading deletion applies only to graph entities. Every delete removes the
item's presence from the knowledge graph — its annotations, which are the
graph's edges, and its Neo4j nodes — and deleting a concept or scheme takes
its descendant concepts and their annotations with it. Nothing else cascades:
no delete removes another agent, tool, activity, workflow or library.
"""

from __future__ import annotations

import logging
from typing import Iterable

logger = logging.getLogger(__name__)


class InUse(Exception):
    """The delete is refused because other things still use the item."""

    def __init__(self, message: str, users: list[dict]):
        super().__init__(message)
        self.users = users


def _names(items: list[dict], key: str = "name", limit: int = 6) -> str:
    shown = [str(i.get(key) or i.get("id")) for i in items[:limit]]
    more = len(items) - len(shown)
    return ", ".join(shown) + (f" and {more} more" if more > 0 else "")


# ── Who uses what ─────────────────────────────────────────────────────────


def _all_agents_raw(page_size: int = 100, max_pages: int = 50) -> list[dict]:
    """Every agent with its raw ``tools`` array (tools, libraries and connectors)."""
    from app.services.agent_service import _http_client

    agents: list[dict] = []
    for page in range(max_pages):
        resp = _http_client.get("/v1/agents", params={"page": page, "page_size": page_size})
        resp.raise_for_status()
        data = resp.json()
        batch = data if isinstance(data, list) else data.get("data", [])
        agents.extend(a for a in batch if isinstance(a, dict))
        if len(batch) < page_size:
            break
    return agents


def _function_names(tools) -> set[str]:
    names: set[str] = set()
    for tool in tools or []:
        if isinstance(tool, str):
            names.add(tool)
        elif isinstance(tool, dict) and tool.get("type") == "function":
            name = (tool.get("function") or {}).get("name")
            if name:
                names.add(name)
    return names


def _library_ids(tools) -> set[str]:
    ids: set[str] = set()
    for tool in tools or []:
        if isinstance(tool, dict) and tool.get("type") == "document_library":
            ids.update(str(i) for i in tool.get("library_ids") or [])
    return ids


def agents_using_tool(tool_name: str) -> list[dict]:
    return [
        {"id": a.get("id"), "name": a.get("name") or a.get("id")}
        for a in _all_agents_raw() if tool_name in _function_names(a.get("tools"))
    ]


def agents_using_library(library_id: str) -> list[dict]:
    return [
        {"id": a.get("id"), "name": a.get("name") or a.get("id")}
        for a in _all_agents_raw() if library_id in _library_ids(a.get("tools"))
    ]


def workflows_using_tool(tool_name: str) -> list[dict]:
    """Workflows with a step that runs ``tool_name``, archived ones included."""
    from app.services.workflow_engine.engine import list_workflows

    users = []
    for workflow in list_workflows():
        steps = [
            s.id for s in workflow.steps
            if (s.config or {}).get("tool_name") == tool_name
        ]
        if steps:
            users.append({"name": workflow.name, "archived": bool(workflow.archived),
                          "steps": steps})
    return users


# ── Rules ─────────────────────────────────────────────────────────────────


def check_tool_deletable(tool_name: str, purpose: str) -> None:
    """Raise :class:`InUse` when workflows still run the tool as a step."""
    users = workflows_using_tool(tool_name)
    if users:
        noun = "activity" if purpose == "activity" else "tool"
        raise InUse(
            f"The {noun} '{tool_name}' is used by {len(users)} workflow(s): "
            f"{_names(users)}. Remove it from those workflows (or delete them) first.",
            users,
        )


def check_library_deletable(library_id: str, library_name: str = "") -> None:
    """Raise :class:`InUse` when any agent has the library attached."""
    users = agents_using_library(library_id)
    if users:
        raise InUse(
            f"The library '{library_name or library_id}' is attached to {len(users)} "
            f"agent(s): {_names(users)}. Detach it from those agents first.",
            users,
        )


async def detach_tool_from_agents(client, tool_name: str) -> list[dict]:
    """Remove ``tool_name`` from every agent that has it. Returns the agents changed.

    The agent's libraries and connectors are carried over unchanged; only the
    one tool is dropped.
    """
    from app.services import agent_service

    detached = []
    for agent in agents_using_tool(tool_name):
        current = agent_service.current_attachments(agent["id"])
        remaining = [key for key in current["tools"] if key != tool_name]
        try:
            await agent_service.update_agent(client, agent["id"], {"tools": remaining},
                                             skip_rules=True)
            detached.append(agent)
        except Exception as e:  # noqa: BLE001 — reported, and the delete is refused
            raise RuntimeError(
                f"Could not detach '{tool_name}' from agent '{agent['name']}': {e}"
            ) from e
    return detached


# ── Graph ─────────────────────────────────────────────────────────────────


def forget_in_graph(subject_type: str, subject_id: str) -> dict:
    """Remove a deleted item's edges from the knowledge graph.

    The graph's edges are the annotation table. The graph view already hides
    annotations whose subject is gone, but they still count in domain
    roll-ups and are read by classification and scoping — so they are
    deleted, not just hidden.
    """
    try:
        from app.ontology import store as ontology_store

        return {"annotations_removed":
                ontology_store.delete_subject_annotations(subject_type, subject_id)["removed"]}
    except Exception as e:  # noqa: BLE001 — the item itself is already deleted
        logger.warning("Graph cleanup for %s '%s' failed: %s", subject_type, subject_id, e)
        return {"annotations_removed": 0, "error": str(e)}


def forget_concepts_in_neo4j(concept_ids: Iterable[str]) -> dict:
    """Drop deleted concepts from the Neo4j taxonomy mirror."""
    ids = [c for c in concept_ids if c]
    if not ids:
        return {"concept_nodes_removed": 0}
    try:
        from app.rag import graph_store

        if not graph_store.available():
            return {"concept_nodes_removed": 0, "reason": "graph unavailable"}
        rows = graph_store._run(
            "MATCH (c:Concept) WHERE c.id IN $ids DETACH DELETE c RETURN count(c) AS removed",
            ids=ids,
        )
        return {"concept_nodes_removed": rows[0]["removed"] if rows else 0}
    except Exception as e:  # noqa: BLE001
        logger.warning("Neo4j concept cleanup failed: %s", e)
        return {"concept_nodes_removed": 0, "error": str(e)}


def forget_library_document_in_graph(library_id: str, mistral_doc_id: str) -> dict:
    """A document deleted from a library: its graph slice and local tracking row."""
    try:
        from app.rag import graph_store, store as rag_store

        graph = graph_store.delete_document_graph(mistral_doc_id, library_id)
        rows = [d for d in rag_store.list_documents(library_id)
                if str(d.get("mistral_doc_id")) == str(mistral_doc_id)]
        for row in rows:
            rag_store.delete_document(row["id"])
        return {"graph": graph, "rag_rows_removed": len(rows)}
    except Exception as e:  # noqa: BLE001
        logger.warning("Graph cleanup for document %s failed: %s", mistral_doc_id, e)
        return {"error": str(e)}
