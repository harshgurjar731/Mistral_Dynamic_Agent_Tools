"""The workflow input designer and InputSchemaLayer — no Mistral."""

import asyncio
import json
from types import SimpleNamespace

from app.workflow_inputs import run_input
from app.workflow_inputs.designer import (
    example_payload_of,
    finalise_definition,
    finalise_input_schema,
)

CLAIM_SCHEMA = {
    "type": "object", "description": "The claim record",
    "properties": {
        "amount": {"type": "number", "minimum": 0},
        "items": {"type": "array", "items": {
            "type": "object", "properties": {"sku": {"type": "string"}, "qty": {"type": "integer"}},
            "required": ["sku", "qty"]}},
    },
    "required": ["amount", "items"],
}


def _steps():
    return [
        {"id": "intake", "type": "agent", "next_steps": ["calc"],
         "config": {"agent_id": "a1", "query_template":
                    "Review the claim from {{customer_name}} filed on {{loss_date}}."}},
        {"id": "calc", "type": "tool", "next_steps": ["route"],
         "config": {"tool_name": "calc_excess",
                    "arguments": {"claim": "{{claim}}", "policy_limit": "{{policy.limit}}",
                                  "tier": "{{tier}}"},
                    "code_requirement": {
                        "input_schema": {"type": "object", "properties": {
                            "claim": CLAIM_SCHEMA,
                            "policy_limit": {"type": "number", "minimum": 1000, "maximum": 100000},
                            "tier": {"type": "string", "enum": ["gold", "silver"]}},
                            "required": ["claim", "policy_limit", "tier"]},
                        "output_schema": {"type": "object",
                                          "properties": {"excess": {"type": "number"}}}}}},
        {"id": "route", "type": "condition", "next_steps": [],
         "config": {"expression": "{{excess}} > {{threshold}}"}},
    ]


DRAFT = [
    {"name": "customer_name", "type": "str", "required": "true"},
    {"name": "loss_date", "type": "string", "format": "date", "example": "03/04/2026"},
    {"name": "claim", "type": "string"},  # wrong: the activity takes a record
    {"name": "tier", "type": "string", "example": "GOLD"},
]


def _finalise(**kw):
    return finalise_input_schema(DRAFT, _steps(), "intake", catalogue=[],
                                 step_outputs={"intake": ["summary"]}, **kw)


def _by_name(fields):
    return {f["name"]: f for f in fields}


def test_bound_input_takes_the_activity_parameter_type_and_nested_schema():
    claim = _by_name(_finalise())["claim"]
    assert claim["type"] == "object"
    assert claim["schema"]["required"] == ["amount", "items"]
    assert claim["description"] == "The claim record"


def test_enum_from_the_activity_and_example_matched_case_insensitively():
    tier = _by_name(_finalise())["tier"]
    assert tier["enum"] == ["gold", "silver"] and tier["example"] == "gold"


def test_inputs_nobody_declared_are_discovered_with_inferred_types():
    fields = _by_name(_finalise())
    assert fields["policy"]["type"] == "object"           # read as {{policy.limit}}
    assert 1000 <= fields["policy"]["example"]["limit"] <= 100000
    assert fields["threshold"]["type"] == "number"        # only compared numerically
    assert "summary" not in fields and "excess" not in fields  # produced by steps


def test_without_known_agent_outputs_a_later_reference_is_not_assumed_an_input():
    fields = _by_name(finalise_input_schema(DRAFT, _steps(), "intake", catalogue=[]))
    assert "threshold" not in fields


def test_every_example_passes_the_run_check_and_forms_one_payload():
    fields = _finalise(example_payload={
        "customer_name": "Priya Raman",
        "claim": {"amount": "4,250.50", "items": [{"sku": "FLR-1", "qty": "2"}]},
        "loss_date": "not a date",
    })
    payload = example_payload_of(fields)
    assert payload["customer_name"] == "Priya Raman"
    assert payload["claim"] == {"amount": 4250.5, "items": [{"sku": "FLR-1", "qty": 2}]}
    assert payload["loss_date"] != "not a date"  # invalid → replaced by a valid date
    definition = SimpleNamespace(name="wf", input_schema=fields, steps=[], entry_step="intake",
                                 variables={})
    assert run_input.check(definition, payload) == []


def test_labels_types_and_required_are_normalised():
    fields = _by_name(_finalise())
    assert fields["customer_name"]["type"] == "string"
    assert fields["customer_name"]["required"] is True
    assert fields["loss_date"]["label"] == "Loss date"


def test_finalise_is_idempotent():
    once = _finalise()
    twice = finalise_input_schema(once, _steps(), "intake", catalogue=[],
                                  step_outputs={"intake": ["summary"]})
    assert once == twice


def test_nested_schema_is_enforced_on_a_run():
    field = _by_name(_finalise())["claim"]
    problems = run_input.check_value(field, {"amount": 10})
    assert problems and "items" in problems[0]


