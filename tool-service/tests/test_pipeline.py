"""The layered pipeline G1–G10, driven by a scripted model."""

from app.config import settings
from app.database import SessionLocal
from app.models import ToolRecord
from app.synthesis.pipeline import run_synthesis
from app.synthesis.spec import SynthesisSpec
from tests.samples import (
    ALWAYS_REJECTS,
    GOOD_GST,
    GOOD_WORD_COUNT,
    TOOL_SPEC,
    WRONG_RATE_GST,
    WRONG_SHAPE_GST,
    gst_spec,
)


def test_activity_built_first_time(clean_db, fake_llm):
    fake = fake_llm([GOOD_GST])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "approved", result
    assert result["version"] == 1 and result["tool_id"]
    record = clean_db.get(ToolRecord, result["tool_id"])
    assert record.is_active and record.purpose == "activity" and record.output_schema_json
    assert fake.roles() == ["codegen"]  # two worked examples → no test-plan call


def test_repair_uses_the_diagnostic(clean_db, fake_llm):
    fake = fake_llm([WRONG_SHAPE_GST, GOOD_GST])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "approved", result
    role, messages = fake.calls[-1]
    assert role == "repair"
    assert "output_schema" in messages[-1]["content"] and "grand_total" in messages[-1]["content"]


def test_same_failure_twice_restarts_fresh(clean_db, fake_llm, monkeypatch):
    monkeypatch.setattr(settings, "ORACLE_ARBITRATION", False)
    fake = fake_llm([ALWAYS_REJECTS, ALWAYS_REJECTS, GOOD_GST])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "approved", result
    assert [r for r in fake.roles()] == ["codegen", "repair", "codegen_fresh"]
    fresh_messages = fake.calls[-1][1]
    assert len(fresh_messages) == 2, "a fresh restart must not carry the old conversation"
    assert "Earlier attempts" in fresh_messages[-1]["content"]


