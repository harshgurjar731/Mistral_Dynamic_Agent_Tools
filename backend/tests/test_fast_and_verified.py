"""Planning is fast, and a workflow is only "complete" when it has run.

Each test is a failure read from the deployment's own runs:

* a plan took 140 minutes — nearly every decision waited out a 3–5 minute
  timeout on a slow model before the fallback answered in seconds;
* unanswered questions took defaults that left the workflow broken: "finish
  without" a failed activity, then "accept" a workflow failing 0 of 3 scenarios;
* transform code failed with "name 'mean_kwh' is not defined" and "string
  indices must be integers"; three specifications were rewritten over
  ``"email": null``; an agent was blocked by its own `pii` guardrail.
"""

import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from app.core import model_speed
from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, CodeNeed, CodeRequirement, CodeResolution, WorkflowSpec


@pytest.fixture(autouse=True)
def _fresh_speed():
    model_speed.reset()
    yield
    model_speed.reset()


# ── Speed: a slow model cannot stall a decision ──────────────────────────────


def _client(delays: dict, calls: list):
    def complete(**kw):
        calls.append((kw["model"], kw.get("reasoning_effort")))
        time.sleep(delays.get(kw["model"], 0))
        return f"answer from {kw['model']}"

    return SimpleNamespace(chat=SimpleNamespace(complete=complete))


def test_a_slow_model_is_raced_against_the_fallback(monkeypatch):
    from app.config import settings
    from app.core.decision import _complete

    monkeypatch.setattr(settings, "DECISION_HEDGE_SECONDS", 0.05)
    calls = []
    client = _client({"mistral-large-4": 0.6, "mistral-medium-2604": 0.0}, calls)

    async def go():
        started = time.monotonic()
        result = await _complete(client, "mistral-large-4", "s", "u", 0.1, 5000, "high",
                                 "mistral-medium-2604")
        return result, time.monotonic() - started

    out, waited = asyncio.run(go())
    assert out == "answer from mistral-medium-2604"
    assert waited < 0.5, "did not wait for the slow model"
    assert [m for m, _ in calls] == ["mistral-large-4", "mistral-medium-2604"]


def test_a_model_that_keeps_losing_is_skipped(monkeypatch):
    from app.config import settings
    from app.core.decision import _complete

    monkeypatch.setattr(settings, "DECISION_HEDGE_SECONDS", 0.02)
    calls = []
    client = _client({"mistral-large-4": 0.2}, calls)
    # One lost race is decisive: the fallback answered while it was still silent.
    asyncio.run(_complete(client, "mistral-large-4", "s", "u", 0.1, 5000, None, "mistral-medium-2604"))
    assert model_speed.skipped("mistral-large-4")
    calls.clear()
    asyncio.run(_complete(client, "mistral-large-4", "s", "u", 0.1, 5000, None, "mistral-medium-2604"))
    assert [m for m, _ in calls] == ["mistral-medium-2604"], "the slow model is not asked at all"


def test_a_model_that_answers_in_time_is_not_hedged(monkeypatch):
    from app.config import settings
    from app.core.decision import _complete

    monkeypatch.setattr(settings, "DECISION_HEDGE_SECONDS", 5)
    calls = []
    out = asyncio.run(_complete(_client({}, calls), "mistral-medium-2604", "s", "u", 0.1, 5000,
                                "high", "mistral-large-4"))
    assert out == "answer from mistral-medium-2604"
    assert calls == [("mistral-medium-2604", "high")]


def test_fast_tier_decisions_do_not_reason_and_defaults_are_the_measured_ones(monkeypatch):
    from app.config import settings
    from app.core import decision
    from app.layers.agent.facets import ToolSelectionLayer
    from app.layers.workflow.dataflow_layer import DataFlowLayer
    from app.llm_routes import other_model, route_for

    seen = {}

    async def fake_complete(client, model, system, user, temperature, timeout_ms, effort, fallback):
        seen.update(model=model, effort=effort, fallback=fallback)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))])

    monkeypatch.setattr(decision, "_complete", fake_complete)
    monkeypatch.setattr(decision, "reasoning_capable", lambda m: True)
    model = settings.MISTRAL_ORCHESTRATOR_MODEL
    asyncio.run(decision.decide(None, model=model, system="s", user="u", phase="p", tier="fast"))
    assert seen["effort"] is None and seen["fallback"] and seen["fallback"] != model
    asyncio.run(decision.decide(None, model=model, system="s", user="u", phase="p"))
    assert seen["effort"] == "high"

    assert ToolSelectionLayer.tier == "fast" and DataFlowLayer.tier == "deep"
    # The code default (an .env or the Settings page may still name another model —
    # the hedge and the breaker above keep that fast too).
    assert type(settings).model_fields["MISTRAL_ORCHESTRATOR_MODEL"].default == "mistral-medium-2604"
    spec = route_for("spec_author")
    assert (spec.model, spec.reasoning_effort, spec.fallback_model) == (
        "mistral-medium-2604", "high", "mistral-large-4")
    assert route_for("reuse_resolution").reasoning_effort is None
    assert other_model("mistral-medium-2604", "mistral-medium-2604") == "mistral-large-4"


