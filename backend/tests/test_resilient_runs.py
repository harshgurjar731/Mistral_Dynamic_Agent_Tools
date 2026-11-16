"""A slow model cannot fail a run, and a repair cannot make a workflow worse.

Every test is a failure read from one deployed plan (85 minutes, 18 dry runs,
17 failed):

* each failed dry run ended at the same agent step with "The read operation
  timed out" after exactly 120 s — the agent's model took 148 s to write 77
  characters, the fallback 1.5 s;
* the repair loop was handed those timeouts as "failed scenarios" and rewrote
  three working activities until the workflow no longer validated;
* a scenario expected ``decision.outcome`` where the activity returns
  ``decision.outcome_code``, and steps the run never reached were each counted
  as a further failure;
* the agent's prompt named a few fields while its instructions required whole
  records, so the one time it answered it said "Insufficient data";
* a template used ``| abs`` and the figure was reported "not produced".
"""

import asyncio
import time
from types import SimpleNamespace

import pytest

from app.core import model_speed
from app.core.context import PipelineContext
from app.core.specs import CodeNeed, CodeRequirement, WorkflowSpec
from app.layers.workflow import verify_layers as vl
from app.services import agent_service  # noqa: F401 — imported up front: the hedge tests are timed
from app.services.workflow_engine import agent_call, failures
from app.services.workflow_engine.models import StepResult, StepType, WorkflowDefinition, WorkflowStep


@pytest.fixture(autouse=True)
def _fresh():
    model_speed.reset()
    agent_call.forget()
    yield
    model_speed.reset()
    agent_call.forget()


# ── What kind of failure ─────────────────────────────────────────────────────


def test_a_failure_has_a_kind():
    assert failures.kind("The read operation timed out", "agent") == failures.TRANSIENT
    assert failures.kind("Status 429: rate limit exceeded", "agent") == failures.TRANSIENT
    assert failures.kind("503 Service Unavailable", "agent") == failures.TRANSIENT
    assert failures.kind("Server disconnected without sending a response", "agent") == failures.TRANSIENT
    assert failures.kind("name 'round' is not defined", "transform") == failures.DESIGN
    assert failures.kind("the arguments do not match the activity's input schema", "tool") == failures.DESIGN
    # An activity's own code running out of time is the code's fault.
    assert failures.kind("Error: tool 'x' execution timed out after 30s", "tool") == failures.DESIGN
    assert failures.kind("Blocked by guardrail policy: … 'pii' …", "agent") == failures.GUARDRAIL
    assert "did not answer in time" in failures.describe("The read operation timed out")


# ── An agent call survives a slow model ──────────────────────────────────────

PROFILE = {"model": "mistral-large-latest", "instructions": "ROLE: you draft replies.",
           "tools": [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}],
           "guardrails": [], "completion_args": {"temperature": 0.2}, "portable": True}


def _agent_client(own_delay=0.0, own_error=None, calls=None):
    calls = calls if calls is not None else []

    def agents_complete(**kw):
        calls.append(("agent", kw.get("agent_id")))
        time.sleep(own_delay)
        if own_error:
            raise own_error
        return "answer from the agent's own model"

    def chat_complete(**kw):
        calls.append(("chat", kw["model"], kw))
        return f"answer from {kw['model']}"

    return SimpleNamespace(agents=SimpleNamespace(complete=agents_complete),
                           chat=SimpleNamespace(complete=chat_complete)), calls


def _settings(monkeypatch, **values):
    from app.config import settings

    for key, value in {"AGENT_FALLBACK_MODEL": "mistral-medium-latest", "AGENT_HEDGE_SECONDS": 0.05,
                       "AGENT_CALL_TIMEOUT_SECONDS": 30, **values}.items():
        monkeypatch.setattr(settings, key, value)


