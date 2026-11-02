"""One knowledge store, one usage table, and the guidance half of KnowledgeContextLayer."""

import asyncio

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def db(monkeypatch, tmp_path):
    import app.catalog.models  # noqa: F401
    import app.knowledge.models  # noqa: F401
    import app.process.models  # noqa: F401
    from app.catalog import store as catalog_store
    from app.catalog.models import ConceptScheme
    from app.database import Base
    from app.knowledge import store as knowledge_store
    from app.process import store as process_store

    engine = create_engine(f"sqlite:///{tmp_path / 'k.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (catalog_store, knowledge_store, process_store):
        monkeypatch.setattr(module, "SessionLocal", Session)
    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"), ConceptScheme(id="process", label="Process")])
    s.commit()
    s.close()
    catalog_store.create_concept("domain.manufacturing", "domain", "Manufacturing")
    catalog_store.create_concept("domain.procurement", "domain", "Procurement", "domain.manufacturing")
    catalog_store.create_concept("domain.health", "domain", "Healthcare")
    return Session


def _ctx(**kw):
    from app.core.context import PipelineContext

    return PipelineContext(query=kw.pop("query", "extract invoice fields and post to the ERP"), **kw)


def _guidance(**kw):
    from app.knowledge import store

    data = {"kind": "guidance", "category": "archetype", "title": "Task agent for fixed extraction",
            "body": "Use a task agent with a strict output schema for fixed-format invoice extraction.",
            "strength": "should", "audience": "builder"}
    data.update(kw)
    return store.create_item(data)


# ── Store and migration ────────────────────────────────────────────────────


def test_legacy_industry_knowledge_is_copied_once(db):
    from app.knowledge import store

    s = db()
    s.execute(text("INSERT INTO industry_knowledge (concept_id, kind, title, body, tags, source) VALUES "
                   "('domain.procurement', 'regulation', 'Three-way match', 'Match PO, GRN and invoice.', '[]', 'seed'),"
                   "('domain.procurement', 'best_practice', 'Separate maker and checker', 'Vendor changes need two people.', NULL, 'user')"))
    s.commit()
    s.close()

    store.ensure_schema()
    store.ensure_schema()

    items = store.list_items()
    assert len(items) == 2
    ref = next(i for i in items if i["title"] == "Three-way match")
    bp = next(i for i in items if i["title"] == "Separate maker and checker")
    assert (ref["kind"], ref["audience"], ref["origin"]) == ("reference", "runtime", "seed")
    assert (bp["kind"], bp["category"], bp["audience"], bp["strength"]) == ("guidance", "best_practice", "both", "should")


def test_reference_api_keeps_its_shape(db):
    from app.knowledge import reference

    entry = reference.upsert_entry("domain.procurement", "Three-way match", "Match PO, GRN and invoice.",
                                   kind="regulation", tags=["3-way"])
    assert set(entry) == {"id", "concept_id", "kind", "title", "body", "tags", "as_of", "source"}
    assert entry["kind"] == "regulation"
    again = reference.upsert_entry("domain.procurement", "Three-way match", "Updated.", kind="regulation")
    assert again["id"] == entry["id"] and reference.counts() == {"entries": 1, "concepts": 1}
    found = reference.search("match invoice", domains=["domain.procurement"])
    assert found and found[0]["title"] == "Three-way match"
    _guidance()  # builder-only guidance is not runtime reference knowledge
    assert reference.counts()["entries"] == 1


def test_validation_rejects_bad_items(db):
    from app.knowledge import store

    with pytest.raises(store.KnowledgeError):
        store.create_item({"kind": "guidance", "category": "regulation", "title": "x", "body": "y"})
    with pytest.raises(store.KnowledgeError):
        store.create_item({"kind": "guidance", "title": "x", "body": "y", "conditions": [{"op": "eq"}]})
    with pytest.raises(store.KnowledgeError):
        store.create_item({"kind": "reference", "title": "x", "body": "y", "concept_id": "domain.nope"})


# ── Retrieval ──────────────────────────────────────────────────────────────


def test_conditions_true_false_unknown():
    from app.knowledge.retrieval import evaluate

    facts = {"execution_profile": {"workflow_determinism": "fixed_steps", "input_variability": "standard_forms"},
             "integrations": {"systems": [{"access": "read"}, {"access": "write"}]}}
    yes = [{"attr": "execution_profile.workflow_determinism", "op": "eq", "value": "fixed_steps"},
           {"attr": "execution_profile.input_variability", "op": "in", "value": ["structured", "standard_forms"]}]
    assert evaluate(yes, facts) == "true"
    assert evaluate([{"attr": "execution_profile.workflow_determinism", "op": "eq", "value": "open_ended"}], facts) == "false"
    assert evaluate([{"attr": "governance.reversibility", "op": "eq", "value": "irreversible"}], facts) == "unknown"
    assert evaluate([{"attr": "integrations.systems.access", "op": "eq", "value": "write"}], facts) == "true"


def test_select_filters_scope_and_conditions_and_ranks_strength(db):
    from app.knowledge import retrieval

    keep = _guidance(title="Global should")
    must = _guidance(title="Procurement must", strength="must", concept_id="domain.procurement")
    _guidance(title="Health only", concept_id="domain.health")
    _guidance(title="Wrong shape", conditions=[{"attr": "execution_profile.workflow_determinism",
                                                "op": "eq", "value": "open_ended"}])
    ranked = retrieval.select("invoice extraction", concept_ids=["domain.procurement"],
                              facts={"execution_profile": {"workflow_determinism": "fixed_steps"}})
    titles = [r["title"] for r in ranked]
    assert titles[0] == "Procurement must"
    assert "Global should" in titles and "Health only" not in titles and "Wrong shape" not in titles
    assert {r["id"] for r in ranked} == {keep["id"], must["id"]}


def test_pack_views_follow_category():
    from app.knowledge import retrieval

    items = [{"id": 1, "title": "A", "body": "b", "category": "archetype", "strength": "must"},
             {"id": 2, "title": "N", "body": "b", "category": "naming", "strength": "should",
              "layers": ["agent_identity"]}]
    pack = retrieval.build_pack(items, mode="auto")
    assert pack["views"]["agent_archetype"] == [1] and pack["views"]["agent_identity"] == [2]
    text_block = retrieval.render(pack, "agent_archetype")
    assert "[guidance:1] MUST — A" in text_block and "guidance_refs" in text_block
    assert retrieval.render(pack, "data_flow") == ""


# ── The layer contract ─────────────────────────────────────────────────────


def test_no_guidance_means_nothing_is_set(db):
    from app.knowledge import pipeline as guidance
    from app.layers.knowledge_context_layer import resolve_guidance

    ctx = _ctx()
    assert asyncio.run(resolve_guidance(ctx, goal=ctx.query, concept_ids=[])) is None
    assert guidance.CONTEXT_KEY not in ctx.metadata
    assert guidance.block(ctx, "design") == ""


def test_decision_prompt_is_unchanged_without_guidance(db, monkeypatch):
    from app.core import decision

    seen = []

    async def fake_decide(client, **kw):
        seen.append(kw["user"])
        return '{"reasoning": "ok"}'

    monkeypatch.setattr(decision, "decide", fake_decide)

    class Probe(decision.DecisionLayer):
        name = "probe"
        process_view = "design"

        def build_prompt(self, ctx):
            return "system", "USER PROMPT"

        def apply(self, ctx, data):
            pass

    async def run(ctx):
        async def nxt(c):
            return c
        return await Probe().process(ctx, nxt)

    asyncio.run(run(_ctx()))
    assert seen == ["USER PROMPT"]

    # With guidance in scope the same layer reads its slice, and its answer is recorded.
    _guidance(category="agent_design")
    ctx = _ctx()
    from app.layers.knowledge_context_layer import resolve_guidance

    pack = asyncio.run(resolve_guidance(ctx, goal=ctx.query, concept_ids=[]))
    assert pack and pack["items"]
    ref = f"guidance:{pack['items'][0]['id']}"

    async def answer(client, **kw):
        seen.append(kw["user"])
        return '{"reasoning": "ok", "guidance_refs": ["%s", "guidance:999"]}' % ref

    monkeypatch.setattr(decision, "decide", answer)
    asyncio.run(run(ctx))
    assert seen[-1].startswith("USER PROMPT\n\n## Build guidance") and ref in seen[-1]
    from app.knowledge import pipeline as guidance

    assert [e["ref"] for e in guidance.all_usage(ctx)["probe"]] == [ref]


def test_off_and_selected_modes(db):
    from app.layers.knowledge_context_layer import resolve_guidance

    a = _guidance(title="A")
    _guidance(title="B")
    assert asyncio.run(resolve_guidance(_ctx(guidance_request={"mode": "off"}), goal="x", concept_ids=[])) is None
    pack = asyncio.run(resolve_guidance(_ctx(guidance_request={"mode": "selected", "item_ids": [a["id"]]}),
                                        goal="x", concept_ids=[]))
    assert [i["title"] for i in pack["items"]] == ["A"]


def test_usage_shares_the_table_without_mixing_kinds(db):
    from app.knowledge import pipeline as guidance
    from app.layers.knowledge_context_layer import resolve_guidance
    from app.process import store as process_store

    item = _guidance()
    ctx = _ctx()
    asyncio.run(resolve_guidance(ctx, goal=ctx.query, concept_ids=[]))
    guidance.record_refs(ctx, "agent_design", {"guidance_refs": [f"guidance:{item['id']}"]})
    assert guidance.persist(ctx, "agent", "agent-1", "Invoice extractor") == 1

    assert process_store.usage() == []  # process-document reads see only process rows
    rows = process_store.usage(source_type="guidance")
    assert rows[0]["element"] == f"guidance:{item['id']}" and rows[0]["source_type"] == "guidance"
    from app.knowledge import store

    assert store.get_item(item["id"])["stats"]["used"] == 1


def test_guidance_request_rides_in_the_knowledge_request(db):
    from app.layers.knowledge_context_layer import resolve_guidance

    _guidance(title="A")
    ctx = _ctx(process_request={"enabled": False, "guidance": {"mode": "off"}})
    assert asyncio.run(resolve_guidance(ctx, goal="x", concept_ids=[])) is None
    from app.routes.runs import ProcessKnowledgeRequest

    parsed = ProcessKnowledgeRequest(enabled=True, guidance={"mode": "selected", "item_ids": [3]})
    assert parsed.model_dump()["guidance"] == {"mode": "selected", "item_ids": [3]}
