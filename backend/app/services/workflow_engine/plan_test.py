"""
Test a built workflow's parts — run when the user asks, not automatically.

Checks each step can actually do its job, without running the whole workflow
(which needs real inputs and costs a model call per agent step):

* activity step — executed against its worked examples when it is pure and
  side-effect free; otherwise checked to exist as an active, approved version
* agent step    — the agent exists on Mistral
* other steps   — not tested here (connectors call live systems; conditions
  and transforms have no external part)

plus the structural validation the builder runs.
"""

from __future__ import annotations

import asyncio
import logging

from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep

logger = logging.getLogger(__name__)


async def test_workflow(definition: WorkflowDefinition, client) -> dict:
    from app.services.workflow_engine.validation import validate_workflow

    validation = validate_workflow(definition)
    steps = await asyncio.gather(*(_test_step(s, client) for s in definition.steps))
    failed = [s for s in steps if s["result"] == "failed"]
    return {
        "workflow_name": definition.name,
        "passed": validation.valid and not failed,
        "validation": {
            "valid": validation.valid,
            "issues": [i.model_dump() for i in validation.issues if i.severity == "error"],
        },
        "steps": list(steps),
        "summary": (f"{sum(1 for s in steps if s['result'] == 'passed')} passed, "
                    f"{len(failed)} failed, "
                    f"{sum(1 for s in steps if s['result'] == 'skipped')} not tested"),
    }


async def _test_step(step: WorkflowStep, client) -> dict:
    row = {"step_id": step.id, "type": step.type.value}
    try:
        if step.type == StepType.TOOL:
            return {**row, **await _test_activity(step)}
        if step.type == StepType.AGENT:
            return {**row, **await _test_agent(step, client)}
    except Exception as e:  # noqa: BLE001 — one step's test never stops the others
        logger.warning("Testing step '%s' raised: %s", step.id, e)
        return {**row, "result": "failed", "detail": f"{type(e).__name__}: {e}"}
    return {**row, "result": "skipped", "detail": f"{step.type.value} steps are not tested here"}


async def _test_activity(step: WorkflowStep) -> dict:
    from app.core.specs import CodeRequirement
    from app.layers.codegen.smoke import smoke_test, smoke_testable
    from app.services.tool_resolver import tool_resolver

    config = step.config or {}
    name = str(config.get("tool_name") or "").strip()
    if not name:
        return {"result": "failed", "detail": "No activity is bound to this step."}

    requirement = config.get("code_requirement")
    req = CodeRequirement.from_dict(requirement) if isinstance(requirement, dict) else None
    if req is not None and smoke_testable(req) and req.examples:
        problems = await smoke_test(req, {"tool_name": name, "version": config.get("tool_version")})
        if problems:
            return {"result": "failed", "name": name, "detail": "; ".join(problems)}
        return {"result": "passed", "name": name,
                "detail": f"matched {min(len(req.examples), 3)} worked example(s)"}

    versions = await tool_resolver.get_tool_versions(name)
    pinned = config.get("tool_version")
    usable = [v for v in versions if v.get("status") == "approved"
              and (v.get("version_no") == pinned if pinned is not None else v.get("is_active"))]
    if not usable:
        return {"result": "failed", "name": name,
                "detail": f"Activity '{name}' has no approved"
                          f"{f' version {pinned}' if pinned is not None else ' active version'}."}
    return {"result": "passed", "name": name,
            "detail": "exists (not executed — it has side effects or no worked examples)"}


async def _test_agent(step: WorkflowStep, client) -> dict:
    agent_id = str((step.config or {}).get("agent_id") or "").strip()
    if not agent_id:
        if (step.config or {}).get("model"):
            return {"result": "skipped", "detail": "inline model step — no agent to check"}
        return {"result": "failed", "detail": "No agent is bound to this step."}
    agent = await asyncio.to_thread(client.beta.agents.get, agent_id=agent_id)
    return {"result": "passed", "name": getattr(agent, "name", agent_id), "detail": "agent exists"}
