"""
The Verify stage — a planned workflow is run before anyone relies on it.

Validation proves a workflow is well-formed; it cannot prove it works. The
recording's workflow validated and then failed its first run five times. Here,
before the user reviews it:

    ScenarioDesignLayer   the best model designs test scenarios: the designed
                          example plus cases drawn from the process's decision
                          rules, each with the outcome the rules determine
    WorkflowDryRunLayer   runs every scenario end to end (connectors and human
                          reviews stubbed — ``dry_run``), checks each step, each
                          typed output and each expected outcome, and when
                          something fails hands the failures to Refine with AI
                          (the planned fix: workflow edits and activity-code
                          rebuilds), applies the fix and runs again

Every scenario run and every repair is streamed as a sublayer of its layer.
The review's "Test" runs the same verification again (``run_verification``).

Three rules keep the repair honest (each from a deployed plan that broke one):

* **A failure has a kind** (``workflow_engine.failures``). A step the model
  service did not answer is *transient*: the scenario is run again, and if it
  still cannot complete it is reported as not completed — never repaired. All
  17 failed dry runs of one plan were one agent timing out; the repairs rewrote
  three working activities.
* **An expectation must name a field that exists.** Paths are checked against
  each step's declared output and corrected or dropped before anything runs;
  expectations on steps a failed run never reached are not counted at all.
* **A repair is kept only if it helps.** The best state seen is remembered; a
  repair that leaves the workflow invalid, or does not make more scenarios
  pass, is undone.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.core.stages import emit_sublayer
from app.layers.workflow.base import WorkflowDecisionLayer, WorkflowStepLayer

logger = logging.getLogger(__name__)

SCENARIOS_KEY = "dry_run_scenarios"
RESULT_KEY = "dry_run"
#: ``async (revision, failed) -> bool`` — asked before a repair is applied. Set when the
#: user owns the design (a builder test); the planner applies its own repairs.
CONFIRM_REPAIR_KEY = "dry_run_confirm_repair"
#: Times a repair's fix is planned before the repair gives up (a model that did not answer).
PROPOSE_ATTEMPTS = 2
#: Scenarios run at once (each is a full run of the workflow).
SCENARIO_CONCURRENCY = 3
#: Seconds before a scenario the model service did not answer is run again (× the attempt).
TRANSIENT_WAIT = 4.0

SCENARIO_SYSTEM_PROMPT = """\
You design the test scenarios a newly built workflow is run on before anyone
relies on it. Each scenario is a complete run input and the outcome the
workflow's own rules determine for it.

- The FIRST scenario is the typical case — start from the designed example.
- Further scenarios exercise the decision rules and thresholds in the process
  knowledge and the goal: each outcome the workflow can reach (e.g. approve,
  refer, decline), each boundary (just below / at a threshold), each stop
  condition. Prefer one scenario per distinct outcome.
- Every input must satisfy the RUN INPUT SCHEMA exactly: every required field,
  correct types, realistic and internally consistent values (amounts add up,
  dates are ordered).
- "expect" lists only what the rules determine, read from the workflow's
  variables by FULL PATH: step_<step id>_output.<record>.<field> (see the DATA
  CONTRACT). Expect decisions, enums, flags and computed figures — never exact
  model-written prose. Operators: "equals", "in" (a list), "exists" (true),
  "min" / "max" (numbers). Each expectation says "why" — the rule behind it.
- An expected figure must be the EXACT result of the rules on that input:
  compute it step by step before writing it, and never round or simplify it
  "for convenience" — a wrong expectation fails a correct workflow. When you
  are not certain of a figure, expect the decision it leads to instead.

## Output
{
  "scenarios": [
    {"name": "string", "description": "string", "input": {},
     "expect": [{"path": "step_<id>_output.<record>.<field>", "equals": "<value>", "why": "string"}]}
  ],
  "reasoning": "string"
}
"""

SCENARIO_USER_PROMPT = """\
GOAL:
{goal}

STEPS:
{steps}

RUN INPUT SCHEMA:
{input_schema}

