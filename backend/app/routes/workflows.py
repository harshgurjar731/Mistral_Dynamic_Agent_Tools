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
from fastapi import APIRouter, HTTPException, BackgroundTasks
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

# ── Worker deployment name — must match what mistral_worker.py uses ───────────
# This is the task_queue your worker polls. Execution must target the same name.
WORKER_DEPLOYMENT = os.environ.get("DEPLOYMENT_NAME", "default")

# ── SSE helper ────────────────────────────────────────────────────────────────
def _sse(data, event: str = "message") -> str:
    payload = json.dumps(data, default=str) if not isinstance(data, str) else data
    payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


def _safe_serialize(obj):
    """
    Recursively convert a value into a plain JSON-serializable Python type.

    Handles:
      - Pydantic BaseModel objects → dict via model_dump() / dict()
      - datetime objects → ISO string
      - strings that look like JSON or Python dicts → parsed to dict
      - lists/dicts → recursively cleaned
      - Everything else → str()
    """
    if obj is None:
        return None

    # Pydantic models (Mistral SDK returns these)
    if hasattr(obj, "model_dump"):
        try:
            return _safe_serialize(obj.model_dump())
        except Exception:
            pass
    if hasattr(obj, "dict") and callable(obj.dict) and not isinstance(obj, dict):
        try:
            return _safe_serialize(obj.dict())
        except Exception:
            pass

    # datetime → ISO string
    if hasattr(obj, "isoformat"):
        return obj.isoformat()

    # dict → recurse
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v) for k, v in obj.items()}

    # list/tuple → recurse
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(item) for item in obj]

    # Primitives pass through
    if isinstance(obj, (str, int, float, bool)):
        # Try parsing strings that look like JSON or Python dict literals
        if isinstance(obj, str) and obj.strip().startswith("{"):
            try:
                return _safe_serialize(json.loads(obj))
            except (json.JSONDecodeError, ValueError):
                # Try Python literal eval as last resort (for repr-style dicts)
                import ast
                try:
                    parsed = ast.literal_eval(obj)
                    if isinstance(parsed, (dict, list)):
                        return _safe_serialize(parsed)
                except (ValueError, SyntaxError):
                    pass
        return obj

    # Fallback: stringify
    try:
        return str(obj)
    except Exception:
        return repr(obj)


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


def _mistral_put(path: str, body: dict | None = None, timeout: float = 30.0):
    try:
        kwargs = {
            "headers": _mistral_headers(),
            "timeout": timeout,
        }
        if body is not None:
            kwargs["headers"]["Content-Type"] = "application/json"
            kwargs["json"] = body
            
        return httpx.put(f"https://api.mistral.ai{path}", **kwargs)
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


def _delayed_mistral_archive(remote_id: str):
    import time
    time.sleep(5)
    _mistral_put(f"/v1/workflows/{remote_id}/archive")

