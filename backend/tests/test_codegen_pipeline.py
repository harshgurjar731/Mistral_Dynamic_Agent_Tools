"""The code-requirement pipeline R1–R8, with scripted decisions and a stub tool service."""

import asyncio
import json

import pytest

from app.core.specs import CodeNeed
from app.layers.codegen import contracts, layers, pipeline

GST_REQ = {
    "name": "apply_gst",
    "description": "Apply 18% GST to a subtotal; return gst_amount and grand_total rounded to 2 dp.",
    "kind": "pure",
    "input_schema": {"type": "object", "properties": {
        "subtotal": {"type": "number", "description": "Pre-tax amount"}}, "required": ["subtotal"]},
    "output_schema": {"type": "object", "properties": {
        "gst_amount": {"type": "number"}, "grand_total": {"type": "number"}},
        "required": ["gst_amount", "grand_total"]},
    "examples": [
        {"input": {"subtotal": 100}, "output": {"gst_amount": 18.0, "grand_total": 118.0}},
        {"input": {"subtotal": 200}, "output": {"gst_amount": 36.0, "grand_total": 236.0}},
    ],
    "api_details": "No external API. This is a pure computation using the standard library.",
}


class Stub:
    """Scripted decide() answers per phase, and a fake tool service."""

    def __init__(self, answers=None, builds=None, catalogue=None):
        self.answers = {k: list(v) if isinstance(v, list) else [v] for k, v in (answers or {}).items()}
        self.builds = list(builds or [{"status": "approved", "tool_id": 11, "version": 1}])
        self.catalogue = catalogue or []
        self.phases: list[str] = []
        self.prompts: list[str] = []
        self.submitted: list[dict] = []

    async def decide(self, client, *, system, user, phase, route=None, **_):
        self.phases.append(phase)
        self.prompts.append(user)
        queue = self.answers.get(phase)
        if not queue:
            raise AssertionError(f"unexpected decision '{phase}'")
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        return json.dumps(answer)

    async def run_synthesis(self, spec, on_event=None):
        self.submitted.append(spec)
        build = dict(self.builds.pop(0) if len(self.builds) > 1 else self.builds[0])
        build.setdefault("tool_name", spec["name"])
        if on_event:
            on_event({"stage": "verify", "message": "verified"})
        return build

    async def list_tools(self):
        return self.catalogue


@pytest.fixture
def stub(monkeypatch):
    def install(**kw):
        s = Stub(**kw)
        monkeypatch.setattr(layers, "decide", s.decide)
        from app.services import tool_resolver as tr
        from app.services import tool_registry

        monkeypatch.setattr(tr.tool_resolver, "run_synthesis", s.run_synthesis)
        monkeypatch.setattr(tr.tool_resolver, "list_tools", s.list_tools)

        async def no_refresh():
            return None

        monkeypatch.setattr(tool_registry, "refresh_dynamic_tools", no_refresh)
        return s
    return install


def _run(need, **kw):
    return asyncio.run(pipeline.resolve_code_need(need, client=object(), **kw))


def _activity_need(outputs=("gst_amount", "grand_total")):
    return CodeNeed(purpose="activity", origin="workflow", intent="apply GST", name_hint="apply_gst",
                    capability={"id": "gst", "name": "apply_gst", "purpose": "apply GST",
                                "inputs": ["subtotal"], "outputs": list(outputs)})


def test_explicit_tool_request_goes_through_every_layer(stub):
    s = stub(answers={
        "normalise need": {"name": "word_count", "summary": "count words"},
        "policy gate": {"allowed": True},
        "spec authoring": {**GST_REQ, "name": "word_count", "output_schema": None, "examples": []},
    })
    resolution = _run(CodeNeed(purpose="tool", origin="explicit", intent="count words in text"))
    assert resolution.status == "built" and resolution.name == "word_count"
    assert s.phases == ["normalise need", "policy gate", "spec authoring"]
    assert s.submitted[0]["purpose"] == "tool"


def test_activity_missing_capability_output_is_reauthored(stub):
    incomplete = {**GST_REQ, "output_schema": {"type": "object", "properties": {"gst_amount": {"type": "number"}}}}
    s = stub(answers={"policy gate": {"allowed": True}, "spec authoring": [incomplete, GST_REQ]})
    resolution = _run(_activity_need())
    assert resolution.status == "built"
    assert s.phases.count("spec authoring") == 2
    assert len(s.submitted) == 1, "the incomplete spec must never reach the tool service"
    assert set(s.submitted[0]["output_schema"]["properties"]) == {"gst_amount", "grand_total"}


def test_tool_service_rejection_is_reauthored(stub):
    s = stub(answers={"policy gate": {"allowed": True}, "spec authoring": GST_REQ},
             builds=[{"status": "spec_invalid", "issues": ["example_1: expected 18.0 but 20.0"]},
                     {"status": "approved", "tool_id": 3, "version": 2}])
    resolution = _run(_activity_need())
    assert resolution.status == "built" and resolution.version == 2
    assert s.phases.count("spec authoring") == 2 and len(s.submitted) == 2


