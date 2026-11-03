"""Rebuild-from-error spec revision, the Refine-with-AI repair loop, and model routing."""

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest

from app.core import decision
from app.core.specs import CodeRequirement
from app.layers.codegen import feedback as fb
from tests.test_codegen_pipeline import GST_REQ, stub  # noqa: F401 — fixture
from tests.test_code_rebuild import _feedback_need, _run as run_need
from tests.test_workflow_revisions import _fake_model, _run, env  # noqa: F401 — fixtures


# ── Specification revision checks ──────────────────────────────────────────


def _req():
    return CodeRequirement.from_dict({**copy.deepcopy(GST_REQ), "purpose": "activity"})


def test_a_sound_revision_passes():
    revised = {"description": GST_REQ["description"] + " Accepts numeric strings.",
               "examples": GST_REQ["examples"] + [
                   {"input": {"subtotal": 50}, "output": {"gst_amount": 9.0, "grand_total": 59.0}}]}
    assert fb.check_revision(_req(), revised) == []


def test_dropping_an_output_field_unasked_is_refused():
    out = copy.deepcopy(GST_REQ["output_schema"])
    del out["properties"]["gst_amount"]
    out["required"] = ["grand_total"]
    examples = [{"input": e["input"], "output": {"grand_total": e["output"]["grand_total"]}}
                for e in GST_REQ["examples"]]
    problems = fb.check_revision(_req(), {"output_schema": out, "examples": examples})
    assert any("gst_amount" in p for p in problems)
    # …unless the user named it.
    assert fb.check_revision(_req(), {"output_schema": out, "examples": examples},
                             user_comment="stop returning gst_amount") == []


def test_examples_must_satisfy_the_revised_schemas_and_not_shrink():
    bad = {"examples": [{"input": {"subtotal": "100"}, "output": {"gst_amount": 18.0}}]}
    problems = fb.check_revision(_req(), bad)
    assert any("dropped worked examples" in p for p in problems)
    assert any("input breaks" in p for p in problems)


def test_python_type_names_in_a_revision_are_fixed_not_refused():
    schema = {"type": "object", "properties": {"subtotal": {"type": ["float", "null"]}},
              "required": ["subtotal"]}
    revised = {"input_schema": schema}
    assert fb.check_revision(_req(), revised) == []
    assert revised["input_schema"]["properties"]["subtotal"]["type"] == ["number", "null"]


# ── revise_for_feedback ─────────────────────────────────────────────────────


class _Ctx:
    def __init__(self, req):
        self.requirement, self.client, self.events = req, object(), []
        self.profile = SimpleNamespace(noun="workflow activity")

    def emit(self, stage, message, **data):
        self.events.append(message)


def _with_feedback(comment="Round to 2 dp and accept '1,200' style amounts"):
    req = _req()
    req.feedback = {"runtime_error": "ValueError: could not convert '1,200'", "comment": comment,
                    "previous_code": "def run(**kw): ..."}
    return req


def _answer(monkeypatch, answer, seen=None):
    async def decide(client, **kw):
        if seen is not None:
            seen.append(kw)
        return json.dumps(answer)

    monkeypatch.setattr(fb, "decide", decide)


def test_revision_is_applied_and_directives_set(monkeypatch):
    seen = []
    new_desc = GST_REQ["description"] + " A subtotal given as text like '1,200' is accepted."
    _answer(monkeypatch, {"specification": {"description": new_desc, "name": "renamed!"},
                          "directives": ["Accept '1,200' style amounts", "Round to 2 dp"],
                          "contract_changed": False, "reasoning": "r"}, seen)
    ctx = _Ctx(_with_feedback())
    assert asyncio.run(fb.revise_for_feedback(ctx)) is True
    assert ctx.requirement.description == new_desc
    assert ctx.requirement.name == "apply_gst", "the name never changes"
    assert ctx.requirement.feedback["directives"] == ["Accept '1,200' style amounts", "Round to 2 dp"]
    assert seen[0]["route"] == "spec_revision"
    assert "Round to 2 dp" in seen[0]["user"] and "could not convert" in seen[0]["user"]


def test_an_unsound_revision_keeps_the_spec_but_still_sends_directives(monkeypatch):
    _answer(monkeypatch, {"specification": {"examples": []}, "directives": []})
    ctx = _Ctx(_with_feedback("accept strings"))
    assert asyncio.run(fb.revise_for_feedback(ctx)) is False
    assert ctx.requirement.examples == GST_REQ["examples"]
    directives = ctx.requirement.feedback["directives"]
    assert directives[0] == "accept strings" and "could not convert" in directives[1]


def test_the_rebuild_sends_the_revised_spec_and_directives(stub, monkeypatch):  # noqa: F811
    s = stub()
    new_desc = GST_REQ["description"] + " Strings are accepted."
    _answer(monkeypatch, {"specification": {"description": new_desc},
                          "directives": ["Accept numeric strings"]})
    resolution = run_need(_feedback_need())
    assert resolution.status == "built"
    sent = s.submitted[0]
    assert sent["description"] == new_desc
    assert sent["feedback"]["directives"] == ["Accept numeric strings"]
    assert sent["feedback"]["comment"] == "accept strings"


# ── Refine with AI: the repair loop ─────────────────────────────────────────


