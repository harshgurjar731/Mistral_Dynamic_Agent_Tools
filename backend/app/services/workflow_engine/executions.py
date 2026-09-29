"""
Execution service — one normalised view over the two places a workflow can run.

A workflow either runs on Mistral (Temporal-backed, reachable through
``client.workflows.executions.*``) or in the local DAG engine when the server is
unreachable or the workflow was never published. The UI should not have to care
which, so every function here tries Mistral first and degrades to the local
in-memory store, tagging the result with ``source``.

The shapes returned mirror the Mistral Workflow Executions API
(https://docs.mistral.ai/api/endpoint/workflows/executions) so the frontend can
be written against one contract:

  execution_id, workflow_name, status, start_time, end_time, result,
  root_execution_id, parent_execution_id, run_id, total_duration_ms

Step-level progress comes from the trace ``EVENT_PROGRESS`` events, which the
Mistral runtime emits per activity with a RUNNING → COMPLETED/FAILED lifecycle.
That is the only server-side source of per-step state; the local engine's
``StepResult`` list is normalised onto the same shape.
"""

from __future__ import annotations

import ast
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from app.config import settings
from app.dependencies import get_mistral_client
from app.services.workflow_engine import engine, execution_logs
from app.services.workflow_engine.models import WorkflowRun

logger = logging.getLogger(__name__)


# ── Status vocabulary ─────────────────────────────────────────────────────────
#
# The full set the Mistral API can report. RETRYING_AFTER_ERROR is a live state
# (the activity failed and Temporal is backing off before another attempt), so
# it is deliberately *not* terminal — the UI keeps streaming through it.

TERMINAL_STATUSES: frozenset[str] = frozenset({
    "COMPLETED", "FAILED", "CANCELLED", "CANCELED",
    "TERMINATED", "TIMED_OUT", "CONTINUED_AS_NEW",
})

ACTIVE_STATUSES: frozenset[str] = frozenset({
    "PENDING", "RUNNING", "RETRYING_AFTER_ERROR",
})


def normalise_status(raw: Any) -> str:
    """Coerce any SDK status representation to a plain uppercase string.

    The SDK has returned plain strings, enum members and ``UnrecognizedStr``
    wrappers across versions, and ``str(enum)`` yields ``"ClassName.MEMBER"``.
    Getting this wrong silently breaks terminal-state detection and leaves the
    stream polling until it times out, so it is centralised here.
    """
    if raw is None:
        return "RUNNING"
    if hasattr(raw, "value"):
        raw = raw.value
    text = str(raw).upper().strip()
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    # The API spells it CANCELED; the local engine model spells it CANCELLED.
    return "CANCELLED" if text == "CANCELED" else text


def is_terminal(status: Any) -> bool:
    return normalise_status(status) in TERMINAL_STATUSES


# ── Serialisation ─────────────────────────────────────────────────────────────

def safe_serialize(obj: Any) -> Any:
    """Recursively convert a value into plain JSON-serialisable Python.

    The SDK hands back Pydantic models, datetimes and — for activity results
    that crossed the Temporal boundary — strings that are really ``repr()``ed
    dicts. All three break ``json.dumps``, so they are normalised here rather
    than at every call site.
    """
    if obj is None:
        return None

    if hasattr(obj, "model_dump"):
        try:
            return safe_serialize(obj.model_dump())
        except Exception:
            pass
    if hasattr(obj, "dict") and callable(obj.dict) and not isinstance(obj, dict):
        try:
            return safe_serialize(obj.dict())
        except Exception:
            pass

    if hasattr(obj, "isoformat"):
        return obj.isoformat()

    if isinstance(obj, dict):
        return {str(k): safe_serialize(v) for k, v in obj.items()}

    if isinstance(obj, (list, tuple)):
        return [safe_serialize(item) for item in obj]

    if isinstance(obj, (str, int, float, bool)):
        if isinstance(obj, str) and obj.strip().startswith("{"):
            try:
                return safe_serialize(json.loads(obj))
            except (json.JSONDecodeError, ValueError):
                try:
                    parsed = ast.literal_eval(obj)
                    if isinstance(parsed, (dict, list)):
                        return safe_serialize(parsed)
                except (ValueError, SyntaxError):
                    pass
        return obj

    try:
        return str(obj)
    except Exception:
        return repr(obj)


