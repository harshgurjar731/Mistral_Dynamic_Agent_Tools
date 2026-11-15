"""An agent created in the builder can be tested; revised instructions are put to its author."""

import asyncio

from app.core.context import PipelineContext
from app.core.specs import AgentSpec
from app.layers.agent import verification_layers as av

LONG = "Answer every question about invoices precisely. " * 10


def _ctx(confirm):
    ctx = PipelineContext(query="invoice helper")
    ctx.agent_spec = AgentSpec(agent_instructions="Be helpful.")
    ctx.created_agent_id = "ag_1"
    ctx.metadata[av.CONFIRM_REVISION_KEY] = confirm
    return ctx


def test_declined_revision_keeps_the_instructions(monkeypatch):
    updated = []

    async def decide(ctx, system, user, phase):
        return {"instructions": LONG, "reasoning": "add precision"}

    async def update_agent(client, agent_id, patch):
        updated.append(patch)

    monkeypatch.setattr(av, "_decide", decide)
    monkeypatch.setattr("app.services.agent_service.update_agent", update_agent)
    asked = []

    async def decline(current, revised, changes):
        asked.append((current, revised[:20], changes))
        return False

    ctx = _ctx(decline)
    ok = asyncio.run(av.AgentEvaluationLayer()._revise(ctx, "ag_1", {"instructions": "Be helpful."}, "be precise"))
    assert ok is False and updated == []
    assert asked == [("Be helpful.", LONG[:20], "be precise")]
    assert ctx.agent_spec.agent_instructions == "Be helpful."


def test_accepted_revision_is_saved(monkeypatch):
    updated = []

    async def decide(ctx, system, user, phase):
        return {"instructions": LONG}

    async def update_agent(client, agent_id, patch):
        updated.append(patch)

    async def accept(current, revised, changes):
        return True

    monkeypatch.setattr(av, "_decide", decide)
    monkeypatch.setattr("app.services.agent_service.update_agent", update_agent)
    ctx = _ctx(accept)
    assert asyncio.run(av.AgentEvaluationLayer()._revise(ctx, "ag_1", {"instructions": "x"}, "c")) is True
    assert updated == [{"instructions": LONG.strip()}]


def test_the_runner_loads_the_agent_and_reports(monkeypatch):
    from app.runs import runners
    from app.services import agent_service

    async def get_agent(client, agent_id):
        return {"id": agent_id, "name": "Invoice helper", "description": "Answers invoice questions",
                "instructions": "Be helpful.", "tools": [{"type": "function", "function": {"name": "lookup"}}],
                "connectors": [], "guardrails": []}

    seen = {}

    async def process(self, ctx, next):
        seen["tools"] = ctx.agent_spec.tools
        seen["confirm"] = av.CONFIRM_REVISION_KEY in ctx.metadata
        ctx.metadata["agent_evaluation"] = {"tests": 3, "passed_first": 3, "passed_after": None,
                                            "tools_rebuilt": [], "instructions_revised": False}
        ctx.set_layer_summary(self.name, "3 of 3 test(s) pass")
        return await next(ctx)

    monkeypatch.setattr(agent_service, "get_agent", get_agent)
    monkeypatch.setattr(av.AgentEvaluationLayer, "process", process)
    events = []

    class Run:
        def emit(self, event, data=None):
            events.append((event, data))

    out = asyncio.run(runners.agent_evaluate(Run(), client=None, agent_id="ag_1"))
    assert seen == {"tools": ["lookup"], "confirm": True}
    assert out.status == "completed" and out.result["passed_first"] == 3
    assert out.result["agent_name"] == "Invoice helper"
    assert ("layer", {"name": "agent_evaluation", "state": "active"}) in events
