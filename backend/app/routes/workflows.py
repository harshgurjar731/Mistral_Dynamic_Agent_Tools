"""
Workflow Routes — CRUD and execution for dynamic workflows.

Execution routing strategy:
  1. If workflow is_deployed → try Mistral server execution first
  2. Gracefully fall back to local DAG engine if server is unreachable
  3. Source field in response tells the UI which path was taken
"""

import asyncio
import logging
import os
import json
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.dependencies import get_mistral_client
from app.services.workflow_engine.models import (
    CreateWorkflowRequest, ExecuteWorkflowRequest,
    WorkflowExecutionResponse, WorkflowListResponse, WorkflowDefinition,
)
from app.services.workflow_engine.engine import (
    save_workflow, get_workflow, list_workflows, delete_workflow,
    execute_workflow, get_execution, list_executions_for_workflow,
)
from app.services import workflow_planner
from app.services.mistral_workflows_compiler import compile_workflow_to_python

logger = logging.getLogger(__name__)

# ── SSE helper ────────────────────────────────────────────────────────────────
def _sse(data, event: str = "message") -> str:
    payload = json.dumps(data) if not isinstance(data, str) else data
    payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


router = APIRouter(tags=["Workflows"])


# ── Mistral API proxy helpers ─────────────────────────────────────────────────

def _mistral_headers() -> dict:
    return {"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"}


def _mistral_get(path: str, timeout: float = 8.0):
    try:
        return httpx.get(f"https://api.mistral.ai{path}", headers=_mistral_headers(), timeout=timeout)
    except Exception:
        return None


def _mistral_post(path: str, body: dict, timeout: float = 30.0):
    try:
        return httpx.post(
            f"https://api.mistral.ai{path}",
            headers={**_mistral_headers(), "Content-Type": "application/json"},
            json=body,
            timeout=timeout,
        )
    except Exception:
        return None


def _get_mistral_workflow_id(workflow_name: str) -> str | None:
    """Fetch the Mistral server workflow ID for the given workflow name."""
    local = get_workflow(workflow_name)
    if local and local.id and local.is_deployed:
        return local.id  # fast-path from local cache

    resp = _mistral_get("/v1/workflows")
    if resp and resp.status_code == 200:
        for wf in resp.json().get("workflows", []):
            if wf.get("name") == workflow_name:
                return wf.get("id")
    return None


# ── Plan ──────────────────────────────────────────────────────────────────────

class PlanWorkflowRequest(BaseModel):
    goal: str


@router.post("/workflows/plan")
async def plan_workflow_endpoint(request: PlanWorkflowRequest):
    """
    Stream a multi-phase workflow planning process via SSE.
    Phases: Analyse → Synthesise tools → Create agents → Build DAG
            → Save → Compile → Register → le Chat
    """
    client = get_mistral_client()
    return StreamingResponse(
        workflow_planner.plan_workflow_stream(client=client, goal=request.goal),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("/workflows")
async def create_workflow(request: CreateWorkflowRequest):
    """Create a new workflow definition."""
    name = save_workflow(request.definition)
    return {"workflow_name": name, "message": "Workflow created", "steps": len(request.definition.steps)}


@router.get("/workflows", response_model=WorkflowListResponse)
async def list_all_workflows():
    """List all workflow definitions, merged with Mistral server status."""
    local_workflows = list_workflows()
    local_dict = {wf.name: wf for wf in local_workflows}

    try:
        resp = _mistral_get("/v1/workflows")
        if resp and resp.status_code == 200:
            for rw in resp.json().get("workflows", []):
                name = rw.get("name")
                if not name:
                    continue
                if name in local_dict:
                    local_dict[name].is_deployed = True
                    local_dict[name].id = rw.get("id")
                    local_dict[name].archived = rw.get("archived", False)
                else:
                    local_dict[name] = WorkflowDefinition(
                        id=rw.get("id"),
                        name=name,
                        description=rw.get("description", ""),
                        steps=[],
                        entry_step="",
                        is_deployed=True,
                        archived=rw.get("archived", False),
                    )
    except Exception as e:
        logger.warning("Failed to fetch remote workflows: %s", e)

    merged = list(local_dict.values())
    return WorkflowListResponse(workflows=merged, count=len(merged))


@router.get("/workflows/{workflow_name}")
async def get_workflow_detail(workflow_name: str):
    """Get a workflow definition, merged with Mistral server data."""
    workflow = get_workflow(workflow_name)

    # Also fetch remote info
    resp = _mistral_get("/v1/workflows")
    if resp and resp.status_code == 200:
        for rw in resp.json().get("workflows", []):
            if rw.get("name") == workflow_name:
                if workflow:
                    workflow.is_deployed = True
                    workflow.id = rw.get("id")
                    workflow.archived = rw.get("archived", False)
                else:
                    workflow = WorkflowDefinition(
                        id=rw.get("id"),
                        name=workflow_name,
                        description=rw.get("description", ""),
                        steps=[],
                        entry_step="",
                        is_deployed=True,
                        archived=rw.get("archived", False),
                    )
                break

    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"workflow": workflow.model_dump()}


