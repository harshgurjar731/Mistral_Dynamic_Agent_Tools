"""
The knowledge graph — one connected view of the whole platform.

Everything the ontology touches is a node: industries, domains and subdomains
from the vocabulary; capabilities and data classes; and the resources annotated
against them — agents, tools, connectors and workflows. Edges are either
hierarchy (``parent``) or an annotation predicate.

Built server-side rather than assembled in the browser for one reason: the
edges *are* the annotation table, and shipping raw annotations plus four
inventory listings to the client would mean reimplementing the join there —
including the hierarchy walk that decides whether an agent tagged
``domain.lending.mortgage`` belongs under BFSI.

Inventory is fetched best-effort. A graph missing its connectors because the
Connectors API is down is still worth drawing; failing the whole view is not.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable, Optional

from app.ontology import store
from app.ontology.vocab import Predicate, Scheme, SubjectType

logger = logging.getLogger(__name__)

#: Structural edge kinds — what a resource is built from, as opposed to what it
#: is annotated as being about.
COMPOSITION_KINDS = ("uses_agent", "uses_tool", "uses_connector")

#: Which predicates become edges, and what to call them in the UI.
_EDGE_LABELS = {
    Predicate.SERVES_DOMAIN.value: "serves",
    Predicate.HAS_TIER.value: "tier",
    Predicate.REQUIRES_CAPABILITY.value: "requires",
    Predicate.PROVIDES_CAPABILITY.value: "provides",
    Predicate.HANDLES_DATA_CLASS.value: "handles",
    Predicate.EGRESSES_TO.value: "egresses",
}

#: Node kinds the client can filter on. Concept kinds are the *level names* of
#: the domain tree so "industry" and "subdomain" are filterable separately.
NODE_KINDS = (
    "industry", "domain", "subdomain",
    "capability", "data_class", "agent_tier",
    "agent", "tool", "connector", "workflow",
)


def _node(node_id: str, kind: str, label: str, **extra: Any) -> dict:
    return {"id": node_id, "kind": kind, "label": label, **extra}


def _concept_kind(concept: dict) -> str:
    """A concept's node kind, which for domains is its depth."""
    scheme = concept.get("scheme_id")
    if scheme == Scheme.DOMAIN.value:
        return concept.get("level_name") or "domain"
    if scheme == Scheme.CAPABILITY.value:
        return "capability"
    if scheme == Scheme.DATA_CLASS.value:
        return "data_class"
    if scheme == Scheme.AGENT_TIER.value:
        return "agent_tier"
    return "concept"


async def _fetch_inventory(client) -> dict[str, list[dict]]:
    """Agents, tools, connectors and workflows, concurrently and best-effort."""
    from app.services import agent_service, connector_service
    from app.services.tool_resolver import tool_resolver
    from app.services.workflow_engine.engine import list_workflows

    async def _workflows() -> list[dict]:
        return [
            {
                "id": w.name, "name": w.name, "description": w.description or "",
                "steps": len(w.steps), "is_deployed": w.is_deployed, "archived": w.archived,
                # The step list is what makes composition edges possible: which
                # agents a workflow actually calls, and which tools it calls
                # directly. Counting steps alone loses all of that.
                "step_detail": [
                    {"id": s.id, "type": getattr(s.type, "value", str(s.type)), "config": s.config}
                    for s in w.steps
                ],
            }
            for w in await asyncio.to_thread(list_workflows)
        ]

    agents, tools, connectors, workflows = await asyncio.gather(
        agent_service.list_agents(client, page=0, page_size=200),
        tool_resolver.list_tools(),
        connector_service.list_connectors(),
        _workflows(),
        return_exceptions=True,
    )

    def _ok(result, name, extract=lambda r: r):
        if isinstance(result, Exception):
            logger.warning("Graph: could not load %s: %s", name, result)
            return []
        try:
            return extract(result)
        except Exception as e:
            logger.warning("Graph: malformed %s payload: %s", name, e)
            return []

    return {
        "agents": _ok(agents, "agents", lambda r: r.get("items", [])),
        "tools": _ok(tools, "tools"),
        "connectors": _ok(connectors, "connectors", lambda r: r.get("items", [])),
        "workflows": _ok(workflows, "workflows"),
    }


