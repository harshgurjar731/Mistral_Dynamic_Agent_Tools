"""
Tagging — one entry point for filing a resource under the catalog.

Three modes, cheapest first:

* **fast** — keyword heuristics, run on every creation path
  (``annotate_agent`` / ``annotate_workflow``). Free, and never raises.
* **accurate** — a model chooses from the actual vocabulary
  (``classify`` / ``classify_and_apply``). Used where a person is waiting
  anyway: manual creation, document upload, import.
* **bulk** — propose tags for resources that predate the catalog, write them to
  a review file, and apply only what a person has looked at
  (``propose_for_*`` / ``write_review`` / ``apply_reviewed``).

``tag()`` dispatches agents and workflows to fast or accurate. Process
documents are placed on a node by ``place_document``.

Provenance is recorded on every tag: ``inferred`` (keywords), ``llm``
(accurate) and ``user`` (stated). A human-stated tag is never overwritten.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from app.catalog import match as matcher, store
from app.catalog.vocab import (
    SYSTEM_DOMAIN,
    Predicate,
    Scheme,
    SubjectType,
    coerce_tier,
    domains_for_tier,
)

logger = logging.getLogger(__name__)

# ══ Fast: tag at creation ═════════════════════════════════════════════════════

#: Provenances that a guess must not overwrite.
#:
#: ``set_annotations`` replaces rather than merges, so re-tagging an agent
#: someone has already corrected in the Annotations tab would silently undo
#: their work — and demote a publish-blocking error back to a warning.
_PROTECTED_SOURCES = frozenset({"user", "seed"})


def _is_protected(
    subject_id: str, predicate: str, subject_type: str = SubjectType.AGENT.value
) -> bool:
    """True when a human (or the seed) has already spoken for this predicate."""
    try:
        sources = store.annotation_sources(subject_type, subject_id, predicate)
    except Exception:
        # Unreadable store — treat as protected. Declining to write is always
        # safer than overwriting something that might have been confirmed.
        return True
    return any(source in _PROTECTED_SOURCES for source in sources.values())


def _domains_for(tier: str, goal: Optional[str], name: str, body: str) -> list[str]:
    """Which domains to record.

    Foundation agents are domain-agnostic *by definition* — the tier exists for
    safety and quality gates that apply to every domain — so pinning one to an
    industry would be wrong even when the text of the request it was created
    for matches one strongly. They go under `domain.system` instead, which is a
    sibling of the industries rather than one of them: the claim being recorded
    is "belongs to no industry", not "belongs to industry X".

    For the other tiers the originating goal is the better signal when there is
    one: an agent generated for "assess a residential mortgage application"
    belongs to mortgage regardless of how its instructions happen to be worded.
    """
    fixed = domains_for_tier(tier)
    if fixed is not None:
        return fixed

    if goal:
        from_goal = matcher.match_domains(goal, limit=2)
        if from_goal:
            return from_goal

    return propose_domains_for(name, body)


def annotate_agent(
    agent_id: str,
    *,
    name: str = "",
    description: str = "",
    instructions: str = "",
    tier: Optional[str] = None,
    goal: Optional[str] = None,
    source: str = "inferred",
) -> dict:
    """Tag a freshly created agent. Best effort — never raises.

    ``goal`` is the request the agent was generated for, when the caller has
    one; it is a stronger domain signal than the generated instructions.

    Returns a summary of what was written, for logging.
    """
    written: dict[str, list[str]] = {}
    if not agent_id:
        return written

    try:
        if not store.is_seeded():
            return written

        resolved_tier = coerce_tier(tier)
        text = " ".join(part for part in (name, description, instructions) if part)

        requires, provides = _split_capabilities(
            _propose_capabilities(text)
        )

        candidates = {
            Predicate.HAS_TIER.value: [f"{Scheme.AGENT_TIER.value}.{resolved_tier}"],
            Predicate.SERVES_DOMAIN.value: _domains_for(
                resolved_tier, goal, name, f"{description} {instructions}"
            ),
            Predicate.REQUIRES_CAPABILITY.value: requires,
            Predicate.PROVIDES_CAPABILITY.value: provides,
        }

        known = {concept["id"] for concept in store.list_concepts()}

        for predicate, concept_ids in candidates.items():
            # An empty guess is not the same as "remove what is there" — this
            # writes only what it is confident enough to state.
            valid = [cid for cid in concept_ids if cid in known]
            if not valid or _is_protected(agent_id, predicate):
                continue
            store.set_annotations(
                SubjectType.AGENT.value, agent_id, predicate, valid, source=source
            )
            written[predicate] = valid

        if written:
            logger.info(
                "Auto-annotated agent %s (%s): %s",
                agent_id, name or "unnamed",
                {p: v for p, v in written.items()},
            )
    except Exception as e:
        # Annotation improves planning; it is never what makes an agent work.
        logger.warning("Could not auto-annotate agent %s: %s", agent_id, e)

    return written


def annotate_workflow(
    workflow_name: str,
    *,
    description: str = "",
    step_text: str = "",
    goal: Optional[str] = None,
    source: str = "inferred",
) -> dict:
    """Classify a workflow against the same vocabulary its agents use.

    A workflow has no tier — the vocabulary is called ``agent_tier`` and means
    reuse breadth, which is a property of an agent, not of a pipeline. What it
    does have is a domain and the capabilities its steps exercise, and those are
    what make it findable and checkable alongside everything else.

    ``step_text`` is the concatenated step ids and templates: a workflow's own
    name is often generic ("demo1") while its steps say exactly what it does.
    """
    written: dict[str, list[str]] = {}
    if not workflow_name:
        return written

    try:
        if not store.is_seeded():
            return written

        text = " ".join(
            part for part in (workflow_name.replace("_", " "), description, step_text) if part
        )

        domains = []
        if goal:
            domains = matcher.match_domains(goal, limit=2)
        if not domains:
            domains = propose_domains_for(
                workflow_name.replace("_", " "), f"{description} {step_text}"
            )

        requires, provides = _split_capabilities(
            _propose_capabilities(text)
        )

        candidates = {
            Predicate.SERVES_DOMAIN.value: domains,
            Predicate.REQUIRES_CAPABILITY.value: requires,
            Predicate.PROVIDES_CAPABILITY.value: provides,
        }

        known = {concept["id"] for concept in store.list_concepts()}
        subject = SubjectType.WORKFLOW.value

        for predicate, concept_ids in candidates.items():
            valid = [cid for cid in concept_ids if cid in known]
            if not valid or _is_protected(workflow_name, predicate, subject):
                continue
            store.set_annotations(subject, workflow_name, predicate, valid, source=source)
            written[predicate] = valid

        if written:
            logger.info("Auto-annotated workflow '%s': %s", workflow_name, written)
    except Exception as e:
        logger.warning("Could not auto-annotate workflow %s: %s", workflow_name, e)

    return written

# ══ Bulk: proposals for review (keyword heuristics shared with fast) ══════════

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
        # Tier comes from whatever the agent already reports, which is metadata
        # when set and the keyword heuristic otherwise.
        tier = coerce_tier(agent.get("tier"))

        # Foundation is the one tier that fixes its own domain, so the lexical
        # guess is not consulted at all. It used to be, and it fired: a
        # guardrail whose instructions say "reject anything unrelated to
        # mortgage lending" scored as mortgage and was then scoped out of every
        # other workflow — the exact opposite of what the tier means.
        fixed = domains_for_tier(tier)
        domains = fixed if fixed is not None else _propose_domains(text)
        requires, provides = _split_capabilities(_propose_capabilities(text))

        proposals.append({
            "subject_type": SubjectType.AGENT.value,
            "subject_id": agent_id,
            "name": agent.get("name", ""),
            # A tier-fixed domain is a statement, not a guess, so it is not
            # reported at the low confidence an empty lexical match would be.
            "confidence": "high" if domains else "low",
            "annotations": {
                Predicate.HAS_TIER.value: [f"agent_tier.{tier}"],
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

# ══ Accurate: model classification ════════════════════════════════════════════

_TIMEOUT_MS = 45_000

_SYSTEM_PROMPT = """\
You classify software agents and workflows against a controlled vocabulary.

