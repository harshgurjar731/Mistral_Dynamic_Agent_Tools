"""Process knowledge: ontology levels, validation, storage, resolution, the
pipeline contract and the graph — no Mistral, no tool service."""

import asyncio
import copy
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.ontology.vocab import Scheme
from app.process_knowledge import templates, validation
from app.process_knowledge.templates import DEFAULT_EXAMPLE


@pytest.fixture
def db(monkeypatch, tmp_path):
    """A private database with the domain and process schemes and a small tree."""
    import app.ontology.models  # noqa: F401
    import app.process_knowledge.models  # noqa: F401
    from app.database import Base
    from app.ontology import knowledge, store as ontology_store
    from app.process_knowledge import store as process_store

    engine = create_engine(f"sqlite:///{tmp_path / 'pk.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (ontology_store, knowledge, process_store, templates):
        monkeypatch.setattr(module, "SessionLocal", Session)

    from app.ontology.models import ConceptScheme

    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"),
               ConceptScheme(id="process", label="Process")])
    s.commit()
    s.close()
    ontology_store.create_concept("domain.bfsi", "domain", "BFSI")
    ontology_store.create_concept("domain.lending", "domain", "Lending", "domain.bfsi")
    ontology_store.create_concept("domain.lending.mortgage", "domain", "Mortgage", "domain.lending",
                                  synonyms=["mortgage", "home loan"])
    ontology_store.create_concept("domain.health", "domain", "Healthcare")
    templates.ensure_builtin()
    return Session


def _proc(store_mod, cid="process.lending.mortgage.residential_mortgage_approval",
          label="Residential mortgage approval", domain="domain.lending.mortgage", synonyms=()):
    store_mod.create_concept(cid, Scheme.PROCESS.value, label, synonyms=list(synonyms))
    store_mod.link_concepts(cid, domain)
    return cid


# ── Ontology levels ────────────────────────────────────────────────────────


def test_process_levels_and_links(db):
    from app.ontology import store

    pid = _proc(store)
    store.create_concept(f"{pid}.affordability", "process", "Affordability", pid)

    assert store.get_concept(pid)["level_name"] == "process"
    assert store.get_concept(f"{pid}.affordability")["level_name"] == "subprocess"
    assert store.domain_of(f"{pid}.affordability") == "domain.lending.mortgage"
    # Reachable from the subdomain, from its ancestors' scope, and not from a sibling.
    assert store.processes_under(["domain.lending"]) == {pid, f"{pid}.affordability"}
    assert store.processes_under(["domain.health"]) == set()
    # The domain walk itself is unchanged: processes never become descendants.
    assert pid not in store.descendants("domain.lending")


def test_link_rejects_wrong_schemes(db):
    from app.ontology import store

    with pytest.raises(store.VocabularyError):
        store.link_concepts("domain.lending", "domain.bfsi")


def test_delete_domain_with_processes_is_refused_then_cascades(db):
    from app.ontology import store
    from app.process_knowledge import store as process_store

    pid = _proc(store)
    process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)

    usage = store.concept_usage("domain.lending.mortgage")
    assert usage["processes"] == [pid]
    with pytest.raises(store.VocabularyError):
        store.delete_concept("domain.lending.mortgage")

    result = store.delete_concept("domain.lending.mortgage", cascade=True)
    assert pid in result["concept_ids"]
    assert store.get_concept(pid) is None
    assert process_store.count_for_concepts([pid]) == 0
    assert store.all_links() == []


# ── Validation ─────────────────────────────────────────────────────────────


def _validate(doc, **kw):
    return validation.validate(doc if isinstance(doc, (str, bytes)) else json.dumps(doc),
                               templates.default_template(), **kw)


def test_builtin_example_is_valid(db):
    report = _validate(DEFAULT_EXAMPLE)
    assert report["valid"], report["errors"]
    assert report["stats"]["stages"] == 5 and report["stats"]["mandatory_controls"] == 3


def test_invalid_json_reports_line_and_fix(db):
    report = _validate('{\n  "process": {"id": "x",}\n}')
    assert not report["valid"]
    issue = report["errors"][0]
    assert issue["code"] == "invalid_json" and issue["path"].startswith("line 2")
    assert "trailing comma" in issue["fix"].lower()


def test_schema_errors_are_specific(db):
    doc = copy.deepcopy(DEFAULT_EXAMPLE)
    del doc["objective"]
    doc["stages"][0]["actor_type"] = "robot"
    doc["controls"][0]["mandatory"] = "yes"
    doc["process"]["id"] = "Bad Id"
    codes = {(i["code"], i["path"]) for i in _validate(doc)["errors"]}
    assert ("missing_field", "objective") in codes
    assert ("not_allowed", "stages[0].actor_type") in codes
    assert ("wrong_type", "controls[0].mandatory") in codes
    assert ("bad_format", "process.id") in codes


