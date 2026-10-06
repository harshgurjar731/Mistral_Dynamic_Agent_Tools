"""
Tracing — every action this backend takes, exported to Mistral Observability.

One OpenTelemetry ``TracerProvider`` is owned by this module and exports over
OTLP/HTTP to Mistral's telemetry endpoint, authenticated with the same API key
the rest of the app uses. Traces then appear in the Mistral console's Trace
Explorer and are readable back through ``/v1/observability/traces`` — which is
what the Logs page does.

The provider is deliberately *not* installed as the global OpenTelemetry
provider. Mistral clients are bound to it explicitly (``instrument_client``),
so a client that is not bound — the one the Logs page reads traces with —
produces no spans, and reading the logs never writes more logs.

Grouping
--------
A workflow execution is one trace, whichever executor runs it. The trace id is
derived from the execution id, so:

* the local DAG engine opens the root span with that trace id;
* a Mistral-hosted run gets a root span when it is dispatched, and every
  activity the worker subprocess runs attaches to it — the worker learns the
  execution id from Temporal, derives the same ids, and parents its step spans
  under them. One run, one trace, in both cases.

Everything else (an API request, a background run, a pipeline) is a trace of
its own, and a workflow or run started from a request carries a span link back
to the request that started it.
"""

from __future__ import annotations

import contextvars
import dataclasses
import hashlib
import json
import logging
import os
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.trace import Link, NonRecordingSpan, Span, SpanContext, Status, StatusCode, TraceFlags

from app.config import settings

logger = logging.getLogger(__name__)

TRACER_NAME = "mistral-dynamic-agent-tools"

#: Mistral reads this attribute into the trace's first-class ``workflow_name``
#: column, which is what lets the console and the Logs page group by workflow.
GEN_AI_WORKFLOW_NAME = "gen_ai.workflow.name"

_provider: Optional[TracerProvider] = None
_component: str = "api"


# ── Deterministic ids ─────────────────────────────────────────────────────────

def _digest(namespace: str, value: str) -> bytes:
    return hashlib.sha256(f"{namespace}:{value}".encode()).digest()


def execution_trace_id(execution_id: str) -> int:
    """The trace id every span of one workflow execution shares."""
    return int.from_bytes(_digest("trace", execution_id)[:16], "big") or 1


def execution_root_span_id(execution_id: str) -> int:
    return int.from_bytes(_digest("root", execution_id)[:8], "big") or 1


def execution_trace_hex(execution_id: str) -> str:
    return format(execution_trace_id(execution_id), "032x")


#: Set for the duration of one ``start_span`` call when the span must carry
#: specific ids — a workflow's root span. Read by the id generator below.
_FORCED_IDS: contextvars.ContextVar[Optional[tuple[int, int]]] = contextvars.ContextVar(
    "observability_forced_ids", default=None
)


class _IdGenerator(RandomIdGenerator):
    """Random ids, except where a workflow root span needs its derived ones."""

    def generate_trace_id(self) -> int:
        forced = _FORCED_IDS.get()
        return forced[0] if forced else super().generate_trace_id()

    def generate_span_id(self) -> int:
        forced = _FORCED_IDS.get()
        if forced:
            # A trace id and a span id are generated for a root span; only the
            # first span id may be forced, or its children would share it.
            _FORCED_IDS.set(None)
            return forced[1]
        return super().generate_span_id()


# ── Setup ─────────────────────────────────────────────────────────────────────

def enabled() -> bool:
    return _provider is not None


def _endpoint() -> str:
    return (
        settings.OBSERVABILITY_ENDPOINT
        or os.getenv("MISTRAL_OTLP_TRACES_ENDPOINT")
        or "https://api.mistral.ai/telemetry/v1/traces"
    )


def setup(component: str = "api") -> bool:
    """Create the provider and its Mistral exporter. Idempotent; never raises.

    ``component`` is ``api`` for the FastAPI process and ``worker`` for the
    Workflows worker subprocess, recorded on every span so a step can be traced
    back to the process that ran it.
    """
    global _provider, _component
    if _provider is not None:
        return True
    if not settings.OBSERVABILITY_ENABLED:
        logger.info("ℹ️ Observability disabled (OBSERVABILITY_ENABLED=false)")
        return False
    if not settings.MISTRAL_API_KEY:
        logger.warning("⚠️ Observability not started: MISTRAL_API_KEY is not set")
        return False

    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter: Any = OTLPSpanExporter(
            endpoint=_endpoint(),
            headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
        )
        if settings.OBSERVABILITY_REDACT:
            # The SDK's own policy: secrets and PII substrings are masked in
            # place, keys and surrounding text kept.
            from mistralai.extra.observability import RedactingSpanExporter, default_redaction_policy

            exporter = RedactingSpanExporter(exporter, default_redaction_policy())

        _component = component
        provider = TracerProvider(
            resource=Resource.create({
                "service.name": settings.OBSERVABILITY_SERVICE_NAME,
                "service.namespace": "mistral-dynamic-agent-tools",
                "deployment.environment": settings.OBSERVABILITY_ENVIRONMENT,
                "app.component": component,
            }),
            id_generator=_IdGenerator(),
        )
        provider.add_span_processor(BatchSpanProcessor(exporter, schedule_delay_millis=2000))
        _provider = provider
    except Exception as e:
        logger.warning("⚠️ Observability not started: %s", e)
        return False

    _install_log_capture()
    logger.info(
        "✅ Observability: tracing to Mistral (%s, service=%s, env=%s, redaction=%s)",
        _endpoint(), settings.OBSERVABILITY_SERVICE_NAME,
        settings.OBSERVABILITY_ENVIRONMENT, "on" if settings.OBSERVABILITY_REDACT else "off",
    )
    return True