def unwrap_result(value: Any, depth: int = 3) -> Any:
    """Peel ``{"result": X}`` envelopes the runtime wraps return values in."""
    for _ in range(depth):
        if isinstance(value, dict) and list(value.keys()) == ["result"]:
            value = value["result"]
        else:
            break
    return value


def _extract_result(execution: Any) -> Any:
    """Pull the return value off an SDK execution object.

    Which attribute holds it has moved between SDK versions, so all the known
    names are tried in order of preference.
    """
    for attr in ("result", "output", "return_value", "data"):
        value = getattr(execution, attr, None)
        if value is not None and value != "" and value != {}:
            return unwrap_result(safe_serialize(value))
    return None


def _iso(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


# ── Normalised shapes ─────────────────────────────────────────────────────────

class ExecutionStep(BaseModel):
    """One unit of per-step progress, from either runtime.

    ``id`` is the trace event id server-side and the step id locally; it is what
    the UI keys the timeline on, so it must be stable across polls.
    """
    id: str
    name: str
    status: str = "RUNNING"          # RUNNING | COMPLETED | FAILED
    start_time_ms: Optional[int] = None
    end_time_ms: Optional[int] = None
    duration_ms: Optional[float] = None
    error: Optional[str] = None
    internal: bool = False
    attributes: dict = Field(default_factory=dict)
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None
    parallel_group: Optional[str] = None


class ExecutionDetail(BaseModel):
    """The Mistral execution object, plus what the UI needs on top of it."""
    execution_id: str
    workflow_name: str = ""
    status: str = "RUNNING"
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    result: Any = None
    error: Optional[str] = None
    root_execution_id: Optional[str] = None
    parent_execution_id: Optional[str] = None
    run_id: Optional[str] = None
    user_id: Optional[str] = None
    deployment_name: Optional[str] = None
    total_duration_ms: Optional[float] = None
    source: str = "mistral"          # "mistral" | "local"
    steps: list[ExecutionStep] = Field(default_factory=list)


# ── Attribute helpers ─────────────────────────────────────────────────────────

_INPUT_KEYS = ("input", "query", "arguments", "request", "prompt", "args")
_OUTPUT_KEYS = ("output", "result", "response", "return_value", "content")

_PREVIEW_LIMIT = 4000


def _flatten_attributes(raw: Any) -> dict:
    """Trace attribute values arrive wrapped in a typed union — unwrap them.

    Each value is a ``{string_value|int_value|bool_value|…: v}`` container. The
    UI only ever wants the scalar, so single-key wrappers are collapsed.
    """
    attrs = safe_serialize(raw)
    if not isinstance(attrs, dict):
        return {}

    flat: dict = {}
    for key, value in attrs.items():
        if isinstance(value, dict) and len(value) == 1:
            inner_key, inner = next(iter(value.items()))
            if inner_key.endswith("_value") or inner_key == "value":
                value = inner
        flat[key] = value
    return flat


def _preview(attrs: dict, keys: tuple[str, ...]) -> Optional[str]:
    """First attribute matching one of ``keys``, rendered as bounded text."""
    for key in keys:
        for attr_key, value in attrs.items():
            if attr_key == key or attr_key.endswith(f".{key}"):
                if value in (None, "", {}, []):
                    continue
                text = value if isinstance(value, str) else json.dumps(value, indent=2, default=str)
                return text[:_PREVIEW_LIMIT] + ("…" if len(text) > _PREVIEW_LIMIT else "")
    return None


def _step_from_progress_event(event: Any) -> ExecutionStep:
    """Map an ``EVENT_PROGRESS`` trace event onto the normalised step shape."""
    attrs = _flatten_attributes(getattr(event, "attributes", None))
    start_ms = getattr(event, "start_time_unix_ms", None)
    end_ms = getattr(event, "end_time_unix_ms", None)

    duration_ms: Optional[float] = None
    if start_ms and end_ms:
        duration_ms = float(end_ms - start_ms)

    return ExecutionStep(
        id=str(getattr(event, "id", "") or getattr(event, "name", "")),
        name=str(getattr(event, "name", "") or "step"),
        status=normalise_status(getattr(event, "status", "RUNNING")),
        start_time_ms=start_ms,
        end_time_ms=end_ms,
        duration_ms=duration_ms,
        error=getattr(event, "error", None),
        internal=bool(getattr(event, "internal", False) or False),
        attributes=attrs,
        input_preview=_preview(attrs, _INPUT_KEYS),
        output_preview=_preview(attrs, _OUTPUT_KEYS),
        parallel_group=attrs.get("parallel_group") or attrs.get("group"),
    )


_LOCAL_STEP_STATUS = {"failed": "FAILED", "running": "RUNNING"}


def _steps_from_local_run(run: WorkflowRun) -> list[ExecutionStep]:
    """Normalise the local engine's ``StepResult`` list onto ``ExecutionStep``.

    The engine publishes a ``running`` row when a step starts and overwrites it
    on completion, so this maps the same three-state lifecycle the server-side
    progress events use.
    """
    steps: list[ExecutionStep] = []
    for index, result in enumerate(run.step_results):
        start_ms = int(result.started_at_ms) if result.started_at_ms else None
        end_ms = (
            int(result.started_at_ms + result.duration_ms)
            if result.started_at_ms and result.duration_ms
            else None
        )
        steps.append(ExecutionStep(
            id=f"{result.step_id}:{index}",
            name=result.step_id,
            status=_LOCAL_STEP_STATUS.get(result.status, "COMPLETED"),
            start_time_ms=start_ms,
            end_time_ms=end_ms,
            duration_ms=result.duration_ms,
            error=result.error,
            input_preview=result.input_preview,
            output_preview=result.output_preview,
        ))
    return steps


def _detail_from_local_run(run: WorkflowRun) -> ExecutionDetail:
    status = normalise_status(run.status)
    total_ms: Optional[float] = None
    if run.start_time:
        end = run.end_time or datetime.now(timezone.utc)
        total_ms = (end - run.start_time).total_seconds() * 1000

    error: Optional[str] = None
    if isinstance(run.result, dict) and run.result.get("error"):
        error = str(run.result["error"])

    return ExecutionDetail(
        execution_id=run.execution_id,
        workflow_name=run.workflow_name,
        status=status,
        start_time=_iso(run.start_time),
        end_time=_iso(run.end_time),
        result=safe_serialize(run.result) if status in TERMINAL_STATUSES else None,
        error=error,
        root_execution_id=run.execution_id,
        total_duration_ms=total_ms,
        source="local",
        steps=_steps_from_local_run(run),
    )


# ── Raw HTTP fallback ─────────────────────────────────────────────────────────
#
# A few documented endpoints (trace/info, logs, logs/stream) have no SDK method
# in the pinned client, so they are proxied directly. Everything else goes
# through the SDK, which handles auth, retries and response parsing.

_API_ROOT = "https://api.mistral.ai"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"}


async def _raw_get(path: str, params: dict | None = None, timeout: float = 20.0) -> Any:
    async with httpx.AsyncClient(timeout=timeout) as http:
        resp = await http.get(f"{_API_ROOT}{path}", headers=_headers(), params=params)
        resp.raise_for_status()
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}


