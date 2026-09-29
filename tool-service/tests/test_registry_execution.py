"""Versioned registry, runtime policy per purpose, and the legacy-row backfill."""

import json

from sqlalchemy import text

from app.database import _backfill_versions, engine
from app.models import ToolRecord
from app.services.execution_service import coerce_arguments, execute_tool
from app.services.synthesis_service import reject_tool, update_tool
from app.synthesis import registry
from app.synthesis.spec import SynthesisSpec
from tests.samples import GOOD_GST, GOOD_WORD_COUNT, TOOL_SPEC, WRONG_RATE_GST, gst_spec


def _install(db, spec, code, status="approved"):
    profile_plan = None
    return registry.create_version(db, spec=spec, code=code, status=status,
                                   report={"history": "test"}, test_plan=profile_plan)


def test_active_and_pinned_versions(clean_db):
    v1 = _install(clean_db, gst_spec(), WRONG_RATE_GST)
    v2 = _install(clean_db, gst_spec(description=gst_spec().description + " v2"), GOOD_GST)
    assert (v1.version_no, v2.version_no) == (1, 2)

    latest = execute_tool(clean_db, "apply_gst", {"subtotal": 100})
    assert latest["version"] == 2 and latest["result"]["data"]["gst_amount"] == 18.0

    pinned = execute_tool(clean_db, "apply_gst@1", {"subtotal": 100})
    assert pinned["version"] == 1 and pinned["result"]["data"]["gst_amount"] == 15.0


def test_rejecting_active_version_rolls_back(clean_db):
    _install(clean_db, gst_spec(), WRONG_RATE_GST)
    v2 = _install(clean_db, gst_spec(description=gst_spec().description + " v2"), GOOD_GST)
    result = reject_tool(clean_db, v2.id)
    assert "version 1 is active again" in result["message"]
    assert execute_tool(clean_db, "apply_gst", {"subtotal": 100})["version"] == 1


def test_activity_arguments_are_strict_tools_lenient():
    schema = {"type": "object", "properties": {
        "n": {"type": "integer"}, "flag": {"type": "boolean"}, "rec": {"type": "object"},
        "unit": {"type": "string", "enum": ["kg", "lb"]}}}
    strict = coerce_arguments({"n": "3", "flag": "true", "rec": '{"a": 1}', "unit": "KG"}, schema, lenient=False)
    assert strict == {"n": 3, "flag": "true", "rec": {"a": 1}, "unit": "KG"}
    lenient = coerce_arguments({"n": "3", "flag": "true", "rec": '{"a": 1}', "unit": "KG"}, schema, lenient=True)
    assert lenient == {"n": 3, "flag": True, "rec": {"a": 1}, "unit": "kg"}


def test_bad_arguments_are_rejected_before_the_code_runs(clean_db):
    _install(clean_db, gst_spec(), GOOD_GST)
    missing = execute_tool(clean_db, "apply_gst", {})
    assert missing["reason"] == "bad_arguments"
    wrong_type = execute_tool(clean_db, "apply_gst", {"subtotal": "a lot"})
    assert wrong_type["reason"] == "bad_arguments"


def test_output_contract_is_enforced_at_runtime(clean_db):
    bad = GOOD_GST.replace('"grand_total": round', '"total": round')
    _install(clean_db, gst_spec(), bad)
    result = execute_tool(clean_db, "apply_gst", {"subtotal": 100})["result"]
    assert result["status"] == "error" and result["error_type"] == "contract_violation"


def test_activity_crash_is_an_error_envelope_never_a_fallback(clean_db, monkeypatch):
    import app.services.execution_service as ex

    monkeypatch.setattr(ex, "_degraded", lambda *a, **k: (_ for _ in ()).throw(AssertionError("fallback used")))
    crashing = "def run(**kwargs):\n    raise RuntimeError('db down')\n"
    _install(clean_db, gst_spec(), crashing)
    result = execute_tool(clean_db, "apply_gst", {"subtotal": 1})["result"]
    assert result["status"] == "error" and result["error_type"] == "runtime_crash"