DESIGNED EXAMPLE INPUT:
{example}
{contract}
Design at most {count} scenarios.
"""


def _definition(ctx: PipelineContext):
    return getattr(ctx.workflow_spec, "definition", None)


def _example(definition) -> dict:
    from app.workflow_inputs.designer import example_payload_of

    try:
        return example_payload_of(definition.input_schema) or {}
    except Exception:  # noqa: BLE001
        return {}


class ScenarioDesignLayer(WorkflowDecisionLayer):
    """Test scenarios with the outcomes the process rules determine."""

    name = "scenario_design"
    label = "Design test scenarios"
    detail = "The typical case plus one scenario per outcome and threshold the process rules define."
    phase = "scenario design"
    process_view = "revision"
    status_message = "Designing test scenarios…"
    timeout_ms = LONG_TIMEOUT_MS
    temperature = 0.2
    max_repairs = 2

    def should_run(self, ctx: PipelineContext) -> bool:
        from app.config import settings

        return super().should_run(ctx) and settings.WORKFLOW_DRY_RUN and _definition(ctx) is not None

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.config import settings
        from app.layers.workflow.data_contract_layer import wiring_block

        definition = _definition(ctx)
        steps = [{"id": s.id, "type": getattr(s.type, "value", s.type), "description": s.description}
                 for s in definition.steps]
        return SCENARIO_SYSTEM_PROMPT, SCENARIO_USER_PROMPT.format(
            goal=ctx.workflow_spec.goal,
            steps=json.dumps(steps, indent=2),
            input_schema=json.dumps(definition.input_schema, indent=2)[:12000],
            example=json.dumps(_example(definition), indent=2)[:6000],
            contract=wiring_block(ctx.workflow_spec),
            count=max(1, settings.WORKFLOW_DRY_RUN_SCENARIOS),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        from app.config import settings

        scenarios = []
        for raw in data.get("scenarios") or []:
            if not isinstance(raw, dict) or not isinstance(raw.get("input"), dict):
                continue
            expect = [e for e in raw.get("expect") or [] if isinstance(e, dict) and e.get("path")]
            scenarios.append({"name": str(raw.get("name") or f"Scenario {len(scenarios) + 1}")[:80],
                              "description": str(raw.get("description") or "")[:300],
                              "input": raw["input"], "expect": expect[:8]})
        ctx.metadata[SCENARIOS_KEY] = scenarios[:max(1, settings.WORKFLOW_DRY_RUN_SCENARIOS)]
        ctx.set_layer_summary(self.name, f"{len(ctx.metadata[SCENARIOS_KEY])} scenario(s): "
                              + ", ".join(s["name"] for s in ctx.metadata[SCENARIOS_KEY]))
        ctx.emit("test_scenarios", json.dumps(ctx.metadata[SCENARIOS_KEY], default=str))

    def postconditions(self, ctx: PipelineContext) -> list[str]:
        from app.workflow_inputs import run_input

        definition = _definition(ctx)
        step_ids = {s.id for s in definition.steps}
        problems = []
        scenarios = ctx.metadata.get(SCENARIOS_KEY) or []
        if not scenarios:
            problems.append("no usable scenario: each needs a name and an input object")
        for sc in scenarios:
            for p in run_input.check(definition, sc["input"])[:4]:
                problems.append(f"scenario '{sc['name']}': input — {p}")
            for e in sc["expect"]:
                head = str(e["path"]).split(".")[0]
                if not (head.startswith("step_") and head.endswith("_output") and head[5:-7] in step_ids):
                    problems.append(f"scenario '{sc['name']}': path '{e['path']}' must start with "
                                    "step_<an existing step id>_output")
        return problems

    def fallback(self, ctx: PipelineContext) -> None:
        definition = _definition(ctx)
        ctx.metadata[SCENARIOS_KEY] = [{"name": "Designed example", "description": "The run form's example.",
                                        "input": _example(definition), "expect": []}]


# ── Running a scenario ─────────────────────────────────────────────────────


def _compare(actual: Any, expectation: dict) -> Optional[str]:

    path = expectation["path"]
    if actual is _missing() or actual is None:
        return None if expectation.get("exists") is False else f"{path} is missing"
    if "equals" in expectation:
        want = expectation["equals"]
        same = (str(actual).strip().lower() == str(want).strip().lower()
                if isinstance(want, str) or isinstance(actual, str) else actual == want)
        if not same:
            return f"{path} is {json.dumps(actual, default=str)[:120]}, expected {json.dumps(want)}"
    if "in" in expectation and isinstance(expectation["in"], list):
        options = [str(o).lower() for o in expectation["in"]]
        if str(actual).lower() not in options:
            return f"{path} is {json.dumps(actual, default=str)[:120]}, expected one of {expectation['in']}"
    for bound, cmp in (("min", lambda a, b: a >= b), ("max", lambda a, b: a <= b)):
        if bound in expectation:
            try:
                if not cmp(float(actual), float(expectation[bound])):
                    return f"{path} is {actual}, expected {bound} {expectation[bound]}"
            except (TypeError, ValueError):
                return f"{path} is {actual!r}, not a number"
    return None


def _missing():
    from app.services.workflow_engine.step_runners import _MISSING

    return _MISSING


def _live_connectors(ctx: PipelineContext) -> dict[str, list]:
    """Agents with Mistral connectors attached: those run on Mistral and a dry run cannot stub them."""
    out = {}
    for agent in getattr(ctx.workflow_spec, "provisioned_agents", None) or []:
        if isinstance(agent, dict) and agent.get("agent_id") and agent.get("connectors"):
            out[agent["agent_id"]] = list(agent["connectors"])
    return out


def expectation_step(path: str) -> str:
    """The step id an expectation path reads: ``step_<id>_output.…`` → ``<id>``."""
    head = str(path or "").split(".")[0]
    return head[5:-7] if head.startswith("step_") and head.endswith("_output") else ""


def _words(name: str) -> set[str]:
    import re

    return {t for t in re.split(r"[^a-z0-9]+", str(name).lower()) if t}


def check_expectation_paths(definition: dict, catalog: dict, scenarios: list[dict]) -> list[dict]:
    """Make every expectation name a field its step really returns. Returns one note per change.

    ``catalog``: activity name → ``{"input", "output", "version"}`` (argument_shapes).
    A path is judged only where the step's output is declared (an activity's
    output schema, an agent's typed output). A field the schema says does not
    exist is corrected when exactly one field at that level is the same name
    with more or fewer words (``outcome`` → ``outcome_code``), else the
    expectation is dropped: it could never be met, and a repair once added a
    step just to produce the name a test had invented.
    """
    from app.services.workflow_engine.argument_shapes import MISSING, _Context

    shapes = _Context(definition, catalog or {})
    notes: list[dict] = []
    for scenario in scenarios:
        kept = []
        for expectation in scenario.get("expect") or []:
            path = str(expectation.get("path") or "")
            parts = [x for x in path.split(".") if x]
            if len(parts) < 2 or shapes.reference(path) is not MISSING:
                kept.append(expectation)
                continue
            # Walk to the first part the schema does not have.
            fixed = None
            for depth in range(2, len(parts) + 1):
                if shapes.reference(".".join(parts[:depth])) is not MISSING:
                    continue
                parent = shapes.reference(".".join(parts[:depth - 1]))
                siblings = list((parent or {}).get("properties") or {}) if isinstance(parent, dict) else []
                want = _words(parts[depth - 1])
                close = [f for f in siblings if want and (want <= _words(f) or _words(f) <= want)]
                if len(close) == 1:
                    trial = ".".join([*parts[:depth - 1], close[0], *parts[depth:]])
                    if shapes.reference(trial) is not MISSING:
                        fixed = trial
                break
            if fixed:
                notes.append({"scenario": scenario.get("name"), "path": path, "now": fixed,
                              "note": f"'{path}' does not exist — the step returns '{fixed}'; corrected"})
                expectation["path"] = fixed
                kept.append(expectation)
            else:
                notes.append({"scenario": scenario.get("name"), "path": path, "now": None,
                              "note": f"'{path}' is not a field that step returns — expectation dropped"})
        scenario["expect"] = kept
    return notes


async def _live_catalog() -> dict:
    from app.services.workflow_engine.rule_validation import _activity_catalog

    try:
        return await _activity_catalog()
    except Exception as e:  # noqa: BLE001 — unknown shapes are simply not judged
        logger.debug("Activity catalog unavailable for the expectation check: %s", e)
        return {}


async def run_scenario(ctx: PipelineContext, workflow_name: str, scenario: dict) -> dict:
    """Run one scenario as a dry run and say whether it passed, and why not."""
    from app.services.workflow_engine import dry_run, engine, failures
    from app.services.workflow_engine.step_runners import _lookup, blocked_categories
    from app.services.workflow_engine.structured_output import problems as schema_problems

    _MISSING = _missing()

    definition = await asyncio.to_thread(engine.get_workflow, workflow_name)
    steps = {s.id: s for s in (definition.steps if definition else [])}
    execution_id = f"dryrun-{uuid.uuid4().hex[:12]}"
    outcome: dict = {"name": scenario["name"], "execution_id": execution_id, "passed": False,
                     "problems": [], "failed_steps": [], "warnings": []}
    connected = _live_connectors(ctx)
    try:
        with dry_run.enabled():
            run = await engine.execute_workflow(workflow_name, dict(scenario["input"]),
                                                execution_id=execution_id, wait_for_result=True)
    except Exception as e:  # noqa: BLE001 — a crash is a failed scenario, not a failed plan
        text = f"the run crashed: {e}"
        outcome["problems"].append(text)
        if failures.is_transient(e):
            outcome["transient_problems"] = [text]
            outcome["inconclusive"] = True
        return outcome

    for result in run.step_results:
        step = steps.get(result.step_id)
        agent_id = (step.config or {}).get("agent_id") if step else None
        if agent_id in connected:
            outcome["warnings"].append(
                f"step '{result.step_id}' ran with connector(s) {', '.join(map(str, connected[agent_id]))}, "
                "which run on Mistral and are not stubbed in a dry run")
        if result.status == "failed":
            outcome["failed_steps"].append(result.step_id)
            step_type = str(getattr(getattr(step, "type", ""), "value", getattr(step, "type", "")) or "")
            if failures.is_transient(result.error, step_type):
                # The service did not answer. Nothing in the workflow caused it,
                # so it is never handed to a repair (see run_verification).
                text = (f"step '{result.step_id}' could not be completed — "
                        f"{failures.describe(result.error)} ({(result.error or '')[:160]})")
                outcome["problems"].append(text)
                outcome.setdefault("transient_problems", []).append(text)
                outcome.setdefault("transient_steps", []).append(result.step_id)
                continue
            outcome["problems"].append(f"step '{result.step_id}' failed: {(result.error or '')[:400]}")
            blocked = blocked_categories(result.error or "")
            if blocked is not None and agent_id:
                outcome.setdefault("guardrail_blocks", []).append(
                    {"step_id": result.step_id, "agent_id": agent_id, "categories": blocked})
            continue
        schema = (step.config or {}).get("output_schema") if step else None
        if isinstance(schema, dict) and isinstance(result.output, (dict, list)):
            for p in schema_problems(result.output, schema, limit=3):
                outcome["problems"].append(f"step '{result.step_id}' output does not match its record: {p}")
    status = str(getattr(run.status, "value", run.status)).upper()
    if status != "COMPLETED" and not outcome["failed_steps"]:
        reason = (run.result or {}).get("error") if isinstance(run.result, dict) else None
        outcome["problems"].append(f"the run ended {status.lower()}" + (f": {reason}" if reason else ""))
    # Until here every problem is the run's own (a failed step, an output that
    # breaks its record). An unmet expectation may be the expectation's fault.
    outcome["hard_problems"] = len(outcome["problems"]) - len(outcome.get("transient_problems") or [])
    outcome["inconclusive"] = bool(outcome.get("transient_problems"))
    outcome["expectation_misses"] = []
    completed = {r.step_id for r in run.step_results if r.status == "completed"}
    stopped_early = bool(outcome["failed_steps"]) or status != "COMPLETED"
    for index, expectation in enumerate(scenario.get("expect") or []):
        # A run that stopped at a failed step never reached the later ones. Their
        # expectations are not separate failures — the failed step is the failure.
        if stopped_early and expectation_step(expectation["path"]) not in completed:
            outcome["unreached"] = outcome.get("unreached", 0) + 1
            continue
        actual = _lookup(str(expectation["path"]), run.variables or {})
        miss = _compare(actual, expectation)
        if miss:
            text = (f"expected outcome not met — {miss}"
                    + (f" ({expectation['why']})" if expectation.get("why") else ""))
            outcome["problems"].append(text)
            outcome["expectation_misses"].append({
                "index": index, "path": expectation["path"], "text": text,
                "actual": None if actual is _MISSING else actual})
    outcome["passed"] = not outcome["problems"]
    outcome["steps_run"] = len(run.step_results)
    outcome["steps_completed"] = len(completed)
    return outcome


# ── Is it the workflow or the expectation that is wrong? ───────────────────

EXPECTATION_REVIEW_SYSTEM = """A workflow was run on a test scenario and produced a value that differs from
what the scenario expected. Decide which is right. Work only from the GOAL and
its rules and the scenario INPUT: recompute each value step by step, exactly as
the rules state (no rounding the rules do not ask for), then compare.