# ── Reads ─────────────────────────────────────────────────────────────────────

async def _mistral_execution(execution_id: str) -> Optional[ExecutionDetail]:
    """Fetch the execution object from Mistral, or None when it is not there."""
    client = get_mistral_client()
    execution = await client.workflows.executions.get_workflow_execution_async(
        execution_id=execution_id
    )

    status = normalise_status(getattr(execution, "status", None))
    return ExecutionDetail(
        execution_id=getattr(execution, "execution_id", None) or execution_id,
        workflow_name=(
            getattr(execution, "workflow_name", None)
            or getattr(execution, "workflow_identifier", None)
            or ""
        ),
        status=status,
        start_time=_iso(getattr(execution, "start_time", None)),
        end_time=_iso(getattr(execution, "end_time", None)),
        result=_extract_result(execution),
        root_execution_id=getattr(execution, "root_execution_id", None) or execution_id,
        parent_execution_id=getattr(execution, "parent_execution_id", None),
        run_id=getattr(execution, "run_id", None),
        user_id=getattr(execution, "user_id", None),
        deployment_name=getattr(execution, "deployment_name", None),
        total_duration_ms=getattr(execution, "total_duration_ms", None),
        source="mistral",
    )


async def fetch_progress_steps(
    execution_id: str,
    include_internal: bool = False,
) -> list[ExecutionStep]:
    """Per-step progress from the execution's trace events.

    Only ``EVENT_PROGRESS`` events carry a step lifecycle; plain ``EVENT``
    entries are point-in-time markers and would render as zero-length steps.
    Failures are swallowed — tracing is observability, and losing it must not
    take the status stream down with it.
    """
    try:
        client = get_mistral_client()
        response = await client.workflows.executions.get_workflow_execution_trace_events_async(
            execution_id=execution_id,
            merge_same_id_events=True,
            include_internal_events=include_internal,
        )
    except Exception as e:
        logger.debug("Trace events unavailable for %s: %s", execution_id, e)
        return []

    steps: list[ExecutionStep] = []
    for event in getattr(response, "events", None) or []:
        if normalise_status(getattr(event, "type", "")) != "EVENT_PROGRESS":
            continue
        try:
            steps.append(_step_from_progress_event(event))
        except Exception as e:
            logger.debug("Skipping malformed progress event: %s", e)

    steps.sort(key=lambda s: (s.start_time_ms or 0, s.name))
    return steps