@router.put("/workflows/{workflow_name}/archive")
async def archive_workflow_endpoint(workflow_name: str):
    """Archive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if remote_id:
        _mistral_post(f"/v1/workflows/{remote_id}/archive", {})

    if workflow:
        workflow.archived = True
        save_workflow(workflow)

    if not workflow and not remote_id:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"archived": True, "workflow_name": workflow_name}


@router.put("/workflows/{workflow_name}/unarchive")
async def unarchive_workflow_endpoint(workflow_name: str):
    """Unarchive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if remote_id:
        _mistral_post(f"/v1/workflows/{remote_id}/unarchive", {})

    if workflow:
        workflow.archived = False
        save_workflow(workflow)

    if not workflow and not remote_id:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"unarchived": True, "workflow_name": workflow_name}


# ── Execute ───────────────────────────────────────────────────────────────────

@router.post("/workflows/{workflow_name}/execute", response_model=WorkflowExecutionResponse)
async def execute_workflow_endpoint(workflow_name: str, request: ExecuteWorkflowRequest):
    """
    Execute a workflow.
    
    Strategy:
      1. If is_deployed → call Mistral server (POST /v1/workflows/{name}/execute)
      2. On server failure or if not deployed → fall back to local DAG engine
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    # ── Try Mistral server first if deployed ──────────────────────────────
    if workflow.is_deployed or workflow.id:
        try:
            body = {
                "input": request.input or {},
                "wait_for_result": request.wait_for_result,
            }
            if request.execution_id:
                body["execution_id"] = request.execution_id
            if request.timeout_seconds:
                body["timeout_seconds"] = request.timeout_seconds

            resp = _mistral_post(
                f"/v1/workflows/{workflow_name}/execute",
                body,
                timeout=max(60.0, (request.timeout_seconds or 60) + 5),
            )

            if resp and resp.status_code in (200, 201):
                data = resp.json()
                from app.services.workflow_engine.models import WorkflowStatus
                status_raw = data.get("status", "RUNNING").upper()
                try:
                    status = WorkflowStatus(status_raw)
                except ValueError:
                    status = WorkflowStatus.RUNNING

                return WorkflowExecutionResponse(
                    execution_id=data.get("execution_id", data.get("id", "")),
                    workflow_name=workflow_name,
                    status=status,
                    start_time=data.get("start_time"),
                    end_time=data.get("end_time"),
                    result=data.get("result"),
                    root_execution_id=data.get("root_execution_id", data.get("execution_id")),
                )
            else:
                logger.warning(
                    "Mistral server returned %s for workflow execute — falling back to local engine.",
                    resp.status_code if resp else "no response",
                )
        except Exception as e:
            logger.warning("Mistral server execution failed (%s) — falling back to local engine.", e)

    # ── Local DAG engine fallback ─────────────────────────────────────────
    try:
        run = await execute_workflow(
            workflow_name=workflow_name,
            input_vars=request.input or {},
            execution_id=request.execution_id,
            wait_for_result=request.wait_for_result,
        )
        return WorkflowExecutionResponse(
            execution_id=run.execution_id,
            workflow_name=run.workflow_name,
            status=run.status,
            start_time=run.start_time,
            end_time=run.end_time,
            result=run.result,
            root_execution_id=run.execution_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Get execution status ──────────────────────────────────────────────────────

@router.get("/workflows/executions/{execution_id}", response_model=WorkflowExecutionResponse)
async def get_execution_status(execution_id: str):
    """
    Get execution status.
    Tries Mistral server first, falls back to local store.
    """
    # Try Mistral server
    resp = _mistral_get(f"/v1/workflows/executions/{execution_id}")
    if resp and resp.status_code == 200:
        data = resp.json()
        from app.services.workflow_engine.models import WorkflowStatus
        status_raw = data.get("status", "RUNNING").upper()
        try:
            status = WorkflowStatus(status_raw)
        except ValueError:
            status = WorkflowStatus.RUNNING

        # Also persist step_results from Mistral into local run if present
        run = get_execution(execution_id)

        return WorkflowExecutionResponse(
            execution_id=data.get("execution_id", execution_id),
            workflow_name=data.get("workflow_name", run.workflow_name if run else ""),
            status=status,
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            result=data.get("result"),
            root_execution_id=data.get("root_execution_id", execution_id),
        )

    # Fall back to local store
    run = get_execution(execution_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Execution '{execution_id}' not found")

    return WorkflowExecutionResponse(
        execution_id=run.execution_id,
        workflow_name=run.workflow_name,
        status=run.status,
        start_time=run.start_time,
        end_time=run.end_time,
        result=run.result,
        root_execution_id=run.execution_id,
    )


# ── Execution SSE stream ──────────────────────────────────────────────────────

@router.get("/workflows/executions/{execution_id}/stream")
async def stream_execution_status(execution_id: str):
    """
    SSE stream that polls execution status and pushes events until terminal state.
    Tries Mistral server, falls back to local store.
    Terminal states: COMPLETED, FAILED, CANCELLED, TERMINATED, TIMED_OUT
    """
    TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT", "CONTINUED_AS_NEW"}

    async def _generate() -> AsyncGenerator[str, None]:
        for _ in range(120):  # max 2 min of polling
            await asyncio.sleep(1)
            try:
                # Try Mistral server
                resp = _mistral_get(f"/v1/workflows/executions/{execution_id}")
                if resp and resp.status_code == 200:
                    data = resp.json()
                    yield _sse(data, "execution_update")
                    if data.get("status", "").upper() in TERMINAL:
                        yield _sse({"execution_id": execution_id, "status": data.get("status")}, "done")
                        return
                    continue

                # Fall back to local
                run = get_execution(execution_id)
                if run:
                    payload = {
                        "execution_id": run.execution_id,
                        "status": run.status.value,
                        "start_time": run.start_time.isoformat() if run.start_time else None,
                        "end_time": run.end_time.isoformat() if run.end_time else None,
                        "result": run.result,
                        "step_results": [sr.model_dump() for sr in run.step_results],
                    }
                    yield _sse(payload, "execution_update")
                    if run.status.value.upper() in TERMINAL:
                        yield _sse({"execution_id": execution_id, "status": run.status.value}, "done")
                        return

            except Exception as e:
                yield _sse({"error": str(e)}, "error")

        yield _sse({"execution_id": execution_id, "status": "TIMED_OUT"}, "done")

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Signal to running execution ───────────────────────────────────────────────

class SignalRequest(BaseModel):
    signal_name: str = "user_message"
    payload: dict = {}


@router.post("/workflows/executions/{execution_id}/signal")
async def send_signal_to_execution(execution_id: str, request: SignalRequest):
    """
    Send a signal to a running workflow execution on the Mistral server.
    Used by the le Chat / execution modal to send user messages.
    """
    resp = _mistral_post(
        f"/v1/workflows/executions/{execution_id}/signals",
        {
            "signal_name": request.signal_name,
            "payload": request.payload,
        },
    )
    if resp and resp.status_code in (200, 201, 204):
        return {"sent": True, "execution_id": execution_id, "signal": request.signal_name}

    # Graceful fallback: not fatal — local execution doesn't support signals
    logger.warning("Signal to Mistral execution %s failed (status=%s)", execution_id, resp.status_code if resp else "none")
    return {"sent": False, "execution_id": execution_id, "note": "Signal not delivered — worker may not be connected."}


# ── List executions for workflow ──────────────────────────────────────────────

@router.get("/workflows/{workflow_name}/executions")
async def get_workflow_executions(workflow_name: str):
    """Get all executions for a workflow (merged: Mistral server + local)."""
    results = []

    # Try Mistral server
    remote_id = _get_mistral_workflow_id(workflow_name)
    if remote_id:
        resp = _mistral_get(f"/v1/workflows/{remote_id}/executions")
        if resp and resp.status_code == 200:
            for ex in resp.json().get("executions", []):
                results.append({
                    "execution_id": ex.get("execution_id", ex.get("id")),
                    "status": ex.get("status"),
                    "start_time": ex.get("start_time"),
                    "end_time": ex.get("end_time"),
                    "source": "mistral",
                })

    # Merge local executions
    local_ids = {r["execution_id"] for r in results}
    for run in list_executions_for_workflow(workflow_name):
        if run.execution_id not in local_ids:
            results.append({
                "execution_id": run.execution_id,
                "status": run.status.value,
                "start_time": run.start_time.isoformat() if run.start_time else None,
                "end_time": run.end_time.isoformat() if run.end_time else None,
                "source": "local",
            })

    return {"executions": results}


# ── Register (manual trigger) ─────────────────────────────────────────────────

@router.post("/workflows/{workflow_name}/register")
async def register_workflow_on_mistral(workflow_name: str):
    """
    Manually compile a workflow to SDK Python, write it to the worker directory,
    and restart the worker. The worker will auto-register with Mistral.
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    # Compile
    code = compile_workflow_to_python(workflow)
    workflows_dir = os.path.abspath(
        os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
    )
    os.makedirs(workflows_dir, exist_ok=True)
    file_path = os.path.join(workflows_dir, f"workflow_{workflow_name}.py")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(code)

    logger.info("Registered workflow '%s' → %s (worker will hot-reload)", workflow_name, file_path)

    return {
        "message": "Workflow compiled and queued for worker registration.",
        "workflow_name": workflow_name,
        "file_path": file_path,
        "note": "The worker hot-reload will pick up the new file automatically.",
    }


# ── Export (legacy — kept for backward compat) ───────────────────────────────

@router.post("/workflows/{workflow_name}/export")
async def export_to_mistral(workflow_name: str):
    """Compile to Mistral Workflows SDK Python code and write to disk (worker auto-reloads)."""
    result = await register_workflow_on_mistral(workflow_name)
    workflow = get_workflow(workflow_name)
    code = compile_workflow_to_python(workflow) if workflow else ""
    return {**result, "code": code}