def test_semantic_checks(db):
    doc = copy.deepcopy(DEFAULT_EXAMPLE)
    doc["stages"][4]["depends_on"] = ["decision", "nowhere"]
    doc["stages"][0]["depends_on"] = ["manual_review"]  # makes a loop
    doc["stages"].append(dict(doc["stages"][0]))          # duplicate id
    doc["controls"][1]["applies_to"] = ["ghost"]
    doc["extra_thing"] = 1
    report = _validate(doc)
    codes = {i["code"] for i in report["errors"]}
    assert {"unknown_reference", "dependency_cycle", "duplicate_id"} <= codes
    assert any(w["code"] == "unknown_field" and w["path"] == "extra_thing"
               for w in report["warnings"])


def test_size_limit(db):
    report = validation.validate(b"{" + b" " * 3000 + b"}", templates.default_template(), max_kb=1)
    assert report["errors"][0]["code"] == "too_large"


def test_placement_checks_level(db):
    from app.ontology import store

    pid = _proc(store)
    store.create_concept(f"{pid}.aff", "process", "Affordability", pid)
    report = _validate(DEFAULT_EXAMPLE, concept_id=f"{pid}.aff")
    assert any(i["code"] == "wrong_level" for i in report["errors"])
    assert _validate(DEFAULT_EXAMPLE, concept_id=pid)["valid"]


# ── Templates ──────────────────────────────────────────────────────────────


def test_inferred_template_accepts_its_example(db):
    schema = templates.infer_schema(DEFAULT_EXAMPLE)
    assert templates.check_schema(schema) == []
    tpl = {"schema": schema, "id": None, "name": "x", "version": 1}
    assert validation.validate(DEFAULT_EXAMPLE, tpl)["valid"]
    broken = copy.deepcopy(DEFAULT_EXAMPLE)
    del broken["stages"]
    assert not validation.validate(broken, tpl)["valid"]


def test_skeleton_and_bad_schema(db):
    blank = templates.skeleton_from_schema(templates.DEFAULT_SCHEMA)
    assert set(templates.DEFAULT_SCHEMA["required"]) <= set(blank)
    assert blank["stages"][0]["actor_type"] == "agent"
    assert templates.check_schema({"type": 5})
    assert templates.looks_like_schema(templates.DEFAULT_SCHEMA)
    assert not templates.looks_like_schema(DEFAULT_EXAMPLE)


def test_new_default_template_marks_documents_stale(db):
    from app.ontology import store
    from app.process_knowledge import store as process_store

    pid = _proc(store)
    saved = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)
    assert saved["document"]["is_active"]

    stricter = copy.deepcopy(templates.DEFAULT_SCHEMA)
    stricter["required"] = [*stricter["required"], "service_level"]
    created = templates.create_template("Strict", stricter, make_default=True)
    counts = process_store.revalidate_all(created["id"])
    assert counts["stale"] == 1
    doc = process_store.get_document(saved["document"]["id"])
    assert doc["status"] == "stale" and not doc["is_active"]


# ── Storage ────────────────────────────────────────────────────────────────


def test_versions_and_activation(db):
    from app.ontology import store
    from app.process_knowledge import store as process_store

    pid = _proc(store)
    v1 = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)["document"]
    bad = process_store.save_document('{"process": 1}', concept_id=pid)["document"]
    v2 = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)["document"]

    assert (v1["version"], v2["version"]) == (1, 2)
    assert bad["status"] == "invalid" and not bad["is_active"]
    assert process_store.active_for([pid])[pid]["id"] == v2["id"]
    with pytest.raises(ValueError):
        process_store.activate(bad["id"])
    process_store.activate(v1["id"])
    assert process_store.active_for([pid])[pid]["id"] == v1["id"]

    # Fixing the invalid one in place promotes it to the next version.
    fixed = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid,
                                        replace_id=bad["id"])["document"]
    assert fixed["id"] == bad["id"] and fixed["status"] == "valid" and fixed["version"] == 3


def test_delete_refused_while_used(db):
    from app.ontology import store
    from app.process_knowledge import store as process_store

    pid = _proc(store)
    doc = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)["document"]
    process_store.record_usage([{"document_id": doc["id"], "subject_type": "workflow",
                                 "subject_id": "wf1", "layer": "goal_decomposition",
                                 "element": "stage:intake", "concept_id": pid}])
    with pytest.raises(PermissionError):
        process_store.delete_document(doc["id"])
    assert process_store.delete_document(doc["id"], force=True)["usage_removed"] == 1