async def fetch_execution(
    execution_id: str,
    with_steps: bool = True,
) -> Optional[ExecutionDetail]:
    """Full execution detail from whichever runtime owns it.

    Mistral is tried first because server-side executions are the common case
    and the local store only ever holds DAG-engine runs.
    """
    detail: Optional[ExecutionDetail] = None
    try:
        detail = await _mistral_execution(execution_id)
    except Exception as e:
        logger.debug("Execution %s not on Mistral (%s) — trying local store.", execution_id, e)

    if detail is None:
        run = engine.get_execution(execution_id)
        return _detail_from_local_run(run) if run else None

    if with_steps:
        detail.steps = await fetch_progress_steps(execution_id)

    # A server-side execution that finished without a return value still needs
    # *something* to render. The workflow's own query handler is the last place
    # the value can be, so it is worth one extra call — but only once, at the
    # end, not on every poll.
    if detail.result in (None, "", {}) and detail.status == "COMPLETED":
        detail.result = await _query_last_result(execution_id)

    if detail.status in ("FAILED", "TIMED_OUT") and not detail.error:
        failed = [s for s in detail.steps if s.status == "FAILED" and s.error]
        if failed:
            detail.error = failed[-1].error

    return detail


async def _query_last_result(execution_id: str) -> Any:
    """Ask the workflow for its last result via the query API. Best effort."""
    client = get_mistral_client()
    for query_name in ("get_last_result", "get_result"):
        try:
            response = await client.workflows.executions.query_workflow_execution_async(
                execution_id=execution_id, name=query_name,
            )
        except Exception:
            continue
        value = getattr(response, "result", None) or getattr(response, "data", None)
        if value not in (None, "", {}):
            return unwrap_result(safe_serialize(value))
    return None


async def fetch_history(execution_id: str, decode_payloads: bool = True) -> Any:
    """Raw Temporal event history — the ground truth for a reset target."""
    client = get_mistral_client()
    response = await client.workflows.executions.get_workflow_execution_history_async(
        execution_id=execution_id, decode_payloads=decode_payloads,
    )
    return safe_serialize(response)


async def fetch_trace_summary(execution_id: str) -> Any:
    """Hierarchical span tree — parent/child activity spans with durations."""
    client = get_mistral_client()
    response = await client.workflows.executions.get_workflow_execution_trace_summary_async(
        execution_id=execution_id
    )
    return safe_serialize(response)


async def fetch_trace_events(
    execution_id: str,
    merge_same_id_events: bool = True,
    include_internal_events: bool = False,
) -> Any:
    client = get_mistral_client()
    response = await client.workflows.executions.get_workflow_execution_trace_events_async(
        execution_id=execution_id,
        merge_same_id_events=merge_same_id_events,
        include_internal_events=include_internal_events,
    )
    return safe_serialize(response)


