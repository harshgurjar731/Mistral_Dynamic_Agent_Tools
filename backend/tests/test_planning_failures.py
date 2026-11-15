"""Three planning failures from the claim workflow, and what now prevents each.

1. "Output Safety and Delivery" failed its build at example_mismatch: its worked
   examples stated composed text the code could not reproduce word for word.
2. Step 'fraud_risk_scoring' failed every dry run: its agent has the code
   interpreter, and the agents completion endpoint answers 400 "CodeInterpreterTool
   connector is not supported".
3. The dry run's repair gave up with "the model did not answer": a timed-out or
   unreadable decision was final.
"""

import asyncio
from types import SimpleNamespace

from app.core.specs import CodeNeed, CodeRequirement
from app.layers.codegen.profiles import ActivityRequirementProfile, drop_composed_text

# ── 1. Composed text in worked examples ───────────────────────────────────────


def _req(examples):
    return CodeRequirement(
        name="output_safety_and_delivery", purpose="activity",
        input_schema={"type": "object", "properties": {"claim_id": {"type": "string"},
                                                       "summary": {"type": "string"}}},
        output_schema={"type": "object", "properties": {
            "safe": {"type": "boolean"}, "channel": {"type": "string", "enum": ["email", "letter"]},
            "delivery_message": {"type": "string"}, "summary": {"type": "string"}}},
        examples=examples)


def test_composed_text_is_left_out_of_example_outputs():
    summary = "The claim was reviewed and approved for payment in full"
    req = _req([
        {"input": {"claim_id": "CLM-2024-0002", "summary": summary},
         "output": {"safe": True, "channel": "email", "summary": summary,
                    "delivery_message": "Dear customer, your claim CLM-2024-0002 has been approved."}},
        {"input": {"claim_id": "CLM-1"}, "output": {"safe": False, "channel": "letter"}},
    ])
    dropped = drop_composed_text(req)
    assert dropped == ["example 1: delivery_message"]
    # Values computed deterministically, enum values and text copied from the input stay.
    assert req.examples[0]["output"] == {"safe": True, "channel": "email", "summary": summary}
    assert req.examples[1]["output"] == {"safe": False, "channel": "letter"}


def test_the_activity_profile_strips_it_before_the_build():
    req = _req([
        {"input": {"claim_id": "A"}, "output": {"safe": True, "channel": "email",
                                                "delivery_message": "Your claim A has now been approved in full."}},
        {"input": {"claim_id": "B"}, "output": {"safe": False, "channel": "letter"}},
    ])
    issues = ActivityRequirementProfile().bind_contract(CodeNeed(purpose="activity"), req)
    assert "delivery_message" not in req.examples[0]["output"]
    assert not any("worked example" in i for i in issues)


def test_a_build_that_cannot_match_an_example_goes_back_to_its_author_once(monkeypatch):
    from app.layers.codegen import layers
    from app.layers.codegen.profiles import profile_for
    from app.services.tool_resolver import tool_resolver

    failed = {"status": "failed", "message": "Verification failed after 2 attempt(s) (last stage: example_mismatch).",
              "report": {"attempts": [{"stage": "example_mismatch"}], "cases": [
                  {"case_id": "example_1", "ok": False,
                   "detail": "output differs from the worked example — data.risk_band: expected 'high', got 'medium'\n…"},
                  {"case_id": "example_2", "ok": True, "detail": ""}]}}

    async def run_synthesis(request, on_event=None):
        return dict(failed)

    monkeypatch.setattr(tool_resolver, "run_synthesis", run_synthesis)
    ctx = layers.RequirementContext(need=CodeNeed(purpose="activity"), profile=profile_for("activity"),
                                    client=None)
    ctx.requirement = CodeRequirement(name="risk", purpose="activity")
    asyncio.run(layers.SubmitAndTrackLayer().run(ctx))
    assert ctx.example_reauthored and len(ctx.issues) == 1
    assert "data.risk_band: expected 'high', got 'medium'" in ctx.issues[0]

    ctx.issues = []
    asyncio.run(layers.SubmitAndTrackLayer().run(ctx))
    assert ctx.issues == [], "only once: a second failure is final"


# ── 2. Agents with conversation-only connectors ───────────────────────────────


def test_connector_refusals_are_recognised():
    from app.services.workflow_engine.step_runners import needs_conversations

    err = Exception('API error occurred: Status 400. Body: {"object":"error","message":'
                    '"CodeInterpreterTool connector is not supported","type":"invalid_tools","code":"1800"}')
    assert needs_conversations(err)
    assert not needs_conversations(Exception("Status 429 rate limit"))
    assert not needs_conversations(Exception("Status 400 invalid_request_error: bad message"))