# ── Resolution ─────────────────────────────────────────────────────────────


def test_resolve_uploaded_inventory_and_none(db, monkeypatch):
    from app.config import settings
    from app.ontology import store
    from app.process_knowledge import resolver, store as process_store

    monkeypatch.setattr(settings, "PROCESS_MATCH_MIN_SCORE", 3.0)
    pid = _proc(store, synonyms=["mortgage approval"])
    doc = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)["document"]
    scope = {"domains": ["domain.lending.mortgage"], "scoped": True, "concepts": set()}

    uploaded = resolver.resolve("anything", scope, [doc["id"]])
    assert uploaded["mode"] == "uploaded" and uploaded["documents"][0]["id"] == doc["id"]

    matched = resolver.resolve("approve a residential mortgage application", scope)
    assert matched["mode"] == "inventory"
    assert matched["documents"][0]["path"].startswith("BFSI › Lending › Mortgage")

    none = resolver.resolve("triage a patient", {"domains": ["domain.health"], "scoped": True})
    assert none["mode"] == "none" and "No process is defined" in none["message"]

    invalid = process_store.save_document('{"x": 1}', concept_id=None)["document"]
    fallback = resolver.resolve("approve a residential mortgage", scope, [invalid["id"]])
    assert fallback["mode"] == "inventory" and "Not using the attached" in fallback["message"]


# ── Pipeline contract ──────────────────────────────────────────────────────


def _context(db):
    from app.ontology import store
    from app.process_knowledge import context, store as process_store

    pid = _proc(store)
    doc = process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)["document"]
    return context.build([process_store.get_document(doc["id"])], mode="uploaded")


def test_off_leaves_prompts_unchanged():
    """With the feature off, every decision layer sends the prompt it always did."""
    from app.core.context import PipelineContext
    from app.core.decision import DecisionLayer
    from app.layers import chat_pipeline, workflow_pipeline

    ctx = PipelineContext(query="x")
    layers = []
    for pipeline in (chat_pipeline, workflow_pipeline):
        for layer in pipeline._layers:
            layers += getattr(layer, "layers", [layer])
    decision_layers = [l for l in layers if isinstance(l, DecisionLayer)]
    assert any(l.process_view for l in decision_layers)
    for layer in decision_layers:
        assert layer.process_block(ctx) == ""


def test_decision_layer_appends_block_and_records_refs(db, monkeypatch):
    from app.core import decision
    from app.core.context import PipelineContext
    from app.core.decision import DecisionLayer
    from app.process_knowledge import pipeline as pk

    sent = {}

    async def fake_decide(client, **kw):
        sent["user"] = kw["user"]
        return json.dumps({"reasoning": "r", "process_refs": [
            {"ref": "stage:intake", "how": "made it the entry step"},
            {"ref": "stage:invented", "how": "not real"}]})

    monkeypatch.setattr(decision, "decide", fake_decide)

    class Probe(DecisionLayer):
        name = "probe"
        process_view = "topology"

        def build_prompt(self, ctx):
            return "sys", "USER"

        def apply(self, ctx, data):
            pass

    ctx = PipelineContext(query="x")
    ctx.metadata[pk.CONTEXT_KEY] = _context(db)
    ctx.metadata[pk.USAGE_KEY] = {}

    async def done(c):
        return c

    asyncio.run(Probe().process(ctx, done))
    assert sent["user"].startswith("USER\n\n── PROCESS KNOWLEDGE")
    assert "[stage:intake]" in sent["user"] and "process_refs" in sent["user"]
    # Only the reference that exists in the documents is recorded.
    assert [u["ref"] for u in pk.usage_for(ctx, "probe")] == ["stage:intake"]

    ctx.emit_layer("probe", "completed")
    layer_event = json.loads(ctx.events[-1].data) if isinstance(ctx.events[-1].data, str) \
        else ctx.events[-1].data
    assert layer_event["process"][0]["ref"] == "stage:intake"


def test_views_render_the_right_parts(db):
    from app.process_knowledge import context

    pc = _context(db)
    design = context.render(pc, "design", focus="affordability")
    assert "Affordability assessment" in design and "control:stress_test" in design
    assert "Application intake" not in design
    guard = context.render(pc, "guardrail")
    assert "risk:unexplained_decline" in guard and "pii" in guard
    assert context.render(pc, "data_flow").count("inputs:") >= 3


