"""
G3 Test planning — decide what the code will be held to before it exists.
"""

from __future__ import annotations

from app import llm
from app.synthesis.layers.base import Layer, NextFn, SynthesisContext
from app.synthesis.prompts import testplan as testplan_prompt
from app.synthesis.testplan import validate_input

MAX_LLM_CASES = 3


class TestPlanLayer(Layer):
    __test__ = False  # not a pytest class

    name = "test_plan"
    label = "Plan the tests"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        llm_inputs: list[dict] = []
        if ctx.profile.wants_llm_cases(ctx.spec) and ctx.spec.properties:
            llm_inputs = self._realistic_inputs(ctx)

        ctx.plan = ctx.profile.build_test_plan(ctx.spec, llm_inputs)
        counts: dict[str, int] = {}
        for case in ctx.plan.cases:
            counts[case.expect] = counts.get(case.expect, 0) + 1
        if ctx.plan.weak:
            ctx.warnings.append("no input is known to be valid, so the tests can only show the "
                                "code does not crash — add worked examples to the spec")
        ctx.emit("test_plan", f"{len(ctx.plan.cases)} case(s): "
                 + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())),
                 {"cases": [c.case_id for c in ctx.plan.cases], "weak": ctx.plan.weak})
        return next(ctx)

    def _realistic_inputs(self, ctx: SynthesisContext) -> list[dict]:
        try:
            data, _model = llm.complete_json("testplan", [
                {"role": "system", "content": testplan_prompt.SYSTEM},
                {"role": "user", "content": testplan_prompt.user(ctx.spec)},
            ])
        except Exception as e:  # noqa: BLE001 — the plan degrades, the job continues
            ctx.warnings.append(f"realistic test inputs unavailable ({type(e).__name__}); "
                                f"using schema samples only")
            return []

        kept: list[dict] = []
        for raw in (data or {}).get("cases", []) if isinstance(data, dict) else []:
            inputs = raw.get("input") if isinstance(raw, dict) else None
            if not isinstance(inputs, dict):
                continue
            inputs = {k: v for k, v in inputs.items() if k in ctx.spec.properties}
            problem = validate_input(ctx.spec.input_schema, inputs)
            if problem:
                ctx.emit("test_plan", f"dropped a generated input that breaks the schema: {problem}")
                continue
            kept.append(inputs)
            if len(kept) >= MAX_LLM_CASES:
                break
        return kept
