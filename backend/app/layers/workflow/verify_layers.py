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
    from app.services.workflow_engine.step_runners import _MISSING

    path = expectation["path"]
    if actual is _MISSING or actual is None:
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


def _live_connectors(ctx: PipelineContext) -> dict[str, list]:
    """Agents with Mistral connectors attached: those run on Mistral and a dry run cannot stub them."""
    out = {}
    for agent in getattr(ctx.workflow_spec, "provisioned_agents", None) or []:
        if isinstance(agent, dict) and agent.get("agent_id") and agent.get("connectors"):
            out[agent["agent_id"]] = list(agent["connectors"])
    return out


async def run_scenario(ctx: PipelineContext, workflow_name: str, scenario: dict) -> dict:
    """Run one scenario as a dry run and say whether it passed, and why not."""
    from app.services.workflow_engine import dry_run, engine
    from app.services.workflow_engine.step_runners import _lookup
    from app.services.workflow_engine.structured_output import problems as schema_problems

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
        outcome["problems"].append(f"the run crashed: {e}")
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
            outcome["problems"].append(f"step '{result.step_id}' failed: {(result.error or '')[:400]}")
            continue
        schema = (step.config or {}).get("output_schema") if step else None
        if isinstance(schema, dict) and isinstance(result.output, (dict, list)):
            for p in schema_problems(result.output, schema, limit=3):
                outcome["problems"].append(f"step '{result.step_id}' output does not match its record: {p}")
    status = str(getattr(run.status, "value", run.status)).upper()
    if status != "COMPLETED" and not outcome["failed_steps"]:
        reason = (run.result or {}).get("error") if isinstance(run.result, dict) else None
        outcome["problems"].append(f"the run ended {status.lower()}" + (f": {reason}" if reason else ""))
    for expectation in scenario.get("expect") or []:
        miss = _compare(_lookup(str(expectation["path"]), run.variables or {}), expectation)
        if miss:
            outcome["problems"].append(f"expected outcome not met — {miss}"
                                       + (f" ({expectation['why']})" if expectation.get("why") else ""))
    outcome["passed"] = not outcome["problems"]
    outcome["steps_run"] = len(run.step_results)
    return outcome


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


def _instruction(failed: list[dict]) -> str:
    lines = []
    for o in failed:
        lines.append(f"Scenario '{o['name']}':")
        lines += [f"  - {p}" for p in o["problems"][:8]]
    return ("The workflow was dry-run on its test scenarios before review and these failed. Find "
            "the cause of each — wiring, a condition or transform, a template, or an activity's "
            "code — and fix it so every scenario passes. Change only what causes these failures.\n"
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


async def run_verification(ctx: PipelineContext, parent: str) -> dict:
    """Run every scenario; repair and re-run what fails, up to the configured rounds."""
    from app.config import settings

    spec = ctx.workflow_spec
    workflow_name = spec.workflow_name or getattr(spec.definition, "name", None)
    scenarios = ctx.metadata.get(SCENARIOS_KEY) or [
        {"name": "Designed example", "input": _example(spec.definition), "expect": []}]
    rounds = max(0, settings.WORKFLOW_DRY_RUN_REPAIRS)
    history: list[dict] = []
    outcomes: list[dict] = []
    for round_no in range(rounds + 1):
        outcomes = []
        for i, scenario in enumerate(scenarios):
            sub = f"r{round_no}:s{i}"
            label = f"{'Re-run' if round_no else 'Run'} '{scenario['name']}'"
            emit_sublayer(ctx, parent, sub, "active", label=label, detail=scenario.get("description", ""))
            outcome = await run_scenario(ctx, workflow_name, scenario)
            outcomes.append(outcome)
            summary = ("Passed — every step completed and every expected outcome held."
                       if outcome["passed"] else "; ".join(outcome["problems"][:3]))
            if outcome.get("warnings"):
                summary += " Note: " + outcome["warnings"][0]
            emit_sublayer(ctx, parent, sub, "completed" if outcome["passed"] else "failed", label=label,
                          summary=summary)
        failed = [o for o in outcomes if not o["passed"]]
        history.append({"round": round_no, "passed": len(outcomes) - len(failed), "failed": len(failed)})
        if not failed or round_no == rounds:
            break
        fixed = await repair(ctx, workflow_name, parent, round_no + 1, failed)
        history[-1]["repair"] = fixed
        if not fixed.get("applied"):
            break
    passed = bool(outcomes) and all(o["passed"] for o in outcomes)
    result = {"passed": passed, "scenarios": outcomes, "rounds": history}
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
        repairs = sum(1 for r in result["rounds"] if (r.get("repair") or {}).get("applied"))
        ctx.set_layer_summary(
            self.name,
            f"{good} of {len(result['scenarios'])} scenario(s) pass"
            + (f" after {repairs} repair(s)" if repairs else "")
            + ("" if result["passed"] else " — the rest are listed for your review"))
        return await next(ctx)
