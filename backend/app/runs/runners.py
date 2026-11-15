"""
Runners — the existing creation pipelines, adapted to background runs.

Each runner builds the same context its streaming endpoint builds and points the
context's event queue at the run. The pipelines themselves are untouched, and
the original streaming endpoints keep working exactly as before.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from app.runs.manager import LiveRun, RunOutcome


def _as_dict(value: Any) -> Optional[dict]:
    return value if isinstance(value, dict) else None


async def workflow_plan(run: LiveRun, *, client, goal: str,
                        process_knowledge: Optional[dict] = None) -> RunOutcome:
    from app.core.context import PipelineContext
    from app.layers import workflow_pipeline

    from app.layers.workflow import plan_control

    ctx = PipelineContext(query=goal, stream=True, client=client,
                          process_request=process_knowledge)
    ctx.event_queue = run
    try:
        await workflow_pipeline.execute(ctx)
    except asyncio.CancelledError:
        # Stopped before it saved a workflow: nothing will use what it built.
        await asyncio.shield(plan_control.reclaim_unused(ctx, "the plan was cancelled"))
        raise

    done = _as_dict(run.payload("done")) or {}
    result = {
        "workflow_name": done.get("workflow_name"),
        "mistral_workflow_id": done.get("mistral_workflow_id"),
        "created": plan_control.created(ctx),
    }
    if ctx.metadata.get(plan_control.ROLLED_BACK_KEY):
        result["rolled_back"] = True
        return RunOutcome(status="cancelled", result=result, error=ctx.error)
    stopped = _prerequisites_stop(ctx, result)
    if stopped:
        return stopped
    fatal = _as_dict(run.payload("fatal_error"))
    if ctx.error or fatal:
        error = ctx.error or (fatal or {}).get("error") or "Planning failed"
        if not result.get("workflow_name"):
            reclaimed = await plan_control.reclaim_unused(ctx, "the plan failed before saving")
            if reclaimed:
                result["reclaimed"] = reclaimed
                result["created"] = plan_control.created(ctx)
        return RunOutcome(status="failed", result=result, error=str(error))
    return RunOutcome(result=result)


async def workflow_refine(run: LiveRun, *, client, workflow_name: str, instruction: str,
                          focus_step_ids: list[str], origin: str = "editor",
                          execution_id: Optional[str] = None) -> RunOutcome:
    """Refine with AI: read the failed run, analyse, plan, edit, fix activity code, check, propose."""
    from app.services import workflow_revision_service as revisions

    try:
        revision = await revisions.propose(
            client, workflow_name, instruction=instruction, focus_step_ids=focus_step_ids,
            origin=origin, execution_id=execution_id, event_queue=run)
    except revisions.RevisionError as e:
        return RunOutcome(status="failed", result={"workflow_name": workflow_name}, error=str(e))
    result = {"workflow_name": workflow_name, "revision_id": revision.get("id"),
              "revision_status": revision.get("status")}
    if revision.get("status") == "failed":
        return RunOutcome(status="failed", result=result, error=revision.get("error") or "No change could be made.")
    return RunOutcome(result=result)


async def _agents_with_connectors(client, definition) -> list[dict]:
    """The workflow's agents that have Mistral connectors (a dry run cannot stub those)."""
    from app.services import agent_service

    used = {(s.config or {}).get("agent_id") for s in definition.steps}
    try:
        listed = await agent_service.list_agents(client, page=0, page_size=200)
    except Exception:  # noqa: BLE001 — only a warning depends on it
        return []
    out = []
    for a in listed.get("items", []) if isinstance(listed, dict) else []:
        if a.get("id") in used and a.get("connectors"):
            names = [c.get("name") or c.get("connector_id") if isinstance(c, dict) else c
                     for c in a["connectors"]]
            out.append({"agent_id": a["id"], "connectors": [n for n in names if n]})
    return out