def test_contracted_activities_build_at_once_and_reuse_is_prefiltered(monkeypatch):
    from app.layers.codegen import layers
    from app.layers.codegen.profiles import profile_for
    from app.layers.workflow import tool_gap_layer

    caps = [CapabilitySpec(id="a", name="A", kind="activity"),
            CapabilitySpec(id="b", name="B", kind="activity", depends_on=["a"])]
    assert tool_gap_layer.activity_waves(caps, caps) == [0, 1]

    asked = []

    async def fake_decide(*a, **k):
        asked.append(k.get("phase"))
        return "{}"

    monkeypatch.setattr(layers, "decide", fake_decide)
    contract = {"input_schema": {"type": "object", "properties": {"dispute_record": {"type": "object"}}}}
    other = {"name": "word_count", "purpose": "activity", "status": "approved", "is_active": True,
             "schema": {"function": {"name": "word_count", "parameters": {
                 "type": "object", "properties": {"text": {"type": "string"}}}}}}
    ctx = layers.RequirementContext(need=CodeNeed(purpose="activity", contract=contract),
                                    profile=profile_for("activity"), client=None, catalogue=[other])
    asyncio.run(layers.ReuseResolutionLayer().run(ctx))
    assert asked == [], "nothing in the catalogue fits the contract — the model is not asked"


# ── Unanswered questions never leave a broken workflow ───────────────────────


class DefaultingRun:
    """Nobody answers: every question takes its recommended choice."""

    def __init__(self):
        self.questions, self.events = [], []

    def put_nowait(self, sse):
        self.events.append((sse.event, sse.data))

    async def ask(self, kind, question, *, options, default):
        self.questions.append({"kind": kind, "default": default, "options": options, **question})
        return {"choice": default}

    def payloads(self, event):
        return [json.loads(d) for e, d in self.events if e == event]


async def _done(ctx):
    return ctx


def test_an_activity_nobody_can_build_is_retried_then_done_by_an_agent(monkeypatch):
    import app.layers.codegen as codegen
    from app.layers.workflow import tool_gap_layer

    builds = []

    async def always_fails(needs, **kw):
        builds.append(len(needs))
        return [CodeResolution(status="failed", name="consumption_analysis",
                               message="the specification could not be made implementable")
                for _ in needs]

    monkeypatch.setattr(codegen, "resolve_code_needs", always_fails)
    run = DefaultingRun()
    spec = WorkflowSpec(goal="disputes", capabilities=[
        CapabilitySpec(id="consumption_analysis", name="Consumption Analysis",
                       purpose="compute the statistics", kind="activity")])
    ctx = PipelineContext(workflow_spec=spec)
    ctx.event_queue = run
    asyncio.run(tool_gap_layer.ActivityGapLayer().process(ctx, _done))

    assert [q["default"] for q in run.questions] == ["retry", "agent"]
    assert len(builds) == 3, "first build, the automatic retry, and the recommended retry"
    cap = spec.capabilities[0]
    assert cap.kind == "agent" and "code interpreter" in cap.purpose
    assert not ctx.metadata.get("build_issues"), "no step is left with nothing to run"
    assert run.payloads("activity_plan")[0]["failed"][0]["status"] == "handed_to_agent"