For each mismatch answer:
- "workflow"     the workflow's value is what the rules give; the expectation was wrong
- "expectation"  the expectation is what the rules give; the workflow is wrong
- "unclear"      the rules do not determine it

{"verdicts": [{"index": 0, "correct": "workflow|expectation|unclear",
               "computed": "<the value the rules give>", "why": "one line"}],
 "reasoning": "string"}
"""


async def review_expectations(ctx: PipelineContext, parent: str, round_no: int,
                              scenarios: list[dict], outcomes: list[dict]) -> int:
    """Correct expectations the workflow rightly did not meet. Returns how many were corrected.

    Only scenarios whose run was clean — every step completed, every typed
    output fits — and that failed on expectations alone are reviewed: a
    scenario's own note once read "example expects £98.00 for simplicity"
    against a computed £98.06, and a correct workflow was sent for repair.
    The decision is made on the reasoning tier and shown as its own step; a
    corrected expectation is rewritten to the value the workflow produced.
    """
    from app.config import settings
    from app.core.decision import decide, parse_json

    todo = [(i, o) for i, o in enumerate(outcomes)
            if not o["passed"] and not o.get("hard_problems") and o.get("expectation_misses")]
    if not todo:
        return 0
    sub = f"r{round_no}:expectations"
    label = "Check the expectations that were not met"
    emit_sublayer(ctx, parent, sub, "active", label=label,
                  summary=f"{sum(len(o['expectation_misses']) for _, o in todo)} unmet expectation(s) "
                          "in runs that otherwise completed — is the workflow or the expectation wrong?")
    corrected = 0
    for i, outcome in todo:
        scenario = scenarios[i]
        misses = outcome["expectation_misses"]
        try:
            data = parse_json(await decide(
                ctx.client, model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                system=EXPECTATION_REVIEW_SYSTEM,
                user=json.dumps({
                    "GOAL": ctx.workflow_spec.goal,
                    "SCENARIO": {"name": scenario["name"], "description": scenario.get("description", "")},
                    "INPUT": scenario["input"],
                    "MISMATCHES": [{"index": n, "path": m["path"],
                                    "expected": {k: v for k, v in scenario["expect"][m["index"]].items()
                                                 if k != "path"},
                                    "workflow_value": m["actual"]} for n, m in enumerate(misses)],
                }, indent=2, default=str)[:24_000],
                phase="expectation review", timeout_ms=LONG_TIMEOUT_MS, temperature=0.0), None)
        except Exception as e:  # noqa: BLE001 — unreviewed expectations stay failures
            logger.warning("Expectation review failed for '%s': %s", scenario["name"], e)
            continue
        verdicts = {v.get("index"): v for v in (data or {}).get("verdicts") or [] if isinstance(v, dict)}
        notes = outcome.setdefault("corrected_expectations", [])
        for n, miss in enumerate(misses):
            verdict = verdicts.get(n) or {}
            if verdict.get("correct") != "workflow" or miss["actual"] is None:
                continue
            expectation = scenario["expect"][miss["index"]]
            was = {k: v for k, v in expectation.items() if k not in ("path", "why")}
            for key in ("equals", "in", "min", "max", "exists"):
                expectation.pop(key, None)
            expectation["equals"] = miss["actual"]
            expectation["why"] = (str(verdict.get("why") or expectation.get("why") or "")[:240]
                                  + " (expectation corrected after review)").strip()
            outcome["problems"].remove(miss["text"])
            notes.append({"path": miss["path"], "was": was, "now": miss["actual"],
                          "why": str(verdict.get("why") or "")[:240]})
            corrected += 1
        outcome["expectation_misses"] = [m for m in misses if m["text"] in outcome["problems"]]
        outcome["passed"] = not outcome["problems"]
    emit_sublayer(ctx, parent, sub, "completed", label=label,
                  summary=(f"{corrected} expectation(s) were wrong and were corrected; the workflow's "
                           "values are what the rules give." if corrected
                           else "The expectations stand — the workflow needs fixing."))
    return corrected


# ── An agent blocked by its own guardrail ──────────────────────────────────

#: Categories that describe what an agent's input *is* (records about people,
#: money, health, law) rather than harm. Only these are ever relaxed; a block on
#: jailbreaking or a harm category is a finding, never repaired away.
RELAXABLE_CATEGORIES = frozenset({"pii", "financial", "health", "law"})


async def relax_blocking_guardrails(ctx: PipelineContext, parent: str, round_no: int,
                                    failed: list[dict]) -> list[dict]:
    """Exempt the data categories that blocked agents this plan created. Returns what changed.

    A workflow edit cannot fix this: the agent's moderation guardrail refuses
    the step's own input (an output-safety agent was blocked on `pii` by the
    customer reply it had to check). Only agents created by this plan are
    touched — their guardrail was this plan's decision — and the update goes
    through the platform's agent rules, so an admin rule that requires the
    category still wins.
    """
    from app.layers.workflow import plan_control
    from app.services import agent_service

    mine = {str(i.get("id")) for i in plan_control.created(ctx) if i.get("kind") == "agent"}
    wanted: dict[str, set[str]] = {}
    for outcome in failed:
        for block in outcome.get("guardrail_blocks") or []:
            cats = set(block.get("categories") or []) & RELAXABLE_CATEGORIES
            if cats and str(block.get("agent_id")) in mine:
                wanted.setdefault(str(block["agent_id"]), set()).update(cats)
    changed = []
    for agent_id, cats in wanted.items():
        sub = f"guardrail{round_no}:{agent_id[-8:]}"
        label = f"Repair {round_no}: the agent's guardrail"
        emit_sublayer(ctx, parent, sub, "active", label=label,
                      summary=f"Its own guardrail blocked the step on {', '.join(sorted(cats))} — "
                              "that is the data it is handed, so the category is exempted")
        try:
            agent = await agent_service.get_agent(ctx.client, agent_id)
            guardrails = [dict(g) for g in agent.get("guardrails") or [] if isinstance(g, dict)]
            touched = False
            for entry in guardrails:
                for key in ("moderation_llm_v2", "moderation_llm_v1"):
                    config = entry.get(key)
                    if not isinstance(config, dict):
                        continue
                    thresholds = dict(config.get("custom_category_thresholds") or {})
                    thresholds = {k: v for k, v in thresholds.items() if v is not None}
                    for cat in cats:
                        thresholds[cat] = 1.0
                    entry[key] = {**config, "custom_category_thresholds": thresholds}
                    touched = True
            if not touched:
                raise ValueError("the agent has no moderation guardrail to change")
            await agent_service.update_agent(ctx.client, agent_id, {"guardrails": guardrails})
        except Exception as e:  # noqa: BLE001 — reported; the failure then stands for review
            emit_sublayer(ctx, parent, sub, "failed", label=label,
                          error=f"The guardrail could not be changed: {e}")
            continue
        summary = (f"Exempted {', '.join(sorted(cats))} on agent "
                   f"{agent.get('name') or agent_id} (its own input data)")
        emit_sublayer(ctx, parent, sub, "completed", label=label, summary=summary)
        changed.append({"agent_id": agent_id, "categories": sorted(cats), "summary": summary})
    return changed


# ── Repairing from failed scenarios ────────────────────────────────────────


class _SubSink:
    """Receives a nested revision run's events and shows them as sublayers of ``parent``."""

    def __init__(self, ctx: PipelineContext, parent: str, prefix: str, label: str):
        from app.layers import revision_pipeline

        self.ctx, self.parent, self.prefix, self.label = ctx, parent, prefix, label
        self.labels = {m["name"]: m["label"] for m in revision_pipeline.flat_manifest()}

    def put_nowait(self, sse) -> None:
        data = sse.data
        if isinstance(data, str) and sse.event not in ("status",):
            try:
                data = json.loads(data)
            except ValueError:
                pass
        if sse.event == "layer" and isinstance(data, dict) and data.get("state") in (
                "active", "completed", "failed", "skipped"):
            name = data.get("name")
            emit_sublayer(self.ctx, self.parent, f"{self.prefix}:{name}", data["state"],
                          label=f"{self.label}: {self.labels.get(name, name)}",
                          summary=str(data.get("summary") or ""), ms=data.get("ms"),
                          error=str(data.get("error") or ""))
        elif sse.event == "fix_plan" and isinstance(data, dict):
            items = data.get("items") or []
            running = any(i.get("status") in ("pending", "in_progress") for i in items)
            emit_sublayer(self.ctx, self.parent, f"{self.prefix}:plan", "active" if running else "completed",
                          label=f"{self.label}: the fix plan",
                          summary="; ".join(f"{i.get('title')} — {i.get('status')}"
                                            + (f" (v{i['version']})" if i.get("version") else "")
                                            for i in items if i.get("kind") != "check"))
        elif sse.event == "status" and isinstance(data, str):
            self.ctx.emit("status", data)


