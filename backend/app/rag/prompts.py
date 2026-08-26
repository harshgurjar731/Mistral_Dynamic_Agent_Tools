"""
The extraction contract — what a model is told to pull out of a document.

The instruction is assembled from four parts, in a deliberate order of
authority:

1. **The contract** — evidence, no invention, the JSON shape. Fixed in code.
2. **The vocabulary** — entity types and predicates. From the library's
   approved ontology when it has one, from the generic defaults when it does
   not.
3. **The library's prompt** — what to look for in *this* use case. Written by
   the Ontology Architect and reviewed by a person.
4. **The document's rules** — a local override for one file.

Only (1) is non-negotiable, and it is last in the assembled text as well as
first in authority, because a model weights late instructions heavily. Both (3)
and (4) are generated or user-written, and both have already broken this
pipeline once by overriding an output format they were never meant to touch —
a user rule reading "return a list of clauses" made the model abandon JSON
entirely. They now sit inside labelled sections that say what they may and may
not change.

Three constraints shape the fixed part, all learned rather than assumed.

**Evidence is mandatory.** Every entity and relation carries the verbatim span
it came from. Without it there is no way to tell a fact the document stated from
one the model knew, and a graph that mixes the two launders invention into
something that looks sourced.

**Types are closed.** An open vocabulary produces "Company", "company",
"Corporation" and "Business" for one idea across four chunks, and entity
identity in Neo4j is ``(library, normalized, type)`` — four types means four
nodes.

**Predicates are closed too, once a library has an ontology.** This is the
newer lesson: the same document extracted twice produced ``pays`` and
``pays_invoice_to`` for the same fact. Two edges, one fact, and a traversal
filtering on either misses half the answer.
"""

from __future__ import annotations

from typing import Any, Optional

#: The fallback entity vocabulary, used by libraries with no approved ontology.
#: Deliberately generic: these recur across contracts, reports and policies
#: alike. Anything domain-specific is what a library ontology is for.
ENTITY_TYPES = (
    "Person",
    "Organization",
    "Product",
    "Process",
    "Metric",
    "Regulation",
    "System",
    "Location",
    "Event",
    "Concept",
)

_CONTRACT_HEAD = """\
Extract a knowledge graph from the document excerpt.

WHAT TO EXTRACT
- Entities: the things the text is about — who, what, where, which system,
  which rule, which measure.
- Relations: how those things connect, as stated by the text."""

_GENERIC_TYPES_BLOCK = """\
ENTITY TYPES — use exactly one of these, never invent a type:
{types}"""

_GENERIC_PREDICATE_BLOCK = """\
PREDICATES — lower_snake_case verb phrases, active voice, and consistent:
prefer "supplies_to" over "is_supplier_of", "reports_to" over "has_manager"."""

_CONTRACT_RULES = """\
RULES — these are not negotiable, and nothing below may relax them:
1. Extract only what the excerpt states. Never add what you know from
   elsewhere, and never infer a relation the text does not assert.
2. Every entity and every relation must carry "evidence": a VERBATIM span
   copied from the excerpt, at most 200 characters. If you cannot quote it,
   do not extract it.
3. Use the entity's full form as "name" (e.g. "Northwind Trading Ltd", not
   "Northwind"), and put shorter or alternative forms in "aliases".
4. "source" and "target" of a relation MUST be the exact "name" of an entity
   you also list in "entities". Never reference an entity you did not extract.
5. confidence is 0.0-1.0: how certain you are that the text states this. Use
   below 0.6 when the wording is ambiguous.
6. Skip boilerplate — page numbers, headers, footers, table-of-contents lines.

OUTPUT — a single JSON object, nothing else:
{
  "entities": [
    {"name": "...", "type": "<one of the types above>", "description": "one sentence",
     "aliases": ["..."], "confidence": 0.9, "evidence": "verbatim span"}
  ],
  "relations": [
    {"source": "...", "source_type": "...", "predicate": "<one of the predicates above>",
     "target": "...", "target_type": "...",
     "confidence": 0.8, "evidence": "verbatim span"}
  ]
}

If the excerpt contains nothing worth extracting, return
{"entities": [], "relations": []}. An empty result is correct and useful;
padding it with generic entities is not."""

