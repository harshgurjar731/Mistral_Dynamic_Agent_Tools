"""Template v3: controls and KPIs split into business (required, mandatory) and
technical (optional, advisory) — schema, validation, planner context and the
coverage check. v1 documents are covered in test_process_knowledge.py."""

import copy

import pytest

from app.process import context, levels, templates, validation

TEMPLATE = {"schema": templates.DEFAULT_SCHEMA}


def _report(doc):
    return validation.validate(doc, TEMPLATE)


def _codes(report):
    return {(i["code"], i["path"]) for i in report["issues"]}


def _ctx(doc):
    return context.build([{"id": 1, "title": doc["process"]["name"], "content": doc}], mode="uploaded")


@pytest.mark.parametrize("doc", [templates.DEFAULT_EXAMPLE, templates.KYC_ONBOARDING_EXAMPLE],
                         ids=["mortgage", "kyc_onboarding"])
def test_v3_examples_are_valid_with_no_issues(doc):
    report = _report(doc)
    assert report["valid"], report["errors"]
    assert report["issues"] == []
    stats = report["stats"]
    assert stats["mandatory_controls"] == stats["business_controls"] == len(doc["controls"]["business"])
    assert stats["technical_controls"] == len(doc["controls"]["technical"])
    assert stats["kpis"] == len(doc["kpis"]["business"]) + len(doc["kpis"]["technical"])


def test_v1_example_still_valid():
    report = _report(templates.DEFAULT_EXAMPLE_V1)
    assert report["valid"], report["errors"]
    assert report["stats"]["mandatory_controls"] == 3


def test_business_lists_are_required_in_v3():
    doc = copy.deepcopy(templates.DEFAULT_EXAMPLE)
    del doc["controls"]["business"]
    doc["kpis"]["business"] = []
    codes = _codes(_report(doc))
    assert ("missing_field", "controls.business") in codes
    assert ("too_short", "kpis.business") in codes


def test_technical_lists_are_optional():
    doc = copy.deepcopy(templates.DEFAULT_EXAMPLE)
    del doc["controls"]["technical"]
    del doc["kpis"]["technical"]
    for stage in doc["stages"]:
        stage["controls"] = [c for c in stage.get("controls", [])
                             if c in {b["id"] for b in doc["controls"]["business"]}]
    assert _report(doc)["valid"]


def test_v3_needs_the_split_shape_and_sections():
    doc = copy.deepcopy(templates.DEFAULT_EXAMPLE)
    doc["controls"] = doc["controls"]["business"]  # a flat list under a 3.0 version
    del doc["kpis"]
    codes = _codes(_report(doc))
    assert ("wrong_type", "controls") in codes
    assert ("missing_field", "kpis") in codes


def test_misspelled_level_is_an_error():
    doc = copy.deepcopy(templates.DEFAULT_EXAMPLE)
    doc["controls"]["buisness"] = doc["controls"].pop("technical")
    assert ("unknown_field", "controls.buisness") in _codes(_report(doc))


def test_v3_outcomes_need_condition_and_next_stage():
    doc = copy.deepcopy(templates.DEFAULT_EXAMPLE)
    del doc["stages"][0]["decision"]["outcomes"][0]["next_stage"]
    assert ("missing_field", "stages[0].decision.outcomes[0].next_stage") in _codes(_report(doc))


def test_references_are_checked_in_both_levels():
    doc = copy.deepcopy(templates.KYC_ONBOARDING_EXAMPLE)
    doc["controls"]["technical"][0]["applies_to"] = ["ghost_stage"]
    doc["controls"]["technical"][1]["id"] = doc["controls"]["business"][0]["id"]
    doc["kpis"]["business"][0]["applies_to"] = ["ghost_stage"]
    doc["risks"][0]["applies_to"] = ["ghost_stage"]
    codes = _codes(_report(doc))
    assert ("unknown_reference", "controls.technical[0].applies_to") in codes
    assert ("duplicate_id", "controls.technical[1].id") in codes
    assert ("unknown_reference", "kpis.business[0].applies_to") in codes
    assert ("unknown_reference", "risks[0].applies_to") in codes