def test_a_silent_agent_model_is_raced_against_the_same_agent_on_the_fallback(monkeypatch):
    _settings(monkeypatch)
    monkeypatch.setattr(agent_call, "profile", lambda agent_id: dict(PROFILE))
    client, calls = _agent_client(own_delay=1.2)
    trace = {}
    messages = [{"role": "user", "content": "Draft the reply."}]

    async def go():
        started = time.monotonic()
        out = await agent_call.complete(client, "ag_1", messages, "draft", trace=trace)
        return out, time.monotonic() - started

    out, waited = asyncio.run(go())
    assert out == "answer from mistral-medium-latest" and waited < 1.0, "did not wait for the slow model"
    assert trace["fallback"] is True and trace["model"] == "mistral-medium-latest"
    assert "had not answered" in trace["why"]
    sent = next(c[2] for c in calls if c[0] == "chat")
    # The same agent: its instructions lead, its tools and sampling settings follow.
    assert sent["messages"][0] == {"role": "system", "content": PROFILE["instructions"]}
    assert sent["messages"][1:] == messages
    assert sent["tools"] == PROFILE["tools"] and sent["temperature"] == 0.2

    # Its model lost the race: the next step does not wait for it at all.
    assert model_speed.skipped("mistral-large-latest")
    calls.clear()
    asyncio.run(agent_call.complete(client, "ag_1", messages, "draft", trace={}))
    assert [c[0] for c in calls] == ["chat"]


def test_an_agent_that_answers_in_time_runs_on_its_own_model(monkeypatch):
    _settings(monkeypatch, AGENT_HEDGE_SECONDS=5)
    monkeypatch.setattr(agent_call, "profile", lambda agent_id: dict(PROFILE))
    client, calls = _agent_client()
    trace = {}
    out = asyncio.run(agent_call.complete(client, "ag_1", [{"role": "user", "content": "x"}], "s", trace=trace))
    assert out == "answer from the agent's own model"
    assert [c[0] for c in calls] == ["agent"] and trace["fallback"] is False


def test_a_timeout_falls_back_and_a_refusal_does_not(monkeypatch):
    _settings(monkeypatch, AGENT_HEDGE_SECONDS=5)
    monkeypatch.setattr(agent_call, "profile", lambda agent_id: dict(PROFILE))
    client, calls = _agent_client(own_error=TimeoutError("The read operation timed out"))
    trace = {}
    out = asyncio.run(agent_call.complete(client, "ag_1", [{"role": "user", "content": "x"}], "s", trace=trace))
    assert out == "answer from mistral-medium-latest" and "its own model failed" in trace["why"]

    refused = RuntimeError('Status 403: blocked by guardrail policy {"pii": {"score": 0.9, "violated": true}}')
    client, calls = _agent_client(own_error=refused)
    with pytest.raises(RuntimeError, match="guardrail"):
        asyncio.run(agent_call.complete(client, "ag_1", [{"role": "user", "content": "x"}], "s"))
    assert [c[0] for c in calls] == ["agent"], "a refusal is the answer — no other model is asked"


def test_an_agent_with_builtin_connectors_is_retried_on_its_own_model(monkeypatch):
    _settings(monkeypatch, AGENT_HEDGE_SECONDS=5)
    monkeypatch.setattr(agent_call, "profile", lambda agent_id: {
        **PROFILE, "tools": [{"type": "web_search"}], "portable": False})
    attempts = []

    def agents_complete(**kw):
        attempts.append(1)
        if len(attempts) == 1:
            raise TimeoutError("The read operation timed out")
        return "second try"

    client = SimpleNamespace(agents=SimpleNamespace(complete=agents_complete),
                             chat=SimpleNamespace(complete=lambda **kw: pytest.fail("no fallback for connectors")))
    assert asyncio.run(agent_call.complete(client, "ag_1", [], "s")) == "second try"