@router.put("/workflows/{workflow_name}/archive")
async def archive_workflow_endpoint(workflow_name: str, background_tasks: BackgroundTasks):
    """Archive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if workflow:
        workflow.archived = True
        save_workflow(workflow)
        # Delete file so worker unregisters it
        py_file = os.path.join(settings.MISTRAL_WORKFLOWS_DIR, f"workflow_{workflow_name}.py")
        if os.path.exists(py_file):
            try:
                os.remove(py_file)
            except Exception:
                pass

    if remote_id:
        background_tasks.add_task(_delayed_mistral_archive, remote_id)

    if not workflow and not remote_id:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"archived": True, "workflow_name": workflow_name}


@router.put("/workflows/{workflow_name}/unarchive")
async def unarchive_workflow_endpoint(workflow_name: str):
    """Unarchive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if remote_id:
        _mistral_put(f"/v1/workflows/{remote_id}/unarchive")

    if workflow:
        workflow.archived = False
        save_workflow(workflow)
        # Recreate file so worker registers it
        try:
            from app.services.mistral_workflows_compiler import compile_workflow_to_python
            code = compile_workflow_to_python(workflow)
            py_file = os.path.join(settings.MISTRAL_WORKFLOWS_DIR, f"workflow_{workflow_name}.py")
            with open(py_file, "w", encoding="utf-8") as f:
                f.write(code)
        except Exception as e:
            logging.error(f"Failed to recompile workflow on unarchive: {e}")

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
         with worker_identifier so Temporal routes the task to our worker's
         task queue (WORKER_DEPLOYMENT = 'default').
      2. On server failure or if not deployed → fall back to local DAG engine.
    """
    workflow = get_workflow(workflow_name)
    # Note: workflow may be None for Mistral-only (remotely registered) workflows.
    # We still attempt Mistral server execution before raising 404.

    # ── Always try Mistral server first via direct HTTP ──────────────────
    # We use httpx directly so we can pass worker routing fields that the
    # SDK wrapper does not expose. We send all known field-name variants
    # for the worker routing hint — the server ignores unknown fields.
    try:
        body: dict = {
            "input": {"variables": request.input or {}},
            # Send all known field-name variants for worker task-queue routing.
            # The Mistral API field name has changed across versions; sending
            # all three is safe (unknown fields are silently ignored server-side).
            "worker_deployment": WORKER_DEPLOYMENT,   # current API field name
            "worker_identifier": WORKER_DEPLOYMENT,   # older API field name
            "deployment_name":   WORKER_DEPLOYMENT,   # alias in some versions
        }
        if request.execution_id:
            body["execution_id"] = request.execution_id

        logger.info(
            "Executing '%s' on Mistral server — worker_deployment='%s'",
            workflow_name, WORKER_DEPLOYMENT,
        )

        resp = await asyncio.to_thread(
            lambda: httpx.post(
                f"https://api.mistral.ai/v1/workflows/{workflow_name}/execute",
                headers={**_mistral_headers(), "Content-Type": "application/json"},
                json=body,
                timeout=30.0,
            )
        )

        logger.info(
            "Mistral execute response: status=%d body=%.300s",
            resp.status_code, resp.text,
        )

        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Mistral API returned {resp.status_code}: {resp.text}")

        data = resp.json()
        exec_id = data.get("execution_id", data.get("id", ""))
        status_raw = str(data.get("status", "RUNNING")).upper()

        from app.services.workflow_engine.models import WorkflowStatus
        try:
            status = WorkflowStatus(status_raw)
        except ValueError:
            status = WorkflowStatus.RUNNING

        logger.info(
            "Workflow '%s' executing on Mistral server (exec_id=%s, worker=%s)",
            workflow_name, exec_id[:20], WORKER_DEPLOYMENT,
        )
        return WorkflowExecutionResponse(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=status,
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            result=data.get("output"),
            root_execution_id=data.get("root_execution_id", exec_id),
            source="mistral",
        )
    except Exception as e:
        logger.info(
            "Mistral server execution failed or unreachable for '%s' (%s) — using local DAG engine.",
            workflow_name, e,
        )

    # ── Local DAG engine fallback ─────────────────────────────────────────
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow '{workflow_name}' not found locally and Mistral server execution failed.",
        )

    try:
        import uuid as _uuid
        exec_id = request.execution_id or str(_uuid.uuid4())

        from app.services.workflow_engine.models import WorkflowRun, WorkflowStatus as WfSt
        from datetime import datetime, timezone

        stub_run = WorkflowRun(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=WfSt.RUNNING,
            start_time=datetime.now(timezone.utc),
            variables={**(workflow.variables or {}), **(request.input or {})},
        )
        from app.services.workflow_engine.engine import _execution_store
        _execution_store[exec_id] = stub_run

        async def _run_in_background():
            try:
                await execute_workflow(
                    workflow_name=workflow_name,
                    input_vars=request.input or {},
                    execution_id=exec_id,
                )
            except Exception as bg_err:
                logger.error("Background workflow execution failed: %s", bg_err)
                run = _execution_store.get(exec_id)
                if run:
                    run.status = WfSt.FAILED
                    run.result = {"error": str(bg_err)}
                    run.end_time = datetime.now(timezone.utc)

        asyncio.create_task(_run_in_background())

        return WorkflowExecutionResponse(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=WfSt.RUNNING,
            start_time=stub_run.start_time,
            root_execution_id=exec_id,
            source="local",
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
    try:
        client = get_mistral_client()
        execution = await asyncio.to_thread(
            lambda: client.workflows.executions.get_workflow_execution(execution_id=execution_id)
        )
        from app.services.workflow_engine.models import WorkflowStatus
        status_raw = str(execution.status).upper() if hasattr(execution, "status") else "RUNNING"
        try:
            status = WorkflowStatus(status_raw)
        except ValueError:
            status = WorkflowStatus.RUNNING

        run = get_execution(execution_id)

        # Try all known SDK attribute names for the result
        raw_result = None
        for attr_name in ("result", "output", "return_value", "data"):
            val = getattr(execution, attr_name, None)
            if val is not None and val != "" and val != {}:
                raw_result = val
                break

        # Make result JSON-serializable (SDK returns Pydantic models)
        raw_result = _safe_serialize(raw_result)

        # Unwrap nested {'result': X} envelopes (may be multiple layers)
        for _ in range(3):
            if isinstance(raw_result, dict) and list(raw_result.keys()) == ["result"]:
                raw_result = raw_result["result"]
            else:
                break

        return WorkflowExecutionResponse(
            execution_id=getattr(execution, "execution_id", execution_id),
            workflow_name=getattr(execution, "workflow_identifier", None) or getattr(execution, "workflow_name", None) or (run.workflow_name if run else ""),
            status=status,
            start_time=getattr(execution, "start_time", None),
            end_time=getattr(execution, "end_time", None),
            result=raw_result,
            root_execution_id=getattr(execution, "root_execution_id", execution_id),
        )
    except Exception as e:
        logger.debug("Execution not found on Mistral server (%s), falling back to local.", e)

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

    def _normalise_status(raw) -> str:
        """
        Normalise a Mistral SDK status value to a plain uppercase string.
        Handles plain strings ("running"), SDK enums (WorkflowExecutionStatus.running),
        and enum .value attributes so TERMINAL set lookups always work.
        """
        if raw is None:
            return "RUNNING"
        if hasattr(raw, "value"):
            raw = raw.value
        s = str(raw).upper()
        # Strip enum class prefix e.g. "WORKFLOWEXECUTIONSTATUS.RUNNING" → "RUNNING"
        if "." in s:
            s = s.rsplit(".", 1)[-1]
        return s

    async def _generate() -> AsyncGenerator[str, None]:
        for _ in range(360):  # max 6 min of polling
            await asyncio.sleep(1)
            try:
                # ── Try Mistral server FIRST (most executions run server-side) ──
                # Local store only has DAG-engine executions, never server ones.
                try:
                    client = get_mistral_client()
                    execution = await asyncio.to_thread(
                        lambda: client.workflows.executions.get_workflow_execution(
                            execution_id=execution_id
                        )
                    )
                    status_str = _normalise_status(getattr(execution, "status", None))

                    # ── Extract result ──
                    # The SDK exposes the return value under different attr names
                    # depending on version. Try all known names.
                    raw_result = None
                    for attr_name in ("result", "output", "return_value", "data"):
                        val = getattr(execution, attr_name, None)
                        if val is not None and val != "" and val != {}:
                            raw_result = val
                            break

                    # ── Make result JSON-serializable ──
                    # SDK may return Pydantic models, datetime objects, or other
                    # non-serializable types that silently break json.dumps().
                    raw_result = _safe_serialize(raw_result)

                    # Unwrap nested {'result': X} envelopes (may be multiple layers)
                    for _ in range(3):
                        if isinstance(raw_result, dict) and list(raw_result.keys()) == ["result"]:
                            raw_result = raw_result["result"]
                        else:
                            break

                    # Log all execution attributes for debugging
                    if status_str in TERMINAL:
                        logger.info(
                            "Terminal execution attrs: %s",
                            {a: repr(getattr(execution, a, None))[:200]
                             for a in dir(execution) if not a.startswith("_")},
                        )

                    # If result is still empty but terminal, try the query API
                    # to fetch the workflow's in-memory last_result
                    if status_str in TERMINAL and (raw_result is None or raw_result == "" or raw_result == {}):
                        try:
                            query_result = await asyncio.to_thread(
                                lambda: client.workflows.executions.query_workflow_execution(
                                    execution_id=execution_id,
                                    query_type="get_last_result",
                                )
                            )
                            qr = getattr(query_result, "result", None) or getattr(query_result, "data", None)
                            if qr and qr != {} and qr != "":
                                raw_result = _safe_serialize(qr)
                                logger.info("Got result from query API: %.200s", str(qr)[:200])
                        except Exception as q_err:
                            logger.debug("Query API fallback failed (expected for some workflows): %s", q_err)

                    # Final fallback message for truly empty results
                    if status_str in TERMINAL and (raw_result is None or raw_result == "" or raw_result == {}):
                        raw_result = f"Workflow completed with status {status_str} (no output data returned from activities)."

                    logger.debug(
                        "SSE poll — status=%s  result_type=%s  result_preview=%.200s",
                        status_str, type(raw_result).__name__,
                        str(raw_result)[:200] if raw_result else "None",
                    )

                    # ── Try to get step progress via workflow query API ──
                    step_progress = []
                    try:
                        progress_result = await asyncio.to_thread(
                            lambda: client.workflows.executions.query_workflow_execution(
                                execution_id=execution_id,
                                query_type="get_progress",
                            )
                        )
                        pr = getattr(progress_result, "result", None) or getattr(progress_result, "data", None)
                        if isinstance(pr, list):
                            step_progress = [{"step_id": s, "status": "completed"} for s in pr]
                    except Exception:
                        pass  # Query not supported by all workflows

                    data = {
                        "execution_id": execution_id,
                        "workflow_name": getattr(execution, "workflow_identifier", "") or getattr(execution, "workflow_name", ""),
                        "status": status_str,
                        "source": "mistral",
                        "result": raw_result if status_str in TERMINAL else None,
                        "step_results": step_progress,
                        "start_time": str(getattr(execution, "start_time", "") or ""),
                        "end_time":   str(getattr(execution, "end_time",   "") or ""),
                    }
                    yield _sse(data, "execution_update")
                    if status_str in TERMINAL:
                        yield _sse({"execution_id": execution_id, "status": status_str}, "done")
                        return
                    continue
                except Exception as mistral_err:
                    logger.debug("Mistral poll error: %s", mistral_err)

                # ── Fallback: local store for DAG-engine executions ───────────
                run = get_execution(execution_id)
                if run:
                    is_terminal = run.status.value.upper() in TERMINAL
                    slim_steps = [
                        {
                            "step_id": sr.step_id,
                            "status": sr.status,
                            "duration_ms": sr.duration_ms,
                            "error": sr.error,
                            "input_preview": sr.input_preview,
                            "output_preview": sr.output_preview,
                        }
                        for sr in run.step_results
                    ]
                    payload = {
                        "execution_id": run.execution_id,
                        "workflow_name": run.workflow_name,
                        "status": run.status.value,
                        "start_time": run.start_time.isoformat() if run.start_time else None,
                        "end_time": run.end_time.isoformat() if run.end_time else None,
                        "result": run.result if is_terminal else None,
                        "step_results": slim_steps,
                        "source": "local",
                    }
                    yield _sse(payload, "execution_update")
                    if is_terminal:
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

    logger.warning(
        "Signal to Mistral execution %s failed (status=%s)",
        execution_id, resp.status_code if resp else "none",
    )
    return {"sent": False, "execution_id": execution_id, "note": "Signal not delivered — worker may not be connected."}


# ── List executions for workflow ──────────────────────────────────────────────

@router.get("/workflows/{workflow_name}/executions")
async def get_workflow_executions(workflow_name: str):
    """Get all executions for a workflow (merged: Mistral server + local)."""
    results = []

    resp = _mistral_get("/v1/workflows/executions")
    if resp and resp.status_code == 200:
        for ex in resp.json().get("executions", []):
            if ex.get("workflow_name") == workflow_name:
                results.append({
                    "execution_id": ex.get("execution_id", ex.get("id")),
                    "status": ex.get("status"),
                    "start_time": ex.get("start_time"),
                    "end_time": ex.get("end_time"),
                    "duration_ms": ex.get("total_duration_ms"),
                    "source": "mistral",
                })

    local_ids = {r["execution_id"] for r in results}
    for run in list_executions_for_workflow(workflow_name):
        if run.execution_id not in local_ids:
            results.append({
                "execution_id": run.execution_id,
                "status": run.status.value,
                "start_time": run.start_time.isoformat() if run.start_time else None,
                "end_time": run.end_time.isoformat() if run.end_time else None,
                "duration_ms": None,
                "source": "local",
            })

    return {"executions": results}


# ── Register (manual trigger) ─────────────────────────────────────────────────

@router.post("/workflows/{workflow_name}/register")
async def register_workflow_on_mistral(workflow_name: str):
    """
    Compile the workflow to SDK Python, write it to the worker directory,
    AND register/update it on the Mistral server with the correct
    worker_deployment so the server routes executions to our worker.

    The two-step process:
      1. Write workflow_<name>.py to MISTRAL_WORKFLOWS_DIR so the local
         worker picks it up on hot-reload.
      2. POST /v1/workflows on the Mistral server (create or update) with
         worker_deployment=WORKER_DEPLOYMENT so the server knows which
         Temporal task queue to dispatch execution tasks to.
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    # ── Step 1: write compiled file for local worker hot-reload ──────────
    code = compile_workflow_to_python(workflow)
    workflows_dir = os.path.abspath(
        os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
    )
    os.makedirs(workflows_dir, exist_ok=True)
    file_path = os.path.join(workflows_dir, f"workflow_{workflow_name}.py")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(code)
    logger.info("Wrote compiled workflow to %s", file_path)

    # ── Step 2: register on Mistral server with worker_deployment ─────────
    # This is what tells the Mistral server which Temporal task queue to
    # route execution tasks to. Without this the server has no routing info
    # and dispatches to its own default queue, which our worker never polls.
    server_result: dict = {}
    try:
        # Check if already registered so we PATCH instead of POST
        existing_id: str | None = None
        list_resp = _mistral_get("/v1/workflows")
        if list_resp and list_resp.status_code == 200:
            for wf in list_resp.json().get("workflows", []):
                if wf.get("name") == workflow_name:
                    existing_id = wf.get("id")
                    break

        reg_body = {
            "name": workflow_name,
            "worker_deployment": WORKER_DEPLOYMENT,
            # Some API versions use worker_identifier instead
            "worker_identifier": WORKER_DEPLOYMENT,
        }
        if workflow.description:
            reg_body["description"] = workflow.description

        if existing_id:
            # Try PUT first (standard REST update), then PATCH, then
            # DELETE+POST recreate — Mistral API version determines which works.
            action = "updated"
            resp = None
            for method, url, body in [
                ("PUT",   f"/v1/workflows/{existing_id}", reg_body),
                ("PATCH", f"/v1/workflows/{existing_id}", reg_body),
            ]:
                try:
                    fn = httpx.put if method == "PUT" else httpx.patch
                    resp = fn(
                        f"https://api.mistral.ai{url}",
                        headers={**_mistral_headers(), "Content-Type": "application/json"},
                        json=body,
                        timeout=15.0,
                    )
                    if resp.status_code in (200, 201, 204):
                        logger.info("%s /v1/workflows/%s → %d", method, existing_id, resp.status_code)
                        break
                    logger.warning("%s returned %d: %s", method, resp.status_code, resp.text[:100])
                    resp = None
                except Exception as e:
                    logger.warning("%s failed: %s", method, e)
                    resp = None

            if resp is None or resp.status_code not in (200, 201, 204):
                # Last resort: delete and recreate with worker_deployment set
                logger.info("PUT/PATCH failed — trying DELETE + POST recreate")
                try:
                    del_resp = httpx.delete(
                        f"https://api.mistral.ai/v1/workflows/{existing_id}",
                        headers=_mistral_headers(),
                        timeout=15.0,
                    )
                    logger.info("DELETE /v1/workflows/%s → %d", existing_id, del_resp.status_code)
                except Exception as e:
                    logger.warning("DELETE failed: %s", e)
                resp = _mistral_post("/v1/workflows", reg_body)
                action = "recreated"
        else:
            resp = _mistral_post("/v1/workflows", reg_body)
            action = "created"

        if resp and resp.status_code in (200, 201):
            data = resp.json()
            remote_id = data.get("id", existing_id or "")
            server_result = {"server_action": action, "remote_id": remote_id}
            # Update local cache
            workflow.is_deployed = True
            workflow.id = remote_id
            save_workflow(workflow)
            logger.info(
                "Workflow '%s' %s on Mistral server (id=%s, worker_deployment='%s')",
                workflow_name, action, remote_id, WORKER_DEPLOYMENT,
            )
        else:
            status = resp.status_code if resp else "no response"
            body = resp.text[:200] if resp else ""
            logger.warning(
                "Mistral server registration returned %s: %s", status, body
            )
            server_result = {"server_action": "failed", "detail": f"{status}: {body}"}
    except Exception as e:
        logger.warning("Mistral server registration failed: %s", e)
        server_result = {"server_action": "error", "detail": str(e)}

    return {
        "message": "Workflow compiled and registered.",
        "workflow_name": workflow_name,
        "file_path": file_path,
        "worker_deployment": WORKER_DEPLOYMENT,
        **server_result,
    }


# ── Export (legacy — kept for backward compat) ───────────────────────────────

@router.post("/workflows/{workflow_name}/export")
async def export_to_mistral(workflow_name: str):
    """Compile to Mistral Workflows SDK Python code and write to disk (worker auto-reloads)."""
    result = await register_workflow_on_mistral(workflow_name)
    workflow = get_workflow(workflow_name)
    code = compile_workflow_to_python(workflow) if workflow else ""
    return {**result, "code": code}