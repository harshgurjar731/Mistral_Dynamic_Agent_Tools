"""
The query optimiser every RAG query passes through.

Retrieval here starts by *matching an entity*. That makes it unusually
sensitive to how a question is worded: "who do we buy widgets off" has to reach
a node stored as "Northwind Trading Ltd", and nothing in that sentence does.
Preprocessing the query is therefore not a refinement, it is the difference
between retrieving something and retrieving nothing.

What it produces, per Mistral's search-toolkit preprocessing model:

* a **rewrite** — the question restated in the vocabulary a document would use;
* an **extension** — sub-queries covering the facets of a multi-part question,
  each of which gets its own entity match;
* **entity hints** — the proper nouns worth matching on directly, which is the
  part that matters most to a graph and has no equivalent in a vector pipeline.

**Two backends, one policy.** The toolkit's ``LLMQueryRewriter`` and
``LLMQueryExtension`` are the reference implementation and run whenever
``mistralai-search-toolkit`` is importable. It stays optional rather than a
hard requirement: it constrains ``mistralai`` to ``>=2.5,<2.9`` and drags in
numpy, pillow, sentencepiece and tiktoken, which is a lot of weight for two
prompts. The native backend implements the same ``rewrite``/``extend`` protocol
against the agent directly, in one call rather than two, and takes over
untouched when the toolkit is absent.

What the two share is ``REWRITE_DIRECTIVE`` — the statement of what a good
rewrite *is*. They do not share an output contract, because the toolkit returns
a plain string and the native path returns JSON.

**The agent is real.** The optimiser is a Mistral agent, visible in Agent
Studio, created with temperature 0 so its rewrites are reproducible. The native
backend runs the query through it directly, and the toolkit backend uses the
same rewrite policy — so the agent is what governs retrieval either way. It is
registered in ``rag_system_agents``, which is what makes it non-deletable and
what stops a second one appearing on the next boot.
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
from app.rag import store, timeline

logger = logging.getLogger(__name__)

#: Registration key in ``rag_system_agents``.
OPTIMIZER_KEY = "query_optimizer"
OPTIMIZER_NAME = "Query Optimizer"

#: Marks the agent as platform-owned on the Mistral side too, so the delete
#: guard still recognises it if the local registration is ever lost.
OPTIMIZER_METADATA = {"system": OPTIMIZER_KEY, "protected": "true"}

MAX_SUB_QUERIES = 4
MAX_ENTITY_HINTS = 8

#: What a good rewrite is, in prose.
#:
#: Shared between the two backends because it is the *policy*, and policy should
#: not depend on which library happens to be installed. It is embedded in the
#: agent's instructions below and handed to the toolkit's rewriter on its own —
#: the toolkit returns a plain string, so giving it the full JSON contract makes
#: it emit a fenced JSON blob as the "rewritten query", which is exactly what it
#: did before this was split out.
REWRITE_DIRECTIVE = """\
Restate the question in the vocabulary a formal document would use, so it can be
matched against entities extracted from contracts, policies and reports.
Expand abbreviations, resolve vague wording ("we", "they", "that one"), and keep
the specific names the question contains — a named company, system or agreement
must survive the rewrite, because retrieval matches on those names. Keep it to
one sentence. If the question is already well formed, return it unchanged."""

OPTIMIZER_INSTRUCTIONS = """\
You are the Query Optimizer. Every knowledge-graph retrieval in this platform
passes through you before anything is searched.

You do not answer questions. You restate them so they can be matched against a
graph of entities and relations extracted from uploaded documents.

Produce three things:

1. "rewritten" — {rewrite_directive}

2. "sub_queries" — between 0 and 4 sub-questions, each covering one facet of a
   multi-part question. Return [] when the question asks exactly one thing;
   padding a simple question with sub-queries costs a retrieval pass each and
   buys nothing.

3. "entity_hints" — the specific named things the question is about: people,
   organisations, products, systems, regulations, places. Use the fullest form
   the question gives. This is the most important field — retrieval matches
   entities first, and a good hint is worth more than a good rewrite. Return []
   rather than inventing a name the question does not contain.

Also classify "intent" as one of: lookup (a fact about one thing), relation
(how two things connect), enumeration (list everything of a kind), comparison,
or summary.