def shutdown() -> None:
    """Flush buffered spans. Called on process exit so the last run is not lost."""
    if _provider is not None:
        try:
            _provider.force_flush(timeout_millis=5000)
            _provider.shutdown()
        except Exception as e:
            logger.debug("Observability shutdown: %s", e)


def flush() -> None:
    if _provider is not None:
        try:
            _provider.force_flush(timeout_millis=5000)
        except Exception:
            pass


def instrument_client(client: Any) -> Any:
    """Bind a Mistral client to this provider so its calls become spans.

    Chat completions, agent calls, embeddings, OCR and conversations are then
    traced by the SDK itself with full GenAI attributes (model, messages,
    tokens), as children of whatever span is current when the call is made.
    """
    if _provider is None or client is None:
        return client
    try:
        from mistralai.extra.observability import configure_telemetry

        # redaction=False: the SDK cannot redact on a provider it does not own
        # (and warns if asked); our exporter already does, in setup().
        configure_telemetry(client, provider=_provider, redaction=False)
    except Exception as e:
        logger.warning("Could not instrument Mistral client: %s", e)
    return client


def tracer() -> trace.Tracer:
    if _provider is None:
        return trace.NoOpTracer()
    return _provider.get_tracer(TRACER_NAME)


# ── Attribute encoding ────────────────────────────────────────────────────────

def _truncate(text: str) -> str:
    limit = settings.OBSERVABILITY_MAX_ATTR_CHARS
    if len(text) <= limit:
        return text
    return text[:limit] + f"… [truncated {len(text) - limit} chars]"


def encode(value: Any) -> Any:
    """An attribute value OpenTelemetry accepts, with large payloads clipped.

    Scalars pass through; everything else becomes JSON, so a step's input and
    output stay readable (and searchable) in the trace rather than a repr.
    """
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, (list, tuple)) and value and all(isinstance(v, str) for v in value):
        return [_truncate(v) for v in value[:100]]
    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump(mode="json")
        except Exception:
            pass
    elif dataclasses.is_dataclass(value) and not isinstance(value, type):
        try:
            value = dataclasses.asdict(value)
        except Exception:
            pass
    try:
        text = json.dumps(value, default=str, ensure_ascii=False)
    except Exception:
        text = str(value)
    return _truncate(text)


def set_attrs(span: Span, attrs: Optional[dict]) -> None:
    if not attrs or span is None or not span.is_recording():
        return
    for key, value in attrs.items():
        encoded = encode(value)
        if encoded is not None:
            try:
                span.set_attribute(key, encoded)
            except Exception:
                pass


def mark_error(span: Span, error: Any, *, error_type: Optional[str] = None) -> None:
    if span is None or not span.is_recording():
        return
    message = str(error) if error is not None else "error"
    span.set_status(Status(StatusCode.ERROR, message[:1000]))
    span.set_attribute("error.type", error_type or (type(error).__name__ if isinstance(error, BaseException) else "error"))
    span.set_attribute("app.error", _truncate(message))
    if isinstance(error, BaseException):
        span.record_exception(error)


# ── Log capture ───────────────────────────────────────────────────────────────
#
# Every log line written while an app span is current is kept and attached to
# that span as ``app.logs`` when it ends. Span events would be the textbook
# home, but Mistral's trace API does not return events — an attribute does
# reach the Logs page, so that is where the lines go.

class _SpanLogs:
    __slots__ = ("lines", "dropped")

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.dropped = 0


_CURRENT_LOGS: contextvars.ContextVar[Optional[_SpanLogs]] = contextvars.ContextVar(
    "observability_span_logs", default=None
)


class _SpanLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        buffer = _CURRENT_LOGS.get()
        if buffer is None:
            return
        if len(buffer.lines) >= settings.OBSERVABILITY_MAX_LOG_LINES:
            buffer.dropped += 1
            return
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        stamp = time.strftime("%H:%M:%S", time.localtime(record.created))
        buffer.lines.append(f"{stamp} {record.levelname:<7} {record.name}: {message[:800]}")


