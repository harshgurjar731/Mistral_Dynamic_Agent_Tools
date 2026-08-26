"""
The Ontology Architect — proposes a library's content schema.

Extraction quality is bounded by the instruction it runs under, and the generic
contract cannot know that in a contract library the interesting unit is a
clause, or that in an incident library it is a failure mode. This agent reads a
sample of the library, works out what the library is *for*, and proposes the
entity types, the predicates and the use-case-specific half of the extraction
prompt.

Three things make it worth an agent rather than a one-off call.

**It is reviewable.** The proposal is a draft. Correcting a schema costs one
edit; correcting what a bad schema extracted costs a re-run per document. The
lever belongs before the work, not after it.

**It is project-level.** One agent, visible in Agent Studio, non-deletable, with
the document-library tool covering every library it has been asked about — so
it can look further into a library than the sample it was handed.

**It proposes once per library, not once per document.** Per-document schemas
were the obvious idea and the wrong one: entity identity in Neo4j is
``(library_id, normalized, type)``, so a company typed ``Organization`` from one
document and ``Supplier`` from another becomes two nodes, and the library graph
fragments — the exact failure a library-level schema exists to prevent.

What it does **not** decide: the evidence requirement and the JSON output shape.
Those are fixed in ``prompts.py`` and spliced around whatever this produces.
Generated instructions that can override an output contract break every parser
downstream — a lesson this codebase has already learned twice.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import partial
from typing import Any, Optional

from mistralai.client.models.completionargs import CompletionArgs

from app.config import settings
from app.rag import library_ontology, store, timeline

logger = logging.getLogger(__name__)

ARCHITECT_KEY = "ontology_architect"
ARCHITECT_NAME = "Ontology Architect"
ARCHITECT_METADATA = {"system": ARCHITECT_KEY, "protected": "true"}

#: How many documents to read before proposing. One is not enough — a schema
#: designed from a single file describes that file rather than the library —
#: and every extra one costs tokens for diminishing returns.
SAMPLE_DOCUMENTS = 4
#: Characters taken from each sampled document. The opening of a document is
#: where its purpose, parties and defined terms live.
SAMPLE_CHARS = 6000

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

ARCHITECT_INSTRUCTIONS = """\
You are the Ontology Architect. You design the content schema for a document
library — the closed set of entity types and relation predicates that everything
extracted from that library must use.

You are shown excerpts from several documents in one library. Libraries are
organised by purpose: all contracts, all incident reports, all policies. Work out
what this library is for, then design a schema that fits it.

DESIGN RULES
1. Entity types describe what this library is ABOUT, not generic categories.
   A supply-contract library wants Party, Carrier, Subcontractor, Standard,
   Obligation — not "Organization" for all four. Aim for 6-12 types. Fewer than
   5 loses the distinctions that make a graph useful; more than 15 becomes
   impossible for an extractor to apply consistently.
2. Predicates are the important half. They are lower_snake_case verb phrases,
   active voice, and the list is CLOSED — an extractor may use nothing else.
   Pick one form per idea: "supplies_to" OR "provides_to", never both. Aim for
   8-20. For each, say which entity types it usually connects.
3. Every type and predicate must be justified by the excerpts. Do not invent a
   type for something the documents never mention, and do not carry over a
   generic vocabulary out of habit.
4. Prefer names a domain expert would recognise over abstract ones.

You also write "prompt": the extraction instruction for THIS library. It says
what to look for and what to ignore, in two or three short paragraphs. It must
NOT specify an output format, and must NOT mention JSON — the platform supplies
the output contract and the evidence rules separately, and anything you say
about format will conflict with them.

