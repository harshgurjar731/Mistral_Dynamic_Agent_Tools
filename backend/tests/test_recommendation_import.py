"""Template v2 and the recommendation importer, against the real P2P export."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

P2P = (Path(__file__).parent / "fixtures" / "p2p_recommendations.json").read_bytes()


@pytest.fixture
def db(monkeypatch, tmp_path):
    import app.catalog.models  # noqa: F401
    import app.process.models  # noqa: F401
    from app.catalog import store as catalog_store
    from app.catalog.models import ConceptScheme
    from app.database import Base
    from app.process import store as process_store, templates

    engine = create_engine(f"sqlite:///{tmp_path / 'r.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (catalog_store, process_store, templates):
        monkeypatch.setattr(module, "SessionLocal", Session)
    s = Session()
    s.add_all([ConceptScheme(id="domain", label="Domain"), ConceptScheme(id="process", label="Process")])
    s.commit()
    s.close()
    catalog_store.create_concept("domain.manufacturing", "domain", "Manufacturing")
    catalog_store.create_concept("domain.procurement", "domain", "Procurement", "domain.manufacturing",
                                 synonyms=["procurement", "accounts payable", "procure to pay"])
    templates.ensure_builtin()
    return Session


def test_v1_example_is_still_valid_under_v2():
    from app.process import templates, validation

    report = validation.validate(templates.DEFAULT_EXAMPLE, {"schema": templates.DEFAULT_SCHEMA})
    assert report["valid"] and not [i for i in report["issues"] if i["severity"] == "error"]


def test_flat_export_maps_and_infers():
    from app.process import recommendations as rec

    parsed = rec.parse(P2P)
    assert parsed["shape"] == "flat" and len(parsed["recommendations"]) == 8
    first, second, mining = parsed["recommendations"][0], parsed["recommendations"][1], parsed["recommendations"][6]
    assert first["intervention"] == {
        "category": "artificial_intelligence", "implementation_type": "agent", "mode": "assist",
        "type": "Copilot Enabled", "description": first["intervention"]["description"]}
    assert first["governance"]["human_oversight"]["model"] == "human_out_of_the_loop"
    assert first["governance"]["risk"]["rating"] == "low"
    assert first["governance"]["governance_controls"] == ["transparency", "reliability", "accountability"]
    assert first["evidence"]["origin"] == "client_sop"
    assert "intervention.implementation_type" in first["_inferred"]
    assert second["intervention"]["implementation_type"] == "workflow_config"
    assert "mode" not in second["intervention"]  # null in the export, not invented
    assert mining["intervention"]["implementation_type"] == "analytics"
    assert mining["evidence"]["origin"] == "market_research"


def test_every_recommendation_becomes_a_valid_v2_document():
    from app.process import recommendations as rec, templates, validation

    parsed = rec.parse(P2P)
    for r in parsed["recommendations"]:
        doc = rec.to_process_document(r, {"industry": "Manufacturing"})
        report = validation.validate(doc, {"schema": templates.DEFAULT_SCHEMA})
        errors = [i for i in report["issues"] if i["severity"] == "error"]
        assert not errors, (r["id"], errors)

    copilot = rec.to_process_document(parsed["recommendations"][0])
    assert [s["actor_type"] for s in copilot["stages"]] == ["agent"]
    maker_checker = rec.to_process_document(parsed["recommendations"][3])
    assert [(s["actor_type"], s["execution"]) for s in maker_checker["stages"]] == [
        ("system", "activity"), ("human", "human_task")]
    assert maker_checker["stages"][1]["is_oversight_point"] is True


def test_market_research_at_high_confidence_is_warned():
    from app.process import recommendations as rec, templates, validation

    invoice = rec.to_process_document(rec.parse(P2P)["recommendations"][5])
    codes = {i["code"] for i in validation.validate(invoice, {"schema": templates.DEFAULT_SCHEMA})["issues"]}
    assert "overconfident_evidence" in codes


def test_missing_attributes_are_reported():
    from app.process import recommendations as rec

    doc = rec.to_process_document(rec.parse(P2P)["recommendations"][0])
    missing = {m["path"] for m in rec.missing_attributes(doc)}
    assert "intervention.implementation_type" not in missing
    assert {"execution_profile.workflow_determinism", "governance.action_authority",
            "integrations.systems"} <= missing


def test_import_files_each_recommendation_under_its_l3(db):
    from app.catalog import store
    from app.process import recommendations as rec, store as process_store

    report = rec.import_recommendations(P2P, domain_id="domain.procurement", filename="p2p.json")
    assert report["summary"] == "8 imported, 0 need a domain, 0 failed."
    statuses = {r["status"] for r in report["imported"]}
    assert statuses == {"valid"}

    # #4 and #5 share an L3 node and become two versions of its document.
    vendor = [r for r in report["imported"] if r["l3"] == "Maintain Vendor Master Data"]
    assert len({r["concept_id"] for r in vendor}) == 1
    path = store.tree_path(vendor[0]["concept_id"])
    assert [c["label"] for c in path] == ["Manufacturing", "Procurement", "Accounts Payable (AP)",
                                          "Vendor Master", "Maintain Vendor Master Data"]
    assert len(process_store.list_documents(vendor[0]["concept_id"])) == 2


def test_import_without_domain_matches_l0_or_asks(db):
    from app.process import recommendations as rec

    matched = rec.import_recommendations(P2P, save=False)
    assert len(matched["imported"]) == 8 and matched["imported"][0]["domain_id"] == "domain.procurement"

    import json

    data = json.loads(P2P)
    for row in data:
        row["L0 Process"] = "Zoology"
    asked = rec.import_recommendations(json.dumps(data), save=False)
    assert len(asked["needs_domain"]) == 8 and not asked["imported"]


def test_structured_shape_carries_v2_sections():
    from app.process import recommendations as rec

    structured = {"engagement": {"industry": "Manufacturing"}, "recommendations": [{
        "id": "P2P-REC-006", "title": "Invoice IDP",
        "process": {"l0": "Procurement", "l1": "Accounts Payable", "l2": "Invoice Processing", "l3": "Invoice Extraction"},
        "intervention": {"category": "intelligent_document_processing", "implementation_type": "agent",
                         "description": "Extract invoices and match them to POs."},
        "execution_profile": {"workflow_determinism": "fixed_steps", "interaction_mode": "event_triggered",
                              "trigger": {"type": "document_arrival"}, "input_variability": "mixed_formats"},
        "integrations": {"systems": [{"id": "sap_fi", "name": "SAP FI", "access": "write"}]},
        "governance": {"action_authority": "write", "reversibility": "financial_impact",
                       "human_oversight": {"model": "human_on_the_loop", "applies_to": "exceptions_only"},
                       "validation": {"criteria": ["3-way match passes"]},
                       "regulations": ["SOX"],
                       "controls": [{"id": "c_match", "description": "Three-way match before posting", "mandatory": True}]},
        "data": {"entities": [{"name": "invoice", "fields": ["amount"], "classification": "confidential"}]},
    }]}
    doc = rec.to_process_document(rec.parse(structured)["recommendations"][0], structured["engagement"])
    assert rec.missing_attributes(doc) == []
    assert doc["regulations"] == [{"id": "sox", "name": "SOX"}]
    assert doc["data_entities"][0]["classification"] == "internal"
    assert doc["governance"]["action_authority"] == "write" and "controls" not in doc["governance"]