def test_budget_exhaustion_reports_failure(clean_db, fake_llm, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_SYNTHESIS_MAX_ATTEMPTS", 2)
    fake_llm([ALWAYS_REJECTS, ALWAYS_REJECTS])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "failed" and result["fault"] == "code"
    assert clean_db.query(ToolRecord).count() == 0


def test_invalid_spec_never_reaches_the_model(clean_db, fake_llm):
    fake = fake_llm([])
    result = run_synthesis(gst_spec(examples=[], output_schema=None), SessionLocal)
    assert result["status"] == "spec_invalid" and result["fault"] == "spec"
    assert any("output_schema" in i for i in result["issues"])
    assert fake.calls == []


def test_example_contradicting_its_schema_is_a_spec_fault(clean_db, fake_llm):
    fake_llm([])
    spec = gst_spec(examples=[
        {"input": {"subtotal": 100}, "output": {"gst_amount": "18.00"}},  # string, schema says number
        {"input": {"subtotal": 200}, "output": {"gst_amount": 36.0, "grand_total": 236.0}},
    ])
    result = run_synthesis(spec, SessionLocal)
    assert result["status"] == "spec_invalid"
    assert any("example 1 output" in i for i in result["issues"])


REFERENCE_GST = """
def run(**kwargs):
    subtotal = kwargs["subtotal"]
    gst = round(subtotal * kwargs.get("rate", 0.18), 2)
    return {"status": "success", "data": {"gst_amount": gst, "grand_total": round(subtotal + gst, 2)}}
"""

# A reference that reads the spec differently from both code and example.
REFERENCE_TEN_PERCENT = REFERENCE_GST.replace('kwargs.get("rate", 0.18)', 'kwargs.get("rate", 0.10)')

WRONG_EXAMPLES = [
    {"input": {"subtotal": 100}, "output": {"gst_amount": 20.0, "grand_total": 120.0}},  # wrong: 18
    {"input": {"subtotal": 250.5}, "output": {"gst_amount": 45.09, "grand_total": 295.59}},
]


def test_reference_agreeing_with_code_corrects_the_example(clean_db, fake_llm):
    fake = fake_llm([GOOD_GST, REFERENCE_GST])
    result = run_synthesis(gst_spec(examples=WRONG_EXAMPLES), SessionLocal)
    assert result["status"] == "approved", result
    assert fake.roles() == ["codegen", "arbiter"], "no repair: the code was right"
    assert result["corrected_examples"][0]["case_id"] == "example_1"
    assert result["examples"][0]["output"] == {"gst_amount": 18.0, "grand_total": 118.0}
    assert any("example_1 corrected" in w for w in result["warnings"])


def test_corrected_request_is_still_recognised(clean_db, fake_llm):
    fake_llm([GOOD_GST, REFERENCE_GST])
    first = run_synthesis(gst_spec(examples=WRONG_EXAMPLES), SessionLocal)
    fake = fake_llm([])
    second = run_synthesis(gst_spec(examples=WRONG_EXAMPLES), SessionLocal)
    assert second.get("reused") and second["tool_id"] == first["tool_id"] and fake.calls == []


def test_without_autocorrect_the_spec_goes_back(clean_db, fake_llm, monkeypatch):
    monkeypatch.setattr(settings, "ORACLE_AUTOCORRECT", False)
    fake_llm([GOOD_GST, REFERENCE_GST])
    result = run_synthesis(gst_spec(examples=WRONG_EXAMPLES), SessionLocal)
    assert result["status"] == "spec_invalid", result
    assert "example_1" in result["issues"][0] and "Use" in result["issues"][0]


def test_reference_agreeing_with_example_drives_repair(clean_db, fake_llm):
    fake = fake_llm([WRONG_RATE_GST, REFERENCE_GST, GOOD_GST])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "approved", result
    assert fake.roles() == ["codegen", "arbiter", "repair"]
    assert "reference implementation confirms" in fake.calls[-1][1][-1]["content"]


def test_three_different_answers_mean_an_ambiguous_spec(clean_db, fake_llm):
    fake_llm([GOOD_GST, REFERENCE_TEN_PERCENT])
    result = run_synthesis(gst_spec(examples=WRONG_EXAMPLES), SessionLocal)
    assert result["status"] == "spec_invalid"
    assert "admits different answers" in result["issues"][0]


def test_reference_is_written_once_per_job(clean_db, fake_llm, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_SYNTHESIS_MAX_ATTEMPTS", 3)
    fake = fake_llm([WRONG_RATE_GST, REFERENCE_GST, WRONG_RATE_GST, GOOD_GST])
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "approved"
    assert fake.roles().count("arbiter") == 1


def test_identical_spec_is_reused(clean_db, fake_llm):
    fake_llm([GOOD_GST])
    first = run_synthesis(gst_spec(), SessionLocal)
    fake = fake_llm([])
    second = run_synthesis(gst_spec(), SessionLocal)
    assert second["status"] == "approved" and second.get("reused")
    assert second["tool_id"] == first["tool_id"] and fake.calls == []


def test_respecified_tool_becomes_version_two(clean_db, fake_llm):
    fake_llm([GOOD_GST])
    first = run_synthesis(gst_spec(), SessionLocal)
    fake_llm([GOOD_GST])
    second = run_synthesis(gst_spec(description=gst_spec().description + " Amounts in INR."),
                           SessionLocal)
    assert second["version"] == 2
    v1 = clean_db.get(ToolRecord, first["tool_id"])
    v2 = clean_db.get(ToolRecord, second["tool_id"])
    clean_db.refresh(v1)
    assert v2.is_active and not v1.is_active


def test_write_side_effects_need_review(clean_db, fake_llm):
    fake_llm([GOOD_WORD_COUNT], {"testplan": {"cases": [{"input": {"text": "a b c"}}]}})
    spec = SynthesisSpec.from_request(**{**TOOL_SPEC, "side_effects": "write"})
    result = run_synthesis(spec, SessionLocal)
    assert result["status"] == "pending_approval" and result["review_required"] is True


def test_tool_gets_realistic_inputs_from_test_plan_model(clean_db, fake_llm):
    fake = fake_llm([GOOD_WORD_COUNT], {"testplan": {"cases": [
        {"input": {"text": "hello world"}}, {"input": {"text": 42}},  # second breaks the schema
    ]}})
    result = run_synthesis(SynthesisSpec.from_request(**TOOL_SPEC), SessionLocal)
    assert result["status"] == "approved", result
    assert fake.roles() == ["testplan", "codegen"]
    assert result["report"]["weak_plan"] is False


def test_model_outage_is_a_transport_failure(clean_db, monkeypatch):
    import app.llm as llm_pkg

    def down(role, messages, json_mode=False):
        raise llm_pkg.LLMUnavailable("all models down")

    monkeypatch.setattr(llm_pkg, "complete", down)
    result = run_synthesis(gst_spec(), SessionLocal)
    assert result["status"] == "failed" and result["fault"] == "transport"