def design_problems(outcome: dict) -> list[str]:
    """The problems of a scenario that a change to the workflow could fix."""
    transient = set(outcome.get("transient_problems") or [])
    return [p for p in outcome.get("problems") or [] if p not in transient]


def _instruction(failed: list[dict]) -> str:
    lines = []
    for o in failed:
        lines.append(f"Scenario '{o['name']}':")
        lines += [f"  - {p}" for p in design_problems(o)[:8]]
    return ("The workflow was dry-run on its test scenarios before review and these failed. Find "
            "the cause of each — wiring, a condition or transform, a template, or an activity's "
            "code — and fix it so every scenario passes. Change only what causes these failures. "
            "Do not rename fields, add steps or change working activity code merely to make a "
            "value appear where a test looks for it: if a listed expectation is itself wrong, "
            "leave the workflow as it is and say so in the summary.\n"
            + "\n".join(lines))[:3900]


async def _record_versions(ctx: PipelineContext, revision: dict) -> None:
    """Activity versions a repair built belong to the plan: a rollback removes them too."""
    from app.layers.workflow import plan_control
    from app.services.tool_resolver import tool_resolver

    for item in revision.get("plan") or []:
        if item.get("kind") != "code" or not item.get("version") or not item.get("tool_name"):
            continue
        try:
            versions = await tool_resolver.get_tool_versions(item["tool_name"])
        except Exception:  # noqa: BLE001
            continue
        match = next((v for v in versions if v.get("version_no") == item["version"]), None)
        if match and match.get("id") is not None:
            plan_control.record_created(ctx, "activity", match["id"], item["tool_name"],
                                        version=item["version"])