async def workflow_verify(run: LiveRun, *, client, workflow_name: str) -> RunOutcome:
    """Test a saved workflow on scenarios, as the planner's Verify stage does.

    For a workflow built or edited by hand: the best model designs scenarios
    (the typical case and each outcome the steps decide), each runs as a dry run
    (connectors and reviews stubbed), and a failure is diagnosed and a fix
    planned by Refine with AI. The workflow is the user's design, so each fix is
    put to them before it is applied — with the decision countdown, the
    recommended choice being to apply it (every applied fix is a version that
    can be undone).
    """
    from app.core.context import PipelineContext
    from app.core.specs import WorkflowSpec
    from app.layers.workflow import verify_layers as vl
    from app.services.workflow_engine.engine import get_workflow

    definition = await asyncio.to_thread(get_workflow, workflow_name)
    if definition is None:
        return RunOutcome(status="failed", error=f"Workflow '{workflow_name}' not found — save it first.")
    spec = WorkflowSpec(goal=definition.description or workflow_name.replace("_", " "),
                        workflow_name=workflow_name)
    spec.definition = definition
    spec.provisioned_agents = await _agents_with_connectors(client, definition)
    ctx = PipelineContext(query=spec.goal, stream=True, client=client, workflow_spec=spec)
    ctx.event_queue = run

    async def confirm(revision: dict, failed: list[dict]) -> bool:
        items = [{"title": i.get("title"), "kind": i.get("kind"),
                  "detail": i.get("detail") or i.get("why") or ""}
                 for i in revision.get("plan") or [] if i.get("kind") != "check"]
        answer = await run.ask("verify_repair", {
            "title": f"Apply the fix for {len(failed)} failed scenario(s)?",
            "workflow_name": workflow_name,
            "fix_summary": revision.get("summary") or "",
            "fix_items": items,
            "scenario_failures": [{"name": o["name"], "problems": o["problems"][:4]} for o in failed],
        }, options=["apply_fix", "skip_fix"], default="apply_fix")
        return answer.get("choice") == "apply_fix"

    ctx.metadata[vl.CONFIRM_REPAIR_KEY] = confirm
    design, dry = vl.ScenarioDesignLayer(), vl.WorkflowDryRunLayer()
    run.emit("pipeline", {"layers": [design.describe(), dry.describe()]})

    async def _done(c):
        return c

    for layer in (design, dry):
        if not layer.should_run(ctx):
            run.emit("layer", {"name": layer.name, "state": "skipped"})
            continue
        run.emit("layer", {"name": layer.name, "state": "active"})
        started = time.monotonic()
        await layer.process(ctx, _done)
        run.emit("layer", {"name": layer.name, "state": "failed" if ctx.error else "completed",
                           "ms": round((time.monotonic() - started) * 1000),
                           "summary": ctx.layer_summary(layer.name),
                           **({"error": ctx.error} if ctx.error else {})})
        if ctx.error:
            return RunOutcome(status="failed", result={"workflow_name": workflow_name}, error=ctx.error)

    outcome = ctx.metadata.get(vl.RESULT_KEY) or {}
    scenarios = outcome.get("scenarios") or []
    passed = sum(1 for o in scenarios if o.get("passed"))
    applied = sum(1 for r in outcome.get("rounds") or [] if (r.get("repair") or {}).get("applied"))
    return RunOutcome(result={"workflow_name": workflow_name, "passed": bool(outcome.get("passed")),
                              "scenarios": len(scenarios), "scenarios_passed": passed,
                              "repairs_applied": applied})


def _tool_names(tools) -> list[str]:
    out = []
    for t in tools or []:
        if isinstance(t, dict):
            fn = t.get("function") if isinstance(t.get("function"), dict) else {}
            name = fn.get("name") or t.get("name") or t.get("type")
        else:
            name = str(t)
        if name:
            out.append(str(name))
    return out


