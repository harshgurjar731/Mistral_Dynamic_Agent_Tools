"""Governance runtime: oversight placement, human review, reflection, and the checks on them."""

import asyncio
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.specs import ArchetypeSpec, CapabilitySpec, OversightSpec, WorkflowSpec


@pytest.fixture
def review_db(monkeypatch, tmp_path):
    from app.database import Base
    from app.services.workflow_engine import reviews

    engine = create_engine(f"sqlite:///{tmp_path / 'rv.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[reviews.HumanReview.__table__])
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(reviews, "SessionLocal", Session)
    return Session


def _arch(model="human_in_the_loop", applies_to="every_transaction", **kw):
    return ArchetypeSpec(primary_type="task", patterns=["tool_using_react"],
                         oversight=OversightSpec(model=model, applies_to=applies_to,
                                                 reviewer_role="AP clerk", approval_sla="4 hours",
                                                 threshold=kw.pop("threshold", ""),
                                                 sample_rate=kw.pop("sample_rate", 0.0)), **kw)


def _ctx(arch, steps=None, facts=None):
    from app.core.context import PipelineContext
    from app.process import pipeline as pk

    ctx = PipelineContext(query="q")
    cap = CapabilitySpec(id="extract", name="Extract invoice", purpose="p", kind="agent", archetype=arch)
    ctx.workflow_spec = WorkflowSpec(goal="g", capabilities=[cap])
    ctx.workflow_spec.workflow_name = "invoice_flow"
    ctx.workflow_spec.dag = {"name": "invoice_flow", "entry_step": "extract", "steps": steps or [
        {"id": "extract", "type": "agent", "next_steps": ["post"], "parallel_group": None,
         "config": {"agent_id": "a1"}},
        {"id": "post", "type": "tool", "next_steps": [], "parallel_group": None, "config": {"tool_name": "post"}}]}
    if facts is not None:
        ctx.metadata[pk.CONTEXT_KEY] = {"enabled": True, "documents": [{"id": 1}], "facts": facts}
    return ctx


def _place(ctx):
    from app.layers.workflow.oversight_layer import OversightPlacementLayer

    async def nxt(c):
        return c
    return asyncio.run(OversightPlacementLayer().process(ctx, nxt))


def _steps(ctx):
    return {s["id"]: s for s in ctx.workflow_spec.dag["steps"]}


# ── Placement ──────────────────────────────────────────────────────────────


def test_every_transaction_review_follows_the_agent_and_steps_are_stamped():
    ctx = _place(_ctx(_arch(max_tool_rounds=4, reflection_criteria=["3-way match"])))
    s = _steps(ctx)
    assert s["extract"]["next_steps"] == ["review_extract"]
    review = s["review_extract"]
    assert review["type"] == "human_review" and review["next_steps"] == ["post"]
    assert review["config"]["review_of"] == "extract" and review["config"]["reviewer_role"] == "AP clerk"
    assert review["config"]["sla_seconds"] == 4 * 3600
    stamped = s["extract"]["config"]["archetype"]
    assert stamped["max_tool_rounds"] == 4 and stamped["reflection_criteria"] == ["3-way match"]


def test_exceptions_only_gates_on_the_agents_flag():
    s = _steps(_place(_ctx(_arch(applies_to="exceptions_only"))))
    gate = s["gate_extract"]
    assert s["extract"]["next_steps"] == ["gate_extract"]
    assert gate["config"]["expression"] == "{{step_extract_output.needs_review}} == True"
    assert gate["config"]["true_step"] == "review_extract" and gate["config"]["false_step"] == "post"
    assert gate["config"]["fallback_step"] == "review_extract"  # unreadable → a person, not past them
    assert s["review_extract"]["next_steps"] == ["post"]


def test_threshold_gate_and_fallback_to_every_case():
    s = _steps(_place(_ctx(_arch(applies_to="threshold_based", threshold="amount > 10000"))))
    assert s["gate_extract"]["config"]["expression"] == "{{step_extract_output.amount}} > 10000"
    vague = _place(_ctx(_arch(applies_to="threshold_based", threshold="large invoices")))
    assert "gate_extract" not in _steps(vague) and "review_extract" in _steps(vague)
    assert "not a simple comparison" in vague.layer_summary("oversight_placement")


def test_sample_and_on_the_loop():
    sampled = _steps(_place(_ctx(_arch(applies_to="sample", sample_rate=0.05))))
    assert sampled["review_extract"]["config"]["sample_rate"] == 0.05
    on_loop = _place(_ctx(_arch(model="human_on_the_loop")))
    assert "review_extract" not in _steps(on_loop)
    assert _steps(on_loop)["extract"]["config"]["archetype"]["oversight"]["model"] == "human_on_the_loop"


def test_review_goes_after_a_whole_parallel_group():
    steps = [
        {"id": "extract", "type": "agent", "next_steps": ["join"], "parallel_group": "g", "config": {"agent_id": "a1"}},
        {"id": "other", "type": "tool", "next_steps": ["join"], "parallel_group": "g", "config": {}},
        {"id": "join", "type": "tool", "next_steps": [], "parallel_group": None, "config": {}}]
    s = _steps(_place(_ctx(_arch(), steps=steps)))
    assert s["extract"]["next_steps"] == s["other"]["next_steps"] == ["review_extract"]
    assert s["review_extract"]["next_steps"] == ["join"] and s["review_extract"]["parallel_group"] is None


def test_connector_needing_approval_gets_a_review_in_front():
    steps = [
        {"id": "extract", "type": "agent", "next_steps": ["pay"], "parallel_group": None, "config": {"agent_id": "a1"}},
        {"id": "pay", "type": "connector", "next_steps": [], "parallel_group": None,
         "config": {"connector_name": "SAP payments", "tool_name": "post_payment"}}]
    facts = {"integrations": {"connectors": [{"id": "sap_pay", "name": "SAP payments",
                                              "operations": [{"name": "post_payment", "requires_approval": True}]}]}}
    s = _steps(_place(_ctx(_arch(model="not_applicable"), steps=steps, facts=facts)))
    assert s["extract"]["next_steps"] == ["review_extract"]
    assert s["review_extract"]["next_steps"] == ["pay"]
    assert s["review_extract"]["config"]["title"].startswith("Approve before")


# ── The local review step ──────────────────────────────────────────────────


def _review_step(**config):
    from app.services.workflow_engine.models import StepType, WorkflowStep

    return WorkflowStep(id="review_extract", type=StepType.HUMAN_REVIEW,
                        config={"review_of": "extract", "editable": ["amount"], **config})


async def _run_review(step, decide_with=None, delay=0.05):
    from app.services.workflow_engine import execution_logs, reviews
    from app.services.workflow_engine.step_runners import run_human_review_step

    execution_logs.CURRENT_EXECUTION.set("exec-1")
    task = asyncio.create_task(run_human_review_step(step, {"step_extract_output": {"amount": 120}}))
    await asyncio.sleep(delay)
    pending = reviews.list_reviews()
    if decide_with:
        await reviews.decide(pending[0]["id"], **decide_with)
    return pending, await task


def test_approve_and_edit_continue_with_the_corrections(review_db):
    pending, result = asyncio.run(_run_review(_review_step(), {"decision": "edit", "edits": {"amount": 100},
                                                                "decided_by": "sam"}))
    assert pending[0]["payload"] == {"amount": 120} and pending[0]["engine"] == "local"
    assert result.status == "completed" and result.output["amount"] == 100
    assert result.output["review"]["decision"] == "edited"


def test_reject_stops_the_workflow(review_db):
    _, result = asyncio.run(_run_review(_review_step(), {"decision": "reject", "comment": "wrong vendor"}))
    assert result.status == "failed" and "wrong vendor" in result.error


def test_timeout_fails_or_approves_as_configured(review_db):
    _, failed = asyncio.run(_run_review(_review_step(sla_seconds=1), None, delay=0))
    assert failed.status == "failed" and "No review decision" in failed.error
    _, passed = asyncio.run(_run_review(_review_step(sla_seconds=1, on_timeout="approve"), None, delay=0))
    assert passed.status == "completed"


def test_sampling_skips_most_runs(review_db, monkeypatch):
    import random

    monkeypatch.setattr(random, "random", lambda: 0.9)
    pending, result = asyncio.run(_run_review(_review_step(sample_rate=0.1), None, delay=0))
    assert result.output["review"]["decision"] == "not_sampled" and pending == []


def test_decisions_are_checked(review_db):
    from app.services.workflow_engine import reviews

    review = reviews.open_review(execution_id="e", step_id="s", editable=["amount"])
    with pytest.raises(ValueError):
        asyncio.run(reviews.decide(review["id"], "edit", edits={"vendor": "x"}))
    with pytest.raises(ValueError):
        asyncio.run(reviews.decide(review["id"], "maybe"))
    asyncio.run(reviews.decide(review["id"], "approve"))
    with pytest.raises(PermissionError):
        asyncio.run(reviews.decide(review["id"], "reject"))


def test_review_routes(review_db):
    from fastapi.testclient import TestClient

    import app.main
    from app.services.workflow_engine import reviews

    client = TestClient(app.main.app)
    review = reviews.open_review(execution_id="e2", step_id="s", title="Check it")
    assert client.get("/api/reviews").json()["count"] == 1
    ok = client.post(f"/api/reviews/{review['id']}/decision", json={"decision": "approve", "decided_by": "kim"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert client.post(f"/api/reviews/{review['id']}/decision", json={"decision": "approve"}).status_code == 409


# ── Reflection ─────────────────────────────────────────────────────────────


def test_reflection_passes_or_revises(monkeypatch):
    from app.core import decision
    from app.services.workflow_engine.step_runners import reflect

    answers = iter([json.dumps({"verdict": "revise", "issues": ["total wrong"], "revised": '{"total": 100}'}),
                    json.dumps({"verdict": "pass", "issues": []})])

    async def fake(client, **kw):
        return next(answers)

    monkeypatch.setattr(decision, "decide", fake)
    text, meta = asyncio.run(reflect(None, "s", "sum it", '{"total": 90}', ["totals reconcile"], max_passes=2))
    assert text == '{"total": 100}' and meta == {"passes": 2, "verdict": "revised", "issues": ["total wrong"]}

    async def down(client, **kw):
        raise RuntimeError("no model")

    monkeypatch.setattr(decision, "decide", down)
    text, meta = asyncio.run(reflect(None, "s", "q", "kept", []))
    assert text == "kept" and meta["verdict"] == "skipped"


# ── Checks ─────────────────────────────────────────────────────────────────


def test_human_review_in_a_parallel_group_is_invalid():
    from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep
    from app.services.workflow_engine.validation import validate_workflow

    wf = WorkflowDefinition(name="w", entry_step="a", steps=[
        WorkflowStep(id="a", type=StepType.TRANSFORM, config={"transform_code": "x"}, next_steps=["r"]),
        WorkflowStep(id="r", type=StepType.HUMAN_REVIEW, parallel_group="g", config={"review_of": "a"})])
    codes = {i.code for i in validate_workflow(wf).issues}
    assert "human_review.parallel" in codes and "human_review.no_reviewer" in codes


def test_governance_requires_review_for_hitl_and_checks_guidance():
    from app.layers.workflow.governance_checks import governance_issues, guidance_compliance
    from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep

    arch = _arch()
    spec = WorkflowSpec(goal="g", capabilities=[CapabilitySpec(id="extract", name="Extract", kind="agent", archetype=arch)])
    unreviewed = WorkflowDefinition(name="w", entry_step="extract", steps=[
        WorkflowStep(id="extract", type=StepType.AGENT, config={"agent_id": "a", "archetype": {"patterns": []}})])
    assert [i["code"] for i in governance_issues(spec, unreviewed)] == ["governance.missing_review"]
    reviewed = WorkflowDefinition(name="w", entry_step="extract", steps=[
        WorkflowStep(id="extract", type=StepType.AGENT, next_steps=["r"],
                     config={"agent_id": "a", "archetype": {"patterns": []}}),
        WorkflowStep(id="r", type=StepType.HUMAN_REVIEW, config={"review_of": "extract", "reviewer_role": "x"})])
    assert governance_issues(spec, reviewed) == []

    must_goal = {"id": 9, "title": "Use goal agents", "strength": "must", "effect": {"archetype.primary_type": "goal"}}
    assert guidance_compliance(spec, [must_goal], [])[0]["severity"] == "error"
    spec.capabilities[0].archetype.source = "document"
    assert guidance_compliance(spec, [must_goal], [])[0]["severity"] == "warning"


def test_compiled_workflow_waits_for_reviews_durably():
    from app.services.mistral_workflows_compiler import compile_workflow_to_python
    from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep

    wf = WorkflowDefinition(name="w", entry_step="a", steps=[
        WorkflowStep(id="a", type=StepType.AGENT, config={"agent_id": "x"}, next_steps=["r"]),
        WorkflowStep(id="r", type=StepType.HUMAN_REVIEW, config={"review_of": "a"})])
    src = compile_workflow_to_python(wf)
    compile(src, "w.py", "exec")
    assert "def review_decision" in src and "workflow.wait_condition" in src
    assert "open_mistral_review(step_def, variables)" in src and '_opened.get("skip")' in src