async def repair(ctx: PipelineContext, workflow_name: str, parent: str, round_no: int,
                 failed: list[dict]) -> dict:
    """Plan and apply a fix for the failed scenarios. Returns what happened."""
    from app.services import workflow_revision_service as revisions
    from app.services.workflow_engine.engine import get_workflow

    prefix, label = f"repair{round_no}", f"Repair {round_no}"
    emit_sublayer(ctx, parent, prefix, "active", label=label,
                  summary=f"{len(failed)} scenario(s) failed — planning the fix")
    execution_id = next((o["execution_id"] for o in failed if o["failed_steps"]), failed[0]["execution_id"])
    revision: dict = {}
    for attempt in range(1, PROPOSE_ATTEMPTS + 1):
        try:
            revision = await revisions.propose(
                ctx.client, workflow_name, instruction=_instruction(failed), origin="planner",
                execution_id=execution_id, event_queue=_SubSink(ctx, parent, prefix, label))
        except Exception as e:  # noqa: BLE001
            if attempt == PROPOSE_ATTEMPTS:
                emit_sublayer(ctx, parent, prefix, "failed", label=label, error=str(e))
                return {"applied": False, "error": str(e)}
            revision = {"status": "failed", "error": str(e)}
        # Proposed, or a question for the user: final. A failure (the model did
        # not answer, timed out) is tried once more before the repair gives up.
        if revision.get("status") in ("proposed", "needs_clarification") or attempt == PROPOSE_ATTEMPTS:
            break
        emit_sublayer(ctx, parent, prefix, "active", label=label,
                      summary=f"Planning the fix failed ({revision.get('error') or 'no answer'}) — trying again")
    if revision.get("status") != "proposed":
        emit_sublayer(ctx, parent, prefix, "failed", label=label,
                      error=revision.get("error") or revision.get("clarification") or "No fix could be made.")
        return {"applied": False, "revision_id": revision.get("id"), "error": revision.get("error")}
    confirm = ctx.metadata.get(CONFIRM_REPAIR_KEY)
    if confirm is not None:
        emit_sublayer(ctx, parent, prefix, "active", label=label,
                      summary="Fix planned — waiting for you to apply or skip it")
        if not await confirm(revision, failed):
            try:
                await revisions.discard(workflow_name, revision["id"])
            except Exception:  # noqa: BLE001 — an undiscarded proposal changes nothing
                pass
            emit_sublayer(ctx, parent, prefix, "skipped", label=label,
                          summary="You chose not to apply this fix; the workflow is unchanged.")
            return {"applied": False, "declined": True, "revision_id": revision["id"],
                    "summary": revision.get("summary")}
    try:
        await revisions.apply(workflow_name, revision["id"])
    except revisions.RevisionError as e:
        emit_sublayer(ctx, parent, prefix, "failed", label=label, error=f"The fix was not applied: {e}")
        return {"applied": False, "revision_id": revision["id"], "error": str(e)}
    await _record_versions(ctx, revision)
    ctx.workflow_spec.definition = await asyncio.to_thread(get_workflow, workflow_name)
    emit_sublayer(ctx, parent, prefix, "completed", label=label,
                  summary=revision.get("summary") or "Fix applied.")
    return {"applied": True, "revision_id": revision["id"], "summary": revision.get("summary"),
            "code_fixes": [i for i in revision.get("plan") or [] if i.get("kind") == "code"]}