def test_the_fallback_carries_the_agents_guardrails_and_can_be_turned_off(monkeypatch):
    raw = [{"block_on_error": True, "moderation_llm_v2": {
        "model_name": "mistral-moderation-2603", "action": "block",
        "custom_category_thresholds": {"jailbreaking": 0.2, "pii": 1.0}}}]
    kwargs = agent_call.fallback_kwargs({**PROFILE, "guardrails": raw}, "mistral-medium-latest", [], 1000)
    assert len(kwargs["guardrails"]) == 1, "the agent's moderation guardrail goes with it"

    _settings(monkeypatch, AGENT_FALLBACK_MODEL="none")
    assert agent_call.fallback_model("mistral-large-latest") is None
    _settings(monkeypatch)
    assert agent_call.fallback_model("mistral-large-latest") == "mistral-medium-latest"
    # An agent already on the fallback model has the next tier down as its second model.
    assert agent_call.fallback_model("mistral-medium-latest") not in (None, "mistral-medium-latest")


# ── A model is checked before an agent is created on it ──────────────────────


def test_an_agent_is_not_created_on_a_model_that_is_not_answering(monkeypatch):
    probed = []

    def complete(**kw):
        probed.append(kw["model"])
        if kw["model"] == "mistral-large-latest":
            raise TimeoutError("The read operation timed out")
        return "ok"

    client = SimpleNamespace(chat=SimpleNamespace(complete=complete))
    model, note = asyncio.run(model_speed.responsive_model(
        client, "mistral-large-latest", ["mistral-medium-latest", "mistral-small-latest"]))
    assert model == "mistral-medium-latest" and "answering too slowly" in note
    assert model_speed.skipped("mistral-large-latest")
    # Remembered: the next agent does not probe the slow model again.
    probed.clear()
    asyncio.run(model_speed.responsive_model(client, "mistral-large-latest", ["mistral-medium-latest"]))
    assert probed == []

    model_speed.reset()
    assert asyncio.run(model_speed.responsive_model(client, "mistral-small-latest", []))[0] == "mistral-small-latest"


def test_a_model_that_keeps_losing_is_paused_for_longer_each_time():
    model_speed.strike("m", 50, "lost", decisive=True)
    first = model_speed.snapshot()["m"]["skipped_for"]
    with model_speed._lock:
        model_speed._stats["m"]["open_until"] = 0.0  # the pause is over; it is tried, and loses again
    model_speed.strike("m", 50, "lost", decisive=True)
    assert model_speed.snapshot()["m"]["skipped_for"] > first * 1.5
    # A plain timeout is not decisive on its own.
    assert model_speed.strike("other", 50, "timed out") is False


def test_the_default_agent_model_is_the_measured_fast_one():
    from app.config import settings

    fields = type(settings).model_fields
    assert fields["DEFAULT_AGENT_MODEL"].default == "mistral-medium-latest"
    assert fields["AGENT_FALLBACK_MODEL"].default == "mistral-medium-latest"
    assert fields["AGENT_HEDGE_SECONDS"].default > 0


# ── What an agent is handed ──────────────────────────────────────────────────

VARIABLES = {
    "step_recalculate_bill_output": {"status": "success", "data": {"recalculated_bill": {
        "total_gbp": 249.33, "difference_gbp": -0.67}}},
    "step_decide_outcome_output": '{"decision": {"outcome_code": "re-read", "refund_gbp": 0.0}}',
    "dispute": {"account": {"customer_name": "Sarah Johnson"}, "disputed_bill": {"bill_id": "BILL-1"}},
}


def test_template_filters_are_applied_not_reported_missing():
    from app.services.workflow_engine.step_runners import _resolve_value, substitute_double_brackets

    missing = []
    text = substitute_double_brackets(
        "difference £{{step_recalculate_bill_output.recalculated_bill.difference_gbp | abs}}, "
        "total £{{ step_recalculate_bill_output.recalculated_bill.total_gbp | round(1) }}, "
        "outcome {{step_decide_outcome_output.decision.outcome_code | upper}}, "
        "note {{step_decide_outcome_output.decision.note | default('none')}}",
        VARIABLES, missing=missing, mark_missing=True)
    assert text == "difference £0.67, total £249.3, outcome RE-READ, note none"
    assert missing == []
    # An unknown filter does not lose the value; a whole-value reference keeps its type.
    assert substitute_double_brackets("{{dispute.account.customer_name | sparkle}}", VARIABLES) == "Sarah Johnson"
    assert _resolve_value("{{step_recalculate_bill_output.recalculated_bill.difference_gbp | abs}}",
                          VARIABLES, []) == 0.67