def _review_ctx(run, monkeypatch, dry_results):
    from app.layers.workflow import verify_layers
    from app.services.workflow_engine import engine, plan_test
    from app.services.workflow_engine.models import WorkflowDefinition

    definition = WorkflowDefinition(name="disputes", entry_step="s", steps=[
        {"id": "s", "type": "tool", "config": {"tool_name": "x"}}])
    spec = WorkflowSpec(goal="g", workflow_name="disputes")
    spec.definition = definition
    ctx = PipelineContext(workflow_spec=spec)
    ctx.event_queue = run
    monkeypatch.setattr(engine, "get_workflow", lambda name: definition)

    async def fake_test(defn, client):
        return {"passed": True, "summary": "1 passed"}

    async def fake_verification(c, parent):
        result = dry_results.pop(0)
        c.metadata[verify_layers.RESULT_KEY] = result
        return result

    monkeypatch.setattr(plan_test, "test_workflow", fake_test)
    monkeypatch.setattr(verify_layers, "run_verification", fake_verification)
    return ctx


FAILING = {"passed": False, "rounds": [], "scenarios": [{"name": "Typical", "passed": False,
                                                         "problems": ["step 's' failed"]}]}
PASSING = {"passed": True, "rounds": [], "scenarios": [{"name": "Typical", "passed": True, "problems": []}]}


def test_an_unverified_workflow_is_never_accepted_by_default(monkeypatch):
    from app.layers.workflow import finalize_layers as fl
    from app.layers.workflow import verify_layers

    run = DefaultingRun()
    ctx = _review_ctx(run, monkeypatch, [dict(FAILING)])
    ctx.metadata[verify_layers.RESULT_KEY] = dict(FAILING)  # what the Verify stage found
    asyncio.run(fl.WorkflowReviewLayer().process(ctx, _done))

    # Not accepted — and not tested again either: the scenarios ran, failed and
    # were repaired as far as repairs go. On the deployment the automatic
    # re-test repeated a 27-minute verification and ended the same way.
    assert [q["default"] for q in run.questions] == ["draft"]
    assert all(q["verified"] is False for q in run.questions)
    assert not run.payloads("workflow_accepted")
    assert ctx.metadata[fl.DRAFT_KEY] == "0 of 1 test scenario(s) pass"

    asyncio.run(fl.WorkflowRegistrationLayer().process(ctx, _done))
    registered, done = run.payloads("registered")[0], run.payloads("done")[0]
    assert registered["skipped"] and "not passed verification" in registered["error"]
    assert done == {"workflow_name": "disputes", "mistral_workflow_id": None, "verified": False,
                    "not_verified_reason": "0 of 1 test scenario(s) pass"}


def test_the_automatic_retest_can_rescue_it_and_a_verified_workflow_is_accepted(monkeypatch):
    from app.layers.workflow import finalize_layers as fl
    from app.layers.workflow import verify_layers

    run = DefaultingRun()
    ctx = _review_ctx(run, monkeypatch, [dict(PASSING)])  # the model answers this time
    # The Verify stage could not complete a scenario: the model service did not answer.
    ctx.metadata[verify_layers.RESULT_KEY] = {**FAILING, "inconclusive": 1}
    asyncio.run(fl.WorkflowReviewLayer().process(ctx, _done))
    assert [q["default"] for q in run.questions] == ["test", "accept"]
    assert "did not" in run.questions[0]["not_verified_reason"]
    assert run.payloads("workflow_accepted")[0]["verified"] is True
    assert fl.DRAFT_KEY not in ctx.metadata


def test_without_anyone_to_ask_an_unverified_workflow_is_a_draft(monkeypatch):
    from app.layers.workflow import finalize_layers as fl
    from app.layers.workflow import verify_layers
    from app.services.workflow_engine.models import WorkflowDefinition

    spec = WorkflowSpec(goal="g", workflow_name="disputes")
    spec.definition = WorkflowDefinition(name="disputes", entry_step="s", steps=[
        {"id": "s", "type": "tool", "config": {"tool_name": "x"}}])
    ctx = PipelineContext(workflow_spec=spec)
    ctx.metadata[verify_layers.RESULT_KEY] = dict(FAILING)
    asyncio.run(fl.WorkflowRegistrationLayer().process(ctx, _done))
    done = [json.loads(e.data) for e in ctx.events if e.event == "done"][0]
    assert done["verified"] is False and done["mistral_workflow_id"] is None


# ── Run-time input errors ────────────────────────────────────────────────────