def _subject_nodes(inventory: dict[str, list[dict]]) -> dict[str, dict]:
    """One node per resource, keyed by the id annotations use."""
    nodes: dict[str, dict] = {}

    for agent in inventory["agents"]:
        if agent.get("id"):
            nodes[f"agent:{agent['id']}"] = _node(
                f"agent:{agent['id']}", "agent", agent.get("name") or agent["id"],
                subject_id=agent["id"], subject_type=SubjectType.AGENT.value,
                tier=agent.get("tier"), model=agent.get("model"),
                description=(agent.get("description") or "")[:200],
            )

    for tool in inventory["tools"]:
        name = tool.get("name")
        if name:
            nodes[f"tool:{name}"] = _node(
                f"tool:{name}", "tool", name,
                subject_id=name, subject_type=SubjectType.TOOL.value,
                status=tool.get("status"),
                description=(tool.get("description") or "")[:200],
            )

    for connector in inventory["connectors"]:
        if connector.get("id"):
            nodes[f"connector:{connector['id']}"] = _node(
                f"connector:{connector['id']}", "connector",
                connector.get("name") or connector["id"],
                subject_id=connector["id"], subject_type=SubjectType.CONNECTOR.value,
                description=(connector.get("description") or "")[:200],
            )

    for workflow in inventory["workflows"]:
        nodes[f"workflow:{workflow['id']}"] = _node(
            f"workflow:{workflow['id']}", "workflow", workflow["name"],
            subject_id=workflow["id"], subject_type=SubjectType.WORKFLOW.value,
            steps=workflow.get("steps"), is_deployed=workflow.get("is_deployed"),
            archived=workflow.get("archived"),
            description=(workflow.get("description") or "")[:200],
        )

    return nodes


def _rollup_counts(
    concepts: list[dict], annotations: list[dict], known_subjects: set[str]
) -> dict[str, dict[str, int]]:
    """How many resources sit at or below each concept, by kind.

    This is what lets the taxonomy be shown *without* its resources. Drawing
    every agent and workflow is what made the graph unreadable; a domain that
    says "24 agents, 3 workflows" carries the same information at a fraction of
    the ink, and you drill in when you want the detail.

    Counted over sets, not sums: an agent annotated against both ``lending``
    and ``lending.mortgage`` is one agent, and adding it twice would make a
    domain look busier than it is.
    """
    direct: dict[str, dict[str, set[str]]] = {}
    for annotation in annotations:
        # Only domain membership rolls up. Capability and tier edges are
        # properties of a resource, not a place it lives, so summing them into
        # the tree would double-count everything under several branches.
        if annotation["predicate"] != Predicate.SERVES_DOMAIN.value:
            continue
        key = f"{annotation['subject_type']}:{annotation['subject_id']}"
        if key not in known_subjects:
            continue
        direct.setdefault(annotation["concept_id"], {}).setdefault(
            annotation["subject_type"], set()
        ).add(annotation["subject_id"])

    children: dict[str, list[str]] = {}
    for concept in concepts:
        if concept.get("parent_id"):
            children.setdefault(concept["parent_id"], []).append(concept["id"])

    memo: dict[str, dict[str, set[str]]] = {}

    def walk(concept_id: str, seen: frozenset[str]) -> dict[str, set[str]]:
        if concept_id in memo:
            return memo[concept_id]
        # A cycle is rejected at write time, but a hand-edited row should not
        # blow the stack.
        if concept_id in seen:
            return {}
        accumulated = {k: set(v) for k, v in direct.get(concept_id, {}).items()}
        for child in children.get(concept_id, ()):
            for kind, ids in walk(child, seen | {concept_id}).items():
                accumulated.setdefault(kind, set()).update(ids)
        memo[concept_id] = accumulated
        return accumulated

    for concept in concepts:
        walk(concept["id"], frozenset())

    return {
        concept_id: {kind: len(ids) for kind, ids in kinds.items() if ids}
        for concept_id, kinds in memo.items()
    }


def _agent_tool_names(agent: dict) -> list[str]:
    """Tool keys off an agent's ``tools`` array, which is heterogeneous.

    Entries arrive as plain strings, ``{"type": "web_search"}`` built-ins, or
    ``{"type": "function", "function": {"name": …}}``. Connectors live in the
    same array and are handled separately.
    """
    names: list[str] = []
    for tool in agent.get("tools") or []:
        if isinstance(tool, str):
            names.append(tool)
        elif isinstance(tool, dict):
            if tool.get("type") == "connector":
                continue
            name = (tool.get("function") or {}).get("name") or tool.get("type")
            if name:
                names.append(str(name))
    return names