def _sequence_model(monkeypatch, replies, seen):
    import app.core.decision as dec
    from app.layers.revision import context_layer

    queue = list(replies)

    async def decide(client, *, system, user, **kw):
        seen.append({"system": system, "user": user, **kw})
        return json.dumps(queue.pop(0) if len(queue) > 1 else queue[0])

    async def no_catalog(ctx):
        return {"agents": [{"id": "ag_legal", "name": "Legal reviewer"}], "activities": [],
                "connectors": "(none available)"}

    monkeypatch.setattr(dec, "decide", decide)
    monkeypatch.setattr(context_layer, "_catalog", no_catalog)


GOOD_OP = {"op": "update_step", "step_id": "report",
           "changes": {"description": "Write the final report"}, "reason": "asked"}


def test_failed_edits_are_sent_back_and_a_better_set_is_kept(env, monkeypatch):  # noqa: F811
    from app.services import workflow_revision_service as svc

    seen: list = []
    _sequence_model(monkeypatch, [
        {"understood": True, "summary": "first", "operations": [
            GOOD_OP, {"op": "remove_step", "step_id": "ghost", "reason": "x"}], "reasoning": "r"},
        {"understood": True, "summary": "Renames the report step's description.",
         "operations": [GOOD_OP], "reasoning": "r"},
    ], seen)
    rev = _run(svc.propose(None, "claim_flow", instruction="Describe the report step better"))
    assert rev["status"] == "proposed"
    assert len(seen) == 2, "one repair round"
    assert "YOUR PREVIOUS ATTEMPT" in seen[1]["user"] and "ghost" in seen[1]["user"]
    assert "REPAIR round" in seen[1]["system"] and seen[1]["route"] == "workflow_revision"
    assert [o["op"] for o in rev["operations"]] == ["update_step"]
    assert rev["summary"] == "Renames the report step's description."


def test_a_repair_that_is_not_better_is_discarded(env, monkeypatch):  # noqa: F811
    from app.services import workflow_revision_service as svc

    seen: list = []
    first = {"understood": True, "summary": "first", "operations": [
        GOOD_OP, {"op": "remove_step", "step_id": "ghost", "reason": "x"}], "reasoning": "r"}
    _sequence_model(monkeypatch, [first, first], seen)
    rev = _run(svc.propose(None, "claim_flow", instruction="Describe the report step better"))
    assert rev["summary"] == "first"
    assert len(seen) == 2, "stops after a round that did not improve"


def test_clean_edits_are_not_repaired(env, monkeypatch):  # noqa: F811
    from app.services import workflow_revision_service as svc

    seen: list = []
    _sequence_model(monkeypatch, [{"understood": True, "summary": "s", "operations": [GOOD_OP],
                                   "reasoning": "r"}], seen)
    _run(svc.propose(None, "claim_flow", instruction="Describe the report step better"))
    assert len(seen) == 1


# ── Model routing ───────────────────────────────────────────────────────────


def _response(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class _Client:
    def __init__(self, behaviour):
        self.calls, self.behaviour = [], behaviour
        self.chat = SimpleNamespace(complete=self._complete)

    def _complete(self, **kw):
        self.calls.append(kw)
        return self.behaviour(kw)


def test_orchestrator_decisions_reason_on_a_reasoning_model(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "MISTRAL_ORCHESTRATOR_MODEL", "mistral-large-4")
    monkeypatch.setattr(decision, "reasoning_capable", lambda m: True)
    client = _Client(lambda kw: _response("{}"))
    asyncio.run(decision.decide(client, model="mistral-large-4", system="s", user="u", phase="p"))
    assert client.calls[0]["reasoning_effort"] == "high"


def test_no_effort_for_a_model_the_catalog_says_cannot_reason(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "MISTRAL_ORCHESTRATOR_MODEL", "mistral-large-2512")
    monkeypatch.setattr(decision, "reasoning_capable", lambda m: False)
    client = _Client(lambda kw: _response("{}"))
    asyncio.run(decision.decide(client, model="mistral-large-2512", system="s", user="u", phase="p"))
    assert "reasoning_effort" not in client.calls[0]


@pytest.mark.parametrize("message", [
    "reasoning_effort none is not supported for this model",
    "reasoning_effort is not enabled for this model",
])
def test_rejected_effort_is_recognised(message):
    assert decision.rejects_effort(RuntimeError(f"Status 400. Body: {message}"))


def test_not_enabled_effort_is_dropped_not_sent_to_the_fallback():
    def behaviour(kw):
        if "reasoning_effort" in kw:
            raise RuntimeError("Status 400: reasoning_effort is not enabled for this model")
        return _response('{"ok": 1}')

    client = _Client(behaviour)
    out = asyncio.run(decision.decide(client, route="spec_author", system="s", user="u", phase="p"))
    assert out == '{"ok": 1}'
    assert [c["model"] for c in client.calls] == ["mistral-large-4", "mistral-large-4"]


def test_heavy_routes_use_the_largest_model_with_high_effort():
    from app.llm_routes import route_for

    for role in ("spec_author", "spec_revision", "reuse_resolution", "input_schema",
                 "workflow_revision", "capability_gap"):
        route = route_for(role)
        assert route.model == "mistral-large-4" and route.reasoning_effort == "high", role