def test_transform_code_sees_its_own_variables_and_parsed_records():
    from app.services.workflow_engine.expression_sandbox import check_transform, run_transform

    code = ("vals = variables['step_validate_output']['readings']\n"
            "n = len(vals)\n"
            "mean_kwh = sum(vals) / n\n"
            "std = (sum([(x - mean_kwh) ** 2 for x in vals]) / n) ** 0.5\n"
            "output = {'mean_kwh': mean_kwh, 'above': [x for x in vals if x > mean_kwh], 'std': round(std, 2)}\n")
    assert check_transform(code) is None
    variables = {"step_validate_output": json.dumps({"readings": [100, 200, 300]})}  # as the engine stores it
    assert run_transform(code, variables) == {"mean_kwh": 200.0, "above": [300], "std": 81.65}
    # Code written under the old contract ("may need json.loads") still runs.
    old = "rec = json.loads(variables['step_validate_output'])\noutput = {'n': len(rec['readings'])}"
    assert run_transform(old, variables) == {"n": 3}
    assert variables["step_validate_output"].startswith("{"), "the run's own variables are untouched"


def test_an_optional_field_sent_as_null_is_an_absent_field():
    from app.layers.codegen.profiles import ActivityRequirementProfile
    from app.services.workflow_engine.conform import argument_problems, conform_arguments
    from app.workflow_inputs import run_input

    record = {"type": "object", "required": ["account_id"], "properties": {
        "account_id": {"type": "string"}, "email": {"type": "string"},
        "readings": {"type": "array", "items": {"type": "object", "required": ["kwh"], "properties": {
            "kwh": {"type": "number"}, "note": {"type": "string"}}}}}}
    schema = {"type": "object", "required": ["dispute_record"], "properties": {"dispute_record": record}}
    args = {"dispute_record": {"account_id": "A1", "email": None, "readings": [{"kwh": 3, "note": None}]}}

    fixed, notes = conform_arguments(args, schema)
    assert fixed == {"dispute_record": {"account_id": "A1", "readings": [{"kwh": 3}]}}
    assert argument_problems(fixed, schema) == [] and len(notes) == 2
    # A required field that is null is still a problem.
    bad, _ = conform_arguments({"dispute_record": {"account_id": None}}, schema)
    assert argument_problems(bad, schema)

    # The run form's check agrees with the step runner.
    field = {"name": "dispute_record", "type": "object", "schema": record}
    assert run_input.check_value(field, args["dispute_record"]) == []

    # And a worked example saying "email": null no longer sends the spec back to its author.
    req = CodeRequirement(
        name="validate", purpose="activity", input_schema=schema,
        output_schema={"type": "object", "properties": {"ok": {"type": "boolean"}}},
        examples=[{"input": json.loads(json.dumps(args)), "output": {"ok": True}},
                  {"input": {"dispute_record": {"account_id": "A2"}}, "output": {"ok": True}}])
    need = CodeNeed(purpose="activity", contract={"input_schema": schema})
    assert ActivityRequirementProfile().bind_contract(need, req) == []
    assert "email" not in req.examples[0]["input"]["dispute_record"]


# ── An agent blocked by its own guardrail ────────────────────────────────────

BLOCK = ('API error occurred: Status 403. Body: {"object":"Error","message":"Request blocked by guardrail '
         'policy.","type":"invalid_request_error","code":3200,"guardrails":[{"moderation_llm_v2":{"action":'
         '"block","categories":{"financial":{"score":0.01,"violated":false},"pii":{"score":0.8656,'
         '"violated":true},"jailbreaking":{"score":0.04,"violated":false}}}}]}')


def test_pii_is_exempt_for_an_agent_that_is_handed_records_about_people():
    from app.layers.agent.guardrail_layer import handles_personal_data, parse_guardrails
    from app.services.workflow_engine.step_runners import (
        blocked_categories, guardrail_block, guardrail_message,
    )

    raw = {"enabled": True, "thresholds": {"pii": 0.2, "jailbreaking": 0.2}}
    safe_check = parse_guardrails(raw, "Output Safety Check: review the reply to the customer")
    assert safe_check.thresholds == {"pii": 1.0, "jailbreaking": 0.2}
    assert parse_guardrails(raw, "Summarise a public press release").thresholds["pii"] == 0.2
    assert parse_guardrails(raw, "Summarise a press release", personal_data=True).thresholds["pii"] == 1.0
    assert handles_personal_data("dispute_record with customer_name and email")

    assert guardrail_block(Exception(BLOCK)) == ["pii"]
    assert guardrail_block(Exception("Status 400 bad request")) is None
    message = guardrail_message("ag_1", ["pii"], Exception(BLOCK))
    assert "own moderation guardrail" in message and "'pii'" in message
    assert blocked_categories(message) == ["pii"] and blocked_categories("boom") is None