def test_coverage_warns_on_uncovered_mandatory_control(db):
    from app.core.context import PipelineContext
    from app.core.specs import CapabilitySpec, WorkflowSpec
    from app.layers.workflow.finalize_layers import _process_coverage
    from app.process_knowledge import pipeline as pk

    ctx = PipelineContext(query="x")
    ctx.metadata[pk.CONTEXT_KEY] = _context(db)
    ctx.metadata[pk.USAGE_KEY] = {}
    ctx.workflow_spec = WorkflowSpec(goal="g", capabilities=[
        CapabilitySpec(id="check_id", process_stage="identity_check"),
        CapabilitySpec(id="decide", process_stage="decision"),
    ])
    issues = _process_coverage(ctx, "workflow_validation", {"check_id", "decide"})
    # kyc and decision_rationale are covered; stress_test (affordability) is not.
    assert [i["code"] for i in issues] == ["process_control_uncovered"]
    assert "stress_test" in issues[0]["message"]


# ── Graph ──────────────────────────────────────────────────────────────────


def test_graph_shows_processes_only_when_filtered(db, monkeypatch):
    from app.ontology import graph, store
    from app.process_knowledge import store as process_store

    async def no_inventory(client):
        return {"agents": [], "tools": [], "connectors": [], "workflows": [], "libraries": []}

    monkeypatch.setattr(graph, "_fetch_inventory", no_inventory)
    pid = _proc(store)
    store.create_concept(f"{pid}.aff", "process", "Affordability", pid)
    process_store.save_document(copy.deepcopy(DEFAULT_EXAMPLE), concept_id=pid)

    full = asyncio.run(graph.build_graph(None))
    kinds = {n["kind"] for n in full["nodes"]}
    assert not kinds & graph.PROCESS_KINDS
    lending = next(n for n in full["nodes"] if n["id"] == "domain.lending")
    assert lending["process_count"] == 1

    narrowed = asyncio.run(graph.build_graph(None, root_concept="domain.lending"))
    by_id = {n["id"]: n for n in narrowed["nodes"]}
    assert by_id[pid]["kind"] == "process" and by_id[f"{pid}.aff"]["kind"] == "subprocess"
    assert any(n["kind"] == "process_document" for n in narrowed["nodes"])
    edge_kinds = {e["kind"] for e in narrowed["edges"]}
    assert {"part_of_domain", "documents", "hierarchy"} <= edge_kinds
    assert "domain.health" not in by_id


# ── API ────────────────────────────────────────────────────────────────────


def test_api_create_upload_validate_download(db):
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    industry = client.post("/api/processes/concepts",
                           json={"level": "industry", "label": "Insurance"}).json()
    assert industry["id"] == "domain.insurance"
    domain = client.post("/api/processes/concepts", json={
        "level": "domain", "label": "Claims", "parent_id": industry["id"]}).json()
    refused = client.post("/api/processes/concepts", json={
        "level": "process", "label": "Claims lifecycle", "parent_id": industry["id"]})
    assert refused.status_code == 422
    process = client.post("/api/processes/concepts", json={
        "level": "process", "label": "Residential mortgage approval",
        "parent_id": domain["id"]}).json()
    assert process["scheme_id"] == "process"

    bad = client.post(f"/api/processes/concepts/{process['id']}/documents",
                      files={"file": ("p.json", b'{"process": {', "application/json")}).json()
    assert bad["document"]["status"] == "invalid"
    assert bad["report"]["errors"][0]["code"] == "invalid_json"

    good = client.post(f"/api/processes/concepts/{process['id']}/documents/json",
                       json={"content": DEFAULT_EXAMPLE, "replace_id": bad["document"]["id"],
                             "source": "ai_fixed"}).json()
    assert good["document"]["status"] == "valid" and good["document"]["is_active"]

    dry = client.post("/api/processes/validate",
                      files={"file": ("p.json", json.dumps(DEFAULT_EXAMPLE).encode(), "application/json")})
    assert dry.json()["valid"]

    blank = client.get("/api/processes/templates/default/download?kind=blank")
    assert blank.status_code == 200 and "attachment" in blank.headers["content-disposition"]
    assert "stages" in blank.json()

    cards = client.get("/api/processes/industries").json()["industries"]
    card = next(c for c in cards if c["id"] == "domain.insurance")
    assert card["counts"]["processes"] == 1 and card["counts"]["valid_documents"] == 1

    node = client.get(f"/api/processes/concepts/{process['id']}").json()
    assert node["path"] == "Insurance › Claims › Residential mortgage approval"
    assert len(node["documents"]) == 1

    preview = client.post("/api/processes/templates/preview",
                          files={"file": ("ex.json", json.dumps(DEFAULT_EXAMPLE).encode())}).json()
    assert preview["kind"] == "inferred" and preview["problems"] == []