def test_level_decides_mandatory():
    section = {"business": [{"id": "a", "mandatory": False}], "technical": [{"id": "b", "mandatory": True}]}
    items = levels.leveled(section, "controls")
    assert [(c["id"], c["level"], c["mandatory"]) for c in items] == [
        ("a", "business", True), ("b", "technical", False)]
    assert levels.leveled([{"id": "x", "mandatory": True}], "controls") == [{"id": "x", "mandatory": True}]
    assert "mandatory" not in levels.leveled({"business": [{"name": "k"}]}, "kpis")[0]


def test_planner_context_marks_levels():
    doc = templates.KYC_ONBOARDING_EXAMPLE
    ctx = _ctx(doc)
    business = {c["id"] for c in doc["controls"]["business"]}
    technical = {c["id"] for c in doc["controls"]["technical"]}
    assert {c["id"] for c in ctx["controls"]} == business | technical
    assert all(c["_ref"] in ctx["refs"] for c in ctx["controls"] + ctx["kpis"])

    decomposition = context.render(ctx, "decomposition")
    mandatory = decomposition.split("Mandatory controls:", 1)[1]
    assert all(f"control:{b}]" in mandatory for b in business)
    assert not any(f"control:{t}]" in mandatory for t in technical)

    rules = context.render(ctx, "rules")
    assert "(business, MANDATORY)" in rules and "(technical, advisory)" in rules
    assert "(business)" in context.render(ctx, "agent_instructions")


def test_coverage_flags_only_business_controls():
    from app.core.context import PipelineContext
    from app.core.specs import CapabilitySpec, WorkflowSpec
    from app.layers.workflow.finalize_layers import _process_coverage
    from app.process import pipeline as pk

    doc = templates.KYC_ONBOARDING_EXAMPLE
    ctx = PipelineContext(query="x")
    ctx.metadata[pk.CONTEXT_KEY] = _ctx(doc)
    ctx.metadata[pk.USAGE_KEY] = {}
    ctx.workflow_spec = WorkflowSpec(goal="g", capabilities=[
        CapabilitySpec(id="screen", process_stage="screening")])
    issues = _process_coverage(ctx, "workflow_validation", {"screen"})

    covered = {c["id"] for c in doc["controls"]["business"] if "screening" in c["applies_to"]}
    uncovered = {c["id"] for c in doc["controls"]["business"]} - covered
    flagged = {i["message"].split("'")[1] for i in issues}
    assert flagged == uncovered
    assert all(i["message"].startswith("Business control") for i in issues)


def test_over_budget_views_keep_mandatory_controls(monkeypatch):
    """A large document sheds stage detail, then the longest section's tail — never the controls."""
    from app.config import settings

    monkeypatch.setattr(settings, "PROCESS_VIEW_CHARS", 5000)
    doc = templates.KYC_ONBOARDING_EXAMPLE
    ctx = _ctx(doc)
    for view in ("decomposition", "topology"):
        text = context.render(ctx, view)
        assert len(text) < 5000 + 400  # the header sits outside the budget
        mandatory = text.split("Mandatory controls:", 1)[1]
        assert all(f"control:{c['id']}]" in mandatory for c in doc["controls"]["business"])
    assert "cut to fit" in context.render(ctx, "topology")


def test_fit_cuts_the_longest_section_only():
    long, short = "Stages:\n" + "\n".join(f"- s{i}" for i in range(50)), "Controls:\n- a\n- b"
    out = context._fit([long, short], 200)
    assert out[1] == short
    assert out[0].startswith("Stages:\n- s0") and "more lines cut to fit" in out[0]


def test_blank_template_uses_the_split_shape():
    blank = templates.skeleton_from_schema(templates.DEFAULT_SCHEMA)
    assert set(blank["controls"]) == {"business", "technical"}
    assert set(blank["kpis"]) == {"business", "technical"}