Respond with JSON only:
{"rewritten": "...", "sub_queries": [], "entity_hints": [], "intent": "lookup"}"""

OPTIMIZER_INSTRUCTIONS = OPTIMIZER_INSTRUCTIONS.replace(
    "{rewrite_directive}", REWRITE_DIRECTIVE.replace("\n", "\n   ")
)

# Optimisation is deterministic for a given question, and the same question is
# asked repeatedly while a user iterates on an agent. A small cache turns the
# second and later asks into no LLM call at all.
_CACHE: dict[str, dict] = {}
_CACHE_LIMIT = 256

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _cache_key(query: str) -> str:
    return re.sub(r"\s+", " ", (query or "").strip().lower())[:300]


def _parse(raw: str) -> dict:
    text = _FENCE.sub("", (raw or "").strip())
    try:
        value = json.loads(text)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _strings(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text[:300])
    return out[:limit]


def passthrough(query: str, reason: str = "") -> dict:
    """The plan used when optimisation is unavailable.

    Retrieval must still run. A question that was going to match an entity
    still matches it unrewritten — the optimiser improves recall, it is not a
    precondition for it.
    """
    return {
        "query": query,
        "rewritten": query,
        "sub_queries": [],
        "entity_hints": [],
        "intent": "lookup",
        "backend": "passthrough",
        "reason": reason,
    }


# ── Backends ───────────────────────────────────────────────────────────────


def toolkit_available() -> bool:
    """Whether Mistral's search toolkit is importable in this environment."""
    try:
        import mistralai.search.toolkit.retrieval.pre_processors  # noqa: F401
    except Exception:
        return False
    return True


def backend_name() -> str:
    return "mistralai-search-toolkit" if toolkit_available() else "native"


async def _toolkit_plan(client, query: str, instructions: str) -> dict:
    """Run the toolkit's own rewriter and extender.

    Two model calls rather than one — that is the toolkit's design, and it is
    kept faithfully rather than reimplemented.

    The installed API differs from the published examples, which show
    ``LLMQueryRewriter(llm_provider=…, prompt="…")`` returning a string. In
    0.0.11 the prompt is a ``QueryRewriterPromptConfig`` and both preprocessors
    return result models (``rewritten_query`` / ``extended_queries``), so this
    reads the objects rather than the values the docs imply. Both calls are
    guarded by the caller, which falls back to a passthrough plan if a future
    version changes them again.

    Entity hints have no toolkit equivalent. They are the field the graph cares
    most about, so they are recovered from the query and its rewrite rather than
    left empty — a worse source than the native backend's, but not nothing.
    """
    from mistralai.search.toolkit.llm import LLMConfig, MistralChat
    from mistralai.search.toolkit.retrieval.pre_processors import (
        LLMQueryExtension,
        LLMQueryRewriter,
    )
    from mistralai.search.toolkit.retrieval.pre_processors.query_rewriter import (
        QueryRewriterPromptConfig,
    )

    llm = MistralChat(
        client=client,
        config=LLMConfig(model=settings.MISTRAL_ORCHESTRATOR_MODEL, temperature=0.0),
    )
    # The rewrite *policy* is shared with the native backend; the JSON contract
    # is not. The toolkit's rewriter returns a plain string, so handing it the
    # agent's full instructions made it answer with a fenced JSON object and the
    # whole blob became the "rewritten query".
    rewriter = LLMQueryRewriter(
        llm_provider=llm,
        prompt_config=QueryRewriterPromptConfig(system_prompt=instructions),
    )
    extender = LLMQueryExtension(llm_provider=llm, num_queries=3)

    rewrite_result = await rewriter.rewrite(query)
    extend_result = await extender.extend(query)

    rewritten = str(getattr(rewrite_result, "rewritten_query", "") or query).strip()
    sub_queries = list(getattr(extend_result, "extended_queries", None) or [])

    return {
        "rewritten": rewritten or query,
        "sub_queries": _strings(sub_queries, MAX_SUB_QUERIES),
        "entity_hints": _capitalised_terms(f"{query} {rewritten}"),
        "intent": "lookup",
    }


#: Words that get capitalised because they start a sentence, not because they
#: name anything. Without stripping these, "Does Northwind Trading Ltd supply…"
#: yields the hint "Does Northwind Trading Ltd", which matches no entity at all.
_SENTENCE_STARTERS = frozenset(
    """
    does do did what which who whom whose is are was were be can could should
    would will shall how why when where if and but or the a an in on for to
    of at from by with please tell show give list find explain
    """.split()
)


def _capitalised_terms(text: str) -> list[str]:
    """Proper-noun-looking spans, as a fallback source of entity hints.

    Crude on purpose. It exists so the toolkit backend is not worse than the
    native one at the field the graph cares most about, and a wrong hint costs
    a full-text miss rather than a wrong answer.
    """
    spans = re.findall(r"\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)", text or "")
    hints: list[str] = []

    for span in spans:
        words = span.strip().split()
        # Peel off leading function words. A question opens with one, and it is
        # capitalised for grammar rather than because it names anything.
        while words and words[0].lower() in _SENTENCE_STARTERS:
            words.pop(0)
        cleaned = " ".join(words)
        if not cleaned:
            continue

        # Keep multi-word spans (a name) and acronyms (NHS, GDPR); drop lone
        # capitalised words, which are far more often ordinary prose.
        if (" " in cleaned and len(cleaned) > 2) or (cleaned.isupper() and len(cleaned) > 1):
            if cleaned not in hints:
                hints.append(cleaned)

    return hints[:MAX_ENTITY_HINTS]