async def agent_evaluate(run: LiveRun, *, client, agent_id: str) -> RunOutcome:
    """Test an agent a person created (the builder's agent form), as agent design does.

    Test prompts are designed from the agent's instructions, tools and
    guardrails; the agent answers them through the same runner workflows use;
    the answers are judged; a dynamic tool that failed is rebuilt from the call
    it failed on. Revised instructions are put to the user before they replace
    what they wrote (decision countdown; the recommended choice is to apply).
    """
    from app.core.context import PipelineContext
    from app.core.specs import AgentSpec, GuardrailSpec
    from app.layers.agent import verification_layers as av
    from app.services import agent_service

    try:
        agent = await agent_service.get_agent(client, agent_id)
    except Exception as e:  # noqa: BLE001
        return RunOutcome(status="failed", error=f"Could not load the agent: {e}")

    spec = AgentSpec(agent_name=agent.get("name"), description=agent.get("description"),
                     tools=_tool_names(agent.get("tools")),
                     connectors=[str(c.get("name") or c.get("connector_id"))
                                 if isinstance(c, dict) else str(c)
                                 for c in agent.get("connectors") or []],
                     agent_instructions=agent.get("instructions") or "")
    if agent.get("guardrails"):
        try:
            spec.guardrails = GuardrailSpec()
        except TypeError:
            pass
    ctx = PipelineContext(query=agent.get("description") or agent.get("name") or agent_id,
                          stream=True, client=client)
    ctx.agent_spec = spec
    ctx.created_agent_id = agent_id
    ctx.event_queue = run

    async def confirm(current: str, revised: str, changes: str) -> bool:
        answer = await run.ask("revise_instructions", {
            "title": f"Apply revised instructions to {agent.get('name') or 'the agent'}?",
            "agent_name": agent.get("name"),
            "changes": changes[:2000],
            "current_instructions": current[:8000],
            "revised_instructions": revised[:8000],
        }, options=["apply_revision", "keep_instructions"], default="apply_revision")
        return answer.get("choice") == "apply_revision"

    ctx.metadata[av.CONFIRM_REVISION_KEY] = confirm
    layer = av.AgentEvaluationLayer()
    run.emit("pipeline", {"layers": [layer.describe()]})
    run.emit("layer", {"name": layer.name, "state": "active"})
    started = time.monotonic()

    async def _done(c):
        return c

    await layer.process(ctx, _done)
    run.emit("layer", {"name": layer.name, "state": "completed",
                       "ms": round((time.monotonic() - started) * 1000),
                       "summary": ctx.layer_summary(layer.name)})
    result = dict(ctx.metadata.get("agent_evaluation") or {})
    result.update({"agent_id": agent_id, "agent_name": agent.get("name"),
                   "summary": ctx.layer_summary(layer.name)})
    return RunOutcome(result=result)


async def agent(
    run: LiveRun,
    *,
    client,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    tier: Optional[str] = None,
    image_base64: Optional[str] = None,
    image_mime: Optional[str] = None,
    process_knowledge: Optional[dict] = None,
) -> RunOutcome:
    from app.layers import chat_pipeline
    from app.services.orchestrator_service import _build_context

    ctx = _build_context(
        client, query,
        agent_id=agent_id,
        conversation_id=conversation_id,
        tier=tier,
        image_base64=image_base64,
        image_mime=image_mime,
        stream=True,
        process_knowledge=process_knowledge,
    )
    ctx.event_queue = run
    await chat_pipeline.execute(ctx)

    done = _as_dict(run.payload("done")) or {}
    config = ctx.agent_config or {}
    result = {
        "agent_id": done.get("agent_id") or ctx.created_agent_id or ctx.agent_id,
        "agent_name": done.get("agent_name") or config.get("agent_name"),
        "conversation_id": ctx.conversation_id,
    }
    stopped = _prerequisites_stop(ctx, result)
    if stopped:
        return stopped
    if ctx.error:
        return RunOutcome(status="failed", result=result, error=str(ctx.error))
    return RunOutcome(result=result)


def _prerequisites_stop(ctx, result: dict) -> Optional[RunOutcome]:
    """A build stopped at its prerequisites — by the user, or because nobody could be
    asked — created nothing and is reported as cancelled, not failed."""
    from app.build_prereqs.layer import STOPPED_KEY
    from app.build_prereqs.models import METADATA_KEY

    reason = ctx.metadata.get(STOPPED_KEY)
    if not reason:
        return None
    record = ctx.metadata.get(METADATA_KEY) or {}
    result["prerequisites"] = {"stopped": reason, "items": [
        {k: v for k, v in i.items() if k != "value"} for i in record.get("items") or []]}
    return RunOutcome(status="cancelled", result=result, error=ctx.error)