Rules:
- Choose ONLY ids that appear in the supplied vocabulary. Never invent an id.
- Prefer the most specific domain that is clearly right. If a resource is about
  mortgages, choose the mortgage subdomain, not just lending.
- Choose at most 2 domains. One is usually correct.
- A foundation-tier resource is domain-agnostic (safety, moderation, routing,
  review). Those belong to no industry: return ["domain.system"] as the only
  domain, never an industry alongside it.
- requires_capability is only for capabilities the resource must get from a
  tool or connector attached to it — retrieval, integration, computation.
  Reasoning it performs itself is provides_capability.
- Return an empty list rather than guessing when nothing fits.

Respond with JSON only:
{"domains": [], "requires_capability": [], "provides_capability": [],
 "data_classes": [], "tier": "foundation|domain|use_case", "reasoning": ""}"""


def _vocabulary_block() -> str:
    """The choosable vocabulary, rendered compactly for the prompt."""
    lines: list[str] = []

    for scheme_id, heading in (
        (Scheme.DOMAIN.value, "DOMAINS (industry > domain > subdomain)"),
        (Scheme.CAPABILITY.value, "CAPABILITIES"),
        (Scheme.DATA_CLASS.value, "DATA CLASSES"),
    ):
        concepts = store.list_concepts(scheme_id)
        if not concepts:
            continue
        lines.append(f"\n## {heading}")
        for concept in sorted(concepts, key=lambda c: c["id"]):
            indent = "  " * concept.get("level", 0)
            definition = (concept.get("definition") or "")[:90]
            lines.append(f"{indent}- {concept['id']} — {concept['label']}: {definition}")

    return "\n".join(lines)


def _valid_ids(scheme_id: str) -> set[str]:
    return {c["id"] for c in store.list_concepts(scheme_id)}


def _clean(raw: Any, allowed: set[str], limit: int) -> list[str]:
    """Keep only real concept ids, capped."""
    if not isinstance(raw, list):
        return []
    seen: list[str] = []
    for value in raw:
        if isinstance(value, str) and value in allowed and value not in seen:
            seen.append(value)
    return seen[:limit]


async def classify(
    client,
    *,
    name: str,
    description: str = "",
    instructions: str = "",
    subject_kind: str = "agent",
    model: Optional[str] = None,
) -> dict:
    """Ask a model to classify one resource. Returns {} on any failure."""
    import asyncio
    from functools import partial

    from app.config import settings

    if not store.is_seeded():
        return {}

    text = "\n".join(part for part in (
        f"Name: {name}",
        f"Description: {description}" if description else "",
        f"Instructions: {instructions[:2000]}" if instructions else "",
    ) if part)

    prompt = (
        f"Classify this {subject_kind}.\n\n{text}\n\n"
        f"Available vocabulary:{_vocabulary_block()}"
    )

    try:
        response = await asyncio.to_thread(
            partial(
                client.chat.complete,
                model=model or settings.MISTRAL_ORCHESTRATOR_MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                response_format={"type": "json_object"},
                timeout_ms=_TIMEOUT_MS,
            )
        )
        payload = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.warning("Ontology classification failed for %r: %s", name, e)
        return {}

    domains = _valid_ids(Scheme.DOMAIN.value)
    capabilities = _valid_ids(Scheme.CAPABILITY.value)
    data_classes = _valid_ids(Scheme.DATA_CLASS.value)

    tier = coerce_tier(payload.get("tier"))
    result = {
        "domains": _clean(payload.get("domains"), domains, 2),
        "requires_capability": _clean(payload.get("requires_capability"), capabilities, 4),
        "provides_capability": _clean(payload.get("provides_capability"), capabilities, 4),
        "data_classes": _clean(payload.get("data_classes"), data_classes, 4),
        "tier": tier,
        "reasoning": str(payload.get("reasoning") or "")[:400],
    }

    # The prompt asks for domain.system on a foundation resource; this is what
    # makes it true. A model that names a foundation agent's subject matter
    # anyway — and they do, because the instructions are full of it — would
    # otherwise file a guardrail under an industry and scope it out of every
    # other one. A workflow has no tier, so the rule does not apply to it.
    if subject_kind == SubjectType.AGENT.value:
        fixed = domains_for_tier(tier)
        if fixed is not None:
            result["domains"] = [d for d in fixed if d in domains]

    logger.info(
        "Classified %s %r → domains=%s tier=%s",
        subject_kind, name, result["domains"], result["tier"],
    )
    return result


def apply_classification(
    subject_type: str,
    subject_id: str,
    result: dict,
    source: str = "llm",
    include_tier: bool = True,
) -> dict:
    """Write a classification into the store, without clobbering a human.

    ``source="llm"`` is deliberately distinct from ``"inferred"`` (lexical) and
    ``"user"`` (stated). It is a better guess than the keyword heuristic but
    still a guess, so the validator keeps treating it as advisory — and a later
    audit can tell the two kinds of guess apart.
    """

    written: dict[str, list[str]] = {}
    if not result or not subject_id:
        return written

    pairs = [
        (Predicate.SERVES_DOMAIN.value, result.get("domains") or []),
        (Predicate.REQUIRES_CAPABILITY.value, result.get("requires_capability") or []),
        (Predicate.PROVIDES_CAPABILITY.value, result.get("provides_capability") or []),
        (Predicate.HANDLES_DATA_CLASS.value, result.get("data_classes") or []),
    ]
    if include_tier and result.get("tier"):
        pairs.append((
            Predicate.HAS_TIER.value,
            [f"{Scheme.AGENT_TIER.value}.{coerce_tier(result['tier'])}"],
        ))

    for predicate, concept_ids in pairs:
        if not concept_ids or _is_protected(subject_id, predicate, subject_type):
            continue
        try:
            store.set_annotations(subject_type, subject_id, predicate, concept_ids, source=source)
            written[predicate] = concept_ids
        except Exception as e:
            logger.warning("Could not write %s for %s: %s", predicate, subject_id, e)

    return written


async def classify_and_apply(
    client,
    *,
    subject_type: str,
    subject_id: str,
    name: str,
    description: str = "",
    instructions: str = "",
) -> dict:
    """Classify one resource and record the result. Never raises."""
    try:
        kind = "workflow" if subject_type == SubjectType.WORKFLOW.value else "agent"
        result = await classify(
            client, name=name, description=description,
            instructions=instructions, subject_kind=kind,
        )
        if not result:
            return {}
        return apply_classification(
            subject_type, subject_id, result,
            # Only agents carry a tier; the vocabulary is called agent_tier.
            include_tier=(subject_type == SubjectType.AGENT.value),
        )
    except Exception as e:
        logger.warning("classify_and_apply failed for %s %s: %s", subject_type, subject_id, e)
        return {}

# ══ Placing a process document on a node ══════════════════════════════════════

def _place_norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _place_names(concept: dict) -> set[str]:
    out = {_place_norm(concept["label"]), _place_norm(concept["id"].rsplit(".", 1)[-1])}
    out |= {_place_norm(s.lstrip("!")) for s in concept.get("synonyms") or []}
    return {n for n in out if n}


def _place_parse(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8-sig", errors="ignore")
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
        except Exception:
            return None
    return None


def _place_result(concept_id: str, method: str, detail: str) -> dict:
    from app.process.templates import scope_path

    concept = store.get_concept(concept_id) or {}
    return {"concept_id": concept_id, "label": concept.get("label", concept_id),
            "level": concept.get("level_name"), "path": scope_path(concept_id),
            "method": method, "detail": detail}


def _place_match(scheme: str, wanted: list[Any], within: Optional[set[str]] = None) -> Optional[dict]:
    names = [_place_norm(w) for w in wanted if _place_norm(w)]
    if not names:
        return None
    for concept in store.list_concepts(scheme):
        if within is not None and concept["id"] not in within:
            continue
        if concept["id"] == SYSTEM_DOMAIN:
            continue
        if any(n in _place_names(concept) or n == _place_norm(concept["id"]) for n in names):
            return concept
    return None


def place_from_document(doc: dict) -> Optional[dict]:
    """The deepest concept the document's own fields name."""
    process = doc.get("process") if isinstance(doc.get("process"), dict) else {}
    cls = doc.get("classification") if isinstance(doc.get("classification"), dict) else {}

    # Domain first, so a process name shared by two industries resolves to the
    # one the document says it is in.
    domain = None
    for key in ("industry", "domain", "subdomain"):
        if cls.get(key):
            within = (store.descendants(domain["id"]) if domain else None)
            found = _place_match(Scheme.DOMAIN.value, [cls[key]], within)
            if found:
                domain = found
    within_processes = store.processes_under([domain["id"]], include_ancestors=False) \
        if domain else None

    sub = _place_match(Scheme.PROCESS.value, [cls.get("subprocess"),
                                        process.get("name") if process.get("level") == "subprocess" else None,
                                        process.get("id") if process.get("level") == "subprocess" else None],
                 within_processes)
    if sub:
        return _place_result(sub["id"], "document", "named in the document's classification")
    proc = _place_match(Scheme.PROCESS.value, [cls.get("process"), process.get("name"), process.get("id"),
                                         process.get("parent_process")], within_processes)
    if proc:
        return _place_result(proc["id"], "document", "named in the document's process fields")
    if domain:
        return _place_result(domain["id"], "document", "the domain named in the document's classification")
    return None