async def fetch_trace_otel(execution_id: str) -> Any:
    client = get_mistral_client()
    response = await client.workflows.executions.get_workflow_execution_trace_otel_async(
        execution_id=execution_id
    )
    return safe_serialize(response)


async def fetch_trace_info(execution_id: str) -> Any:
    """Whether trace data exists for this execution (no SDK method — proxied)."""
    return await _raw_get(f"/v1/workflows/executions/{execution_id}/trace/info")


async def fetch_logs(execution_id: str, limit: int = 500, since: int = 0) -> dict:
    """Execution logs, from the local capture buffer and the platform.

    Locally-run workflows have no platform logs at all — the engine's own
    narration is the only record of what happened, and it is what the console
    tails. The platform endpoint is still consulted for server-side runs, but
    its absence is normal rather than an error.
    """
    local = execution_logs.get(execution_id, since=since, limit=limit)

    remote: list = []
    try:
        payload = await _raw_get(
            f"/v1/workflows/executions/{execution_id}/logs", params={"limit": limit}
        )
        if isinstance(payload, dict):
            remote = payload.get("logs") or payload.get("data") or []
        elif isinstance(payload, list):
            remote = payload
    except Exception as e:
        logger.debug("Platform logs unavailable for %s: %s", execution_id, e)

    return {
        "execution_id": execution_id,
        "logs": local,
        "platform_logs": remote,
        "next_seq": execution_logs.next_seq(execution_id),
        "source": "local" if local else ("mistral" if remote else "none"),
    }


async def list_runs(
    workflow_identifier: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    user_id: Optional[str] = None,
    page_size: int = 50,
    next_page_token: Optional[str] = None,
) -> dict:
    """List executions across workflows, merged with local DAG-engine runs.

    Local runs are appended (never interleaved by token) because they have no
    cursor to page through — they are an in-memory tail that only exists while
    the process lives.
    """
    items: list[dict] = []
    token: Optional[str] = None
    remote_ok = False

    try:
        client = get_mistral_client()
        kwargs: dict[str, Any] = {"page_size": page_size}
        if workflow_identifier:
            kwargs["workflow_identifier"] = workflow_identifier
        if status:
            kwargs["status"] = normalise_status(status)
        if search:
            kwargs["search"] = search
        if user_id:
            kwargs["user_id"] = user_id
        if next_page_token:
            kwargs["next_page_token"] = next_page_token

        response = await client.workflows.runs.list_runs_async(**kwargs)
        payload = safe_serialize(response) or {}
        # The SDK wraps paginated responses in a `{result, next}` envelope — the
        # execution list is one level down. Unwrapping it is what makes the
        # difference between a populated dashboard and an empty one.
        if isinstance(payload.get("result"), dict):
            payload = payload["result"]
        raw_items = (
            payload.get("runs")
            or payload.get("executions")
            or payload.get("data")
            or payload.get("items")
            or []
        )
        token = payload.get("next_page_token")
        remote_ok = True

        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            items.append({
                "execution_id": raw.get("execution_id") or raw.get("id") or raw.get("run_id"),
                "workflow_name": raw.get("workflow_name") or raw.get("workflow_identifier") or "",
                "status": normalise_status(raw.get("status")),
                "start_time": raw.get("start_time"),
                "end_time": raw.get("end_time"),
                "total_duration_ms": raw.get("total_duration_ms"),
                "run_id": raw.get("run_id"),
                "root_execution_id": raw.get("root_execution_id"),
                "parent_execution_id": raw.get("parent_execution_id"),
                "user_id": raw.get("user_id"),
                "source": "mistral",
            })
    except Exception as e:
        logger.info("Could not list runs from Mistral (%s) — local runs only.", e)

    # Only page 1 gets the local tail appended; on later pages it would repeat.
    if not next_page_token:
        seen = {item["execution_id"] for item in items}
        local_runs = (
            engine.list_executions_for_workflow(workflow_identifier)
            if workflow_identifier else engine.list_executions()
        )
        for run in local_runs:
            if run.execution_id in seen:
                continue
            detail = _detail_from_local_run(run)
            if status and detail.status != normalise_status(status):
                continue
            if search and search.lower() not in f"{run.workflow_name} {run.execution_id}".lower():
                continue
            items.append({
                "execution_id": detail.execution_id,
                "workflow_name": detail.workflow_name,
                "status": detail.status,
                "start_time": detail.start_time,
                "end_time": detail.end_time,
                "total_duration_ms": detail.total_duration_ms,
                "run_id": None,
                "root_execution_id": detail.root_execution_id,
                "parent_execution_id": None,
                "user_id": None,
                "source": "local",
            })

    items.sort(key=lambda i: i.get("start_time") or "", reverse=True)
    return {
        "executions": items,
        "next_page_token": token,
        "count": len(items),
        "remote_available": remote_ok,
    }


