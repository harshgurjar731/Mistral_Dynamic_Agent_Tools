"""Agent templates get every input their capability declares, and an explanation of what they are handed.

Cases from the SME equipment finance run: the credit-risk agent never received
the internal credit file (its capability listed it), and the policy agent read
the 0-100 ``risk_score`` as the credit score.
"""

from app.core.specs import CapabilitySpec
from app.layers.workflow.template_context import (
    LEGEND_MARKER,
    add_value_legend,
    ensure_capability_inputs,
)

ACTIVITIES = {"affordability": {"output": {"type": "object", "properties": {
    "ltv_percent": {"type": "number", "description": "Loan to value, as a percentage (85 means 85%)"},
    "monthly_instalment_gbp": {"type": "number", "description": "Monthly repayment in GBP"}}}}}


def _steps():
    return [
        {"id": "check", "type": "tool", "next_steps": ["afford"], "config": {"tool_name": "validate"}},
        {"id": "afford", "type": "tool", "next_steps": ["credit_risk"], "config": {"tool_name": "affordability"}},
        {"id": "credit_risk", "type": "agent", "next_steps": ["policy"], "config": {
            "query_template": "Assess repayment risk.\n\nAffordability:\n{{step_afford_output}}"}},
        {"id": "policy", "type": "agent", "next_steps": [], "config": {
            "query_template": "Apply the lending policy.\n\nRisk:\n{{step_credit_risk_output}}\n\n"
                              "Affordability:\n{{step_afford_output}}"}},
    ]


CAPS = [
    CapabilitySpec(id="afford", name="Affordability calculation", kind="activity",
                   outputs=["ltv_percent", "monthly_instalment_gbp"]),
    CapabilitySpec(id="credit_risk", name="Credit risk assessment", kind="agent",
                   inputs=["affordability_results", "internal_credit_file"], outputs=["risk_score"]),
    CapabilitySpec(id="policy", name="Policy decision", kind="agent",
                   inputs=["risk_assessment", "affordability_results"]),
]
INPUTS = [{"name": "raw_application", "type": "object", "description": "The SME application"}]


def test_missing_capability_input_is_wired_from_the_run_input_record():
    steps = _steps()
    notes = ensure_capability_inputs(steps, CAPS, INPUTS, ACTIVITIES)
    template = steps[2]["config"]["query_template"]
    assert "{{raw_application.internal_credit_file}}" in template
    assert "Internal credit file:" in template
    assert [n["code"] for n in notes] == ["dataflow.input_wired"]
    assert "make sure every run provides it" in notes[0]["message"]


def test_inputs_already_referenced_are_left_alone():
    steps = _steps()
    ensure_capability_inputs(steps, CAPS, INPUTS, ACTIVITIES)
    # policy: "risk_assessment" ~ the credit-risk step, "affordability_results" ~ the affordability step.
    assert "Also provided" not in steps[3]["config"]["query_template"]
    again = ensure_capability_inputs(steps, CAPS, INPUTS, ACTIVITIES)
    assert again == []  # idempotent


def test_unbound_input_without_a_record_is_reported():
    steps = _steps()
    notes = ensure_capability_inputs(steps, CAPS, [], ACTIVITIES)
    assert [n["code"] for n in notes] == ["dataflow.input_unbound"]


def test_legend_explains_agent_and_activity_values():
    steps = _steps()
    agents = [{"capability_id": "credit_risk",
               "output_contract_detail": "risk_score: integer 0-100, a risk measure (higher is riskier), "
                                         "NOT the applicant's credit score"}]
    assert add_value_legend(steps, agents, ACTIVITIES, INPUTS) == 2
    policy = steps[3]["config"]["query_template"]
    assert LEGEND_MARKER in policy
    assert "NOT the applicant's credit score" in policy
    assert "step_afford_output.ltv_percent: Loan to value, as a percentage" in policy
    # Idempotent: a second pass adds nothing.
    assert add_value_legend(steps, agents, ACTIVITIES, INPUTS) == 0
