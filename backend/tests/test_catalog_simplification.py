"""Catalog simplification: moved modules, one tagger, one tokenizer, closed vocabularies, one tree."""

import asyncio
from pathlib import Path

import pytest
import yaml
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def db(monkeypatch, tmp_path):
    import app.catalog.models  # noqa: F401
    import app.process.models  # noqa: F401
    from app.catalog import store
    from app.catalog.models import ConceptScheme
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'cat.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(store, "SessionLocal", Session)
    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"), ConceptScheme(id="process", label="Process"),
               ConceptScheme(id="capability", label="Capability")])
    s.commit()
    s.close()
    store.create_concept("domain.manufacturing", "domain", "Manufacturing")
    store.create_concept("domain.procurement", "domain", "Procurement", "domain.manufacturing")
    return Session


# ── S1: moved modules alias their new homes ────────────────────────────────


def test_old_import_paths_are_the_same_modules():
    import app.catalog.match as match
    import app.catalog.store as store
    import app.catalog.tagging as tagging
    import app.knowledge.reference as reference
    import app.ontology.autotag as old_autotag
    import app.ontology.backfill as old_backfill
    import app.ontology.classifier as old_classifier
    import app.ontology.knowledge as old_knowledge
    import app.ontology.matcher as old_matcher
    import app.ontology.store as old_store
    import app.process.store as pstore
    import app.process_knowledge.store as old_pstore

    assert old_store is store and old_matcher is match and old_knowledge is reference
    assert old_autotag is tagging and old_backfill is tagging and old_classifier is tagging
    assert old_pstore is pstore


def test_graph_modules_stay_where_they_were():
    import app.ontology.graph  # noqa: F401
    import app.rag.unified_graph  # noqa: F401
    import app.rag.library_domain  # noqa: F401


# ── S2: one tokenizer, one tagger ──────────────────────────────────────────

_OLD_GOAL = set("""a an the and or of for to in on with from by at is are be that this it as
    will can should must workflow agent step process run create build make handle system data new use
    using get set""".split())
_OLD_PROCESS = _OLD_GOAL | {"processes", "please", "want", "need"}
_OLD_QUESTION = set("""a an the and or of for to in on with from by at is are be that this it as
    what how why when which who does do can should must please tell me about""".split())


def test_stopword_sets_match_the_ones_each_matcher_had():
    from app.catalog.match import GOAL_STOPWORDS, PROCESS_STOPWORDS, QUESTION_STOPWORDS

    assert set(GOAL_STOPWORDS) == _OLD_GOAL
    assert set(PROCESS_STOPWORDS) == _OLD_PROCESS
    assert set(QUESTION_STOPWORDS) == _OLD_QUESTION


def test_each_matcher_tokenizes_as_before():
    from app.catalog import match
    from app.knowledge import reference
    from app.process import resolver

    text = "Please process the invoice data: what do we need to approve a purchase requisition?"
    assert match._tokens(text) == {"please", "invoice", "what", "need", "approve", "purchase", "requisition"}
    assert resolver._tokens(text) == {"invoice", "what", "approve", "purchase", "requisition"}
    assert reference._tokens(text) == {"process", "invoice", "data", "need", "approve", "purchase", "requisition"}


def test_tag_dispatches_fast_and_falls_back_from_accurate(monkeypatch):
    from app.catalog import tagging

    calls = []
    monkeypatch.setattr(tagging, "annotate_agent", lambda *a, **k: calls.append(("agent", a, k)) or {"ok": 1})
    monkeypatch.setattr(tagging, "annotate_workflow", lambda *a, **k: calls.append(("wf", a, k)) or {"ok": 2})

    async def empty(*a, **k):
        return {}

    monkeypatch.setattr(tagging, "classify_and_apply", empty)

    assert asyncio.run(tagging.tag("agent", "a1", name="Invoice extractor")) == {"ok": 1}
    assert asyncio.run(tagging.tag("workflow", "wf1", mode="accurate", client=object())) == {"ok": 2}
    assert [c[0] for c in calls] == ["agent", "wf"]


def test_process_classifier_keeps_its_meaning():
    from app.catalog import tagging
    from app.process import classifier

    assert classifier.classify is tagging.place_document
    assert classifier.from_document is tagging.place_from_document


# ── S3: closed vocabularies ────────────────────────────────────────────────


