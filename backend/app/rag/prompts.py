"""
The extraction contract — what a model is told to pull out of a document.

Three constraints shape this prompt, all of them learned from what the
industry-knowledge feature got wrong first.

**Evidence is mandatory.** Every entity and every relation must carry the
verbatim span it came from. Without it there is no way to tell a fact the
document stated from a fact the model knew, and a graph that mixes the two is
worse than no graph — it launders invention into something that looks sourced.
The evidence also lands on the edge in Neo4j, so a retrieved triple can quote
the sentence it came from.

**Types are closed.** An open type vocabulary produces "Company", "company",
"Corporation" and "Business" for the same idea across four chunks, and entity
resolution then has nothing to match on. A short closed list is less expressive
and far more mergeable.

**Predicates are normalised verbs.** ``supplies_to`` and ``is_supplier_of``
would be two edges expressing one fact. Fixing this at retrieval is guesswork;
fixing it at extraction is a sentence of instruction.

User rules extend this contract, never replace it — they are appended as
additional requirements, so a user who writes "only extract clauses about
liability" narrows the scope without being able to switch off evidence or
invent a new output shape.
"""

from __future__ import annotations

#: The closed entity vocabulary. Deliberately generic: these are the types that
#: recur across contracts, reports, policies and manuals alike. A domain-specific
#: type ("Clause", "Incident") is what the per-library rules are for.
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

DEFAULT_EXTRACTION_INSTRUCTIONS = """\
Extract a knowledge graph from the document excerpt.

WHAT TO EXTRACT
- Entities: the things the text is about — who, what, where, which system,
  which rule, which measure.
- Relations: how those things connect, as stated by the text.

ENTITY TYPES — use exactly one of these, never invent a type:
Person, Organization, Product, Process, Metric, Regulation, System, Location,
Event, Concept.

RULES — these are not negotiable:
1. Extract only what the excerpt states. Never add what you know from
   elsewhere, and never infer a relation the text does not assert.
2. Every entity and every relation must carry "evidence": a VERBATIM span
   copied from the excerpt, at most 200 characters. If you cannot quote it,
   do not extract it.
3. Use the entity's full form as "name" (e.g. "Northwind Trading Ltd", not
   "Northwind"), and put shorter or alternative forms in "aliases".
4. Predicates are lower_snake_case verb phrases, active voice, and consistent:
   prefer "supplies_to" over "is_supplier_of", "reports_to" over "has_manager".
5. "source" and "target" of a relation MUST be the exact "name" of an entity
   you also list in "entities". Never reference an entity you did not extract.
6. confidence is 0.0-1.0: how certain you are that the text states this. Use
   below 0.6 when the wording is ambiguous.
7. Skip boilerplate — page numbers, headers, footers, table-of-contents lines.

OUTPUT — a single JSON object, nothing else:
{
  "entities": [
    {"name": "...", "type": "Organization", "description": "one sentence",
     "aliases": ["..."], "confidence": 0.9, "evidence": "verbatim span"}
  ],
  "relations": [
    {"source": "...", "source_type": "Organization", "predicate": "supplies_to",
     "target": "...", "target_type": "Organization",
     "confidence": 0.8, "evidence": "verbatim span"}
  ]
}

If the excerpt contains nothing worth extracting, return
{"entities": [], "relations": []}. An empty result is correct and useful;
padding it with generic entities is not."""

#: Prepended to user rules so the model reads them as *additional* requirements
#: rather than as a replacement contract. The wording matters: an earlier
#: version said "follow these rules", and a user rule reading "return a list of
#: clauses" was enough to make the model abandon the JSON shape entirely.
_RULES_HEADER = """\

ADDITIONAL REQUIREMENTS FROM THE USER
These narrow or extend what to extract. They do NOT change the output format,
and they never override the evidence requirement. If a user requirement
conflicts with the rules above, follow the rules above.

"""


def build_system_prompt(rules: str | None = None) -> str:
    """The extraction contract, with any user rules appended."""
    text = DEFAULT_EXTRACTION_INSTRUCTIONS
    cleaned = (rules or "").strip()
    if cleaned:
        text += _RULES_HEADER + cleaned[:4000]
    return text


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
