"""Stages, sublayers, backtracking and the decide → check → repair cycle (app.core.stages)."""

import asyncio
import json

from app.core.context import PipelineContext
from app.core.decision import DecisionLayer
from app.core.layer import Layer
from app.core.pipeline import Pipeline
from app.core.specs import WorkflowSpec
from app.core.stages import REPAIR_ISSUES_KEY, Stage, request_rewind


class Step(Layer):
    def __init__(self, name, fn=None, rewindable=False):
        self.name = name
        self.fn = fn
        self.rewindable = rewindable

    async def process(self, ctx, next):
        if self.fn:
            stop = self.fn(ctx)
            if stop:
                return ctx
        return await next(ctx)


def _events(ctx, kind):
    return [e.data for e in ctx.events if e.event == kind]


def test_stage_manifest_and_events():
    p = Pipeline("t")
    p.add(Stage("understand", "Understand", "", [Step("a"), Step("b")]))
    p.add(Step("loose"))
    p.add(Stage("build", "Build", "", [Step("c")]))
    manifest = p.manifest()
    assert [m["name"] for m in manifest] == ["understand", "loose", "build"]
    assert [c["name"] for c in manifest[0]["children"]] == ["a", "b"]
    assert [m["name"] for m in p.flat_manifest()] == ["a", "b", "loose", "c"]

    ctx = asyncio.run(p.execute(PipelineContext()))
    states = [(e["name"], e["state"]) for e in _events(ctx, "layer")]
    assert states.index(("understand", "active")) < states.index(("a", "active"))
    assert states.index(("b", "completed")) < states.index(("understand", "completed"))
    assert ("build", "completed") in states


def test_insert_beside_a_staged_layer_joins_its_stage():
    p = Pipeline("t")
    p.add(Stage("s", "S", "", [Step("a"), Step("c")]))
    p.add(Step("b"), after="a")
    assert [c["name"] for c in p.manifest()[0]["children"]] == ["a", "b", "c"]


def test_rewind_restores_the_spec_and_reruns_with_the_problems():
    runs = {"shape": 0, "check": 0}
    seen_issues = []

    def shape(ctx):
        runs["shape"] += 1
        seen_issues.append(list((ctx.metadata.get(REPAIR_ISSUES_KEY) or {}).get("shape") or []))
        ctx.workflow_spec.rationale.setdefault("shapes", 0)
        ctx.workflow_spec.rationale["shapes"] += 1

    def check(ctx):
        runs["check"] += 1
        if runs["check"] == 1:
            return request_rewind(ctx, from_layer="check", issues_by_layer={"shape": ["edge to nowhere"]},
                                  reason="test")
        return False

    p = Pipeline("t")
    p.add(Stage("assemble", "Assemble", "", [Step("shape", shape, rewindable=True)]))
    p.add(Stage("verify", "Verify", "", [Step("check", check), Step("after")]))
    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g"))
    ctx = asyncio.run(p.execute(ctx))

    assert runs == {"shape": 2, "check": 2}
    assert seen_issues == [[], ["edge to nowhere"]]
    # The spec was restored before the re-run, so the layer's work counts once.
    assert ctx.workflow_spec.rationale["shapes"] == 1
    rewind = _events(ctx, "rewind")
    assert rewind and rewind[0]["to"] == "shape" and rewind[0]["reset"][:2] == ["shape", "check"]
    assert ("after", "completed") in [(e["name"], e["state"]) for e in _events(ctx, "layer")]


def test_rewinds_are_bounded():
    calls = {"n": 0}

    def check(ctx):
        calls["n"] += 1
        return request_rewind(ctx, from_layer="check", issues_by_layer={"shape": ["still wrong"]}, reason="x")

    p = Pipeline("t")
    p.add(Step("shape", rewindable=True))
    p.add(Step("check", check))
    p.add(Step("after"))
    ctx = asyncio.run(p.execute(PipelineContext(workflow_spec=WorkflowSpec())))
    assert calls["n"] == 3  # the first run plus MAX_REWINDS re-runs
    assert ("after", "completed") in [(e["name"], e["state"]) for e in _events(ctx, "layer")]


class Counting(DecisionLayer):
    name = "counting"
    phase = "counting"

    def build_prompt(self, ctx):
        return "system", "user"

    def apply(self, ctx, data):
        ctx.metadata["value"] = data.get("value")

    def postconditions(self, ctx):
        return [] if ctx.metadata.get("value") == 2 else [f"value must be 2, got {ctx.metadata.get('value')}"]


def test_decision_repairs_itself_from_its_postconditions(monkeypatch):
    prompts = []
    answers = iter([{"value": 1}, {"value": 2}])

    async def fake(client, **kw):
        prompts.append(kw["user"])
        return json.dumps(next(answers))

    monkeypatch.setattr("app.core.decision.decide", fake)

    async def done(c):
        return c

    ctx = asyncio.run(Counting().process(PipelineContext(), done))
    assert ctx.metadata["value"] == 2
    assert "value must be 2, got 1" in prompts[1] and "YOUR PREVIOUS ANSWER" in prompts[1]
    subs = [(e["id"], e["state"]) for e in _events(ctx, "sublayer")]
    assert subs == [("decide", "active"), ("decide", "completed"), ("check", "failed"),
                    ("repair_1", "active"), ("repair_1", "completed"), ("check_2", "completed")]
