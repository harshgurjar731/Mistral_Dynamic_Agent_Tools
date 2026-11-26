"""Industry knowledge: filed on the domain tree, read while planning and generating code, never at run time."""

import asyncio
import json

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

    engine = create_engine(f"sqlite:///{tmp_path / 'i.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (catalog_store, knowledge_store, process_store):
        monkeypatch.setattr(module, "SessionLocal", Session)
    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"), ConceptScheme(id="process", label="Process")])
    s.commit()
    s.close()
    catalog_store.create_concept("domain.bfsi", "domain", "BFSI")
    catalog_store.create_concept("domain.lending", "domain", "Lending", "domain.bfsi")
    catalog_store.create_concept("domain.lending.mortgage", "domain", "Mortgage", "domain.lending")
    catalog_store.create_concept("domain.health", "domain", "Healthcare")
    catalog_store.create_concept("process.mortgage_origination", "process", "Mortgage origination")
    catalog_store.link_concepts("process.mortgage_origination", "domain.lending.mortgage")
    from app.config import settings

    for key, value in {"INDUSTRY_KNOWLEDGE_MODE": "auto", "INDUSTRY_JURISDICTIONS": "",
                       "INDUSTRY_INCLUDE_NARROWER": True, "INDUSTRY_IN_CODEGEN": True}.items():
        monkeypatch.setattr(settings, key, value)
    return Session


def _item(**kw):
    from app.knowledge import store

    data = {"kind": "reference", "category": "regulation", "concept_id": "domain.lending",
            "title": "Affordability must be assessed", "strength": "must",
            "body": "A lender must assess affordability from verified income before any mortgage offer."}
    data.update(kw)
    return store.create_item(data)


def _ctx(**kw):
    from app.core.context import PipelineContext

    return PipelineContext(query=kw.pop("query", "assess a mortgage application for affordability"), **kw)


# ── Storage ────────────────────────────────────────────────────────────────


def test_items_are_builder_knowledge_with_a_jurisdiction(db):
    item = _item(category="glossary", jurisdiction=" uk ", audience="runtime", strength=None)
    assert item["category"] == "definition"          # legacy category mapped
    assert item["audience"] == "builder"              # never read at run time
    assert item["jurisdiction"] == "UK"
    assert _item(title="B", jurisdiction="worldwide")["jurisdiction"] == "global"


def test_boot_migration_moves_old_reference_rows_to_planning(db):
    from app.knowledge import store

    s = db()
    s.execute(text("INSERT INTO knowledge_items (kind, category, concept_id, title, body, audience, subject, status, "
                   "origin, used, accepted_builds, rolled_back_builds) VALUES ('reference', 'glossary', "
                   "'domain.lending', 'LTV', 'Loan to value.', 'runtime', 'both', 'active', 'seed', 0, 0, 0)"))
    s.commit()
    s.close()
    store.ensure_schema()
    store.ensure_schema()  # idempotent
    [row] = store.list_items(kind="reference")
    assert (row["audience"], row["category"], row["jurisdiction"]) == ("builder", "definition", "global")


def test_only_industry_domain_and_subdomain_nodes_hold_knowledge(db):
    from app.knowledge import industry

    assert industry.check_node("domain.lending.mortgage")["id"] == "domain.lending.mortgage"
    for bad in (None, "", "domain.nope", "process.mortgage_origination", "domain.system"):
        with pytest.raises(industry.NodeError):
            industry.check_node(bad)
    assert [industry.level_name(c) for c in ("domain.bfsi", "domain.lending", "domain.lending.mortgage")] == \
        ["industry", "domain", "subdomain"]


# ── Scope and ranking ──────────────────────────────────────────────────────


def test_a_plan_reads_its_node_what_is_above_and_matching_narrower_items(db):
    from app.knowledge import industry

    _item()
    _item(title="BFSI conduct", concept_id="domain.bfsi", body="Decisions must be explainable to customers.")
    _item(title="Mortgage LTV cap", concept_id="domain.lending.mortgage", category="business_rule",
          body="Mortgage affordability: LTV above 90% needs senior sign-off.")
    _item(title="Mortgage stamp duty", concept_id="domain.lending.mortgage", category="definition",
          strength="may", body="Tax on property purchase.")
    _item(title="HIPAA", concept_id="domain.health", body="Protect patient data.")

    ranked = industry.select("assess mortgage affordability", concept_ids=["domain.lending"])
    by_title = {i["title"]: i["relation"] for i in ranked}
    assert by_title["Affordability must be assessed"] == "exact"
    assert by_title["BFSI conduct"] == "inherited"
    assert by_title["Mortgage LTV cap"] == "narrower"        # below, and it matches the request
    assert "Mortgage stamp duty" not in by_title             # below, and it does not
    assert "HIPAA" not in by_title                           # another industry
    assert ranked[0]["title"] == "Affordability must be assessed"
    assert industry.select("anything", concept_ids=[]) == []  # no industry matched: nothing


def test_process_nodes_scope_to_their_domain_and_jurisdictions_filter(db, monkeypatch):
    from app.config import settings
    from app.knowledge import industry

    _item()
    _item(title="UK rule", jurisdiction="UK")
    _item(title="US rule", jurisdiction="US-CA")
    titles = lambda: {i["title"] for i in industry.select(  # noqa: E731
        "mortgage", concept_ids=["process.mortgage_origination"])}
    assert {"UK rule", "US rule", "Affordability must be assessed"} <= titles()
    monkeypatch.setattr(settings, "INDUSTRY_JURISDICTIONS", "uk")
    assert titles() == {"UK rule", "Affordability must be assessed"}
    monkeypatch.setattr(settings, "INDUSTRY_JURISDICTIONS", "US")
    assert "US rule" in titles()


def test_views_route_each_category_to_the_decisions_it_can_change(db):
    from app.knowledge import industry

    reg = _item()
    term = _item(title="LTV", category="definition", strength="may", body="Loan divided by value.")
    pack = industry.build_pack(industry.select("mortgage affordability ltv", concept_ids=["domain.lending"]),
                               domains=["domain.lending"])
    assert reg["id"] in pack["views"]["decomposition"] and reg["id"] in pack["views"]["code"]
    assert term["id"] not in pack["views"].get("rules", [])
    block = industry.render(pack, "decomposition")
    assert block.startswith("── INDUSTRY KNOWLEDGE: BFSI › Lending ──")
    assert f"[industry:{reg['id']}] MANDATORY · Regulation" in block and "industry_refs" in block
    assert industry.render(pack, "agent_tools") == ""


# ── Planning: the layer and every decision ─────────────────────────────────


def test_decision_prompts_are_unchanged_without_industry_knowledge(db, monkeypatch):
    from app.core import decision
    from app.knowledge import industry, industry_pipeline

    seen = []

    async def fake_decide(client, **kw):
        seen.append(kw["user"])
        return '{"reasoning": "ok"}'

    monkeypatch.setattr(decision, "decide", fake_decide)

    class Probe(decision.DecisionLayer):
        name = "probe"
        process_view = "decomposition"

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

    item = _item()
    ctx = _ctx()
    industry_pipeline.attach(ctx, asyncio.run(industry.resolve(None, goal=ctx.query, concept_ids=["domain.lending"])))
    ref = f"industry:{item['id']}"

    async def answer(client, **kw):
        seen.append(kw["user"])
        return json.dumps({"reasoning": "ok", "industry_refs": [{"ref": ref, "how": "added a check"},
                                                                 "industry:999"]})

    monkeypatch.setattr(decision, "decide", answer)
    asyncio.run(run(ctx))
    assert seen[-1].startswith("USER PROMPT\n\n── INDUSTRY KNOWLEDGE") and ref in seen[-1]
    assert [(e["ref"], e["how"]) for e in industry_pipeline.all_usage(ctx)["probe"]] == [(ref, "added a check")]


def test_layer_resolves_from_inventory_scope_and_process_and_records_usage(db, monkeypatch):
    from app.core.specs import WorkflowSpec
    from app.knowledge import industry_pipeline, store
    from app.layers.industry_knowledge_layer import IndustryKnowledgeLayer
    from app.process import pipeline as pk
    from app.process import store as process_store

    item = _item(concept_id="domain.lending.mortgage")
    ctx = _ctx()
    ctx.workflow_spec = WorkflowSpec(goal="originate a mortgage", inventory={"scope": {"scoped": False}})
    ctx.workflow_spec.workflow_name = "mortgage_flow"
    ctx.workflow_spec.definition = {"steps": []}
    # No goal match, but the process document's domain scopes it.
    ctx.metadata[pk.CONTEXT_KEY] = {"enabled": True, "documents": [{"id": 1, "concept_id": "process.mortgage_origination"}],
                                    "stages": [], "controls": [], "risks": [], "regulations": [],
                                    "data_entities": [], "exceptions": []}
    monkeypatch.setattr("app.layers.workflow.base.workflow_ready", lambda c: True)
    events = []
    ctx.emit = lambda kind, data=None: events.append((kind, data))

    async def downstream(c):
        industry_pipeline.record_refs(c, "goal_decomposition", {"industry_refs": [f"industry:{item['id']}"]})
        return c

    asyncio.run(IndustryKnowledgeLayer("workflow").process(ctx, downstream))
    assert industry_pipeline.active(ctx)["domains"][0]["id"] == "domain.lending.mortgage"
    payload = json.loads(next(d for k, d in events if k == "industry_knowledge"))
    assert payload["items"][0]["id"] == item["id"]
    rows = process_store.usage(source_type="industry")
    assert rows and rows[0]["subject_id"] == "mortgage_flow" and rows[0]["element"] == f"industry:{item['id']}"
    assert process_store.usage() == []  # process-document reads are unaffected
    assert store.get_item(item["id"])["stats"]["used"] == 1


def test_off_mode_and_request_override(db, monkeypatch):
    from app.config import settings
    from app.knowledge import industry, industry_pipeline

    _item()
    assert asyncio.run(industry.resolve(None, goal="x", concept_ids=["domain.lending"], mode="off")) is None
    ctx = _ctx(process_request={"enabled": False, "industry": {"mode": "off"}})
    assert industry_pipeline.industry_request(ctx) == {"mode": "off"}
    monkeypatch.setattr(settings, "INDUSTRY_KNOWLEDGE_MODE", "off")
    assert asyncio.run(industry.resolve(None, goal="x", concept_ids=["domain.lending"])) is None
    from app.routes.runs import ProcessKnowledgeRequest

    assert ProcessKnowledgeRequest(industry={"mode": "off"}).model_dump()["industry"] == {"mode": "off"}


# ── Code generation ────────────────────────────────────────────────────────


def test_code_generation_gets_rules_and_formulas_for_its_purpose(db, monkeypatch):
    from app.config import settings
    from app.core.specs import CodeNeed, CodeRequirement
    from app.knowledge import industry, industry_pipeline
    from app.layers.codegen.layers import requirement_from_answer
    from app.layers.codegen.profiles import profile_for

    rule = _item(title="LTV above 90% is referred", category="business_rule", strength="should",
                 body="Applications with LTV above 90 percent go to a senior underwriter.")
    _item(title="Mortgage glossary: redemption", category="definition", strength="may",
          body="Paying the mortgage off in full.")
    ctx = _ctx()
    industry_pipeline.attach(ctx, asyncio.run(industry.resolve(None, goal="mortgage ltv",
                                                               concept_ids=["domain.lending"])))
    items = industry_pipeline.code_items(ctx, "compute ltv and flag referrals")
    assert items[0]["ref"] == f"industry:{rule['id']}"
    assert all("redemption" not in i["title"] for i in items)  # unrelated definition left out

    need = CodeNeed(purpose="activity", intent="compute ltv", industry_knowledge=items)
    prompt = profile_for("activity").author_user(need=need, normalised={}, issues=[], previous=None)
    assert "## Industry knowledge the code must follow" in prompt and f"industry:{rule['id']}" in prompt

    req = requirement_from_answer({"name": "ltv", "industry_refs": [f"industry:{rule['id']}", "industry:999"]},
                                  need, {})
    assert req.industry_refs == [f"industry:{rule['id']}"]
    assert req.as_request()["industry_knowledge"] == items
    assert "industry_knowledge" not in CodeRequirement(name="x").as_request()  # unchanged without it
    assert CodeRequirement.from_dict(req.as_request()).industry_knowledge == items  # kept for rebuilds

    monkeypatch.setattr(settings, "INDUSTRY_IN_CODEGEN", False)
    assert industry_pipeline.code_items(ctx, "compute ltv") == []


# ── Ingestion ──────────────────────────────────────────────────────────────


def test_structured_pack_imports_exactly_under_its_node(db):
    from app.knowledge import industry_ingest, store

    pack = industry_ingest.parse_pack(json.dumps(industry_ingest.pack_template()).encode(), "pack.json")
    source = store.create_source(title="Pack", source_type="file", concept_id="domain.lending.mortgage",
                                 purpose="industry")
    result = industry_ingest.import_pack(pack, source=source, default_node="domain.lending")
    items = store.list_items(ids=result["created"])
    assert len(items) == 3 and {i["status"] for i in items} == {"active"}
    assert {i["concept_id"] for i in items} == {"domain.lending.mortgage"}
    assert {i["strength"] for i in items} == {"must", "may", "should"}
    again = industry_ingest.import_pack(pack, source=source, default_node="domain.lending")
    assert again["created"] == [] and again["skipped"] == 3  # duplicates by content

    csv_pack = industry_ingest.parse_pack(industry_ingest.pack_template_csv().encode(), "pack.csv")
    assert len(csv_pack["entries"]) == 3
    assert industry_ingest.parse_pack(b"%PDF-1.7", "doc.pdf") is None


def test_distillation_files_facts_in_the_subtree_and_refuses_process_documents(db, monkeypatch):
    from app.core import decision
    from app.knowledge import industry_ingest, store

    answers = iter([
        json.dumps({"document_type": "industry_reference", "items": [
            {"category": "metric", "force": "informational", "title": "DTI", "body": "Debt / income.",
             "node": "domain.lending.mortgage", "confidence": "high"},
            {"category": "regulation", "force": "mandatory", "title": "Elsewhere", "body": "Off-tree.",
             "node": "domain.health"}]}),
        json.dumps({"document_type": "process_document", "items": [
            {"title": "Step 1", "body": "Our own intake."}]}),
    ])

    async def fake_decide(client, **kw):
        assert "domain.lending.mortgage — BFSI › Lending › Mortgage" in kw["system"]
        return next(answers)

    monkeypatch.setattr(decision, "decide", fake_decide)
    source = store.create_source(title="Doc", source_type="text", concept_id="domain.lending",
                                 purpose="industry", text="Lending rules.", status="extracted")
    result = asyncio.run(industry_ingest.distil_source(None, source["id"]))
    items = {i["title"]: i for i in store.list_items(ids=result["item_ids"])}
    assert items["DTI"]["concept_id"] == "domain.lending.mortgage" and items["DTI"]["status"] == "proposed"
    assert items["Elsewhere"]["concept_id"] == "domain.lending"  # not allowed outside the chosen subtree

    other = store.create_source(title="Proc", source_type="text", concept_id="domain.lending",
                                purpose="industry", text="Our process.", status="extracted")
    result = asyncio.run(industry_ingest.distil_source(None, other["id"]))
    assert result["created"] == 0 and "Processes page" in result["notes"][0]


# ── Run time no longer reads it ────────────────────────────────────────────


def test_the_runtime_graph_tool_does_not_search_industry_knowledge(db, monkeypatch):
    from app.rag import domain_search

    _item()
    result = asyncio.run(domain_search.search(None, "affordability", library_ids=[], domains=["domain.lending"]))
    assert result["knowledge"]["entries"] == [] and result["found"] is False
    assert "affordability" not in domain_search.render(result).lower()
    assert domain_search.has_coverage([], ["domain.lending"]) is False
    from app.services.tool_registry import ALL_TOOLS, DOMAIN_SEARCH_TOOL

    spec = ALL_TOOLS[DOMAIN_SEARCH_TOOL]["function"]
    assert "domain" not in spec["parameters"]["properties"] and "industry" not in spec["description"].lower()


# ── API ────────────────────────────────────────────────────────────────────


def test_api_tree_items_preview_and_template(db):
    from fastapi.testclient import TestClient

    from app.dependencies import get_mistral_client
    from app.main import app

    app.dependency_overrides[get_mistral_client] = lambda: None  # no model calls: words-only ranking
    client = TestClient(app)
    created = client.post("/api/industry-knowledge/items", json={
        "concept_id": "domain.lending", "category": "regulation", "strength": "must",
        "title": "Affordability must be assessed", "body": "Assess affordability before any mortgage offer.",
        "jurisdiction": "uk"})
    assert created.status_code == 200, created.text
    assert created.json()["path"] == "BFSI › Lending" and created.json()["jurisdiction"] == "UK"
    refused = client.post("/api/industry-knowledge/items", json={
        "concept_id": "process.mortgage_origination", "title": "x", "body": "y"})
    assert refused.status_code == 400 and "Processes page" in refused.json()["detail"]

    tree = client.get("/api/industry-knowledge/tree").json()
    lending = next(n for n in tree["nodes"] if n["id"] == "domain.lending")
    bfsi = next(n for n in tree["nodes"] if n["id"] == "domain.bfsi")
    assert lending["counts"]["active"] == 1 and bfsi["counts"]["below"] == 1 and lending["level"] == "domain"

    inherited = client.get("/api/industry-knowledge/items",
                           params={"concept_id": "domain.lending.mortgage"}).json()["items"]
    assert [i["relation"] for i in inherited] == ["inherited"]

    preview = client.post("/api/industry-knowledge/preview", json={
        "goal": "assess mortgage affordability", "concept_ids": ["domain.lending.mortgage"]}).json()
    assert preview["items"][0]["title"] == "Affordability must be assessed"
    assert "INDUSTRY KNOWLEDGE" in preview["rendered"]["decomposition"] and preview["code_items"]

    assert client.get("/api/industry-knowledge/config").json()["what_to_upload"]["accepted"]
    assert client.get("/api/industry-knowledge/template", params={"format": "csv"}).text.startswith("node,")
    assert client.get("/api/ontology/knowledge").status_code in (404, 405)  # the old runtime routes are gone
    app.dependency_overrides.pop(get_mistral_client, None)
