"""
Backfill — propose annotations for resources that predate the ontology.

Two-stage on purpose. `propose()` writes suggestions to a review file and
touches nothing; `apply_reviewed()` commits a file a human has looked at.

That split is the whole point. Lexical matching over names and instructions
gets most agents right and some confidently wrong, and a wrong annotation does
not fail loudly — it quietly removes an agent from the planner's candidate set
for the requests it should have served. An untagged resource is visible and
harmless; a mis-tagged one is invisible and harmful.

Everything written here is recorded with ``source="inferred"``, so a later pass
can find exactly what was guessed rather than stated.
"""

import json
import logging
from pathlib import Path
from typing import Any

from app.ontology import matcher, store
from app.ontology.vocab import Predicate, Scheme, SubjectType, coerce_tier

logger = logging.getLogger(__name__)

REVIEW_PATH = Path(__file__).parent / "seed" / "backfill_review.json"

# Capability hints. Deliberately coarse — capability is the vocabulary most
# likely to be wrong when guessed, so this proposes only what a name states
# outright and leaves everything else for a human.
_CAPABILITY_HINTS: dict[str, tuple[str, ...]] = {
    "capability.governance": (
        "moderation", "moderator", "guardrail", "jailbreak", "safety",
        "review", "reviewer", "compliance",
    ),
    "capability.reasoning.extraction": ("extract", "extractor", "parse", "parser"),
    "capability.reasoning.assessment": (
        "assess", "assessor", "eligibility", "risk", "score", "scoring",
        "decision", "approval", "underwrit",
    ),
    "capability.reasoning.summarisation": (
        "summar", "draft", "drafter", "generator", "writer", "compose",
    ),
    "capability.retrieval": ("search", "retrieval", "lookup", "research", "library"),
    "capability.computation": ("calculat", "compute", "transform", "sql", "query"),
}


def _text_of(agent: dict) -> str:
    return " ".join(
        str(agent.get(key) or "") for key in ("name", "description", "instructions")
    )


def _propose_domains(text: str) -> list[str]:
    """Domains a resource plausibly serves, best match first."""
    return _rank_domains(matcher.score_concepts(text, Scheme.DOMAIN.value))[:2]


def _rank_domains(scored: list[tuple[str, float]]) -> list[str]:
    """Order candidate domains, breaking score ties by specificity.

    Ties are the common case, not the exception: most matches score exactly 1.0
    because they hit a single-word synonym. Sorting those alphabetically —
    which is what falling back to the id did — picked ``domain.compliance``
    over ``domain.lending.mortgage`` for a mortgage workflow.

    A deeper concept is a more specific claim, and a more specific claim that
    matched is better evidence than a generic one that also matched.
    """
    if not scored:
        return []

    levels = {c["id"]: c.get("level", 0) for c in store.list_concepts(Scheme.DOMAIN.value)}
    ranked = sorted(
        ((cid, score) for cid, score in scored if score >= 1.0),
        key=lambda pair: (-pair[1], -levels.get(pair[0], 0), pair[0]),
    )
    return [cid for cid, _ in ranked]


def propose_domains_for(name: str, body: str = "") -> list[str]:
    """Domains for a named resource, trusting its name over its body text.

    A name is written to say what the thing is; its instructions are written to
    tell a model how to behave, and are full of incidental vocabulary — an
    "application" in a mortgage workflow matched education admissions. So the
    name is scored on its own first, and the body is only consulted when the
    name says nothing.
    """
    from_name = _rank_domains(matcher.score_concepts(name, Scheme.DOMAIN.value))
    if from_name:
        return from_name[:2]
    return _rank_domains(matcher.score_concepts(body, Scheme.DOMAIN.value))[:2]


#: Capabilities an agent can only obtain from something attached to it.
#:
#: The distinction is what makes `requires_capability` meaningful. Governance
#: and reasoning describe what an agent *is* — a moderator does moderation, it
#: does not need a moderation tool. Only these need an external provider, so
#: only these are ever proposed as requirements. Without this split the
#: backfill tagged every agent whose instructions said "review" as requiring
#: Governance, and the validator then reported a capability gap on all of them.
_EXTERNALLY_PROVIDED = (
    "capability.retrieval",
    "capability.integration",
    "capability.computation",
)


def _propose_capabilities(text: str) -> list[str]:
    lowered = text.lower()
    return [
        concept_id
        for concept_id, hints in _CAPABILITY_HINTS.items()
        if any(hint in lowered for hint in hints)
    ]


def _split_capabilities(capabilities: list[str]) -> tuple[list[str], list[str]]:
    """Partition into (requires, provides).

    Anything an agent cannot get from outside is something it supplies itself,
    so it is recorded as provided rather than required.
    """
    requires = [c for c in capabilities if c.startswith(_EXTERNALLY_PROVIDED)]
    provides = [c for c in capabilities if c not in requires]
    return requires, provides