Respond with JSON only:
{
  "summary": "<2-3 sentences: what this library is and what questions it should answer>",
  "entity_types": [
    {"name": "Party", "description": "...", "examples": ["Northwind Trading Ltd"]}
  ],
  "predicates": [
    {"name": "supplies_to", "description": "...",
     "source_types": ["Party"], "target_types": ["Party"]}
  ],
  "prompt": "<the use-case-specific extraction instruction>"
}"""


def _parse(raw: str) -> dict:
    text = _FENCE.sub("", (raw or "").strip())
    try:
        value = json.loads(text)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


# ── The agent ──────────────────────────────────────────────────────────────


async def _find_existing(client, max_pages: int = 3) -> Optional[str]:
    """An architect already in the workspace, matched on its metadata.

    The registration lives in SQLite, which is a development file that gets
    reset. Without this, every reset would create another architect — the same
    duplication the query optimiser had to be taught to avoid.
    """
    candidates: list[tuple[str, str]] = []
    try:
        for page in range(max_pages):
            agents = await asyncio.to_thread(
                partial(client.beta.agents.list, page=page, page_size=100)
            )
            if not agents:
                break
            for agent in agents:
                metadata = getattr(agent, "metadata", None)
                if isinstance(metadata, dict) and metadata.get("system") == ARCHITECT_KEY:
                    candidates.append(
                        (str(getattr(agent, "created_at", "")), getattr(agent, "id", ""))
                    )
    except Exception as e:
        logger.debug("Could not scan for an existing architect: %s", e)
        return None

    candidates = [(c, a) for c, a in candidates if a]
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


async def ensure_agent(client, reset: bool = False) -> Optional[str]:
    """Create the architect if it does not exist. Idempotent."""
    registration = store.get_system_agent(ARCHITECT_KEY)
    if registration and registration.get("agent_id"):
        agent_id = registration["agent_id"]
        try:
            await asyncio.to_thread(partial(client.beta.agents.get, agent_id=agent_id))
            if reset:
                await asyncio.to_thread(
                    partial(
                        client.beta.agents.update,
                        agent_id=agent_id,
                        instructions=ARCHITECT_INSTRUCTIONS,
                        completion_args=CompletionArgs(temperature=0.1),
                    )
                )
            return agent_id
        except Exception:
            logger.info("Registered architect %s is gone — recreating", agent_id)
            store.clear_system_agent(ARCHITECT_KEY)

    adopted = await _find_existing(client)
    if adopted:
        store.set_system_agent(
            ARCHITECT_KEY, adopted, ARCHITECT_NAME, settings.MISTRAL_ORCHESTRATOR_MODEL
        )
        logger.info("Adopted existing ontology architect %s", adopted)
        return adopted

    model = settings.MISTRAL_ORCHESTRATOR_MODEL
    try:
        agent = await asyncio.to_thread(
            partial(
                client.beta.agents.create,
                model=model,
                name=ARCHITECT_NAME,
                description=(
                    "Designs the entity types, predicates and extraction prompt for "
                    "each document library. Platform-owned — cannot be deleted."
                ),
                instructions=ARCHITECT_INSTRUCTIONS,
                metadata=ARCHITECT_METADATA,
                # A schema should not change shape between two runs on the same
                # library; a little headroom helps it name types well.
                completion_args=CompletionArgs(temperature=0.1),
            )
        )
    except Exception as e:
        logger.warning("Could not create the ontology architect: %s", e)
        return None

    store.set_system_agent(ARCHITECT_KEY, agent.id, ARCHITECT_NAME, model)
    logger.info("Ontology architect ready: %s", agent.id)
    return agent.id


async def attach_library(client, agent_id: str, library_id: str) -> bool:
    """Give the architect search access to a library it is being asked about.

    An agent's tools are fixed at creation, so "the library currently open" is
    not directly expressible. The architect instead accumulates libraries: the
    sample it is handed is the primary input, and the tool is what lets it look
    further when the sample is not enough.
    """
    from app.rag.scope import library_ids_from_tools

    try:
        agent = await asyncio.to_thread(partial(client.beta.agents.get, agent_id=agent_id))
        tools = list(getattr(agent, "tools", None) or [])
        existing = library_ids_from_tools(tools)
        if library_id in existing:
            return False

        remaining = [
            t for t in tools
            if (t.get("type") if isinstance(t, dict) else getattr(t, "type", None))
            != "document_library"
        ]
        remaining.append(
            {"type": "document_library", "library_ids": [*existing, library_id]}
        )
        await asyncio.to_thread(
            partial(client.beta.agents.update, agent_id=agent_id, tools=remaining)
        )
        return True
    except Exception as e:
        # The proposal works from the sampled text alone; library access is an
        # enhancement, not a precondition.
        logger.debug("Could not attach library %s to the architect: %s", library_id, e)
        return False


# ── Proposing ──────────────────────────────────────────────────────────────


async def _sample_library(client, library_id: str) -> tuple[str, list[str]]:
    """Excerpts from a few documents, and the ids they came from."""
    documents = store.list_documents(library_id)
    # Prefer documents whose text we know exists; an unprocessed one yields
    # nothing and wastes a round trip.
    ready = [d for d in documents if d["status"] not in ("failed", "unsupported")]
    chosen = ready[:SAMPLE_DOCUMENTS] or documents[:SAMPLE_DOCUMENTS]

    blocks: list[str] = []
    used: list[str] = []
    for document in chosen:
        try:
            content = await asyncio.to_thread(
                partial(
                    client.beta.libraries.documents.text_content,
                    library_id=library_id,
                    document_id=document["mistral_doc_id"],
                )
            )
            text = str(getattr(content, "text", "") or "").strip()
        except Exception as e:
            logger.debug("Could not sample %s: %s", document["filename"], e)
            continue
        if not text:
            continue
        blocks.append(f'--- Document: "{document["filename"]}" ---\n{text[:SAMPLE_CHARS]}')
        used.append(document["mistral_doc_id"])

    return "\n\n".join(blocks), used


async def propose(client, library_id: str, library_name: str = "") -> dict:
    """Read a sample of the library and propose a schema, as a draft.

    Never writes an approved ontology and never touches the graph. The result
    is a proposal a person confirms — which is the point of having it.
    """
    agent_id = await ensure_agent(client)
    trace_id = timeline.start("ingest", f"library:{library_id}")

    with timeline.stage(
        "propose_ontology", meta={"library": library_name or library_id}
    ) as root:
        with timeline.stage("sample_documents") as st:
            sample, sampled_ids = await _sample_library(client, library_id)
            st.set(documents=len(sampled_ids), chars=len(sample))

        if not sample:
            root.skip("no readable documents to design a schema from")
            raise ValueError(
                "This library has no readable document text yet. Upload a document "
                "and let it finish indexing, then propose an ontology."
            )

        if agent_id:
            await attach_library(client, agent_id, library_id)

        with timeline.stage("design_schema", meta={"agent": agent_id}) as st:
            prompt = (
                f'Library: "{library_name or library_id}"\n\n'
                f"Excerpts from {len(sampled_ids)} document(s) in it:\n\n{sample}"
            )
            if agent_id:
                call = partial(
                    client.agents.complete,
                    agent_id=agent_id,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    timeout_ms=120_000,
                )
            else:
                call = partial(
                    client.chat.complete,
                    model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                    messages=[
                        {"role": "system", "content": ARCHITECT_INSTRUCTIONS},
                        {"role": "user", "content": prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    timeout_ms=120_000,
                )

            response = await asyncio.to_thread(call)
            choice = response.choices[0]
            message = choice.message or (
                (getattr(choice, "messages", None) or [None])[-1]
            )
            payload = _parse(getattr(message, "content", "") or "")
            st.set(
                types=len(payload.get("entity_types") or []),
                predicates=len(payload.get("predicates") or []),
            )

        if not payload.get("entity_types"):
            root.skip("the architect proposed no entity types")
            raise RuntimeError(
                "The architect could not design a schema from these documents. "
                "Try again, or write the types and predicates by hand."
            )

        draft = library_ontology.save_draft(
            library_id=library_id,
            entity_types=payload.get("entity_types"),
            predicates=payload.get("predicates"),
            prompt=str(payload.get("prompt") or ""),
            summary=str(payload.get("summary") or ""),
            source_document_ids=sampled_ids,
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
        )
        root.set(
            version=draft["version"],
            types=len(draft["entity_types"]),
            predicates=len(draft["predicates"]),
        )

    return {**draft, "trace_id": trace_id}


def status() -> dict:
    registration = store.get_system_agent(ARCHITECT_KEY) or {}
    return {
        "agent_id": registration.get("agent_id"),
        "name": registration.get("name") or ARCHITECT_NAME,
        "model": registration.get("model"),
        "protected": True,
    }


def is_protected(agent_id: str) -> bool:
    return bool(agent_id) and agent_id in store.system_agent_ids()