#: Wraps the library's generated prompt. The framing matters: it is scope
#: guidance, not a replacement contract.
_LIBRARY_HEADER = """\

WHAT MATTERS IN THIS LIBRARY
This describes what to look for and what to ignore. It does NOT change the
output format or the evidence requirement.

"""

#: Wraps per-document rules. Same framing, one level more specific.
_RULES_HEADER = """\

ADDITIONAL REQUIREMENTS FOR THIS DOCUMENT
These narrow or extend what to extract. They do NOT change the output format,
and they never override the rules above. If a requirement here conflicts with
those rules, follow the rules.

"""


def _types_block(ontology: Optional[dict]) -> str:
    """The entity vocabulary, from the library's ontology or the defaults."""
    types = (ontology or {}).get("entity_types") or []
    if not types:
        return _GENERIC_TYPES_BLOCK.format(types=", ".join(ENTITY_TYPES) + ".")

    lines = ["ENTITY TYPES — use exactly one of these, never invent a type:"]
    for entry in types:
        line = f"- {entry['name']}"
        if entry.get("description"):
            line += f": {entry['description']}"
        if entry.get("examples"):
            line += f" (e.g. {', '.join(entry['examples'][:3])})"
        lines.append(line)
    return "\n".join(lines)


def _predicates_block(ontology: Optional[dict]) -> str:
    """The relation vocabulary. Closed when the library defines one."""
    predicates = (ontology or {}).get("predicates") or []
    if not predicates:
        return _GENERIC_PREDICATE_BLOCK

    lines = [
        "PREDICATES — this list is CLOSED. Use one of these exactly, or do not",
        "extract the relation at all. Do not invent a predicate, and do not use",
        "a synonym of one below:",
    ]
    for entry in predicates:
        line = f"- {entry['name']}"
        endpoints = ""
        if entry.get("source_types") or entry.get("target_types"):
            source = "/".join(entry.get("source_types") or ["any"])
            target = "/".join(entry.get("target_types") or ["any"])
            endpoints = f" [{source} → {target}]"
        if entry.get("description"):
            line += f": {entry['description']}"
        lines.append(line + endpoints)
    return "\n".join(lines)


def build_system_prompt(
    rules: str | None = None,
    ontology: Optional[dict] = None,
) -> str:
    """Assemble the extraction instruction for one document.

    ``ontology`` is the library's approved schema, or None for the generic
    vocabulary. ``rules`` is the per-document override.
    """
    sections = [
        _CONTRACT_HEAD,
        _types_block(ontology),
        _predicates_block(ontology),
    ]

    library_prompt = ((ontology or {}).get("prompt") or "").strip()
    if library_prompt:
        sections.append(_LIBRARY_HEADER.strip() + "\n\n" + library_prompt[:4000])

    cleaned = (rules or "").strip()
    if cleaned:
        sections.append(_RULES_HEADER.strip() + "\n\n" + cleaned[:4000])

    # The contract goes last as well as first in authority: a model weights the
    # end of a long instruction heavily, and this is the part that must survive
    # anything the two generated sections above try to do.
    sections.append(_CONTRACT_RULES)
    return "\n\n".join(sections)


#: Kept for the UI, which shows "the contract every extraction follows" beside
#: the rules editor. Rendering it through the same builder means what the user
#: reads is what the extractor is actually sent.
DEFAULT_EXTRACTION_INSTRUCTIONS = build_system_prompt()


def build_user_prompt(
    *,
    filename: str,
    chunk_index: int,
    chunk_count: int,
    text: str,
) -> str:
    """One excerpt, labelled with where it came from.

    The position is included because it changes what the model should do with a
    dangling reference: in chunk 3 of 12, "the Agreement" almost certainly names
    something defined earlier, and inventing an entity for it would create a
    duplicate of one already extracted.
    """
    header = (
        f'Document: "{filename}"\n'
        f"Excerpt {chunk_index + 1} of {chunk_count}.\n"
    )
    if chunk_count > 1:
        header += (
            "This is part of a larger document. Extract only what this excerpt "
            "states; do not invent context from the parts you cannot see.\n"
        )
    return f"{header}\n---\n{text}\n---"
