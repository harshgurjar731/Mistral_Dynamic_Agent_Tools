"""
LLM classification against the vocabulary.

The lexical heuristics in ``backfill``/``autotag`` are cheap and run everywhere,
but they only fire on words that literally appear. An agent described as
"decides whether an applicant can afford the repayments" is obviously mortgage
work to a reader and invisible to token overlap.

This module is the expensive, accurate path: it shows a model the actual
vocabulary and asks it to choose from it. Used when a human creates an agent or
a workflow by hand — where there is no planner goal to infer from and the cost
of one extra call is irrelevant against the time already spent typing.

Two properties matter more than accuracy here:

* **Closed choice.** The model picks concept ids from a list; anything it
  invents is dropped. A hallucinated ``domain.crypto`` would annotate a subject
  against a concept nothing else references, which is worse than no annotation.
* **Never fatal.** Classification failing must not fail the create. Every entry
  point returns empty on error and the caller carries on.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.ontology import store
from app.ontology.vocab import Predicate, Scheme, SubjectType, coerce_tier

logger = logging.getLogger(__name__)

_TIMEOUT_MS = 45_000

_SYSTEM_PROMPT = """\
You classify software agents and workflows against a controlled vocabulary.

Rules:
- Choose ONLY ids that appear in the supplied vocabulary. Never invent an id.
- Prefer the most specific domain that is clearly right. If a resource is about
  mortgages, choose the mortgage subdomain, not just lending.
- Choose at most 2 domains. One is usually correct.
- A foundation-tier resource is domain-agnostic (safety, moderation, routing,
  review). For those return an empty domain list.
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

    result = {
        "domains": _clean(payload.get("domains"), domains, 2),
        "requires_capability": _clean(payload.get("requires_capability"), capabilities, 4),
        "provides_capability": _clean(payload.get("provides_capability"), capabilities, 4),
        "data_classes": _clean(payload.get("data_classes"), data_classes, 4),
        "tier": coerce_tier(payload.get("tier")),
        "reasoning": str(payload.get("reasoning") or "")[:400],
    }
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
    from app.ontology.autotag import _is_protected

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