async def _native_plan(client, query: str, instructions: str, agent_id: Optional[str]) -> dict:
    """One call producing rewrite, sub-queries and hints together.

    Folded into a single call deliberately. The toolkit's two-call shape costs
    two round trips on the hot path of every RAG query, and the second call sees
    less context than the first — asking one model for all three fields at once
    is both faster and better informed.

    Routed through the optimiser *agent* when it exists, so the agent is
    genuinely on the path and editing its instructions changes retrieval.
    """
    messages = [{"role": "user", "content": query}]

    if agent_id:
        # `agents.complete` takes no `temperature` — sampling settings belong to
        # the agent, which is created with temperature 0. Passing it here raises
        # a TypeError that surfaces as "optimisation unavailable", which is a
        # confusing way to report a wrong keyword argument.
        call = partial(
            client.agents.complete,
            agent_id=agent_id,
            messages=messages,
            response_format={"type": "json_object"},
            timeout_ms=30_000,
        )
    else:
        # No agent — fall back to a plain completion carrying the same
        # instructions, so optimisation still happens on a fresh install.
        call = partial(
            client.chat.complete,
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[{"role": "system", "content": instructions}, *messages],
            response_format={"type": "json_object"},
            temperature=0.0,
            timeout_ms=30_000,
        )

    response = await asyncio.to_thread(call)
    payload = _parse(response.choices[0].message.content)
    return {
        "rewritten": str(payload.get("rewritten") or query).strip() or query,
        "sub_queries": _strings(payload.get("sub_queries"), MAX_SUB_QUERIES),
        "entity_hints": _strings(payload.get("entity_hints"), MAX_ENTITY_HINTS),
        "intent": str(payload.get("intent") or "lookup")[:40],
    }


# ── Entry point ────────────────────────────────────────────────────────────


async def optimize(client, query: str) -> dict:
    """Preprocess one query. Never raises, never blocks retrieval.

    Recorded as its own timeline stage: when a RAG answer is wrong, whether the
    optimiser mangled the question is the first thing worth ruling out, and that
    is only answerable if the rewrite is visible next to what it retrieved.
    """
    text = (query or "").strip()
    if not text:
        return passthrough(text, "empty query")

    key = _cache_key(text)
    cached = _CACHE.get(key)
    if cached:
        return {**cached, "cached": True}

    with timeline.stage("optimize_query", meta={"backend": backend_name()}) as st:
        registration = store.get_system_agent(OPTIMIZER_KEY)
        agent_id = registration.get("agent_id") if registration else None
        try:
            if toolkit_available():
                # The prose directive, not the JSON contract — see the note on
                # REWRITE_DIRECTIVE. Handing the toolkit's rewriter the full
                # instructions makes it return a fenced JSON object as the
                # "rewritten query", and every downstream entity match then
                # searches for braces.
                plan = await _toolkit_plan(client, text, REWRITE_DIRECTIVE)
                backend = "mistralai-search-toolkit"
            else:
                plan = await _native_plan(
                    client, text, OPTIMIZER_INSTRUCTIONS, agent_id
                )
                backend = "native"
        except Exception as e:
            logger.warning("Query optimisation failed: %s", e)
            st.skip(f"optimisation unavailable ({type(e).__name__})")
            return passthrough(text, str(e)[:200])

        result = {
            "query": text,
            "backend": backend,
            "agent_id": agent_id,
            **plan,
        }
        st.set(
            rewritten=result["rewritten"][:200],
            sub_queries=len(result["sub_queries"]),
            entity_hints=result["entity_hints"],
            intent=result["intent"],
        )

    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.clear()
    _CACHE[key] = result
    return result


def search_terms(plan: dict) -> list[str]:
    """Every phrasing worth matching entities against, best first.

    The rewrite leads because it is the considered form of the question; the
    original follows because a rewrite can lose a proper noun; sub-queries come
    last because each one is narrower than the whole.
    """
    terms = [plan.get("rewritten"), plan.get("query"), *(plan.get("sub_queries") or [])]
    seen: list[str] = []
    for term in terms:
        text = (term or "").strip()
        if text and text.lower() not in {s.lower() for s in seen}:
            seen.append(text)
    return seen


# ── The agent ──────────────────────────────────────────────────────────────