def _score(outcomes: list[dict]) -> tuple[int, int, int, int]:
    """Higher is better.

    Scenarios passing; then fewer scenarios with a fault of the workflow's own;
    then how far the runs got (a repair that fixes step 3 and so exposes a
    fault in step 5 is progress, though no more scenarios pass yet); then fewer
    such faults in all.
    """
    return (sum(1 for o in outcomes if o["passed"]),
            -sum(1 for o in outcomes if not o["passed"] and design_problems(o)),
            sum(int(o.get("steps_completed") or 0) for o in outcomes),
            -sum(len(design_problems(o)) for o in outcomes))


async def _blocking_issues(ctx: PipelineContext, definition) -> list[str]:
    """Validation errors of ``definition`` (rules and argument shapes included)."""
    from app.services.workflow_engine.rule_validation import validate_with_rules

    try:
        result = await validate_with_rules(definition, client=ctx.client)
    except Exception as e:  # noqa: BLE001 — an unavailable check does not undo a repair
        logger.warning("Validation after repair skipped: %s", e)
        return []
    return [i.message for i in result.issues if i.severity == "error"]


async def _restore(ctx: PipelineContext, workflow_name: str, snapshot: dict, label: str) -> None:
    from app.services import workflow_revision_service as revisions
    from app.services.workflow_engine.engine import get_workflow

    await revisions.restore_definition(workflow_name, snapshot, label)
    ctx.workflow_spec.definition = await asyncio.to_thread(get_workflow, workflow_name)