def test_an_agent_step_is_handed_its_whole_input_records():
    from app.services.workflow_engine.step_runners import input_records_block

    missing = []
    block = input_records_block({
        "decision": "{{step_decide_outcome_output.decision}}",
        "dispute": "{{dispute}}",
        "consumption": "{{step_consumption_output.consumption}}",
    }, VARIABLES, missing)
    assert "## Input records" in block
    # Fields the prose template never mentioned are there — the bill id among them.
    assert '"bill_id": "BILL-1"' in block and '"outcome_code": "re-read"' in block
    assert missing == ["consumption ({{step_consumption_output.consumption}})"]
    assert input_records_block(None, VARIABLES) == "" and input_records_block({}, VARIABLES) == ""


def test_the_data_contract_decides_an_agents_input_records():
    from app.layers.workflow.dataflow_layer import _apply_contract

    record = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
    spec = WorkflowSpec(goal="g", workflow_name="disputes")
    spec.data_contract = {
        "records": {"dispute": {"origin": "run_input", "schema": record},
                    "decision": {"origin": "decide_outcome", "schema": record},
                    "draft_message": {"origin": "draft", "schema": record}},
        "bindings": {"draft": {"consumes": ["decision", "dispute"], "produces": "draft_message"}},
    }
    spec.inventory = {"activities": []}
    steps = [{"id": "draft", "type": "agent", "config": {"agent_id": "a", "query_template": "Draft it."}}]
    _apply_contract(PipelineContext(workflow_spec=spec), steps, [])
    assert steps[0]["config"]["input_records"] == {
        "decision": "{{step_decide_outcome_output.decision}}", "dispute": "{{dispute}}"}
    assert "draft_message" in steps[0]["config"]["output_schema"]["properties"]


# ── Verification: retry what is transient, repair only what is a design fault ─

DECISION = {"type": "object", "properties": {"decision": {"type": "object", "properties": {
    "outcome_code": {"type": "string"}, "refund_gbp": {"type": "number"}, "reason_code": {"type": "string"}},
    "required": ["outcome_code"]}}, "required": ["decision"]}
SAFETY = {"type": "object", "properties": {"result": {"type": "object", "properties": {
    "safe": {"type": "boolean"}}}}}


def _definition():
    return WorkflowDefinition(name="disputes", entry_step="decide", steps=[
        WorkflowStep(id="decide", type=StepType.AGENT, next_steps=["draft"],
                     config={"agent_id": "a", "query_template": "x", "output_schema": DECISION}),
        WorkflowStep(id="draft", type=StepType.AGENT, next_steps=["safety"],
                     config={"agent_id": "b", "query_template": "x"}),
        WorkflowStep(id="safety", type=StepType.AGENT, next_steps=[],
                     config={"agent_id": "c", "query_template": "x", "output_schema": SAFETY}),
    ], input_schema=[{"name": "dispute", "type": "object", "required": True}])


GOOD_DECISION = {"decision": {"outcome_code": "re-read", "refund_gbp": 0.0}}
TIMED_OUT = SimpleNamespace(status="FAILED", result={}, variables={"step_decide_output": GOOD_DECISION}, step_results=[
    StepResult(step_id="decide", status="completed", output=GOOD_DECISION),
    StepResult(step_id="draft", status="failed", error="The read operation timed out")])
COMPLETED = SimpleNamespace(status="COMPLETED", result={}, step_results=[
    StepResult(step_id="decide", status="completed", output=GOOD_DECISION),
    StepResult(step_id="draft", status="completed", output="Dear Sarah"),
    StepResult(step_id="safety", status="completed", output={"result": {"safe": True}})],
    variables={"step_decide_output": GOOD_DECISION, "step_safety_output": {"result": {"safe": True}}})


def _scenario():
    return {"name": "Estimated and anomalous", "input": {"dispute": {}}, "expect": [
        {"path": "step_decide_output.decision.outcome_code", "equals": "re-read", "why": "estimated and anomalous"},
        {"path": "step_safety_output.result.safe", "equals": True, "why": "nothing unsafe in the draft"}]}