def test_file_inputs_keep_no_example():
    fields = finalise_input_schema([{"name": "claim_form", "type": "document"}], [], None)
    assert fields[0]["type"] == "file" and "example" not in fields[0]


def test_finalise_definition_on_save_object():
    from app.services.workflow_engine.models import WorkflowDefinition

    definition = WorkflowDefinition(name="wf", entry_step="intake", steps=_steps(),
                                    input_schema=[dict(f) for f in DRAFT])
    assert finalise_definition(definition) is True
    assert _by_name(definition.input_schema)["claim"]["type"] == "object"
    assert finalise_definition(definition) is False


# ── InputSchemaLayer ────────────────────────────────────────────────────────


class _Client:
    def __init__(self, answer):
        self.answer, self.calls = answer, []
        self.chat = SimpleNamespace(complete=self._complete)

    def _complete(self, **kw):
        self.calls.append(kw)
        msg = SimpleNamespace(content=json.dumps(self.answer))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _ctx(answer):
    from app.core.context import PipelineContext
    from app.core.specs import WorkflowSpec

    spec = WorkflowSpec(goal="Assess a home insurance claim")
    spec.dag = {"name": "claims", "entry_step": "intake", "steps": _steps(),
                "input_schema": [dict(f) for f in DRAFT], "variables": {}}
    ctx = PipelineContext(query="claims", client=_Client(answer))
    ctx.workflow_spec = spec
    return ctx


def _run_layer(ctx):
    from app.layers.workflow.input_schema_layer import InputSchemaLayer

    async def done(c):
        return c

    return asyncio.run(InputSchemaLayer().process(ctx, done))


def test_layer_cannot_rename_retype_or_invent_inputs():
    ctx = _run_layer(_ctx({
        "input_schema": [
            {"name": "claim", "type": "string", "label": "Claim details"},   # retype: ignored
            {"name": "invented", "type": "string"},                           # not read: dropped
            {"name": "customer_name", "type": "string", "label": "Policyholder name",
             "description": "Full name as it appears on the policy."},
        ],
        "example_payload": {"customer_name": "Daniel Okafor", "tier": "silver",
                            "claim": {"amount": 1200, "items": [{"sku": "TV-55", "qty": 1}]}},
        "reasoning": "r",
    }))
    fields = _by_name(ctx.workflow_spec.dag["input_schema"])
    assert "invented" not in fields
    assert fields["claim"]["type"] == "object" and fields["claim"]["label"] == "Claim details"
    assert fields["customer_name"]["label"] == "Policyholder name"
    assert fields["customer_name"]["example"] == "Daniel Okafor"
    assert fields["tier"]["example"] == "silver"
    call = ctx.client.calls[0]
    assert call["model"] == "mistral-large-4" and call["reasoning_effort"] == "high"


def test_layer_fallback_still_produces_an_accurate_schema():
    ctx = _ctx({})
    ctx.client = SimpleNamespace(chat=SimpleNamespace(
        complete=lambda **kw: (_ for _ in ()).throw(ValueError("Status 400 bad"))))
    ctx = _run_layer(ctx)
    fields = _by_name(ctx.workflow_spec.dag["input_schema"])
    assert fields["claim"]["type"] == "object" and "example" in fields["claim"]


def test_nested_argument_binding_and_prompt_reads_are_declared_on_the_input_record():
    """The recording's raw_application: an activity reads loan_term_months inside a record,
    and an agent prompt reads credit_file. Both become fields of the declared input."""
    from app.workflow_inputs.designer import finalise_input_schema

    catalogue = [{"name": "affordability", "parameters": {"validated_application": {
        "type": "object",
        "properties": {"term_months": {"type": "integer", "minimum": 1, "description": "Term"}},
        "required": ["term_months"]}}, "required": ["validated_application"]}]
    steps = [
        {"id": "afford", "type": "tool", "next_steps": ["risk"], "config": {
            "tool_name": "affordability",
            "arguments": {"validated_application": {"term_months": "{{raw_application.loan_term_months}}"}}}},
        {"id": "risk", "type": "agent", "next_steps": [], "config": {
            "query_template": "Credit file:\n{{raw_application.credit_file}}"}},
    ]
    fields = finalise_input_schema([{"name": "raw_application", "type": "object", "required": True}],
                                   steps, "afford", catalogue=catalogue)
    schema = fields[0]["schema"]
    assert schema["properties"]["loan_term_months"]["type"] == "integer"
    assert "loan_term_months" in schema.get("required", [])
    assert "credit_file" in schema["properties"]
    assert "credit_file" not in schema.get("required", [])
    # Idempotent.
    again = finalise_input_schema(fields, steps, "afford", catalogue=catalogue)
    assert again[0]["schema"] == schema
