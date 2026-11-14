"""Agent steps produce, and readers find, the fields later steps reference."""

import json

from app.services.workflow_engine.models import WorkflowStep
from app.services.workflow_engine.output_contracts import (
    MISSING, attach_output_contracts, extract_json_object, find_field,
)
from app.services.workflow_engine.step_runners import _lookup, _produced_fields_hint

RESULTS = [{"student": "A. Khan", "mark": 71}, {"student": "B. Ode", "mark": 64}]


def _steps():
    return [
        WorkflowStep(id="moderation_check", type="agent",
                     config={"agent_id": "a", "query_template": "Check {{marks}}"}),
        WorkflowStep(id="output_safety_validation", type="tool",
                     config={"tool_name": "t", "arguments": {
                         "results": "{{step_moderation_check_output.moderated_student_results}}",
                         "note": "{{ step_moderation_check_output.summary }}"}}),
    ]


def test_agent_step_is_told_the_fields_read_from_it():
    steps = _steps()
    attach_output_contracts(steps)
    assert steps[0].config["output_fields"] == ["moderated_student_results", "summary"]
    assert "output_fields" not in steps[1].config


def test_nested_json_after_prose_is_extracted():
    text = "Moderation done.\n{\"moderated_student_results\": %s, \"summary\": \"ok\"}" % json.dumps(RESULTS)
    assert extract_json_object(text, ["moderated_student_results"])["moderated_student_results"] == RESULTS


def test_object_with_the_wanted_fields_wins():
    text = ('Input was {"marks": [1]}.\n```json\n'
            + json.dumps({"moderated_student_results": RESULTS}) + "\n```")
    assert "moderated_student_results" in extract_json_object(text, ["moderated_student_results"])


def test_field_found_through_spelling_and_wrapper():
    assert find_field({"moderatedStudentResults": RESULTS}, "moderated_student_results") == RESULTS
    assert find_field({"result": {"moderated_student_results": RESULTS}}, "moderated_student_results") == RESULTS
    assert find_field({"student_results": RESULTS}, "moderated_student_results") is MISSING
    # The same name in two places is ambiguous: not guessed.
    assert find_field({"a": {"x": 1}, "b": {"x": 2}}, "x") is MISSING


def test_lookup_resolves_agent_text_with_wrapped_field():
    answer = "Here you go:\n```json\n" + json.dumps({"output": {"Moderated Student Results": RESULTS}}) + "\n```"
    variables = {"step_moderation_check_output": answer}
    assert _lookup("step_moderation_check_output.moderated_student_results", variables) == RESULTS


def test_error_hint_lists_what_the_step_returned():
    hint = _produced_fields_hint(["step_m_output.x"], {"step_m_output": {"a": 1, "b": 2}})
    assert "'step_m_output' has: a, b" in hint


def test_checking_activity_rules_reach_the_agent_whose_output_it_checks():
    """The decision letter failed output moderation for rules its author was never given."""
    from app.layers.codegen.layers import clean_checks
    from app.services.workflow_engine.models import StepType, WorkflowStep
    from app.services.workflow_engine.output_contracts import (
        attach_output_contracts, requirements_instruction,
    )

    checks = clean_checks([
        {"code": "missing_decision_reasons", "requirement": "The letter gives the reasons for the decision."},
        {"code": "missing_apr", "requirement": "letter_text states the APR as a percentage."},
        {"code": "", "requirement": ""},
        "not a dict",
    ])
    assert [c["code"] for c in checks] == ["missing_decision_reasons", "missing_apr"]
    steps = [
        WorkflowStep(id="letter", type=StepType.AGENT, next_steps=["moderate"],
                     config={"agent_id": "a", "query_template": "Write the letter."}),
        WorkflowStep(id="moderate", type=StepType.TOOL, next_steps=[], config={
            "tool_name": "output_moderation",
            "arguments": {"decision_letter": "{{step_letter_output.letter_text}}"},
            "code_requirement": {"name": "output_moderation", "checks": checks}}),
    ]
    attach_output_contracts(steps)
    assert steps[0].config["output_fields"] == ["letter_text"]
    assert steps[0].config["output_requirements"] == [c["requirement"] for c in checks]
    text = requirements_instruction(steps[0].config["output_requirements"])
    assert "APR as a percentage" in text and "rejects it" in text