def _seed_capabilities() -> dict[str, str | None]:
    seed = Path(__file__).resolve().parents[1] / "app" / "catalog" / "seed" / "schemes.yaml"
    data = yaml.safe_load(seed.read_text(encoding="utf-8"))
    return {c["id"]: c.get("parent") for c in data["concepts"] if c.get("scheme") == "capability"}


def test_capability_enum_is_the_seeded_vocabulary():
    from app.catalog.vocab import CAPABILITIES

    assert CAPABILITIES == set(_seed_capabilities())


def test_capability_prefix_matches_the_seeded_tree():
    from app.catalog.vocab import capability_covers

    parents = _seed_capabilities()

    def under(node, ancestor):
        while node:
            if node == ancestor:
                return True
            node = parents.get(node)
        return False

    for required in parents:
        for provided in parents:
            assert capability_covers(required, provided) == under(provided, required), (required, provided)


def test_closed_schemes_refuse_edits(db):
    from app.catalog import store

    with pytest.raises(store.VocabularyError, match="closed vocabulary"):
        store.create_concept("capability.teleport", "capability", "Teleport")
    with pytest.raises(store.VocabularyError, match="closed vocabulary"):
        store.delete_scheme("data_class")


# ── S3: one tree ───────────────────────────────────────────────────────────


def test_tree_reads_processes_under_their_domain(db):
    from app.catalog import store

    root = store.create_concept("process.procurement.p2p", "process", "Procure to Pay")["id"]
    store.link_concepts(root, "domain.procurement")
    sub = store.create_concept("process.procurement.p2p.req", "process", "Requisition Management", root)["id"]

    assert store.tree_parent(root) == "domain.procurement"
    assert store.tree_parent(sub) == root
    assert [c["level_name"] for c in store.tree_path(sub)] == ["industry", "domain", "process", "subprocess"]
    assert root in store.tree_children("domain.procurement")
    assert {root, sub} <= store.tree_descendants("domain.manufacturing")
    assert store.tree_ancestors(sub) == {"domain.manufacturing", "domain.procurement", root}


def test_ensure_tree_path_creates_once_then_reuses(db):
    from app.catalog import store

    names = ["Procure to Pay (P2P)", "Requisition Management", "Create Purchase Requisition"]
    first = store.ensure_tree_path("domain.procurement", names)
    again = store.ensure_tree_path("domain.procurement", [n.upper() for n in names])

    assert first == again and len(first) == 3
    assert store.tree_parent(first[0]) == "domain.procurement"
    assert store.get_concept(first[2])["label"] == "Create Purchase Requisition"
    assert store.tree_path(first[2])[-1]["level_name"] == "subprocess"


# ── S6: graph additions ────────────────────────────────────────────────────


def test_agent_type_seed_matches_the_enums():
    from app.catalog.vocab import AGENT_PATTERNS, AGENT_TYPES, CLOSED_SCHEMES

    seed = Path(__file__).resolve().parents[1] / "app" / "catalog" / "seed" / "agent_types.yaml"
    data = yaml.safe_load(seed.read_text(encoding="utf-8"))
    ids = {c["id"] for c in data["concepts"]}
    assert ids == {f"agent_type.{t}" for t in AGENT_TYPES if t != "none"} | {
        f"agent_pattern.{p}" for p in AGENT_PATTERNS}
    assert {"agent_type", "agent_pattern"} <= CLOSED_SCHEMES


def test_graph_draws_archetypes_and_knowledge_items(db, monkeypatch):
    from app.knowledge import store as knowledge_store
    from app.ontology import graph

    monkeypatch.setattr(knowledge_store, "SessionLocal", db)
    import app.knowledge.models  # noqa: F401
    from app.database import Base

    Base.metadata.create_all(db.kw["bind"])
    item = knowledge_store.create_item({"kind": "guidance", "category": "archetype", "title": "Use task agents",
                                        "body": "For fixed steps.", "concept_id": "domain.procurement"})
    assert graph._concept_kind({"scheme_id": "agent_type"}) == "agent_type"
    nodes = {"domain.procurement": {"id": "domain.procurement"}}
    edges: list = []
    graph._add_knowledge_items(nodes, edges)
    node = nodes[f"knowledge:{item['id']}"]
    assert node["kind"] == "guidance" and node["category"] == "archetype"
    assert edges == [{"id": f"k:knowledge:{item['id']}->domain.procurement", "source": f"knowledge:{item['id']}",
                      "target": "domain.procurement", "kind": "about", "label": "about", "reveal": "reverse"}]
