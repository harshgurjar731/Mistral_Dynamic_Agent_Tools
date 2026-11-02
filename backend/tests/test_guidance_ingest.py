"""Knowledge sources: extract, distill, scope, dedupe, embed, conflicts — with a fake Mistral client."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
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

    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (catalog_store, knowledge_store):
        monkeypatch.setattr(module, "SessionLocal", Session)
    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"), ConceptScheme(id="process", label="Process")])
    s.commit()
    s.close()
    catalog_store.create_concept("domain.procurement", "domain", "Procurement",
                                 synonyms=["procurement", "accounts payable", "invoice"])
    return Session


class FakeClient:
    """OCR returns two pages; embeddings map each text to a fixed direction by keyword."""

    def __init__(self):
        self.ocr = SimpleNamespace(process=self._ocr)
        self.embeddings = SimpleNamespace(create=self._embed)
        self.ocr_calls = 0

    def _ocr(self, model, document, **kw):
        self.ocr_calls += 1
        pages = [SimpleNamespace(index=0, markdown="# Agent design\nAlways use a task agent for invoice extraction."),
                 SimpleNamespace(index=1, markdown="Never let an agent post payments without review.")]
        return SimpleNamespace(pages=pages)

    def _embed(self, model, inputs):
        def vec(text):
            t = text.lower()
            return [1.0 if "task agent" in t else 0.0, 1.0 if "payment" in t else 0.0, 0.1]
        return SimpleNamespace(data=[SimpleNamespace(embedding=vec(t)) for t in inputs])


DISTILLED = {"items": [
    {"kind": "guidance", "category": "archetype", "title": "Task agents for invoice extraction",
     "body": "Use a task agent with a strict schema for invoice extraction.", "strength": "must",
     "subject": "agent", "audience": "builder", "scope_hint": "accounts payable invoice",
     "conditions": [{"attr": "execution_profile.workflow_determinism", "op": "eq", "value": "fixed_steps"},
                    {"attr": "made.up.attribute", "op": "eq", "value": "x"}],
     "effect": {"archetype.primary_type": "task", "archetype.patterns.add": ["reflective", "teleport"],
                "archetype.colour": "blue"},
     "page": 1, "quote": "Always use a task agent for invoice extraction.", "confidence": "high"},
    {"kind": "guidance", "category": "governance", "title": "Review before payment",
     "body": "Do not let an agent post payments without a human review.", "strength": "avoid",
     "scope_hint": "", "page": 2, "quote": "Never let an agent post payments", "confidence": "medium"},
    {"kind": "reference", "category": "regulation", "title": "Three-way match",
     "body": "Match purchase order, goods receipt and invoice before paying.", "confidence": "high"},
    {"title": "", "body": "no title — dropped"},
]}


def _fake_decide(monkeypatch, payload=DISTILLED):
    from app.core import decision

    calls = []

    async def fake(client, **kw):
        calls.append(kw)
        return json.dumps(payload)

    monkeypatch.setattr(decision, "decide", fake)
    return calls


def test_clean_item_keeps_only_known_conditions_and_effects():
    from app.knowledge.distill import clean_item

    item = clean_item(DISTILLED["items"][0])
    assert item["conditions"] == [{"attr": "execution_profile.workflow_determinism", "op": "eq", "value": "fixed_steps"}]
    assert item["effect"] == {"archetype.primary_type": "task", "archetype.patterns.add": ["reflective"]}
    assert clean_item(DISTILLED["items"][3]) is None
    ref = clean_item(DISTILLED["items"][2])
    assert ref["kind"] == "reference" and ref["strength"] is None and ref["audience"] == "runtime"


def test_chunks_split_on_headings_and_pages():
    from app.knowledge.distill import chunks

    text = "<!-- page 1 -->\n# A\n" + "x" * 50 + "\n<!-- page 2 -->\n# B\n" + "y" * 50
    assert chunks(text, size=80) == ["<!-- page 1 -->\n# A\n" + "x" * 50 + "\n",
                                     "<!-- page 2 -->\n# B\n" + "y" * 50]
    assert "".join(chunks(text, size=10000)) == text


def test_add_source_extracts_distils_scopes_and_embeds(db, monkeypatch):
    from app.knowledge import ingest, store

    calls = _fake_decide(monkeypatch)
    client = FakeClient()
    out = asyncio.run(ingest.add_source(client, data=b"%PDF-1.4 fake", filename="guide.pdf",
                                        content_type="application/pdf"))
    assert client.ocr_calls == 1 and "<!-- page 2 -->" in calls[0]["user"]
    assert out["result"]["created"] == 3 and out["source"]["status"] == "distilled"

    items = {i["title"]: i for i in store.list_items()}
    task = items["Task agents for invoice extraction"]
    assert task["status"] == "proposed"  # review required by default
    assert task["concept_id"] == "domain.procurement"  # scope hint matched the catalog
    assert task["source_ref"]["page"] == 1 and task["has_embedding"]
    assert items["Review before payment"]["concept_id"] is None  # general guidance stays global


def test_redistil_is_idempotent_and_keeps_reviewed_items(db, monkeypatch):
    from app.knowledge import ingest, store

    _fake_decide(monkeypatch)
    out = asyncio.run(ingest.add_source(FakeClient(), text="Some guidance text.", title="Notes"))
    sid = out["source"]["id"]
    keep = store.list_items(source_id=sid)[0]
    store.set_status([keep["id"]], "active")

    again = asyncio.run(ingest.distill_source(FakeClient(), sid))
    assert again["skipped_duplicates"] == 1  # the approved one is not duplicated
    assert len(store.list_items(source_id=sid)) == 3


def test_contradicting_guidance_is_flagged(db, monkeypatch):
    from app.knowledge import ingest, store

    existing = store.create_item({"kind": "guidance", "category": "governance", "title": "Let agents post payments",
                                  "body": "Agents may post payment runs directly.", "strength": "should",
                                  "status": "active"})
    asyncio.run(__import__("app.knowledge.embed", fromlist=["x"]).embed_missing(FakeClient(), [existing["id"]]))
    _fake_decide(monkeypatch)
    asyncio.run(ingest.add_source(FakeClient(), text="Payments guidance.", title="Payments"))
    flagged = next(i for i in store.list_items() if i["title"] == "Review before payment")
    assert flagged["status"] == "conflicting" and f"guidance:{existing['id']}" in flagged["rationale"]


def test_routes_items_and_recommendation_preview(db, monkeypatch):
    from fastapi.testclient import TestClient

    import app.main

    client = TestClient(app.main.app)
    made = client.post("/api/knowledge/items", json={
        "kind": "guidance", "category": "naming", "title": "Name by domain",
        "body": "Agent names reflect the business domain.", "strength": "should"}).json()
    assert made["id"] and made["audience"] == "builder"
    listed = client.get("/api/knowledge/items", params={"kind": "guidance"}).json()
    assert listed["count"] == 1
    assert client.post("/api/knowledge/items/status", json={"ids": [made["id"]], "status": "retired"}).json() == {"updated": 1}
    assert client.post("/api/knowledge/items", json={"kind": "nope", "title": "x", "body": "y"}).status_code == 400
    vocab = client.get("/api/knowledge/vocabulary").json()
    assert "execution_profile.workflow_determinism" in vocab["condition_attributes"]

    from pathlib import Path

    p2p = (Path(__file__).parent / "fixtures" / "p2p_recommendations.json").read_text(encoding="utf-8")
    preview = client.post("/api/processes/recommendations/import",
                          data={"content": p2p, "domain_id": "domain.procurement", "save": "false"}).json()
    assert len(preview["imported"]) == 8 and preview["imported"][0]["missing"]