def test_a_code_interpreter_agent_step_runs_through_conversations(monkeypatch):
    from app.services.workflow_engine import step_runners
    from app.services.workflow_engine.models import StepType, WorkflowStep

    calls = {"complete": 0, "start": 0}

    def complete(**kw):
        calls["complete"] += 1
        raise Exception('Status 400. Body: {"message":"CodeInterpreterTool connector is not supported",'
                        '"type":"invalid_tools"}')

    def start(**kw):
        calls["start"] += 1
        entry = SimpleNamespace(type="message.output", content='{"fraud_risk_score": 0.82}', agent_id=None)
        return SimpleNamespace(outputs=[entry], conversation_id="c1")

    client = SimpleNamespace(agents=SimpleNamespace(complete=complete),
                             beta=SimpleNamespace(conversations=SimpleNamespace(start=start)))
    monkeypatch.setattr("app.dependencies.get_mistral_client", lambda: client)
    monkeypatch.setattr(step_runners, "_resolve_agent_id", lambda c, a: "ag_fraud")
    monkeypatch.setattr("app.rules.store.rules_for_agent", lambda agent_id: [])
    step_runners.CONVERSATION_ONLY_AGENTS.discard("ag_fraud")

    step = WorkflowStep(id="fraud_risk_scoring", type=StepType.AGENT, next_steps=[],
                        config={"agent_id": "ag_fraud", "query_template": "Score this claim"})
    result = asyncio.run(step_runners.run_agent_step(step, {}))
    assert result.status == "completed", result.error
    assert "0.82" in str(result.output)
    assert calls == {"complete": 1, "start": 1}

    # Known from then on: no wasted completion call.
    asyncio.run(step_runners.run_agent_step(step, {}))
    assert calls == {"complete": 1, "start": 2}


# ── 3. Decisions that time out or come back unreadable ───────────────────────


def test_a_timed_out_decision_is_answered_by_the_fallback_model():
    from app.core.decision import _complete

    models = []

    def complete(**kw):
        models.append(kw["model"])
        if kw["model"] == "big":
            raise Exception("Request timed out after 300000ms")
        return "ok"

    client = SimpleNamespace(chat=SimpleNamespace(complete=complete))
    out = asyncio.run(_complete(client, "big", "s", "u", 0.1, 1000, "high", "small"))
    assert out == "ok" and models == ["big", "small"]


def test_an_unreadable_decision_is_asked_again(monkeypatch):
    from app.core import decision
    from app.core.context import PipelineContext

    answers = iter(["", '{"choice": "x", "reasoning": "r"}'])
    prompts = []

    async def fake_decide(client, **kw):
        prompts.append(kw["user"])
        return next(answers)

    monkeypatch.setattr(decision, "decide", fake_decide)

    class Pick(decision.DecisionLayer):
        name = "pick"

        def build_prompt(self, ctx):
            return "system", "user"

        def apply(self, ctx, data):
            ctx.metadata["choice"] = data["choice"]

    async def done(c):
        return c

    ctx = asyncio.run(Pick().process(PipelineContext(query="q"), done))
    assert ctx.metadata["choice"] == "x"
    assert len(prompts) == 2 and "could not be read" in prompts[1]


def test_a_repair_whose_fix_could_not_be_planned_is_tried_again(monkeypatch):
    from app.core.context import PipelineContext
    from app.core.specs import WorkflowSpec
    from app.layers.workflow import verify_layers as vl
    from app.services import workflow_revision_service as revisions

    outcomes = [{"id": "r1", "status": "failed", "error": "the model did not answer"},
                {"id": "r2", "status": "proposed", "summary": "fixed"}]
    applied = []

    async def propose(client, name, **kw):
        return outcomes.pop(0)

    async def apply(name, rid, **kw):
        applied.append(rid)

    async def no_versions(ctx, revision):
        return None

    monkeypatch.setattr(revisions, "propose", propose)
    monkeypatch.setattr(revisions, "apply", apply)
    monkeypatch.setattr(vl, "_record_versions", no_versions)
    monkeypatch.setattr("app.services.workflow_engine.engine.get_workflow", lambda name: None)
    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g", workflow_name="claims"))
    failed = [{"name": "Designed example", "execution_id": "x", "failed_steps": ["s"], "problems": ["boom"]}]
    out = asyncio.run(vl.repair(ctx, "claims", "workflow_dry_run", 1, failed))
    assert out["applied"] is True and applied == ["r2"]