def _composition_edges(
    inventory: dict[str, list[dict]], nodes: dict[str, dict]
) -> list[dict]:
    """Who uses whom: workflow → agent → tool.

    These are *structural* edges, not annotations. The ontology says what a
    resource is about; this says what it is built from — and that is the chain
    people actually want to trace, because "which workflows break if this tool
    changes" is not answerable from domain tags.

    A workflow step names its agent by id or by human name (the step runner
    resolves either), so both are matched here or half the edges would vanish.
    """
    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    agents_by_id = {a["id"]: a for a in inventory["agents"] if a.get("id")}
    agents_by_name = {
        str(a.get("name", "")).strip().lower(): a
        for a in inventory["agents"]
        if a.get("name")
    }
    tool_names = {t["name"] for t in inventory["tools"] if t.get("name")}

    def add(source: str, target: str, kind: str, label: str) -> None:
        if source not in nodes or target not in nodes:
            return
        key = (source, target, kind)
        if key in seen:
            return
        seen.add(key)
        edges.append({
            "id": f"c:{kind}:{source}->{target}",
            "source": source, "target": target,
            "kind": kind, "label": label, "reveal": "forward",
        })

    # ── Workflow → what its steps call ───────────────────────────────────
    for workflow in inventory["workflows"]:
        workflow_key = f"workflow:{workflow['id']}"
        for step in workflow.get("step_detail") or []:
            config = step.get("config") or {}
            step_type = step.get("type")

            if step_type == "agent":
                reference = str(config.get("agent_id") or "").strip()
                if not reference:
                    continue
                agent = agents_by_id.get(reference) or agents_by_name.get(reference.lower())
                if agent:
                    add(workflow_key, f"agent:{agent['id']}", "uses_agent", "uses")

            elif step_type == "tool":
                name = str(config.get("tool_name") or "").strip()
                if name in tool_names:
                    add(workflow_key, f"tool:{name}", "uses_tool", "calls")

            elif step_type == "connector":
                connector_id = str(config.get("connector_id") or "").strip()
                if connector_id:
                    add(workflow_key, f"connector:{connector_id}", "uses_connector", "calls")

    # ── Agent → its attached tools and connectors ────────────────────────
    for agent in inventory["agents"]:
        if not agent.get("id"):
            continue
        agent_key = f"agent:{agent['id']}"
        for name in _agent_tool_names(agent):
            if name in tool_names:
                add(agent_key, f"tool:{name}", "uses_tool", "has")
        for ref in agent.get("connectors") or []:
            connector_id = ref.get("connector_id") if isinstance(ref, dict) else ref
            if connector_id:
                add(agent_key, f"connector:{connector_id}", "uses_connector", "has")

    return edges


def _prune_to_reachable(
    nodes: dict[str, dict], edges: list[dict], roots: set[str], hops: int = 1
) -> tuple[dict[str, dict], list[dict]]:
    """Keep ``roots`` plus everything within ``hops`` of them, edges undirected.

    Undirected because a filter that kept a matching node but dropped the
    concepts explaining *why* it matched would produce a field of disconnected
    dots — you want the agent, the subdomain it serves, and the industry above.

    Bounded because unbounded reachability is not a filter. Almost every
    resource touches a capability, and every capability touches most resources,
    so following the full connected component from "mortgage" returned 139 of
    202 nodes — the whole graph, minus the parts nothing links to. One hop is
    "this and its immediate context"; two is already most of the graph.
    """
    adjacency: dict[str, set[str]] = {}
    for edge in edges:
        adjacency.setdefault(edge["source"], set()).add(edge["target"])
        adjacency.setdefault(edge["target"], set()).add(edge["source"])

    seen = {r for r in roots if r in nodes}
    frontier = set(seen)
    for _ in range(max(0, hops)):
        nxt: set[str] = set()
        for current in frontier:
            nxt |= {n for n in adjacency.get(current, ()) if n not in seen}
        if not nxt:
            break
        seen |= nxt
        frontier = nxt

    kept_nodes = {nid: n for nid, n in nodes.items() if nid in seen}
    kept_edges = [
        e for e in edges if e["source"] in kept_nodes and e["target"] in kept_nodes
    ]
    return kept_nodes, kept_edges