async def run_verification(ctx: PipelineContext, parent: str) -> dict:
    """Run every scenario; repair and re-run what fails, up to the configured rounds.

    Transient failures are retried, never repaired. A repair is kept only when
    the workflow still validates and more scenarios pass than before; otherwise
    the best state seen is restored and the remaining failures are reported.
    """
    from app.config import settings
    from app.services.workflow_engine.engine import get_workflow

    spec = ctx.workflow_spec
    workflow_name = spec.workflow_name or getattr(spec.definition, "name", None)
    scenarios = ctx.metadata.get(SCENARIOS_KEY) or [
        {"name": "Designed example", "input": _example(spec.definition), "expect": []}]
    rounds = max(0, settings.WORKFLOW_DRY_RUN_REPAIRS)
    retries = max(0, int(getattr(settings, "WORKFLOW_DRY_RUN_TRANSIENT_RETRIES", 2)))
    history: list[dict] = []
    outcomes: list[dict] = []
    gate = asyncio.Semaphore(SCENARIO_CONCURRENCY)
    path_notes: list[dict] = []

    async def _check_paths() -> None:
        definition = await asyncio.to_thread(get_workflow, workflow_name)
        if definition is None:
            return
        found = check_expectation_paths(definition.model_dump(mode="json"), await _live_catalog(), scenarios)
        if found:
            path_notes.extend(found)
            emit_sublayer(ctx, parent, f"paths{len(path_notes)}", "completed",
                          label="Check the expectations against the steps' outputs",
                          summary="; ".join(n["note"] for n in found)[:600])

    def _report(round_no: int, i: int, scenario: dict, outcome: dict) -> None:
        if outcome["passed"]:
            summary = "Passed — every step completed and every expected outcome held."
        elif outcome.get("inconclusive") and not design_problems(outcome):
            summary = ("Not completed — " + "; ".join(outcome["transient_problems"][:2])
                       + ". This is not a fault of the workflow.")
        else:
            summary = "; ".join(outcome["problems"][:3])
        if outcome.get("unreached"):
            summary += f" ({outcome['unreached']} expectation(s) on later steps were not reached.)"
        if outcome.get("corrected_expectations"):
            summary += f" ({len(outcome['corrected_expectations'])} expectation(s) corrected after review.)"
        if outcome.get("warnings"):
            summary += " Note: " + outcome["warnings"][0]
        emit_sublayer(ctx, parent, f"r{round_no}:s{i}", "completed" if outcome["passed"] else "failed",
                      label=f"{'Re-run' if round_no else 'Run'} '{scenario['name']}'", summary=summary)

    best: Optional[dict] = None
    rolled_back = False
    for round_no in range(rounds + 1):
        await _check_paths()

        async def _one(i: int, scenario: dict, _round: int = round_no) -> dict:
            async with gate:
                label = f"{'Re-run' if _round else 'Run'} '{scenario['name']}'"
                emit_sublayer(ctx, parent, f"r{_round}:s{i}", "active", label=label,
                              detail=scenario.get("description", ""))
                outcome = await run_scenario(ctx, workflow_name, scenario)
                for attempt in range(1, retries + 1):
                    if not outcome.get("inconclusive"):
                        break
                    # The model service did not answer: that says nothing about
                    # the workflow. Wait a little and run the scenario again.
                    emit_sublayer(ctx, parent, f"r{_round}:s{i}", "active", label=label,
                                  summary=f"{outcome['transient_problems'][0]} — running it again "
                                          f"({attempt}/{retries})")
                    await asyncio.sleep(min(20.0, TRANSIENT_WAIT * attempt))
                    outcome = await run_scenario(ctx, workflow_name, scenario)
                    outcome["retries"] = attempt
                _report(_round, i, scenario, outcome)
                return outcome

        # Scenarios are independent runs: together, not one after another.
        outcomes = list(await asyncio.gather(*(_one(i, sc) for i, sc in enumerate(scenarios))))
        # A clean run that only missed an expectation: check which is wrong
        # before anything is "repaired".
        if await review_expectations(ctx, parent, round_no, scenarios, outcomes):
            for i, (scenario, outcome) in enumerate(zip(scenarios, outcomes)):
                if outcome.get("corrected_expectations"):
                    _report(round_no, i, scenario, outcome)
        failed = [o for o in outcomes if not o["passed"]]
        to_fix = [o for o in failed if design_problems(o)]
        entry = {"round": round_no, "passed": len(outcomes) - len(failed), "failed": len(failed),
                 "not_completed": sum(1 for o in failed if o.get("inconclusive") and not design_problems(o))}
        history.append(entry)

        # Keep the best state seen; undo a repair that did not help.
        score = _score(outcomes)
        definition = await asyncio.to_thread(get_workflow, workflow_name)
        snapshot = definition.model_dump(mode="json") if definition is not None else None
        if best is None or score > best["score"]:
            best = {"score": score, "snapshot": snapshot, "outcomes": outcomes, "round": round_no}
        elif round_no > 0 and best["snapshot"] is not None:
            was, now = best["score"][0], score[0]
            label = f"Repair {round_no}: undone"
            emit_sublayer(ctx, parent, f"undo{round_no}", "active", label=label)
            try:
                await _restore(ctx, workflow_name, best["snapshot"],
                               f"Repair {round_no} undone — it did not improve the test results")
                history[-1]["undone"] = True
                history[-2].setdefault("repair", {})["undone"] = True
                emit_sublayer(ctx, parent, f"undo{round_no}", "completed", label=label,
                              summary=f"The repair did not help ({was} scenario(s) passed before it, "
                                      f"{now} after) — the workflow is back as it was before the repair.")
                outcomes, rolled_back = best["outcomes"], True
            except Exception as e:  # noqa: BLE001 — reported; the repaired state then stands
                emit_sublayer(ctx, parent, f"undo{round_no}", "failed", label=label,
                              error=f"The repair could not be undone: {e}")
            break

        if not failed or round_no == rounds:
            break
        if not to_fix:
            # Everything that failed is the model service not answering. There
            # is nothing in the workflow to repair.
            entry["note"] = ("Not repaired: the remaining scenario(s) could not be completed because "
                             "the model service did not answer — not a fault of the workflow.")
            break
        relaxed = await relax_blocking_guardrails(ctx, parent, round_no + 1, to_fix)
        if relaxed:
            # The cause was an agent's own guardrail, not the workflow: run again.
            history[-1]["repair"] = {"applied": True, "guardrails": relaxed,
                                     "summary": "; ".join(r["summary"] for r in relaxed)}
            continue
        errors_before = set(await _blocking_issues(ctx, definition)) if definition is not None else set()
        fixed = await repair(ctx, workflow_name, parent, round_no + 1, to_fix)
        history[-1]["repair"] = fixed
        if not fixed.get("applied"):
            break
        # A repair that adds validation errors is not a repair.
        problems = [m for m in await _blocking_issues(ctx, ctx.workflow_spec.definition)
                    if m not in errors_before]
        if problems and snapshot is not None:
            label = f"Repair {round_no + 1}: undone"
            try:
                await _restore(ctx, workflow_name, snapshot,
                               f"Repair {round_no + 1} undone — it left validation errors")
                fixed["undone"] = True
                rolled_back = True
                emit_sublayer(ctx, parent, f"undo{round_no + 1}", "completed", label=label,
                              summary="The repair left the workflow with validation errors and was "
                                      "undone: " + "; ".join(problems[:2])[:400])
            except Exception as e:  # noqa: BLE001
                emit_sublayer(ctx, parent, f"undo{round_no + 1}", "failed", label=label,
                              error=f"The repair could not be undone: {e}")
            break
    passed = bool(outcomes) and all(o["passed"] for o in outcomes)
    not_completed = [o for o in outcomes if not o["passed"] and o.get("inconclusive")
                     and not design_problems(o)]
    result = {"passed": passed, "scenarios": outcomes, "rounds": history,
              "inconclusive": len(not_completed), "rolled_back": rolled_back,
              "expectation_notes": path_notes}
    ctx.metadata[RESULT_KEY] = result
    ctx.emit("dry_run", json.dumps(result, default=str))
    return result