def test_the_dry_run_exempts_the_data_category_on_agents_the_plan_created(monkeypatch):
    from app.layers.workflow import plan_control
    from app.layers.workflow import verify_layers as vl
    from app.services import agent_service

    updates = []

    async def get_agent(client, agent_id):
        return {"id": agent_id, "name": "Output Safety Check Agent", "guardrails": [
            {"block_on_error": True, "moderation_llm_v2": {
                "action": "block", "custom_category_thresholds": {"pii": 0.2, "jailbreaking": 0.2}}}]}

    async def update_agent(client, agent_id, data, skip_rules=False):
        updates.append((agent_id, data, skip_rules))
        return {}

    monkeypatch.setattr(agent_service, "get_agent", get_agent)
    monkeypatch.setattr(agent_service, "update_agent", update_agent)
    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g", workflow_name="disputes"))
    plan_control.record_created(ctx, "agent", "ag_mine", "Output Safety Check Agent")
    failed = [{"name": "Typical", "problems": ["step 'check' failed: Blocked by guardrail policy"],
               "guardrail_blocks": [
                   {"step_id": "check", "agent_id": "ag_mine", "categories": ["pii", "jailbreaking"]},
                   {"step_id": "other", "agent_id": "ag_someone_elses", "categories": ["pii"]}]}]
    changed = asyncio.run(vl.relax_blocking_guardrails(ctx, "workflow_dry_run", 1, failed))

    assert [c["agent_id"] for c in changed] == ["ag_mine"], "only an agent this plan created"
    assert changed[0]["categories"] == ["pii"], "never jailbreaking or a harm category"
    agent_id, data, skip_rules = updates[0]
    thresholds = data["guardrails"][0]["moderation_llm_v2"]["custom_category_thresholds"]
    assert thresholds == {"pii": 1.0, "jailbreaking": 0.2}
    assert skip_rules is False, "the platform's agent rules still apply to the change"


# ── A wrong expectation does not fail a correct workflow ─────────────────────


def _clean_outcome(actual):
    text = "expected outcome not met — step_calc_output.total_gbp is 98.06, expected 98.0"
    return {"name": "Typical", "passed": False, "problems": [text], "failed_steps": [], "warnings": [],
            "hard_problems": 0,
            "expectation_misses": [{"index": 0, "path": "step_calc_output.total_gbp", "text": text,
                                    "actual": actual}]}


def _scenario():
    return {"name": "Typical", "input": {"kwh": 268},
            "expect": [{"path": "step_calc_output.total_gbp", "equals": 98.0,
                        "why": "expects £98.00 for simplicity"}]}


@pytest.mark.parametrize("verdict,passes", [("workflow", True), ("expectation", False), ("unclear", False)])
def test_unmet_expectations_of_a_clean_run_are_reviewed(monkeypatch, verdict, passes):
    from app.core import decision
    from app.layers.workflow import verify_layers as vl

    async def fake_decide(client, **kw):
        assert kw["phase"] == "expectation review"
        return json.dumps({"verdicts": [{"index": 0, "correct": verdict, "computed": "98.06",
                                         "why": "268 x 0.2875 + 31 x 0.524, plus 5% VAT"}]})

    monkeypatch.setattr(decision, "decide", fake_decide)
    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g", workflow_name="disputes"))
    scenarios, outcomes = [_scenario()], [_clean_outcome(98.06)]
    corrected = asyncio.run(vl.review_expectations(ctx, "workflow_dry_run", 0, scenarios, outcomes))
    assert corrected == (1 if passes else 0)
    assert outcomes[0]["passed"] is passes
    if passes:
        assert scenarios[0]["expect"][0]["equals"] == 98.06, "the re-run is held to the corrected value"
        assert outcomes[0]["corrected_expectations"][0]["was"] == {"equals": 98.0}


def test_a_run_with_a_failed_step_is_never_excused_by_an_expectation_review(monkeypatch):
    from app.core import decision
    from app.layers.workflow import verify_layers as vl

    async def boom(*a, **k):
        raise AssertionError("not reviewed")

    monkeypatch.setattr(decision, "decide", boom)
    outcome = _clean_outcome(98.06)
    outcome["hard_problems"] = 1
    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g", workflow_name="disputes"))
    assert asyncio.run(vl.review_expectations(ctx, "p", 0, [_scenario()], [outcome])) == 0
    assert outcome["passed"] is False
