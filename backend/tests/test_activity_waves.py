"""Activities are authored in dependency order, each shown what the activities before it return.

In the recording every activity was specified at once from capability names
alone, so ``application_completeness_check`` returned ``equipment_cost`` while
``affordability_calculation`` expected ``equipment_cost_gbp``, and five steps
needed hand-written argument mappings.
"""

import asyncio

from app.core.specs import CapabilitySpec, CodeNeed, CodeRequirement, CodeResolution, WorkflowSpec
from app.core.context import PipelineContext
from app.layers.codegen.profiles import ActivityRequirementProfile
from app.layers.workflow import tool_gap_layer
from app.layers.workflow.tool_gap_layer import activity_waves, share_upstream_schemas

OUT = {"type": "object", "properties": {"validated_application": {"type": "object", "properties": {
    "equipment_cost": {"type": "number"}, "deposit_amount": {"type": "number"}}}}}


def _caps():
    return [
        CapabilitySpec(id="check", name="Completeness check", kind="activity"),
        CapabilitySpec(id="risk", name="Credit risk", kind="agent", depends_on=["check"]),
        CapabilitySpec(id="afford", name="Affordability", kind="activity", depends_on=["check"]),
        CapabilitySpec(id="moderate", name="Output moderation", kind="activity", depends_on=["risk", "afford"]),
    ]


def test_waves_follow_dependencies_through_agents():
    caps = _caps()
    acts = [c for c in caps if c.kind == "activity"]
    assert activity_waves(acts, caps) == [0, 1, 2]


def test_cycles_are_cut():
    a = CapabilitySpec(id="a", kind="activity", depends_on=["b"])
    b = CapabilitySpec(id="b", kind="activity", depends_on=["a"])
    assert activity_waves([a, b], [a, b]) in ([1, 0], [0, 1], [1, 1], [0, 0])


def test_later_waves_see_the_authored_output_schema():
    caps = _caps()
    acts = [c for c in caps if c.kind == "activity"]
    needs = [CodeNeed(purpose="activity", upstream=[]),
             CodeNeed(purpose="activity", upstream=[{"id": "check", "outputs": ["validated_application"]}]),
             CodeNeed(purpose="activity", upstream=[{"id": "risk"}, {"id": "afford"}])]
    resolutions = [CodeResolution(status="built", name="completeness_check", output_schema=OUT), None, None]
    share_upstream_schemas(needs, [1], acts, resolutions)
    assert needs[1].upstream[0]["output_schema"] == OUT
    assert needs[1].upstream[0]["activity"] == "completeness_check"


def test_renaming_an_upstream_field_is_a_contract_issue():
    need = CodeNeed(purpose="activity", capability={"outputs": ["monthly_instalment"]},
                    upstream=[{"id": "check", "output_schema": OUT}])
    req = CodeRequirement(
        name="affordability", purpose="activity",
        input_schema={"type": "object", "properties": {"validated_application": {
            "type": "object", "properties": {"equipment_cost_gbp": {"type": "number"},
                                             "deposit_amount": {"type": "number"}}}}},
        output_schema={"type": "object", "properties": {"monthly_instalment": {"type": "number"}}},
        examples=[{"input": {}, "output": {}}, {"input": {}, "output": {}}])
    issues = ActivityRequirementProfile().bind_contract(need, req)
    assert any("equipment_cost_gbp" in i and "'equipment_cost'" in i for i in issues)
    req.input_schema["properties"]["validated_application"]["properties"] = {
        "equipment_cost": {"type": "number"}, "deposit_amount": {"type": "number"}}
    assert ActivityRequirementProfile().bind_contract(need, req) == []


def test_the_layer_builds_wave_by_wave(monkeypatch):
    caps = _caps()
    spec = WorkflowSpec(goal="g", capabilities=caps)
    ctx = PipelineContext(workflow_spec=spec)
    calls: list[list[dict]] = []

    async def fake(needs, **kw):
        calls.append([{"name": n.name_hint, "upstream": [dict(u) for u in n.upstream]} for n in needs])
        return [CodeResolution(status="built", name=n.name_hint, version=1, output_schema=OUT,
                               requirement=CodeRequirement(name=n.name_hint, output_schema=OUT))
                for n in needs]

    monkeypatch.setattr("app.layers.codegen.resolve_code_needs", fake)
    monkeypatch.setattr(tool_gap_layer, "resolve_code_needs", fake, raising=False)

    async def done(c):
        return c

    asyncio.run(tool_gap_layer.ActivityGapLayer().process(ctx, done))
    assert [[c["name"] for c in call] for call in calls] == [
        ["Completeness check"], ["Affordability"], ["Output moderation"]]
    afford_upstream = calls[1][0]["upstream"][0]
    assert afford_upstream["output_schema"] == OUT