async def _synthesise_in_place(ctx, task: str, placement: dict, relay, code_check,
                               guidance: list[str]) -> dict:
    """An activity for a place on the builder canvas, through the code-requirement pipeline.

    ``placement``: ``{"definition", "after_step_id", "before_step_ids"}``. The
    author sees what the steps before it return (exact field names) and what the
    steps after it read, and the contract checks refuse renamed fields — as for
    activities the planner builds.
    """
    from app.core.specs import CodeNeed
    from app.layers.codegen.pipeline import resolve_code_need
    from app.services.workflow_engine.builder_context import step_neighbours
    from app.services.workflow_engine.rule_validation import _activity_catalog

    definition = placement.get("definition") or {}
    upstream, downstream = step_neighbours(
        definition, after=placement.get("after_step_id"),
        before=placement.get("before_step_ids") or [], catalog=await _activity_catalog())
    if upstream or downstream:
        ctx.event_queue.emit("status", "Writing it to fit the workflow: reads what "
                             + (", ".join(u["id"] for u in upstream[:4]) or "the workflow inputs")
                             + " return")
    need = CodeNeed(purpose="activity", origin="workflow", intent=task,
                    goal=str(definition.get("description") or definition.get("name") or ""),
                    upstream=upstream, downstream=downstream, guidance=list(guidance or []))
    resolution = await resolve_code_need(need, client=ctx.client, on_event=relay, code_check=code_check)
    ok = resolution.usable or resolution.status == "pending_approval"
    return {
        "status": "success" if resolution.usable else resolution.status if ok else "failed",
        "tool_name": resolution.name, "name": resolution.name, "version": resolution.version,
        "tool_id": resolution.tool_id, "message": resolution.message,
        "issues": list(resolution.issues), "reused": resolution.status == "reused",
        "output_schema": resolution.output_schema,
        **({"reason": "prerequisites"} if resolution.reason == "prerequisites" else {}),
    }


async def synthesis(run: LiveRun, *, task: str, purpose: str,
                    placement: Optional[dict] = None) -> RunOutcome:
    """Tool or activity synthesis, framed as a one-layer pipeline.

    Synthesis is a single service call with no events of its own, so the run
    announces one layer around it. That keeps every kind of run on the same
    protocol — the UI draws progress for all of them the same way.
    """
    from app.build_prereqs import guidance as prerequisites
    from app.build_prereqs.code_check import CodeCheck
    from app.build_prereqs.layer import STOPPED_KEY, BuildPrerequisitesLayer
    from app.core.context import PipelineContext
    from app.layers.codegen.pipeline import _default_client
    from app.services.tool_registry import refresh_dynamic_tools
    from app.services.tool_resolver import tool_resolver

    noun = "activity" if purpose == "activity" else "agent tool"
    check_layer = BuildPrerequisitesLayer("tool")
    run.emit("pipeline", {"layers": [check_layer.describe(), {
        "name": "synthesis",
        "label": f"Synthesise the {noun}",
        "detail": "Designs the schema, generates the code and verifies it in the sandbox.",
        "hidden": False,
    }]})

    # What the code needs from the user — credentials, service URLs, facts —
    # settled before it is generated, as for agent and workflow builds. The
    # context's event queue is this run, so the check can stop and ask.
    ctx = PipelineContext(query=task, stream=True, client=_default_client())
    ctx.event_queue = run
    ctx.metadata["purpose"] = purpose
    run.emit("layer", {"name": check_layer.name, "state": "active"})
    checked = time.monotonic()

    async def _done(c):
        return c

    await check_layer.process(ctx, _done)
    stopped = ctx.metadata.get(STOPPED_KEY)
    run.emit("layer", {"name": check_layer.name, "state": "failed" if stopped else "completed",
                       "ms": round((time.monotonic() - checked) * 1000),
                       "summary": ctx.layer_summary(check_layer.name),
                       **({"error": ctx.error} if stopped else {})})
    if stopped:
        run.emit("layer", {"name": "synthesis", "state": "skipped"})
        result = {"status": "cancelled", "message": ctx.error}
        _prerequisites_stop(ctx, result)
        run.emit("synthesis_result", result)
        return RunOutcome(status="cancelled", result=result, error=ctx.error)

    run.emit("layer", {"name": "synthesis", "state": "active"})
    run.emit("status", "Designing the schema, generating code and verifying it in the sandbox…")

    started = time.monotonic()
    def relay(event: dict) -> None:
        # The pipeline's own progress — reuse check, authoring, the build's
        # attempts — shown as status lines under the one synthesis layer.
        message = str(event.get("message") or "").strip()
        if message and (event.get("stage") != "build" or event.get("build_stage") in (
                "verify", "arbitrate", "test_plan", "review", "done")):
            run.emit("status", message[:300])

    if purpose == "activity" and placement:
        # Created from the builder canvas: written to fit the steps around it.
        result = await _synthesise_in_place(ctx, task, placement, relay, CodeCheck(ctx),
                                            prerequisites.code_guidance(ctx))
    else:
        result = await tool_resolver.synthesize_from_task(
            task, purpose=purpose, on_event=relay, guidance=prerequisites.code_guidance(ctx),
            code_check=CodeCheck(ctx))
    ms = round((time.monotonic() - started) * 1000)
    result = result if isinstance(result, dict) else {"status": "error", "message": str(result)}

    failed = result.get("status") in ("failed", "error")
    if failed:
        message = str(result.get("message") or "Synthesis failed")
        run.emit("layer", {"name": "synthesis", "state": "failed", "ms": ms, "error": message})
        run.emit("synthesis_result", result)
        # Stopped at the credential check (R4b): nothing was built, by choice.
        status = "cancelled" if result.get("reason") == "prerequisites" else "failed"
        return RunOutcome(status=status, result=result, error=message)

    name = result.get("tool_name") or result.get("name")
    run.emit("layer", {
        "name": "synthesis", "state": "completed", "ms": ms,
        "summary": f"Built {name}" if name else "Built",
    })
    run.emit("synthesis_result", result)
    try:
        await refresh_dynamic_tools()
    except Exception:
        pass  # the registry refreshes itself on the next read anyway
    return RunOutcome(result=result)


