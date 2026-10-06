"""
Observability routes — the Logs page's window onto traces stored on Mistral.

Nothing here is stored locally: every read goes to Mistral's observability API
(``/v1/observability/traces`` and ``/spans``), filtered to this service. What
the page shows is exactly what was exported.

The reads use a client of their own that is *not* bound to the tracer, so
browsing the logs never produces more of them.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.observability import tracing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/observability", tags=["Observability"])

_reader = None

#: Root span name prefix → the kind of action a trace records.
_ROOT_KINDS = {
    "workflow": "workflow ",
    "run": "run ",
    "pipeline": "pipeline ",
}
_HTTP_METHODS = ("POST ", "PUT ", "PATCH ", "DELETE ")
#: Root names the Mistral SDK gives its own spans (``chat <model>`` …).
_LLM_PREFIXES = ("chat ", "embeddings ", "invoke_agent", "create_agent", "text_completion", "ocr")
_MAX_SPANS = 2000  # Mistral serves at most 100 spans a page


def _client():
    global _reader
    if _reader is None:
        from mistralai.client import Mistral

        # Deliberately never passed to instrument_client().
        _reader = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=60000)
    return _reader


def _api():
    return _client().beta.observability


def _quote(value: str) -> str:
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def _ms(ns: Any) -> Optional[float]:
    try:
        return round(int(ns) / 1_000_000, 2)
    except (TypeError, ValueError):
        return None


def _kind_of_root(name: str) -> str:
    for kind, prefix in _ROOT_KINDS.items():
        if name.startswith(prefix):
            return kind
    if name.startswith(_HTTP_METHODS):
        return "http"
    if name.startswith(_LLM_PREFIXES):
        # A model call made outside any action — a startup or background task.
        return "llm"
    return "other"


def _console_link(trace_id: str) -> str:
    return f"{settings.OBSERVABILITY_CONSOLE_URL.rstrip('/')}?trace_id={trace_id}"


def _upstream_error(e: Exception) -> HTTPException:
    status = getattr(e, "status_code", None)
    if status == 404:
        return HTTPException(
            status_code=404,
            detail="Not on Mistral yet — traces arrive a few seconds after the action finishes.",
        )
    logger.warning("Mistral observability request failed: %s", e)
    return HTTPException(status_code=502, detail=f"Mistral observability API: {str(e)[:500]}")


# ── Normalisation ─────────────────────────────────────────────────────────────

def _trace_row(t: Any) -> dict:
    name = t.root_span_name or ""
    return {
        "trace_id": t.trace_id,
        "name": name,
        "kind": _kind_of_root(name),
        "workflow_name": t.workflow_name or None,
        "conversation_id": t.conversation_id or None,
        "agent_name": t.agent_name or None,
        "agent_id": t.agent_id or None,
        "service_name": t.service_name,
        "environment": t.environment or None,
        "start_time": _iso(t.start_time),
        "end_time": _iso(t.end_time),
        "duration_ms": _ms(t.duration_ns),
        "status_code": t.status_code,
        "error_count": t.error_count,
        "span_count": t.span_count,
        "llm_call_count": t.llm_call_count,
        "tool_call_count": t.tool_call_count,
        "retrieval_count": t.retrieval_count,
        "input_tokens": t.input_tokens,
        "output_tokens": t.output_tokens,
        "models_used": list(t.models_used or []),
        "tools_used": list(t.tools_used or []),
        "first_input": t.first_turn_last_input_message or None,
        "last_output": t.last_turn_last_output_message or None,
        "console_url": _console_link(t.trace_id),
    }


def _span_kind(s: Any, attrs: dict) -> str:
    kind = attrs.get("app.kind")
    if kind:
        return str(kind)
    op = (s.operation_name or "").lower()
    if op == "execute_tool" or s.tool_name:
        return "tool"
    if op == "evaluate":
        return "rule"
    if op in ("chat", "text_completion", "generate_content", "embeddings") or s.request_model:
        return "llm"
    if op in ("invoke_agent", "create_agent") or s.agent_id:
        return "agent"
    if op:
        return op
    return "other"


def _parent_id(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value)
    if not text.strip("\x00") or set(text) <= {"0"}:
        return None
    return text


def _span_row(s: Any) -> dict:
    attrs = dict(s.span_attributes or {})
    return {
        "span_id": s.span_id,
        "parent_span_id": _parent_id(s.parent_span_id),
        "name": s.span_name,
        "kind": _span_kind(s, attrs),
        "span_kind": s.span_kind,
        "start_time": _iso(s.start_time),
        "end_time": _iso(s.end_time),
        "duration_ms": _ms(s.duration_ns),
        "status_code": s.status_code,
        "status_message": s.status_message or None,
        "error_type": s.error_type or None,
        "service_name": s.service_name,
        "operation_name": s.operation_name or None,
        "model": s.response_model or s.request_model or None,
        "provider": s.provider_name or None,
        "agent_id": s.agent_id or None,
        "agent_name": s.agent_name or None,
        "conversation_id": s.conversation_id or None,
        "workflow_name": s.workflow_name or None,
        "tool_name": s.tool_name or None,
        "tool_call_arguments": s.tool_call_arguments or None,
        "tool_call_result": s.tool_call_result or None,
        "input_messages": s.input_messages or None,
        "output_messages": s.output_messages or None,
        "system_instructions": s.system_instructions or None,
        "usage": {
            "input_tokens": s.usage_input_tokens,
            "output_tokens": s.usage_output_tokens,
            "cache_read_input_tokens": s.usage_cache_read_input_tokens,
        },
        "finish_reasons": list(s.response_finish_reasons or []),
        "temperature": s.request_temperature,
        "attributes": attrs,
        "resource": dict(s.resource_attributes or {}),
        "scope": s.scope_name or None,
    }


def _rule_row(span: dict, trace_id: Optional[str] = None) -> dict:
    a = span["attributes"]
    return {
        "trace_id": trace_id,
        "span_id": span["span_id"],
        "parent_span_id": span["parent_span_id"],
        "time": span["start_time"],
        "rule_id": a.get("app.rule.id"),
        "rule_name": a.get("app.rule.name") or a.get("gen_ai.evaluation.name") or span["name"],
        "verdict": a.get("app.rule.verdict") or a.get("gen_ai.evaluation.score.label"),
        "outcome": a.get("app.rule.outcome"),
        "checkpoint": a.get("app.rule.checkpoint"),
        "message": a.get("app.rule.message") or a.get("gen_ai.evaluation.explanation"),
        "detail": a.get("app.rule.detail"),
        "scope": a.get("app.rule.scope"),
        "subject_id": a.get("app.rule.subject_id"),
        "execution_id": a.get("app.execution.id"),
        "step_id": a.get("app.step.id"),
        "workflow_name": span.get("workflow_name") or a.get("gen_ai.workflow.name"),
        "conversation_id": a.get("gen_ai.conversation.id"),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def status():
    """Whether tracing is on, and where the traces go."""
    return {
        "enabled": tracing.enabled(),
        "service_name": settings.OBSERVABILITY_SERVICE_NAME,
        "environment": settings.OBSERVABILITY_ENVIRONMENT,
        "redaction": settings.OBSERVABILITY_REDACT,
        "endpoint": tracing._endpoint(),
        "console_url": settings.OBSERVABILITY_CONSOLE_URL,
    }


def _window(hours: float) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    return now - timedelta(hours=hours), now + timedelta(minutes=5)


@router.get("/traces")
async def list_traces(
    kind: Optional[str] = Query(None, description="workflow | run | pipeline | http | llm"),
    workflow: Optional[str] = None,
    status: Optional[str] = Query(None, description="error | ok"),
    q: Optional[str] = Query(None, description="Text in the action's name"),
    execution_id: Optional[str] = None,
    hours: float = Query(24, gt=0, le=24 * 90),
    page_size: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = None,
):
    """Every traced action, newest first — one row per trace."""
    clauses = [f"service_name = {_quote(settings.OBSERVABILITY_SERVICE_NAME)}"]
    if kind in _ROOT_KINDS:
        clauses.append(f"root_span_name LIKE {_quote(_ROOT_KINDS[kind] + '%')}")
    elif kind == "llm":
        clauses.append("(" + " OR ".join(
            f"root_span_name LIKE {_quote(p + '%')}" for p in _LLM_PREFIXES
        ) + ")")
    elif kind == "http":
        clauses.append("(" + " OR ".join(
            f"root_span_name LIKE {_quote(m + '%')}" for m in _HTTP_METHODS
        ) + ")")
    if workflow:
        clauses.append(f"workflow_name = {_quote(workflow)}")
    if status == "error":
        clauses.append("error_count > 0")
    elif status == "ok":
        clauses.append("error_count = 0")
    if q:
        clauses.append(f"root_span_name ILIKE {_quote('%' + q + '%')}")
    if execution_id:
        clauses.append(f"trace_id = {_quote(tracing.execution_trace_hex(execution_id))}")

    start, end = _window(hours)
    try:
        response = await _api().traces.search_async(
            from_=start, to=end, page_size=page_size, cursor=cursor or None,
            search_expression=" AND ".join(clauses),
        )
    except Exception as e:
        raise _upstream_error(e)

    feed = response.traces
    return {
        "items": [_trace_row(t) for t in feed.results or []],
        "cursor": feed.cursor if feed.next else None,
        "has_more": bool(feed.next),
    }


async def _all_spans(trace_id: str) -> list[dict]:
    spans: list[dict] = []
    cursor = None
    while len(spans) < _MAX_SPANS:
        response = await _api().traces.get_trace_spans_async(
            trace_id=trace_id, page_size=100, cursor=cursor,
        )
        feed = response.spans
        spans.extend(_span_row(s) for s in feed.results or [])
        if not feed.next or not feed.cursor:
            break
        cursor = feed.cursor
    spans.sort(key=lambda s: s["start_time"] or "")
    return spans


@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str):
    """One trace: its summary, every span, and the rule verdicts reached in it."""
    try:
        summary, spans = await asyncio.gather(
            _api().traces.get_trace_by_id_async(trace_id=trace_id),
            _all_spans(trace_id),
        )
    except Exception as e:
        raise _upstream_error(e)

    rules = [_rule_row(s, trace_id) for s in spans if s["kind"] == "rule"]
    verdicts = {"pass": 0, "fixed": 0, "warn": 0, "fail": 0}
    for r in rules:
        if r["verdict"] in verdicts:
            verdicts[r["verdict"]] += 1

    root = next((s for s in spans if not s["parent_span_id"]), spans[0] if spans else None)
    return {
        "trace": _trace_row(summary),
        "root": root,
        "spans": spans,
        "rules": rules,
        "rule_counts": verdicts,
        "execution_id": (root or {}).get("attributes", {}).get("app.execution.id"),
        "truncated": len(spans) >= _MAX_SPANS,
    }


@router.get("/executions/{execution_id}")
async def get_execution_trace(execution_id: str):
    """A workflow execution's trace, found from its execution id."""
    return await get_trace(tracing.execution_trace_hex(execution_id))


