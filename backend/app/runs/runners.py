"""
Runners — the existing creation pipelines, adapted to background runs.

Each runner builds the same context its streaming endpoint builds and points the
context's event queue at the run. The pipelines themselves are untouched, and
the original streaming endpoints keep working exactly as before.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.runs.manager import LiveRun, RunOutcome


def _as_dict(value: Any) -> Optional[dict]:
    return value if isinstance(value, dict) else None


async def workflow_plan(run: LiveRun, *, client, goal: str) -> RunOutcome:
    from app.core.context import PipelineContext
    from app.layers import workflow_pipeline

    ctx = PipelineContext(query=goal, stream=True, client=client)
    ctx.event_queue = run
    await workflow_pipeline.execute(ctx)

    done = _as_dict(run.payload("done")) or {}
    result = {
        "workflow_name": done.get("workflow_name"),
        "mistral_workflow_id": done.get("mistral_workflow_id"),
    }
    fatal = _as_dict(run.payload("fatal_error"))
    if ctx.error or fatal:
        error = ctx.error or (fatal or {}).get("error") or "Planning failed"
        return RunOutcome(status="failed", result=result, error=str(error))
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
    if ctx.error:
        return RunOutcome(status="failed", result=result, error=str(ctx.error))
    return RunOutcome(result=result)


async def synthesis(run: LiveRun, *, task: str, purpose: str) -> RunOutcome:
    """Tool or activity synthesis, framed as a one-layer pipeline.

    Synthesis is a single service call with no events of its own, so the run
    announces one layer around it. That keeps every kind of run on the same
    protocol — the UI draws progress for all of them the same way.
    """
    from app.services.tool_registry import refresh_dynamic_tools
    from app.services.tool_resolver import tool_resolver

    noun = "activity" if purpose == "activity" else "agent tool"
    run.emit("pipeline", {"layers": [{
        "name": "synthesis",
        "label": f"Synthesise the {noun}",
        "detail": "Designs the schema, generates the code and verifies it in the sandbox.",
        "hidden": False,
    }]})
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

    result = await tool_resolver.synthesize_from_task(task, purpose=purpose, on_event=relay)
    ms = round((time.monotonic() - started) * 1000)
    result = result if isinstance(result, dict) else {"status": "error", "message": str(result)}

    failed = result.get("status") in ("failed", "error")
    if failed:
        message = str(result.get("message") or "Synthesis failed")
        run.emit("layer", {"name": "synthesis", "state": "failed", "ms": ms, "error": message})
        run.emit("synthesis_result", result)
        return RunOutcome(status="failed", result=result, error=message)

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