def _verify(monkeypatch, runs, *, repairs=2, retries=2, definition=None):
    from app.config import settings
    from app.services.workflow_engine import engine

    current = {"definition": definition or _definition()}
    log = {"repairs": [], "restored": [], "runs": 0}

    async def execute(name, inputs, execution_id=None, wait_for_result=False):
        log["runs"] += 1
        return runs.pop(0)

    async def fake_repair(ctx, name, parent, round_no, failed):
        log["repairs"].append([vl.design_problems(o) for o in failed])
        return {"applied": True, "summary": f"repair {round_no}"}

    async def fake_restore(ctx, name, snapshot, label):
        log["restored"].append(label)

    async def no_issues(ctx, definition):
        return []

    async def no_catalog():
        return {}

    monkeypatch.setattr(engine, "get_workflow", lambda name: current["definition"])
    monkeypatch.setattr(engine, "execute_workflow", execute)
    monkeypatch.setattr(vl, "repair", fake_repair)
    monkeypatch.setattr(vl, "_restore", fake_restore)
    monkeypatch.setattr(vl, "_blocking_issues", no_issues)
    monkeypatch.setattr(vl, "_live_catalog", no_catalog)
    monkeypatch.setattr(vl, "TRANSIENT_WAIT", 0.0)
    monkeypatch.setattr(settings, "WORKFLOW_DRY_RUN_REPAIRS", repairs)
    monkeypatch.setattr(settings, "WORKFLOW_DRY_RUN_TRANSIENT_RETRIES", retries)
    spec = WorkflowSpec(goal="g", workflow_name="disputes")
    spec.definition = current["definition"]
    ctx = PipelineContext(workflow_spec=spec)
    ctx.metadata[vl.SCENARIOS_KEY] = [_scenario()]
    return ctx, log


def test_a_step_the_model_did_not_answer_is_run_again_not_repaired(monkeypatch):
    ctx, log = _verify(monkeypatch, [TIMED_OUT, COMPLETED])
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    assert result["passed"] is True and log["runs"] == 2 and log["repairs"] == []
    assert result["scenarios"][0]["retries"] == 1


def test_a_model_that_never_answers_leaves_the_workflow_untouched(monkeypatch):
    ctx, log = _verify(monkeypatch, [TIMED_OUT, TIMED_OUT, TIMED_OUT])
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    outcome = result["scenarios"][0]
    assert result["passed"] is False and result["inconclusive"] == 1
    assert log["repairs"] == [], "a timeout is never handed to Refine with AI"
    assert log["runs"] == 3, "the scenario and its two retries — no further rounds"
    # One problem, and it says what happened; the step the run never reached is not a second failure.
    assert len(outcome["problems"]) == 1 and "could not be completed" in outcome["problems"][0]
    assert outcome["unreached"] == 1 and outcome["hard_problems"] == 0
    assert "did not answer" in result["rounds"][0]["note"]

    from app.layers.workflow import finalize_layers as fl

    verified, why = fl.verification_state(ctx)
    assert verified is False and "not a fault of the workflow" in why
    assert fl.retest_worthwhile(ctx) is True


def test_expectations_must_name_fields_the_step_returns():
    scenarios = [{"name": "s", "input": {}, "expect": [
        {"path": "step_decide_output.decision.outcome", "equals": "re-read"},     # → outcome_code
        {"path": "step_decide_output.decision.anomalous", "equals": True},        # nothing like it
        {"path": "step_decide_output.decision.refund_gbp", "equals": 0.0},        # fine
        {"path": "step_draft_output.text", "exists": True},                        # undeclared: not judged
    ]}]
    notes = vl.check_expectation_paths(_definition().model_dump(mode="json"), {}, scenarios)
    assert [e["path"] for e in scenarios[0]["expect"]] == [
        "step_decide_output.decision.outcome_code", "step_decide_output.decision.refund_gbp",
        "step_draft_output.text"]
    assert [n["now"] for n in notes] == ["step_decide_output.decision.outcome_code", None]