@router.get("/rules")
async def list_rule_verdicts(
    verdict: Optional[str] = Query(None, description="pass | fixed | warn | fail"),
    rule: Optional[str] = None,
    workflow: Optional[str] = None,
    hours: float = Query(24, gt=0, le=24 * 90),
    page_size: int = Query(100, ge=1, le=100),
    cursor: Optional[str] = None,
):
    """Every rule verdict reached, across all traces, newest first."""
    clauses = [
        f"service_name = {_quote(settings.OBSERVABILITY_SERVICE_NAME)}",
        "operation_name = 'evaluate'",
    ]
    if verdict:
        clauses.append(f"span_attributes['app.rule.verdict'] = {_quote(verdict)}")
    if rule:
        clauses.append(f"span_attributes['app.rule.name'] ILIKE {_quote('%' + rule + '%')}")
    if workflow:
        clauses.append(f"workflow_name = {_quote(workflow)}")

    start, end = _window(hours)
    try:
        response = await _api().spans.search_spans_async(
            from_=start, to=end, page_size=page_size, cursor=cursor or None,
            search_expression=" AND ".join(clauses),
        )
    except Exception as e:
        raise _upstream_error(e)

    feed = response.spans
    rows = []
    for raw in feed.results or []:
        span = _span_row(raw)
        rows.append(_rule_row(span, raw.trace_id))
    rows.sort(key=lambda r: r["time"] or "", reverse=True)
    return {"items": rows, "cursor": feed.cursor if feed.next else None, "has_more": bool(feed.next)}


@router.get("/workflows")
async def list_traced_workflows(hours: float = Query(24 * 30, gt=0, le=24 * 90)):
    """Workflow names that have traces, for the grouping filter."""
    start, end = _window(hours)
    try:
        response = await _api().traces.fetch_options_async(field_name="workflow_name", from_=start, to=end)
    except Exception as e:
        raise _upstream_error(e)
    return {"workflows": sorted(o for o in (response.options or []) if o)}