def place_from_goal(goal: str) -> Optional[dict]:
    """The process (or domain) the request itself is about."""
    if not goal or not goal.strip():
        return None
    from app.config import settings
    from app.catalog import match as matcher
    from app.process import resolver

    try:
        scope = matcher.scope_for_goal(goal)
    except Exception as e:
        logger.debug("Goal scoping failed during classification: %s", e)
        return None
    if not scope.get("scoped"):
        return None
    candidates = resolver.candidates_for(goal, scope)
    if candidates and candidates[0]["score"] >= float(settings.PROCESS_MATCH_MIN_SCORE):
        best = candidates[0]
        return _place_result(best["concept_id"], "request",
                       f"the request matched this process (score {best['score']})")
    return _place_result(scope["domains"][0], "request", "the domain the request was scoped to")


def place_document(raw: Any, *, goal: str = "", chosen: Optional[str] = None) -> dict:
    """Where the document belongs, and how that was decided. Never raises."""
    if chosen:
        if store.get_concept(chosen):
            return _place_result(chosen, "chosen", "chosen when uploading")
        logger.info("Chosen classification %r does not exist — classifying instead", chosen)
    doc = _place_parse(raw)
    try:
        found = (place_from_document(doc) if doc else None) or place_from_goal(goal)
    except Exception as e:
        logger.warning("Process document classification failed: %s", e)
        found = None
    if found:
        return found
    from app.process.templates import scope_path

    return {"concept_id": None, "label": None, "level": None, "path": scope_path(None),
            "method": "none",
            "detail": "nothing in the document or the request matched the classification"}


# ══ Dispatch ════════════════════════════════════════════════════════════════


async def tag(
    subject_type: str,
    subject_id: str,
    *,
    mode: str = "fast",
    client: Any = None,
    name: str = "",
    description: str = "",
    instructions: str = "",
    tier: Optional[str] = None,
    goal: Optional[str] = None,
) -> dict:
    """Tag one agent or workflow. ``mode`` is ``fast`` or ``accurate``.

    Accurate needs a Mistral client and falls back to fast when it returns
    nothing, so a caller always gets the cheap tags at least.
    """
    if mode == "accurate" and client is not None:
        written = await classify_and_apply(
            client, subject_type=subject_type, subject_id=subject_id,
            name=name, description=description, instructions=instructions,
        )
        if written:
            return written
    if subject_type == SubjectType.WORKFLOW.value:
        return annotate_workflow(subject_id, description=description,
                                 step_text=instructions, goal=goal)
    return annotate_agent(subject_id, name=name, description=description,
                          instructions=instructions, tier=tier, goal=goal)