async def _find_existing_agent(client, max_pages: int = 3) -> Optional[str]:
    """An optimiser already in the workspace, if there is one.

    Matched on the metadata written at creation rather than the name, because a
    name is something a user may reasonably change and metadata is not. The
    oldest match wins, so repeated adoptions converge on one agent instead of
    ping-ponging between duplicates.
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
                if not isinstance(metadata, dict):
                    continue
                if metadata.get("system") == OPTIMIZER_KEY:
                    candidates.append(
                        (str(getattr(agent, "created_at", "")), getattr(agent, "id", ""))
                    )
    except Exception as e:
        # Adoption is an optimisation, not a requirement. Failing here means we
        # create one, which is the pre-existing behaviour.
        logger.debug("Could not scan for an existing optimiser: %s", e)
        return None

    candidates = [(created, agent_id) for created, agent_id in candidates if agent_id]
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


async def ensure_system_agent(client, reset: bool = False) -> Optional[str]:
    """Create the optimiser agent if it does not exist. Idempotent.

    Verifies the registered agent still exists upstream before trusting it: an
    agent deleted directly in Mistral Studio would otherwise leave every
    optimisation calling a dead id, and the failure would look like the
    optimiser being broken rather than missing.

    An existing agent's instructions are **not** overwritten on boot. Editing
    them is the supported way to change how retrieval interprets queries, and a
    silent reset on every restart would throw that work away without saying so.
    ``reset=True`` restores the shipped instructions deliberately, which is what
    the ensure endpoint exposes for "put it back how it was".
    """
    registration = store.get_system_agent(OPTIMIZER_KEY)
    if registration and registration.get("agent_id"):
        agent_id = registration["agent_id"]
        try:
            await asyncio.to_thread(
                partial(client.beta.agents.get, agent_id=agent_id)
            )
            if reset:
                await asyncio.to_thread(
                    partial(
                        client.beta.agents.update,
                        agent_id=agent_id,
                        instructions=OPTIMIZER_INSTRUCTIONS,
                        completion_args=CompletionArgs(temperature=0.0),
                    )
                )
                logger.info("Query optimiser %s reset to shipped instructions", agent_id)
            return agent_id
        except Exception:
            logger.info(
                "Registered query optimiser %s no longer exists — recreating", agent_id
            )
            store.clear_system_agent(OPTIMIZER_KEY)

    # Before creating one, look for an optimiser already in the workspace.
    #
    # The registration lives in SQLite, which is a development file that gets
    # deleted, moved between machines and recreated. Without this, every such
    # reset would create *another* optimiser and the workspace would slowly fill
    # with identical agents that nothing points at. The metadata written at
    # creation is what makes them findable again.
    adopted = await _find_existing_agent(client)
    if adopted:
        store.set_system_agent(
            OPTIMIZER_KEY, adopted, OPTIMIZER_NAME, settings.MISTRAL_ORCHESTRATOR_MODEL
        )
        logger.info("Adopted existing query optimiser %s", adopted)
        return adopted

    model = settings.MISTRAL_ORCHESTRATOR_MODEL
    try:
        agent = await asyncio.to_thread(
            partial(
                client.beta.agents.create,
                model=model,
                name=OPTIMIZER_NAME,
                description=(
                    "Rewrites, decomposes and extracts entity hints from every "
                    "RAG query before the knowledge graph is searched. "
                    "Platform-owned — cannot be deleted."
                ),
                instructions=OPTIMIZER_INSTRUCTIONS,
                metadata=OPTIMIZER_METADATA,
                # Determinism has to be set here: a per-call temperature is not
                # accepted by agents.complete, and an optimiser that rewrites the
                # same question differently on each ask makes retrieval
                # irreproducible.
                completion_args=CompletionArgs(temperature=0.0),
            )
        )
    except Exception as e:
        logger.warning("Could not create the query optimiser agent: %s", e)
        return None

    store.set_system_agent(OPTIMIZER_KEY, agent.id, OPTIMIZER_NAME, model)
    logger.info("Query optimiser agent ready: %s", agent.id)
    return agent.id


def is_protected(agent_id: str, metadata: Optional[dict] = None) -> bool:
    """Whether this agent is platform-owned and must not be deleted.

    Checked two ways. The registration is authoritative locally; the metadata
    check covers an agent created against a database that has since been
    replaced, which would otherwise become deletable and silently break RAG.
    """
    if not agent_id:
        return False
    if agent_id in store.system_agent_ids():
        return True
    if metadata and str(metadata.get("protected", "")).lower() == "true":
        return True
    return False


def status() -> dict:
    """What the optimiser is and where it runs — for the UI and diagnostics."""
    registration = store.get_system_agent(OPTIMIZER_KEY) or {}
    return {
        "agent_id": registration.get("agent_id"),
        "name": registration.get("name") or OPTIMIZER_NAME,
        "model": registration.get("model"),
        "backend": backend_name(),
        "toolkit_available": toolkit_available(),
        "protected": True,
        "cached_queries": len(_CACHE),
    }