_log_handler: Optional[_SpanLogHandler] = None


def _install_log_capture() -> None:
    global _log_handler
    if _log_handler is not None:
        return
    _log_handler = _SpanLogHandler(level=logging.INFO)
    # The root logger, so the app, the Mistral SDK and the workflows SDK are
    # all captured; the handler drops anything outside an app span at once.
    logging.getLogger().addHandler(_log_handler)


# ── Spans ─────────────────────────────────────────────────────────────────────

@contextmanager
def span(
    name: str,
    *,
    kind: str,
    attrs: Optional[dict] = None,
    root: bool = False,
    parent: Optional[SpanContext] = None,
    forced_ids: Optional[tuple[int, int]] = None,
    link_current: bool = False,
    capture_logs: bool = True,
    record_errors: bool = True,
    start_time: Optional[int] = None,
) -> Iterator[Span]:
    """Open an app span, current for the body, ended (with its logs) on exit.

    ``kind`` is the app's own classification (workflow, step, rule, tool,
    pipeline, layer, run, http…) — the Logs page filters and draws by it.
    ``root`` starts a new trace; ``link_current`` then keeps a link back to the
    span that was current, so a workflow started by a request still points at
    that request. ``parent`` attaches under a remote span (the worker's view of
    a workflow root).
    """
    if _provider is None:
        yield trace.INVALID_SPAN
        return

    links = []
    current = trace.get_current_span().get_span_context()
    if link_current and current.is_valid:
        links.append(Link(current, {"app.link": "started_by"}))

    if parent is not None:
        ctx = trace.set_span_in_context(NonRecordingSpan(parent), otel_context.Context())
    elif root:
        ctx = otel_context.Context()
    else:
        ctx = None

    forced_token = _FORCED_IDS.set(forced_ids) if forced_ids else None
    try:
        s = tracer().start_span(name, context=ctx, links=links or None, start_time=start_time)
    finally:
        if forced_token is not None:
            _FORCED_IDS.reset(forced_token)

    s.set_attribute("app.kind", kind)
    s.set_attribute("app.component", _component)
    set_attrs(s, attrs)

    logs = _SpanLogs() if capture_logs else None
    logs_token = _CURRENT_LOGS.set(logs) if logs is not None else None
    try:
        with trace.use_span(s, end_on_exit=False, record_exception=False, set_status_on_exception=False):
            yield s
    except BaseException as e:
        if record_errors and not isinstance(e, GeneratorExit):
            mark_error(s, e)
        raise
    finally:
        if logs_token is not None:
            try:
                _CURRENT_LOGS.reset(logs_token)
            except ValueError:
                pass
        if logs is not None and logs.lines:
            if logs.dropped:
                logs.lines.append(f"… {logs.dropped} more line(s) not kept")
            s.set_attribute("app.logs", _truncate("\n".join(logs.lines)))
        s.end()


def start_detached(
    name: str,
    *,
    kind: str,
    attrs: Optional[dict] = None,
    parent_span: Optional[Span] = None,
) -> Span:
    """A span the caller ends itself, parented explicitly and never made current.

    For lifecycles that do not fit a ``with`` block — a pipeline layer that
    finishes its own work when it hands off to the next layer, long before its
    ``process`` call returns.
    """
    if _provider is None:
        return trace.INVALID_SPAN
    ctx = trace.set_span_in_context(parent_span) if parent_span is not None else None
    s = tracer().start_span(name, context=ctx)
    s.set_attribute("app.kind", kind)
    s.set_attribute("app.component", _component)
    set_attrs(s, attrs)
    return s


def begin_logs() -> tuple[_SpanLogs, contextvars.Token]:
    """Start capturing log lines for a span that is not opened with ``span()``."""
    buffer = _SpanLogs()
    return buffer, _CURRENT_LOGS.set(buffer)


def finish_logs(target: Span, handle: tuple[_SpanLogs, contextvars.Token]) -> None:
    """Stop capturing and attach what was captured. Call before ending ``target``."""
    buffer, token = handle
    try:
        _CURRENT_LOGS.reset(token)
    except ValueError:
        pass
    if buffer.lines and target is not None and target.is_recording():
        if buffer.dropped:
            buffer.lines.append(f"… {buffer.dropped} more line(s) not kept")
        target.set_attribute("app.logs", _truncate("\n".join(buffer.lines)))


def event_span(name: str, *, kind: str, attrs: Optional[dict] = None,
               error: Optional[str] = None) -> None:
    """A zero-length span recording one thing that happened — a rule verdict."""
    if _provider is None:
        return
    s = tracer().start_span(name)
    s.set_attribute("app.kind", kind)
    s.set_attribute("app.component", _component)
    set_attrs(s, attrs)
    if error:
        s.set_status(Status(StatusCode.ERROR, error[:1000]))
    s.end()