def _failing(step_id, error, completed):
    results = [StepResult(step_id=s, status="completed", output=GOOD_DECISION if s == "decide" else "ok")
               for s in completed]
    results.append(StepResult(step_id=step_id, status="failed", error=error))
    return SimpleNamespace(status="FAILED", result={}, step_results=results,
                           variables={"step_decide_output": GOOD_DECISION} if "decide" in completed else {})


def test_a_repair_that_does_not_help_is_undone(monkeypatch):
    # Before: the run gets as far as 'safety'. After the "repair": it fails one step earlier.
    before = _failing("safety", "'draft' is not a record", ["decide", "draft"])
    after = _failing("draft", "name 'mean' is not defined", ["decide"])
    ctx, log = _verify(monkeypatch, [before, after])
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    assert len(log["repairs"]) == 1 and len(log["restored"]) == 1
    assert "did not improve" in log["restored"][0]
    assert result["rolled_back"] is True and result["rounds"][0]["repair"]["undone"] is True
    # What is reported is the state the workflow is in: the one before the repair.
    assert "'draft' is not a record" in result["scenarios"][0]["problems"][0]


def test_a_repair_that_gets_further_is_kept(monkeypatch):
    before = _failing("draft", "name 'mean' is not defined", ["decide"])
    after = _failing("safety", "'draft' is not a record", ["decide", "draft"])
    ctx, log = _verify(monkeypatch, [before, after], repairs=1)
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    assert log["restored"] == [] and result["rolled_back"] is False
    assert "'draft' is not a record" in result["scenarios"][0]["problems"][0]


def test_a_repair_that_breaks_validation_is_undone_before_anything_runs(monkeypatch):
    before = _failing("draft", "name 'mean' is not defined", ["decide"])
    ctx, log = _verify(monkeypatch, [before])
    answers = [[], ["Step 'safety' calls 'x': draft has no recalculated_bill"]]  # before, after

    async def issues(c, definition):
        return answers.pop(0)

    monkeypatch.setattr(vl, "_blocking_issues", issues)
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    assert log["runs"] == 1 and len(log["restored"]) == 1 and "validation errors" in log["restored"][0]
    assert result["rolled_back"] is True and result["rounds"][0]["repair"]["undone"] is True


def test_the_repair_is_told_only_about_design_faults():
    outcome = {"name": "s", "problems": ["step 'draft' could not be completed — the model did not answer in time",
                                         "expected outcome not met — x is 1, expected 2"],
               "transient_problems": ["step 'draft' could not be completed — the model did not answer in time"]}
    text = vl._instruction([outcome])
    assert "expected 2" in text and "could not be completed" not in text
    assert "merely to make a value appear where a test looks for it" in text


# ── Authoring: one example off the contract does not restart the specification ─

CONTRACT = {"input_schema": {"type": "object", "properties": {
    "reading_type": {"type": "string", "enum": ["actual", "estimated"]}}, "required": ["reading_type"]},
    "output_schema": {"type": "object", "properties": {"ok": {"type": "boolean"}}}}


def _requirement(examples):
    return CodeRequirement(name="validate", description="d", purpose="activity", kind="pure",
                           input_schema={}, output_schema=None, examples=examples)


def test_an_example_off_the_contract_is_left_out_when_enough_remain():
    from app.layers.codegen.profiles import _hold_to_contract

    need = CodeNeed(purpose="activity", contract=CONTRACT)
    good = [{"input": {"reading_type": "actual"}, "output": {"ok": True}},
            {"input": {"reading_type": "estimated"}, "output": {"ok": True}}]
    bad = {"input": {"reading_type": "manual_actual"}, "output": {"ok": False}}

    req = _requirement([good[0], bad, good[1]])
    assert _hold_to_contract(need, req) == []
    assert req.examples == good, "no second authoring call for one bad example"

    req = _requirement([good[0], bad])
    issues = _hold_to_contract(need, req)
    assert issues and "manual_actual" in issues[0], "too few sound examples left: back to the author"
