"""Revising a saved workflow: edit operations, diffs, the revision pipeline,
applying with conflict detection, versions and undo. No model is called — the
pipeline is driven with operations given directly, as the UI's direct edits are."""

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services.workflow_engine.models import WorkflowDefinition
from app.workflow_revisions import diff as revision_diff
from app.workflow_revisions import operations as ops
from app.workflow_revisions import store
from app.workflow_revisions.models import WorkflowRevisionRecord, WorkflowVersionRecord
from app.workflow_revisions.suggestions import suggestions_for


def _agent(step_id, nxt, template="", **extra):
    return {"id": step_id, "type": "agent", "description": f"do {step_id}",
            "config": {"agent_id": f"ag_{step_id}", "query_template": template},
            "next_steps": nxt, "parallel_group": None, **extra}


def _linear() -> dict:
    return {
        "name": "claim_flow",
        "description": "Assess a claim",
        "entry_step": "intake",
        "input_schema": [{"name": "claim", "type": "string"}],
        "variables": {},
        "ui_layout": {"intake": {"x": 0, "y": 0}},
        "steps": [
            _agent("intake", ["assess"], "Read {{claim}}"),
            _agent("assess", ["report"], "Assess {{step_intake_output}}"),
            _agent("report", [], "Report on {{step_assess_output}}"),
        ],
    }


def _ids(d):
    return [s["id"] for s in d["steps"]]


def _step(d, step_id):
    return next(s for s in d["steps"] if s["id"] == step_id)


# ── Operations ──────────────────────────────────────────────────────────────


def test_remove_middle_step_reconnects_and_flags_dangling_template():
    base = _linear()
    result = ops.apply_operations(base, [{"op": "remove_step", "step_id": "assess"}])

    assert _ids(result.definition) == ["intake", "report"]
    assert _step(result.definition, "intake")["next_steps"] == ["report"]
    assert any("step_assess_output" in w for w in result.warnings)
    assert _ids(base) == ["intake", "assess", "report"], "the base must not be mutated"


def test_remove_entry_step_moves_entry_to_its_successor():
    result = ops.apply_operations(_linear(), [{"op": "remove_step", "step_id": "intake"}])
    assert result.definition["entry_step"] == "assess"
    assert "intake" not in result.definition["ui_layout"]


def test_add_after_splices_into_the_flow():
    result = ops.apply_operations(_linear(), [{
        "op": "add_step", "after": "assess",
        "step": {"id": "Fraud Check", "type": "agent", "config": {"model": "m", "instructions": "x"}},
    }])
    d = result.definition
    assert _step(d, "assess")["next_steps"] == ["fraud_check"]
    assert _step(d, "fraud_check")["next_steps"] == ["report"]


def test_add_before_entry_becomes_the_entry():
    result = ops.apply_operations(_linear(), [{
        "op": "add_step", "before": "intake", "step": {"id": "validate", "type": "agent"},
    }])
    d = result.definition
    assert d["entry_step"] == "validate"
    assert _step(d, "validate")["next_steps"] == ["intake"]


def test_add_on_condition_branch():
    base = _linear()
    base["steps"][1] = {"id": "assess", "type": "condition", "next_steps": [],
                        "config": {"expression": "x > 1", "true_step": "report"},
                        "parallel_group": None}
    result = ops.apply_operations(base, [{
        "op": "add_step", "after": "assess", "branch": "true",
        "step": {"id": "escalate", "type": "agent"},
    }])
    d = result.definition
    assert _step(d, "assess")["config"]["true_step"] == "escalate"
    assert _step(d, "escalate")["next_steps"] == ["report"]


def test_rename_updates_links_and_templates():
    result = ops.apply_operations(_linear(), [
        {"op": "rename_step", "step_id": "assess", "new_id": "evaluate"}])
    d = result.definition
    assert _step(d, "intake")["next_steps"] == ["evaluate"]
    assert "step_evaluate_output" in _step(d, "report")["config"]["query_template"]
    assert not result.warnings


def test_move_step_detaches_and_reattaches():
    result = ops.apply_operations(_linear(), [
        {"op": "move_step", "step_id": "report", "after": "intake"}])
    d = result.definition
    assert _step(d, "intake")["next_steps"] == ["report"]
    assert _step(d, "report")["next_steps"] == ["assess"]
    assert _step(d, "assess")["next_steps"] == []