def current_span() -> Span:
    return trace.get_current_span()


def annotate(attrs: dict) -> None:
    """Add attributes to whatever span is current (no-op outside one)."""
    set_attrs(trace.get_current_span(), attrs)


def current_trace_id() -> Optional[str]:
    ctx = trace.get_current_span().get_span_context()
    return format(ctx.trace_id, "032x") if ctx.is_valid else None


# ── Rule verdicts ─────────────────────────────────────────────────────────────

#: Rule outcome → the verdict the Logs page and the evaluation attributes use.
RULE_VERDICT = {
    "passed": "pass",
    "applied": "pass",
    "fixed": "fixed",
    "warned": "warn",
    "blocked": "fail",
}

#: Running totals of rule verdicts for the enclosing workflow run or pipeline.
#: A shared dict, so verdicts recorded inside gather branches and worker
#: threads (copied contexts) still land in the caller's totals.
_RULE_TALLY: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "observability_rule_tally", default=None
)


@contextmanager
def rule_tally() -> Iterator[dict]:
    tally: dict = {"pass": 0, "fixed": 0, "warn": 0, "fail": 0, "failed_rules": []}
    token = _RULE_TALLY.set(tally)
    try:
        yield tally
    finally:
        _RULE_TALLY.reset(token)


def tally_attrs(tally: dict) -> dict:
    total = sum(tally[k] for k in ("pass", "fixed", "warn", "fail"))
    return {
        "app.rules.evaluated": total,
        "app.rules.passed": tally["pass"],
        "app.rules.fixed": tally["fixed"],
        "app.rules.warned": tally["warn"],
        "app.rules.failed": tally["fail"],
        "app.rules.failed_names": sorted(set(tally["failed_rules"])) or None,
    }


def record_rule_outcome(event: dict) -> None:
    """One rule verdict as a span under whatever is running — step, tool call,
    workflow, chat turn — with the GenAI evaluation attributes, so it reads as
    an evaluation in the Mistral console too. A blocked rule is an error span.
    """
    outcome = str(event.get("outcome") or "passed")
    verdict = RULE_VERDICT.get(outcome, "pass")
    tally = _RULE_TALLY.get()
    if tally is not None:
        tally[verdict] = tally.get(verdict, 0) + 1
        if verdict == "fail":
            tally["failed_rules"].append(str(event.get("rule_name") or event.get("rule_id")))

    name = str(event.get("rule_name") or event.get("rule_id") or "rule")
    message = event.get("message") or ""
    event_span(
        f"rule {name}",
        kind="rule",
        attrs={
            "gen_ai.operation.name": "evaluate",
            "gen_ai.evaluation.name": name,
            "gen_ai.evaluation.score.label": verdict,
            "gen_ai.evaluation.score.value": 0.0 if verdict == "fail" else (0.5 if verdict == "warn" else 1.0),
            "gen_ai.evaluation.explanation": message or None,
            "app.rule.id": event.get("rule_id"),
            "app.rule.name": name,
            "app.rule.outcome": outcome,
            "app.rule.verdict": verdict,
            "app.rule.checkpoint": event.get("checkpoint"),
            "app.rule.message": message or None,
            "app.rule.detail": event.get("detail"),
            "app.rule.scope": event.get("scope"),
            "app.rule.subject_id": event.get("subject_id"),
            "app.execution.id": event.get("execution_id"),
            "app.step.id": event.get("step_id"),
            "gen_ai.conversation.id": event.get("conversation_id"),
            GEN_AI_WORKFLOW_NAME: event.get("workflow_name"),
        },
        error=(message or f"Blocked by rule '{name}'") if verdict == "fail" else None,
    )


# ── Workflow executions ───────────────────────────────────────────────────────

def workflow_root_ids(execution_id: str) -> tuple[int, int]:
    return execution_trace_id(execution_id), execution_root_span_id(execution_id)


def workflow_remote_parent(execution_id: str) -> SpanContext:
    """The root of an execution's trace, as a parent a worker can attach to."""
    trace_id, span_id = workflow_root_ids(execution_id)
    return SpanContext(
        trace_id=trace_id, span_id=span_id, is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )


def temporal_activity_info() -> Optional[dict]:
    """The workflow execution this code runs under, when inside a Temporal activity."""
    try:
        from temporalio import activity

        info = activity.info()
    except Exception:
        return None
    return {
        "execution_id": info.workflow_id,
        "workflow_type": info.workflow_type,
        "activity_type": info.activity_type,
        "activity_id": info.activity_id,
        "attempt": info.attempt,
        "run_id": info.workflow_run_id,
    }