async def build_graph(
    client,
    kinds: Optional[Iterable[str]] = None,
    scheme: Optional[str] = None,
    root_concept: Optional[str] = None,
    subject_type: Optional[str] = None,
    search: Optional[str] = None,
    include_orphans: bool = True,
    hops: int = 1,
) -> dict:
    """Assemble the whole graph, optionally narrowed.

    ``root_concept`` restricts to one subtree — picking BFSI shows only that
    industry and everything annotated anywhere beneath it. ``search`` keeps
    matching nodes plus whatever they connect to.
    """
    concepts = store.list_concepts(scheme)
    annotations = store.all_annotations()
    inventory = await _fetch_inventory(client)

    # ── Nodes: concepts, then resources ──────────────────────────────────
    nodes: dict[str, dict] = {}
    for concept in concepts:
        nodes[concept["id"]] = _node(
            concept["id"], _concept_kind(concept), concept["label"],
            scheme_id=concept["scheme_id"], parent_id=concept["parent_id"],
            level=concept.get("level", 0),
            definition=concept.get("definition", ""),
            synonyms=concept.get("synonyms", []),
        )

    subject_nodes = _subject_nodes(inventory)
    nodes.update(subject_nodes)

    # Attach roll-ups before any filtering, so a concept still reports what
    # lives beneath it even when those resources are not being drawn.
    rollups = _rollup_counts(concepts, annotations, set(subject_nodes))
    for concept in concepts:
        counts = rollups.get(concept["id"], {})
        node = nodes[concept["id"]]
        node["rollup"] = counts
        node["rollup_total"] = sum(counts.values())

    # ── Edges: hierarchy, then annotations ───────────────────────────────
    edges: list[dict] = []
    for concept in concepts:
        parent = concept.get("parent_id")
        if parent and parent in nodes:
            edges.append({
                "id": f"h:{parent}->{concept['id']}",
                "source": parent, "target": concept["id"],
                "kind": "hierarchy", "label": "",
                # `reveal` tells the client which end is the container, so
                # expanding a node knows what to bring in. Hierarchy and
                # composition point downward; an annotation points from the
                # resource *to* the concept, so the concept reveals it.
                "reveal": "forward",
            })

    for annotation in annotations:
        node_key = f"{annotation['subject_type']}:{annotation['subject_id']}"
        concept_id = annotation["concept_id"]
        # Annotations outlive their subjects — an agent deleted on Mistral
        # leaves its triples behind. Those are dropped rather than drawn as
        # edges to a node that does not exist.
        if node_key not in nodes or concept_id not in nodes:
            continue
        predicate = annotation["predicate"]
        edges.append({
            "id": f"a:{annotation['id']}",
            "source": node_key, "target": concept_id,
            "kind": predicate,
            "label": _EDGE_LABELS.get(predicate, predicate.replace("_", " ")),
            "source_of": annotation["source"],
            # Reversed: the edge runs resource → concept, but it is the concept
            # that contains the resource when you expand it.
            "reveal": "reverse",
        })

    edges.extend(_composition_edges(inventory, nodes))

    # ── Narrowing ────────────────────────────────────────────────────────
    if root_concept:
        # Accepts several ids so a goal that matched more than one domain shows
        # the union. Scoping to only the first would misrepresent what the
        # planner actually sees.
        subtree: set[str] = set()
        for concept_id in str(root_concept).split(","):
            concept_id = concept_id.strip()
            if concept_id:
                subtree |= store.expand([concept_id])

        roots = set(subtree) | {
            e["source"] for e in edges if e["target"] in subtree and e["kind"] != "hierarchy"
        }
        nodes, edges = _prune_to_reachable(nodes, edges, roots, hops)

    if subject_type:
        wanted = {
            nid for nid, n in nodes.items() if n.get("subject_type") == subject_type
        }
        nodes, edges = _prune_to_reachable(nodes, edges, wanted, hops)

    if search:
        needle = search.strip().lower()
        matches = {
            nid for nid, n in nodes.items()
            if needle in n["label"].lower() or needle in nid.lower()
        }
        nodes, edges = _prune_to_reachable(nodes, edges, matches, hops)

    if kinds:
        wanted_kinds = {k for k in kinds if k}
        nodes = {nid: n for nid, n in nodes.items() if n["kind"] in wanted_kinds}
        edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]

    if not include_orphans:
        connected = {e["source"] for e in edges} | {e["target"] for e in edges}
        nodes = {nid: n for nid, n in nodes.items() if nid in connected}

    # Degree drives node size in the UI — a hub should look like one.
    degree: dict[str, int] = {}
    for edge in edges:
        degree[edge["source"]] = degree.get(edge["source"], 0) + 1
        degree[edge["target"]] = degree.get(edge["target"], 0) + 1
    for node_id, node in nodes.items():
        node["degree"] = degree.get(node_id, 0)

    counts_by_kind: dict[str, int] = {}
    for node in nodes.values():
        counts_by_kind[node["kind"]] = counts_by_kind.get(node["kind"], 0) + 1

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "counts": counts_by_kind,
        "totals": {
            "nodes": len(nodes),
            "edges": len(edges),
            "concepts": len(concepts),
            "annotations": len(annotations),
        },
        "kinds": list(NODE_KINDS),
        "predicates": list(_EDGE_LABELS.keys()),
        "composition_kinds": list(COMPOSITION_KINDS),
    }
