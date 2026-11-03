"""A rebuild follows the user's instructions; generated code is prompted for run-time robustness."""

import app.llm.client as client
from app.llm.routes import route_for
from app.services.execution_service import coerce_arguments
from app.synthesis.profiles import get_profile
from app.synthesis.prompts import repair
from app.synthesis.spec import SynthesisSpec, Verdict
from tests.samples import gst_spec


def _rebuild_spec(**feedback):
    base = gst_spec().to_dict()
    base["feedback"] = {"runtime_error": "ValueError: could not convert '1,200'",
                        "comment": "Accept amounts like '1,200' and round to 2 dp", **feedback}
    return SynthesisSpec.from_dict(base)


def test_directives_survive_normalisation_and_count_as_feedback():
    spec = SynthesisSpec.from_dict({**gst_spec().to_dict(),
                                    "feedback": {"directives": ["Round to 2 dp", "  ", 7]}})
    assert spec.feedback == {"directives": ["Round to 2 dp", "7"]}


def test_user_instructions_lead_the_system_prompt_for_both_purposes():
    spec = _rebuild_spec(directives=["Accept '1,200' style amounts", "Round to 2 dp"])
    for purpose in ("tool", "activity"):
        spec.purpose = purpose
        profile = get_profile(purpose)
        prompt = profile.system_prompt(spec, profile.build_test_plan(spec, []))
        head = prompt.index("USER'S INSTRUCTIONS — MANDATORY")
        assert head < prompt.index("WHO CALLS THIS"), purpose
        assert "1. Accept '1,200' style amounts" in prompt and "2. Round to 2 dp" in prompt
        assert "RUN-TIME ROBUSTNESS" in prompt


def test_the_comment_is_the_checklist_when_no_directives_were_given():
    spec = _rebuild_spec()
    prompt = get_profile("activity").system_prompt(spec, get_profile("activity").build_test_plan(spec, []))
    assert "1. Accept amounts like '1,200' and round to 2 dp" in prompt


def test_no_instructions_section_without_feedback():
    spec = gst_spec()
    prompt = get_profile("activity").system_prompt(spec, get_profile("activity").build_test_plan(spec, []))
    assert "USER'S INSTRUCTIONS" not in prompt


def test_every_repair_round_restates_the_instructions():
    spec = _rebuild_spec(directives=["Round to 2 dp"])
    text = repair.repair_request(spec, Verdict(False, "contract", "case x failed"))
    assert "The user's instructions still apply" in text and "1. Round to 2 dp" in text
    assert "root cause" in text
    assert "still apply" not in repair.repair_request(gst_spec(), Verdict(False, "contract", "x"))


def test_the_failing_input_is_a_must_succeed_case():
    spec = _rebuild_spec(failing_input={"subtotal": 1200})
    plan = get_profile("activity").build_test_plan(spec, [])
    case = next(c for c in plan.cases if c.case_id == "failed_input")
    assert case.expect == "success" and case.kwargs == {"subtotal": 1200}


def test_an_invalid_failing_input_is_not_planned():
    spec = _rebuild_spec(failing_input={"subtotal": "1,200"})  # breaks the schema
    plan = get_profile("activity").build_test_plan(spec, [])
    assert "failed_input" not in [c.case_id for c in plan.cases]


def test_activities_always_ask_for_realistic_inputs():
    assert get_profile("activity").wants_llm_cases(gst_spec())


def test_rejected_effort_messages_are_recognised():
    assert client._rejects_effort(RuntimeError("reasoning_effort is not enabled for this model"))
    assert client._rejects_effort(RuntimeError("reasoning_effort none is not supported"))


def test_code_jobs_run_on_the_largest_model():
    for role in ("codegen", "repair", "codegen_fresh", "arbiter", "testplan"):
        route = route_for(role)
        assert route.model == "mistral-large-4" and route.reasoning_effort == "high", role


def test_strict_policy_accepts_thousands_separators_and_currency_signs():
    schema = {"type": "object", "properties": {"n": {"type": "number"}, "i": {"type": "integer"}}}
    args = coerce_arguments({"n": "$1,250.50", "i": "2,000"}, schema, lenient=False)
    assert args == {"n": 1250.5, "i": 2000}
    assert coerce_arguments({"n": "a lot"}, schema, lenient=False) == {"n": "a lot"}


def test_every_numeric_setting_has_bounds_and_what_they_mean():
    from app.runtime_settings import EFFECTS, all_defs

    defs = {d.key: d for d in all_defs()}
    for key, d in defs.items():
        if d.type in ("int", "float"):
            assert d.minimum is not None and d.maximum is not None, key
            assert d.low_effect and d.high_effect, key
    assert not set(EFFECTS) - set(defs)