def propose_for_agents(agents: list[dict]) -> list[dict]:
    """Suggest tier, domains and capabilities for each agent."""
    proposals = []
    for agent in agents:
        agent_id = agent.get("id")
        if not agent_id:
            continue
        text = _text_of(agent)
        domains = _propose_domains(text)
        requires, provides = _split_capabilities(_propose_capabilities(text))

        proposals.append({
            "subject_type": SubjectType.AGENT.value,
            "subject_id": agent_id,
            "name": agent.get("name", ""),
            "confidence": "high" if domains else "low",
            "annotations": {
                # Tier comes from whatever the agent already reports, which is
                # metadata when set and the keyword heuristic otherwise.
                Predicate.HAS_TIER.value: [f"agent_tier.{coerce_tier(agent.get('tier'))}"],
                Predicate.SERVES_DOMAIN.value: domains,
                Predicate.REQUIRES_CAPABILITY.value: requires,
                Predicate.PROVIDES_CAPABILITY.value: provides,
            },
        })
    return proposals


def propose_for_connectors(connectors: list[dict]) -> list[dict]:
    """Connectors provide capabilities and, when third-party, egress.

    Every connector reaches a system this platform does not control, so all of
    them get `integration.read`. Write access is not guessed — it depends on
    which tools the connector actually exposes, and over-claiming it would
    weaken the confirmation rules built on top.
    """
    proposals = []
    for connector in connectors:
        connector_id = connector.get("id")
        if not connector_id:
            continue
        text = " ".join(str(connector.get(k) or "") for k in ("name", "description"))

        annotations: dict[str, list[str]] = {
            Predicate.PROVIDES_CAPABILITY.value: ["capability.integration.read"],
            Predicate.SERVES_DOMAIN.value: _propose_domains(text),
        }
        # Directory connectors front third-party SaaS by definition; a
        # self-hosted MCP server may not, so it is not assumed.
        if connector.get("is_directory"):
            annotations[Predicate.EGRESSES_TO.value] = ["data_class.internal"]

        proposals.append({
            "subject_type": SubjectType.CONNECTOR.value,
            "subject_id": connector_id,
            "name": connector.get("name", ""),
            "confidence": "high",
            "annotations": annotations,
        })
    return proposals


def propose_for_tools(tools: list[dict]) -> list[dict]:
    proposals = []
    for tool in tools:
        name = tool.get("name")
        if not name:
            continue
        text = f"{name} {tool.get('description') or ''}"
        caps = _propose_capabilities(text) or ["capability.computation"]
        proposals.append({
            "subject_type": SubjectType.TOOL.value,
            "subject_id": name,
            "name": name,
            "confidence": "medium",
            "annotations": {Predicate.PROVIDES_CAPABILITY.value: caps},
        })
    return proposals


def write_review(proposals: list[dict], path: Path | None = None) -> Path:
    """Write proposals to a review file. Nothing is committed to the store."""
    target = path or REVIEW_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "note": (
            "Review before applying. Delete or correct any wrong entry, then run "
            "apply_reviewed(). Entries with confidence 'low' matched no domain and "
            "are the ones most worth checking."
        ),
        "count": len(proposals),
        "proposals": proposals,
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Wrote %d annotation proposals to %s", len(proposals), target)
    return target


def apply_reviewed(path: Path | None = None, source: str = "inferred") -> dict:
    """Commit a reviewed proposal file to the concept store."""
    target = path or REVIEW_PATH
    summary = {"subjects": 0, "annotations": 0, "skipped": 0}

    if not target.exists():
        logger.warning("No review file at %s — run propose first", target)
        return summary

    payload = json.loads(target.read_text(encoding="utf-8"))
    known = {c["id"] for c in store.list_concepts()}

    for proposal in payload.get("proposals", []):
        subject_type = proposal.get("subject_type")
        subject_id = proposal.get("subject_id")
        if not (subject_type and subject_id):
            continue

        wrote_any = False
        for predicate, concept_ids in (proposal.get("annotations") or {}).items():
            # A concept id that is not in the store is a typo or a stale
            # vocabulary; writing it would create an annotation nothing can
            # ever match.
            valid = [c for c in concept_ids if c in known]
            summary["skipped"] += len(concept_ids) - len(valid)
            if not valid:
                continue
            store.set_annotations(subject_type, subject_id, predicate, valid, source=source)
            summary["annotations"] += len(valid)
            wrote_any = True

        if wrote_any:
            summary["subjects"] += 1

    logger.info("Backfill applied: %s", summary)
    return summary