def test_parallel_group_converges_and_predecessor_targets_first_member():
    base = _linear()
    base["steps"].insert(2, _agent("weather", ["report"]))
    _step(base, "assess")["next_steps"] = ["weather"]
    result = ops.apply_operations(base, [
        {"op": "set_parallel_group", "step_ids": ["assess", "weather"], "group": "checks"}])
    d = result.definition
    assert _step(d, "assess")["parallel_group"] == _step(d, "weather")["parallel_group"] == "checks"
    assert _step(d, "assess")["next_steps"] == _step(d, "weather")["next_steps"] == ["report"]


def test_removing_one_of_two_parallel_members_dissolves_the_group():
    base = _linear()
    base["steps"].insert(2, _agent("weather", ["report"], parallel_group=None))
    for s in ("assess", "weather"):
        _step(base, s).update(parallel_group="g", next_steps=["report"])
    result = ops.apply_operations(base, [{"op": "remove_step", "step_id": "assess"}])
    d = result.definition
    assert _step(d, "intake")["next_steps"] == ["weather"]
    assert _step(d, "weather")["parallel_group"] is None


def test_a_failed_operation_is_reported_and_leaves_no_trace():
    result = ops.apply_operations(_linear(), [
        {"op": "remove_step", "step_id": "nope"},
        {"op": "update_step", "step_id": "report", "changes": {"description": "Final report"}},
        {"op": "add_step", "step": {"id": "intake"}},
    ])
    assert [o["ok"] for o in result.outcomes] == [False, True, False]
    assert _step(result.definition, "report")["description"] == "Final report"
    assert _ids(result.definition) == ["intake", "assess", "report"]


def test_update_step_merges_config_and_null_deletes():
    result = ops.apply_operations(_linear(), [{
        "op": "update_step", "step_id": "assess",
        "changes": {"config": {"query_template": "New", "agent_id": None, "model": "m"}},
    }])
    assert _step(result.definition, "assess")["config"] == {"query_template": "New", "model": "m"}


def test_inputs_can_be_added_and_removed():
    result = ops.apply_operations(_linear(), [
        {"op": "upsert_input", "field": {"name": "Policy Id", "type": "string"}},
        {"op": "remove_input", "name": "claim"},
    ])
    assert [f["name"] for f in result.definition["input_schema"]] == ["policy_id"]


# ── Diff and suggestions ────────────────────────────────────────────────────


def test_diff_reports_steps_edges_and_entry():
    before = _linear()
    after = ops.apply_operations(before, [
        {"op": "remove_step", "step_id": "intake"},
        {"op": "update_step", "step_id": "report", "changes": {"description": "x"}},
    ]).definition
    d = revision_diff.diff_definitions(before, after)
    assert d["changed"]
    assert d["steps_removed"] == ["intake"]
    assert d["steps_modified"][0]["step_id"] == "report"
    assert d["entry_step"] == {"before": "intake", "after": "assess"}
    assert ["intake", "assess"] in d["edges_removed"]


def test_diff_of_identical_definitions_is_unchanged():
    assert not revision_diff.diff_definitions(_linear(), _linear())["changed"]


def test_suggestions_put_errors_first_and_fall_back_to_improvements():
    issues = [
        {"severity": "warning", "code": "agent.empty_query", "step_id": "a", "message": "m"},
        {"severity": "error", "code": "step.unreachable", "step_id": "b", "message": "m"},
    ]
    out = suggestions_for(issues)
    assert out[0]["step_id"] == "b" and out[0]["kind"] == "fix"
    assert all(s["kind"] != "fix" for s in suggestions_for([]))


# ── Service: propose → apply → undo ─────────────────────────────────────────