def test_reauthoring_is_bounded(stub):
    s = stub(answers={"policy gate": {"allowed": True}, "spec authoring": GST_REQ},
             builds=[{"status": "spec_invalid", "issues": ["still wrong"]}])
    resolution = _run(_activity_need())
    assert resolution.status == "failed" and "still wrong" in resolution.message
    assert len(s.submitted) == layers.MAX_REAUTHORS + 1


def test_existing_activity_is_reused(stub):
    catalogue = [{"id": 5, "name": "apply_gst", "purpose": "activity", "status": "approved",
                  "is_active": True, "version_no": 4,
                  "schema": {"function": {"name": "apply_gst", "description": "GST",
                                          "parameters": {"properties": {}}}},
                  "output_schema": GST_REQ["output_schema"]}]
    s = stub(answers={"policy gate": {"allowed": True},
                      "reuse resolution": {"action": "exists", "existing_name": "apply_gst",
                                           "reason": "same calculation"}},
             catalogue=catalogue)
    resolution = _run(_activity_need())
    assert resolution.status == "reused" and resolution.version == 4
    assert resolution.output_schema == GST_REQ["output_schema"]
    assert s.submitted == []


def test_tools_are_not_offered_as_activities(stub):
    catalogue = [{"id": 5, "name": "apply_gst", "purpose": "tool", "status": "approved", "is_active": True,
                  "schema": {"function": {"name": "apply_gst"}}}]
    s = stub(answers={"policy gate": {"allowed": True}, "spec authoring": GST_REQ}, catalogue=catalogue)
    resolution = _run(_activity_need())
    assert "reuse resolution" not in s.phases
    # …and the new activity may not take the tool's name.
    assert resolution.name == "apply_gst_2"


def test_policy_block_stops_before_authoring(stub):
    s = stub(answers={"normalise need": {"name": "run_shell"},
                      "policy gate": {"allowed": False, "reason": "executes shell commands"}})
    resolution = _run(CodeNeed(purpose="tool", origin="explicit", intent="run any shell command"))
    assert resolution.status == "blocked" and "shell" in resolution.message
    assert "spec authoring" not in s.phases


def test_policy_gate_fails_closed(stub):
    s = stub(answers={"normalise need": {"name": "x"}})
    s.answers["policy gate"] = []  # decide() will raise
    resolution = _run(CodeNeed(purpose="tool", origin="explicit", intent="something"))
    assert resolution.status == "blocked" and resolution.reason == "policy_unavailable"


def test_runtime_recovery_rebuilds_the_stored_requirement_verbatim(stub):
    s = stub()
    need = CodeNeed(purpose="activity", origin="runtime", name_hint="apply_gst",
                    requirement={**GST_REQ, "purpose": "activity"})
    resolution = _run(need)
    assert resolution.status == "built"
    assert s.phases == [], "a stored requirement is not re-screened, re-matched or re-authored"
    assert s.submitted[0]["examples"] == GST_REQ["examples"]


def test_preflight_fixes_types_and_rejects_inconsistent_examples(stub):
    bad = {**GST_REQ,
           "input_schema": {"type": "object", "properties": {"subtotal": {"type": "float", "description": "x"}},
                            "required": ["subtotal", "ghost"]},
           "examples": [{"input": {"subtotal": "100"}, "output": {"gst_amount": 18.0}},
                        {"input": {"subtotal": 1}, "output": {"gst_amount": 0.18}}]}
    s = stub(answers={"policy gate": {"allowed": True}, "spec authoring": [bad, GST_REQ]})
    resolution = _run(_activity_need())
    assert resolution.status == "built" and s.phases.count("spec authoring") == 2
    second_author_prompt = [p for ph, p in zip(s.phases, s.prompts) if ph == "spec authoring"][1]
    assert "previous specification was rejected" in second_author_prompt
    assert "example 1 input" in second_author_prompt
    assert s.submitted[0]["input_schema"]["properties"]["subtotal"]["type"] == "number"


def test_output_reference_contract_check():
    dag = {"steps": [
        {"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst"}},
        {"id": "letter", "type": "agent", "config": {
            "query_template": "Total {{step_gst_output.grand_total}} tax {{step_gst_output.tax}}"}},
    ]}
    issues = contracts.check_output_references(dag, {"gst": GST_REQ["output_schema"]})
    assert len(issues) == 1 and issues[0]["field"] == "tax" and issues[0]["step_id"] == "letter"
    assert contracts.check_output_references(dag, {}) == []


def test_resolve_many_does_not_double_claim_a_name(stub):
    stub(answers={"policy gate": {"allowed": True}, "spec authoring": GST_REQ})

    async def go():
        return await pipeline.resolve_code_needs([_activity_need(), _activity_need()],
                                                 client=object(), concurrency=1)

    first, second = asyncio.run(go())
    assert {first.name, second.name} == {"apply_gst", "apply_gst_2"}