async def rebuild(run: LiveRun, *, tool_id: int, name: str, purpose: str, error: str = "",
                  comment: str = "", failing_input: Optional[dict] = None,
                  expected_output: Any = None, update_workflows: bool = True) -> RunOutcome:
    """Rebuild a tool or activity from a failure (see ``app.services.code_rebuild``)."""
    from app.services.code_rebuild import RebuildError, rebuild_from_failure

    noun = "activity" if purpose == "activity" else "agent tool"
    run.emit("pipeline", {"layers": [{
        "name": "synthesis",
        "label": f"Rebuild the {noun}",
        "detail": "Fixes the code from the error and your comment, then checks the new version "
                  "against its examples and the input it failed on.",
        "hidden": False,
    }]})
    run.emit("layer", {"name": "synthesis", "state": "active"})
    run.emit("status", f"Rebuilding {name} from the failure you reported…")

    def relay(event: dict) -> None:
        message = str(event.get("message") or "").strip()
        if message and (event.get("stage") != "build" or event.get("build_stage") in (
                "verify", "arbitrate", "test_plan", "review", "done")):
            run.emit("status", message[:300])

    started = time.monotonic()
    try:
        result = await rebuild_from_failure(
            tool_id, error=error, comment=comment, failing_input=failing_input,
            expected_output=expected_output, update_workflows=update_workflows, on_event=relay)
    except RebuildError as e:
        result = {"status": "failed", "tool_name": name, "message": str(e)}
    ms = round((time.monotonic() - started) * 1000)

    if result.get("status") in ("failed", "error", "blocked"):
        message = str(result.get("message") or "Rebuild failed")
        run.emit("layer", {"name": "synthesis", "state": "failed", "ms": ms, "error": message})
        run.emit("synthesis_result", result)
        return RunOutcome(status="failed", result=result, error=message)

    run.emit("layer", {"name": "synthesis", "state": "completed", "ms": ms,
                       "summary": f"Built {name} v{result.get('version')}"})
    run.emit("synthesis_result", result)
    return RunOutcome(result=result)