def _metric_value(raw: Any) -> Any:
    """Unwrap the ``{"value": …}`` container each metric is returned in."""
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


async def workflow_metrics(
    workflow_name: str,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> dict:
    """Aggregate metrics for a workflow: counts, latency series, retry rate.

    The API wraps every metric in a typed container; they are unwrapped to bare
    scalars here so the UI can render a number without knowing the envelope.
    """
    client = get_mistral_client()
    kwargs: dict[str, Any] = {"workflow_name": workflow_name}
    if start_time:
        kwargs["start_time"] = start_time
    if end_time:
        kwargs["end_time"] = end_time

    response = safe_serialize(
        await client.workflows.metrics.get_workflow_metrics_async(**kwargs)
    ) or {}

    return {
        "execution_count": _metric_value(response.get("execution_count")),
        "success_count": _metric_value(response.get("success_count")),
        "error_count": _metric_value(response.get("error_count")),
        "average_latency_ms": _metric_value(response.get("average_latency_ms")),
        "latency_over_time": _metric_value(response.get("latency_over_time")),
        "retry_rate": _metric_value(response.get("retry_rate")),
        "available": True,
    }


# ── Control operations ────────────────────────────────────────────────────────

async def send_signal(execution_id: str, name: str, payload: dict | None = None) -> dict:
    """Deliver a signal to a running execution.

    The API takes ``name`` / ``input``. Sending ``signal_name`` / ``payload``
    instead — as this service used to — is accepted at the HTTP layer but the
    signal never reaches the workflow handler, which is why in-flight user
    messages silently vanished.
    """
    try:
        client = get_mistral_client()
        response = await client.workflows.executions.signal_workflow_execution_async(
            execution_id=execution_id, name=name, input=payload or {},
        )
        return {"delivered": True, "execution_id": execution_id, "signal": name,
                "response": safe_serialize(response)}
    except Exception as e:
        logger.warning("Signal '%s' to %s failed: %s", name, execution_id, e)
        return {"delivered": False, "execution_id": execution_id, "signal": name,
                "detail": str(e)}


async def send_query(execution_id: str, name: str, payload: dict | None = None) -> dict:
    """Read state out of a running execution via one of its query handlers."""
    client = get_mistral_client()
    response = await client.workflows.executions.query_workflow_execution_async(
        execution_id=execution_id, name=name, input=payload or {},
    )
    value = getattr(response, "result", None)
    if value is None:
        value = getattr(response, "data", None)
    return {"execution_id": execution_id, "query": name,
            "result": unwrap_result(safe_serialize(value))}


async def send_update(execution_id: str, name: str, payload: dict | None = None) -> dict:
    """Send an update — a signal that returns a value once handled."""
    client = get_mistral_client()
    response = await client.workflows.executions.update_workflow_execution_async(
        execution_id=execution_id, name=name, input=payload or {},
    )
    value = getattr(response, "result", None)
    if value is None:
        value = getattr(response, "data", None)
    return {"execution_id": execution_id, "update": name,
            "result": unwrap_result(safe_serialize(value))}


async def _stop(execution_id: str, terminate_it: bool) -> dict:
    action = "terminate" if terminate_it else "cancel"

    run = engine.get_execution(execution_id)
    if run:
        accepted = engine.request_stop(execution_id, terminate=terminate_it)
        return {
            "execution_id": execution_id, "action": action, "source": "local",
            "accepted": accepted,
            # A run that already settled cannot be stopped; saying so beats a
            # silent no-op that leaves the UI showing a pending action.
            "detail": None if accepted else f"Execution already {normalise_status(run.status).lower()}.",
        }

    client = get_mistral_client()
    if terminate_it:
        await client.workflows.executions.terminate_workflow_execution_async(execution_id=execution_id)
    else:
        await client.workflows.executions.cancel_workflow_execution_async(execution_id=execution_id)
    return {"execution_id": execution_id, "action": action, "source": "mistral", "accepted": True}


async def cancel(execution_id: str) -> dict:
    """Graceful cancel — the workflow gets to run its cleanup handlers."""
    return await _stop(execution_id, terminate_it=False)


async def terminate(execution_id: str) -> dict:
    """Hard stop — no cleanup, the execution is killed where it stands."""
    return await _stop(execution_id, terminate_it=True)


async def reset(
    execution_id: str,
    event_id: int,
    reason: Optional[str] = None,
    exclude_signals: bool = False,
    exclude_updates: bool = False,
) -> dict:
    """Rewind the execution to a prior history event and replay from there."""
    client = get_mistral_client()
    response = await client.workflows.executions.reset_workflow_async(
        execution_id=execution_id,
        event_id=event_id,
        reason=reason,
        exclude_signals=exclude_signals,
        exclude_updates=exclude_updates,
    )
    return {"execution_id": execution_id, "action": "reset", "event_id": event_id,
            "response": safe_serialize(response)}


async def batch_cancel(execution_ids: list[str]) -> dict:
    local = [i for i in execution_ids if engine.get_execution(i)]
    remote = [i for i in execution_ids if i not in local]

    for execution_id in local:
        engine.request_stop(execution_id, terminate=False)

    response: Any = None
    if remote:
        client = get_mistral_client()
        response = await client.workflows.executions.batch_cancel_workflow_executions_async(
            execution_ids=remote
        )
    return {"action": "cancel", "local": local, "remote": remote,
            "response": safe_serialize(response)}


async def batch_terminate(execution_ids: list[str]) -> dict:
    local = [i for i in execution_ids if engine.get_execution(i)]
    remote = [i for i in execution_ids if i not in local]

    for execution_id in local:
        engine.request_stop(execution_id, terminate=True)

    response: Any = None
    if remote:
        client = get_mistral_client()
        response = await client.workflows.executions.batch_terminate_workflow_executions_async(
            execution_ids=remote
        )
    return {"action": "terminate", "local": local, "remote": remote,
            "response": safe_serialize(response)}


# ── Live stream ───────────────────────────────────────────────────────────────
#
# Two independent sources feed the UI:
#
#   1. Status + step progress, polled. There is no push channel for these — the
#      execution object and its trace events are pull-only.
#   2. Custom workflow events, pushed. A workflow can publish to its own stream;
#      those arrive over the SDK's SSE channel and are forwarded verbatim.
#
# They run concurrently onto one queue so a chatty workflow stream cannot delay
# a status transition, and a stalled status poll cannot swallow stream events.

_POLL_FAST_SECONDS = 1.0
_POLL_SLOW_SECONDS = 3.0
_FAST_POLL_WINDOW = 30          # polls before backing off
_MAX_STREAM_SECONDS = 3600.0
# Logs are tailed faster than status: they are the only thing that moves during
# a long agent call, and reading them is a cheap in-memory slice.
_LOG_POLL_SECONDS = 0.5


async def _pump_workflow_stream(execution_id: str, queue: asyncio.Queue) -> None:
    """Forward the workflow's own published events onto the queue.

    Reconnects on drop using ``last_event_id`` so a transient disconnect does
    not lose events. Gives up quietly if the workflow publishes no stream at
    all — most do not, and that is not an error.
    """
    last_event_id: Optional[str] = None
    failures = 0

    while failures < 3:
        try:
            client = get_mistral_client()
            stream = await client.workflows.executions.stream_async(
                execution_id=execution_id,
                event_source="HYBRID",       # replay from DB, then follow live
                last_event_id=last_event_id,
            )
            async with stream as events:
                async for event in events:
                    if getattr(event, "id", None):
                        last_event_id = event.id
                    payload = safe_serialize(getattr(event, "data", None))
                    name = getattr(event, "event", None)
                    # The channel emits empty frames as keepalives. Forwarding
                    # them would put blank rows in the event log.
                    if payload is None and not name:
                        continue
                    await queue.put(("workflow_event", {
                        "id": getattr(event, "id", None),
                        "event": name,
                        "data": payload,
                    }))
            return
        except asyncio.CancelledError:
            raise
        except Exception as e:
            failures += 1
            logger.debug("Workflow event stream for %s dropped (%d): %s",
                         execution_id, failures, e)
            await asyncio.sleep(1.5 * failures)


async def _pump_logs(execution_id: str, queue: asyncio.Queue) -> None:
    """Tail the execution's captured log lines onto the queue.

    Polls by sequence number rather than waiting on an event, because records
    are written from the worker threads the step runners offload to and asyncio
    primitives are not safe to signal from there.
    """
    cursor = 0
    while True:
        try:
            new_records = execution_logs.get(execution_id, since=cursor)
            if new_records:
                cursor = new_records[-1]["seq"] + 1
                await queue.put(("log", {
                    "execution_id": execution_id,
                    "lines": new_records,
                    "next_seq": cursor,
                }))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("Log pump for %s hiccuped: %s", execution_id, e)
        await asyncio.sleep(_LOG_POLL_SECONDS)


async def _pump_status(execution_id: str, queue: asyncio.Queue) -> None:
    """Poll execution status + step progress until the execution is terminal."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + _MAX_STREAM_SECONDS
    polls = 0
    misses = 0
    last_signature: Optional[str] = None

    while loop.time() < deadline:
        detail = await fetch_execution(execution_id)

        if detail is None:
            # A freshly started execution can 404 briefly while the server
            # registers it, so a few misses are tolerated before giving up.
            misses += 1
            if misses > 10:
                await queue.put(("error", {
                    "execution_id": execution_id,
                    "detail": "Execution not found on Mistral or in the local engine.",
                }))
                await queue.put(("done", {"execution_id": execution_id, "status": "FAILED"}))
                return
        else:
            misses = 0
            payload = detail.model_dump()
            # Only push when something actually changed — an idle workflow
            # would otherwise emit an identical frame every second and make
            # the client re-render for nothing. Elapsed time is excluded from
            # the comparison because it advances on every poll by definition;
            # the client ticks its own clock off `start_time`.
            signature = json.dumps(
                {k: v for k, v in payload.items() if k != "total_duration_ms"},
                sort_keys=True, default=str,
            )
            if signature != last_signature:
                last_signature = signature
                await queue.put(("execution_update", payload))

            if detail.status in TERMINAL_STATUSES:
                await queue.put(("done", {
                    "execution_id": execution_id,
                    "status": detail.status,
                    "total_duration_ms": detail.total_duration_ms,
                }))
                return

        polls += 1
        await asyncio.sleep(
            _POLL_FAST_SECONDS if polls < _FAST_POLL_WINDOW else _POLL_SLOW_SECONDS
        )

    await queue.put(("done", {"execution_id": execution_id, "status": "TIMED_OUT"}))


async def stream_execution(execution_id: str):
    """Yield ``(event_name, payload)`` pairs for the life of an execution.

    Terminates when the status pump reports a terminal state; the workflow
    event pump is cancelled at that point whether or not it has finished.
    """
    queue: asyncio.Queue = asyncio.Queue()

    status_task = asyncio.create_task(_pump_status(execution_id, queue))
    stream_task = asyncio.create_task(_pump_workflow_stream(execution_id, queue))
    log_task = asyncio.create_task(_pump_logs(execution_id, queue))
    tasks = (status_task, stream_task, log_task)

    try:
        while True:
            try:
                event_name, payload = await asyncio.wait_for(queue.get(), timeout=20.0)
            except asyncio.TimeoutError:
                # Keep intermediaries from closing an idle connection.
                yield ("ping", {"execution_id": execution_id})
                if status_task.done():
                    return
                continue

            if event_name == "done":
                # Flush the log tail before closing. The lines written in the
                # same tick as the terminal status — "workflow completed", the
                # final step's output — would otherwise be cut off.
                await asyncio.sleep(_LOG_POLL_SECONDS)
                while not queue.empty():
                    tail_name, tail_payload = queue.get_nowait()
                    if tail_name == "log":
                        yield (tail_name, tail_payload)
                yield (event_name, payload)
                return

            yield (event_name, payload)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