@pytest.fixture
def env(monkeypatch, tmp_path):
    """A private database for revisions, and an in-memory workflow store."""
    engine = create_engine(f"sqlite:///{tmp_path / 'rev.db'}")
    WorkflowRevisionRecord.__table__.create(engine)
    WorkflowVersionRecord.__table__.create(engine)
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=engine))

    from app.services.workflow_engine import engine as wf_engine, rule_validation
    from app.services.workflow_engine.validation import validate_workflow

    saved: dict[str, WorkflowDefinition] = {}

    def get_workflow(name):
        wf = saved.get(name)
        return WorkflowDefinition(**wf.model_dump()) if wf else None

    def save_workflow(definition):
        saved[definition.name] = WorkflowDefinition(**definition.model_dump())
        return definition.name

    async def structural_only(definition, **kw):
        return validate_workflow(definition)

    monkeypatch.setattr(wf_engine, "get_workflow", get_workflow)
    monkeypatch.setattr(wf_engine, "save_workflow", save_workflow)
    monkeypatch.setattr(rule_validation, "validate_with_rules", structural_only)
    saved["claim_flow"] = WorkflowDefinition(**_linear())
    return saved


def _run(coro):
    return asyncio.run(coro)


def test_direct_edit_is_proposed_without_changing_the_workflow(env):
    from app.services import workflow_revision_service as svc

    rev = _run(svc.propose(None, "claim_flow",
                           operations=[{"op": "remove_step", "step_id": "assess"}]))
    assert rev["status"] == "proposed"
    assert rev["instruction"] == "Remove step 'assess'"
    assert rev["diff"]["steps_removed"] == ["assess"]
    assert [t["name"] for t in rev["trace"]][0] == "revision_context"
    assert len(env["claim_flow"].steps) == 3, "proposing must not save"


def test_apply_saves_versions_and_undo_restores(env):
    from app.services import workflow_revision_service as svc

    rev = _run(svc.propose(None, "claim_flow",
                           operations=[{"op": "remove_step", "step_id": "assess"}]))
    applied = _run(svc.apply("claim_flow", rev["id"]))
    assert applied["revision"]["status"] == "applied"
    assert [s.id for s in env["claim_flow"].steps] == ["intake", "report"]

    versions = _run(svc.list_versions("claim_flow"))
    assert [v["source"] for v in versions["versions"]] == ["revision", "baseline"]
    assert versions["versions"][0]["is_current"] and versions["can_undo"]

    _run(svc.undo("claim_flow"))
    assert [s.id for s in env["claim_flow"].steps] == ["intake", "assess", "report"]


def test_apply_is_refused_when_the_workflow_changed_since(env):
    from app.services import workflow_revision_service as svc
    from app.services.workflow_revision_service import RevisionConflict

    rev = _run(svc.propose(None, "claim_flow",
                           operations=[{"op": "remove_step", "step_id": "assess"}]))
    other = _run(svc.propose(None, "claim_flow", operations=[
        {"op": "update_step", "step_id": "report", "changes": {"description": "changed"}}]))
    _run(svc.apply("claim_flow", other["id"]))

    with pytest.raises(RevisionConflict):
        _run(svc.apply("claim_flow", rev["id"]))
    assert store.get_revision(rev["id"])["status"] == "superseded"


def test_apply_with_errors_needs_explicit_consent(env):
    from app.services import workflow_revision_service as svc
    from app.services.workflow_revision_service import RevisionInvalid

    rev = _run(svc.propose(None, "claim_flow", operations=[
        {"op": "update_step", "step_id": "report", "changes": {"config": {"agent_id": None}}}]))
    assert not rev["validation"]["valid"]
    assert rev["validation"]["introduced"][0]["code"] == "agent.missing_binding"

    with pytest.raises(RevisionInvalid):
        _run(svc.apply("claim_flow", rev["id"]))
    assert _run(svc.apply("claim_flow", rev["id"], allow_errors=True))["valid"] is False


def test_a_no_op_edit_fails_instead_of_proposing_nothing(env):
    from app.services import workflow_revision_service as svc

    rev = _run(svc.propose(None, "claim_flow",
                           operations=[{"op": "set_entry_step", "step_id": "intake"}]))
    assert rev["status"] == "failed"
    assert "would not change" in rev["error"]


def test_server_owned_fields_survive_apply(env):
    from app.services import workflow_revision_service as svc

    live = env["claim_flow"]
    live.is_deployed, live.id = True, "wf_123"
    live.published_hash = live.semantic_hash()

    rev = _run(svc.propose(None, "claim_flow", operations=[
        {"op": "update_step", "step_id": "report", "changes": {"description": "new"}}]))
    _run(svc.apply("claim_flow", rev["id"]))
    saved = env["claim_flow"]
    assert saved.id == "wf_123" and saved.is_deployed
    assert saved.has_unpublished_changes