class WorkflowDryRunLayer(WorkflowStepLayer):
    """Run the scenarios end to end; repair and re-run what fails."""

    name = "workflow_dry_run"
    label = "Dry-run and repair"
    detail = ("Runs every scenario with connectors and reviews stubbed, checks each step and outcome, "
              "and fixes what fails — workflow edits and activity code — before your review.")

    def should_run(self, ctx: PipelineContext) -> bool:
        from app.config import settings

        return super().should_run(ctx) and settings.WORKFLOW_DRY_RUN and _definition(ctx) is not None

    async def process(self, ctx: PipelineContext, next):
        ctx.emit("status", "Dry-running the workflow on its scenarios…")
        result = await run_verification(ctx, self.name)
        good = sum(1 for o in result["scenarios"] if o["passed"])
        repairs = sum(1 for r in result["rounds"]
                      if (r.get("repair") or {}).get("applied") and not (r.get("repair") or {}).get("undone"))
        undone = sum(1 for r in result["rounds"] if (r.get("repair") or {}).get("undone"))
        ctx.set_layer_summary(
            self.name,
            f"{good} of {len(result['scenarios'])} scenario(s) pass"
            + (f" after {repairs} repair(s)" if repairs else "")
            + (f"; {undone} repair(s) did not help and were undone" if undone else "")
            + (f"; {result['inconclusive']} could not be completed (the model service did not answer)"
               if result.get("inconclusive") else "")
            + ("" if result["passed"] else " — the rest are listed for your review"))
        return await next(ctx)