def test_tool_fallback_is_opt_in_and_labelled(clean_db, monkeypatch):
    from app.config import settings
    import app.services.llm_fallback as fb

    monkeypatch.setattr(settings, "TOOL_RUNTIME_FALLBACK", True)
    monkeypatch.setattr(fb, "llm_fallback", lambda *a, **k: {"words": 3})
    crashing = "def run(**kwargs):\n    raise RuntimeError('boom')\n"
    _install(clean_db, SynthesisSpec.from_request(**TOOL_SPEC), crashing)
    result = execute_tool(clean_db, "word_count", {"text": "a b c"})["result"]
    assert result["status"] == "degraded" and result["data"] == {"words": 3}
    assert "not verified" in result["message"]


def test_edit_is_verified_and_becomes_a_new_version(clean_db):
    from app.synthesis.profiles import get_profile

    spec = gst_spec()
    plan = get_profile("activity").build_test_plan(spec, [])
    v1 = registry.create_version(clean_db, spec=spec, code=GOOD_GST, status="approved",
                                 report={}, test_plan=plan.to_dict())
    refused = update_tool(clean_db, v1.id, WRONG_RATE_GST, spec.description)
    assert refused["status"] == "error" and "example_mismatch" in refused["message"]

    accepted = update_tool(clean_db, v1.id, GOOD_GST.replace("calculation failed", "failed"),
                           spec.description)
    assert accepted["status"] == "updated" and accepted["version"] == 2


def test_failed_import_check_blocks_registration(clean_db):
    import pytest

    broken = "import json\n\nX = undefined\n\ndef run(**kwargs):\n    return {}\n"
    with pytest.raises(registry.RegistrationError):
        _install(clean_db, SynthesisSpec.from_request(**TOOL_SPEC), broken)
    assert clean_db.query(ToolRecord).count() == 0


def test_backfill_numbers_legacy_rows_and_activates_newest(clean_db):
    schema = json.dumps(SynthesisSpec.from_request(**TOOL_SPEC).tool_schema())
    with engine.connect() as conn:
        for i, status in enumerate(["approved", "approved", "pending_approval"]):
            conn.execute(text(
                "INSERT INTO tools (name, hash, version, schema_json, source_code, status, "
                "purpose, version_no, is_active, kind, side_effects, review_required, mcp_published, created_at) "
                "VALUES ('legacy', :h, '1.0.0', :s, :c, :st, 'tool', 1, 0, 'pure', 'none', 0, 0, :t)"),
                {"h": f"h{i}", "s": schema, "c": GOOD_WORD_COUNT, "st": status, "t": f"2026-01-0{i + 1}"})
        conn.commit()
    _backfill_versions()
    _backfill_versions()  # idempotent
    rows = clean_db.query(ToolRecord).filter_by(name="legacy").order_by(ToolRecord.version_no).all()
    assert [r.version_no for r in rows] == [1, 2, 3]
    assert [r.is_active for r in rows] == [False, True, False]


def test_import_keeps_the_pinned_version_number_when_free(clean_db):
    from app.services.synthesis_service import import_tool

    schema = SynthesisSpec.from_request(**TOOL_SPEC).tool_schema()
    result = import_tool(clean_db, "word_count", schema, GOOD_WORD_COUNT, "hash-a", version_no=3)
    record = clean_db.get(ToolRecord, result["tool_id"])
    assert record.version_no == 3 and record.is_active
    assert execute_tool(clean_db, "word_count@3", {"text": "a b"})["result"]["data"]["words"] == 2

    # Taken number → next free one, never an overwrite.
    clash = import_tool(clean_db, "word_count", schema, GOOD_WORD_COUNT.replace("failed", "x"),
                        "hash-b", version_no=3)
    assert clean_db.get(ToolRecord, clash["tool_id"]).version_no == 4