# ── Interpreting an instruction (model faked) ───────────────────────────────


def _fake_model(monkeypatch, reply: dict, seen: list | None = None):
    import json as _json

    import app.core.decision as decision
    from app.layers.revision import context_layer

    async def decide(client, *, system, user, **kw):
        if seen is not None:
            seen.append(user)
        return _json.dumps(reply)

    async def no_catalog(ctx):
        return {"agents": [{"id": "ag_legal", "name": "Legal reviewer"}], "activities": [],
                "connectors": "(none available)"}

    monkeypatch.setattr(decision, "decide", decide)
    monkeypatch.setattr(context_layer, "_catalog", no_catalog)


def test_instruction_becomes_operations_and_a_proposal(env, monkeypatch):
    from app.services import workflow_revision_service as svc

    seen: list[str] = []
    _fake_model(monkeypatch, {
        "understood": True,
        "summary": "Adds a legal review before the report.",
        "operations": [
            {"op": "add_step", "before": "report",
             "step": {"id": "legal_review", "type": "agent",
                      "config": {"agent_id": "ag_legal", "query_template": "Review {{step_assess_output}}"}}},
            {"op": "explode_everything"},
        ],
        "reasoning": "The user asked for legal sign-off.",
    }, seen)

    rev = _run(svc.propose(None, "claim_flow", instruction="Have legal review it before the report",
                           focus_step_ids=["report", "ghost"]))
    assert rev["status"] == "proposed"
    assert rev["summary"] == "Adds a legal review before the report."
    assert [o["op"] for o in rev["operations"]] == ["add_step"], "malformed ops are dropped"
    assert rev["focus_step_ids"] == ["report"], "unknown focus steps are dropped"
    assert rev["diff"]["steps_added"] == ["legal_review"]
    assert "Have legal review it" in seen[0] and "Legal reviewer" in seen[0]


def test_ambiguous_instruction_asks_instead_of_guessing(env, monkeypatch):
    from app.services import workflow_revision_service as svc

    _fake_model(monkeypatch, {"understood": False, "operations": [],
                              "clarification": "Which check — intake or assess?"})
    rev = _run(svc.propose(None, "claim_flow", instruction="remove the check"))
    assert rev["status"] == "needs_clarification"
    assert rev["clarification"] == "Which check — intake or assess?"
    assert rev["proposed_definition"] is None

    # The answer is interpreted with the question in its history.
    seen: list[str] = []
    _fake_model(monkeypatch, {"understood": True, "summary": "Removes assess.",
                              "operations": [{"op": "remove_step", "step_id": "assess"}]}, seen)
    _run(svc.propose(None, "claim_flow", instruction="assess"))
    assert "Which check" in seen[0]


def test_model_failure_is_recorded_not_raised(env, monkeypatch):
    import app.core.decision as decision
    from app.services import workflow_revision_service as svc

    async def broken(*a, **kw):
        raise RuntimeError("model down")

    _fake_model(monkeypatch, {})
    monkeypatch.setattr(decision, "decide", broken)
    rev = _run(svc.propose(None, "claim_flow", instruction="anything"))
    assert rev["status"] == "failed" and "could not be interpreted" in rev["error"]


# ── Refine with AI as a planned fix (diagnosis, plan, code fix, live progress) ──


def _activity_flow() -> dict:
    d = _linear()
    d["name"] = "loan_flow"
    d["steps"][1] = {"id": "assess", "type": "tool", "description": "affordability",
                     "config": {"tool_name": "affordability_calculation", "tool_version": 2,
                                "arguments": {"cost": "{{step_intake_output}}"}},
                     "next_steps": ["report"], "parallel_group": None}
    return d


class _Queue:
    def __init__(self):
        self.events = []

    def put_nowait(self, sse):
        self.events.append(sse)


def test_a_failed_run_is_planned_and_the_activity_code_is_rebuilt(env, monkeypatch):
    from app.layers.revision import fix_layers
    from app.services import code_rebuild
    from app.services import workflow_revision_service as svc
    from app.workflow_revisions import fix_plan

    env["loan_flow"] = WorkflowDefinition(**_activity_flow())
    seen: list[str] = []
    _fake_model(monkeypatch, {
        "understood": True,
        "summary": "Rounds the instalment in the code and reports it.",
        "operations": [{"op": "update_step", "step_id": "report", "reason": "Name the instalment",
                        "changes": {"config": {"query_template": "Report {{step_assess_output}} with the instalment"}}}],
        "code_fixes": [{"step_id": "assess", "tool_name": "affordability_calculation",
                        "problem": "round() is not defined in the code",
                        "change": "Compute the instalment without round(); return monthly_instalment_gbp."},
                       {"tool_name": "not_in_this_workflow", "change": "x"}],
        "reasoning": "The failure is in the activity code.",
    }, seen)

    async def diagnose(name, base, execution_id):
        assert execution_id == "exec-1"
        return {"execution_id": "exec-1", "status": "FAILED", "error": "name 'round' is not defined",
                "failed_steps": [{"step_id": "assess", "step_type": "tool",
                                  "tool_name": "affordability_calculation", "tool_version": 2, "tool_id": 41,
                                  "error": "name 'round' is not defined", "input_preview": '{"cost": 185000}',
                                  "code": "def affordability_calculation(cost):\n    return round(cost)"}]}

    rebuilt = {}

    async def rebuild(tool_id, **kw):
        rebuilt.update(tool_id=tool_id, **kw)
        kw["on_event"]({"message": "verifying against the examples"})
        return {"status": "approved", "version": 3, "name": "affordability_calculation"}

    monkeypatch.setattr(fix_plan, "diagnose", diagnose)
    monkeypatch.setattr(code_rebuild, "rebuild_from_failure", rebuild)

    queue = _Queue()
    rev = _run(svc.propose(None, "loan_flow", instruction="Fix the failed run",
                           execution_id="exec-1", event_queue=queue))

    assert rev["status"] == "proposed", rev.get("error")
    # The analysis saw the failure and the failing code.
    assert "name 'round' is not defined" in seen[0] and "return round(cost)" in seen[0]
    # The code was rebuilt from the failing input, without re-pinning other workflows.
    assert rebuilt["tool_id"] == 41 and rebuilt["failing_input"] == {"cost": 185000}
    assert rebuilt["update_workflows"] is False and "without round()" in rebuilt["comment"]
    # The proposal is pinned to the new version; applying it adopts the fixed code.
    assess = _step(rev["proposed_definition"], "assess")
    assert assess["config"]["tool_version"] == 3
    # The plan: one workflow edit, one code fix (the unknown activity dropped), then the checks.
    assert [(i["kind"], i["status"]) for i in rev["plan"]] == [
        ("workflow", "completed"), ("code", "completed"), ("check", "completed"), ("check", "completed")]
    assert rev["plan"][1]["version"] == 3
    # Progress streamed live: the plan was re-published as items changed.
    names = [e.event for e in queue.events]
    assert "pipeline" in names and names.count("fix_plan") >= 4
    assert any(e.event == "status" and "verifying" in str(e.data) for e in queue.events)


def test_a_code_fix_that_does_not_build_fails_the_turn_when_nothing_else_changes(env, monkeypatch):
    from app.services import code_rebuild
    from app.services import workflow_revision_service as svc
    from app.workflow_revisions import fix_plan

    env["loan_flow"] = WorkflowDefinition(**_activity_flow())
    _fake_model(monkeypatch, {"understood": True, "summary": "Fix the code", "operations": [],
                              "code_fixes": [{"tool_name": "affordability_calculation",
                                              "change": "Handle a zero cost."}]})

    async def diagnose(name, base, execution_id):
        return {}

    async def rebuild(tool_id, **kw):
        return {"status": "failed", "message": "the new version failed its examples"}

    async def record(name, version):
        return {"id": 7}

    monkeypatch.setattr(fix_plan, "diagnose", diagnose)
    monkeypatch.setattr(fix_plan, "_activity_record", record)
    monkeypatch.setattr(code_rebuild, "rebuild_from_failure", rebuild)

    rev = _run(svc.propose(None, "loan_flow", instruction="It crashes on zero cost"))
    assert rev["status"] == "failed"
    assert "failed its examples" in rev["error"]
    assert [i["status"] for i in rev["plan"]] == ["failed", "skipped", "failed"]
