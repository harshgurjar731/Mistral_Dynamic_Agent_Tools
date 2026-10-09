"""
Run manager — owns background runs for the lifetime of the process.

A ``LiveRun`` is also the pipeline's event sink: it implements the one method
``PipelineContext.emit`` calls on its queue (``put_nowait``), so a pipeline runs
inside a background run with no change to a single layer.

A run can also stop and ask its user something (``LiveRun.ask``): it emits a
``decision_required`` event, waits for ``POST /runs/{id}/decisions/{decision}``,
and emits ``decision_made``. The run stays ``running`` while it waits — it is
still alive and holding its work — and the pending question is recoverable from
the event log alone, so a page opened later shows it.

Every event gets a sequence number. Watchers receive events live; a watcher
that connects late, or reconnects after a network blip, passes the last
sequence it saw and is sent only what it missed. Events are written to SQLite
in batches so a run stays replayable after its in-memory copy is dropped.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Awaitable, Callable, Optional

from app.core.events import SSEEvent
from app.runs import store

logger = logging.getLogger(__name__)

#: How often buffered events are written to SQLite.
_FLUSH_INTERVAL_S = 0.75
#: How long a finished run's exact event list stays in memory. After that,
#: replays come from SQLite, where text chunks are stored merged.
_RETAIN_FINISHED_S = 600
#: Comment frame sent to idle watchers so proxies keep the connection open.
_KEEPALIVE_S = 15
#: How long a run waits for an answer before taking the question's default.
DECISION_TIMEOUT_S = 6 * 3600


def _payload(data: Any) -> str:
    """The SSE ``data`` payload exactly as ``SSEEvent.serialize`` would send it."""
    if isinstance(data, str):
        return data
    try:
        return json.dumps(data)
    except (TypeError, ValueError):
        return str(data)


def frame(seq: Optional[int], event: str, data: str) -> str:
    body = data.replace("\n", "\ndata: ")
    head = f"id: {seq}\n" if seq is not None else ""
    return f"{head}event: {event}\ndata: {body}\n\n"


def _parse(data: str) -> Any:
    try:
        return json.loads(data)
    except (TypeError, ValueError):
        return data


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


@dataclass
class RunOutcome:
    status: str = "completed"                 # completed | failed
    result: Optional[dict] = None
    error: Optional[str] = None


Runner = Callable[["LiveRun"], Awaitable[RunOutcome]]


@dataclass
class LiveRun:
    id: str
    kind: str
    title: str
    request: dict
    status: str = "running"
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=_utcnow_iso)
    finished_at: Optional[str] = None

    events: list[tuple[int, str, str]] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    task: Optional[asyncio.Task] = None
    finished: bool = False

    # The last payload seen for each event name — runners read their result
    # from here (``done``, ``synthesis_result``…) rather than re-parsing.
    last_payloads: dict[str, str] = field(default_factory=dict)

    # Progress, derived from the pipeline protocol.
    _visible: dict[str, str] = field(default_factory=dict)   # layer name → label
    _done: set[str] = field(default_factory=set)
    current_label: Optional[str] = None
    note: Optional[str] = None

    _pending: list[tuple[int, str, str]] = field(default_factory=list)
    _write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Questions waiting for the user: decision id → (allowed choices, answer).
    _decisions: dict[str, tuple[list[str], asyncio.Future]] = field(default_factory=dict)

    # ── Sink interface used by PipelineContext.emit ────────────────────

    def put_nowait(self, sse: SSEEvent) -> None:
        self.emit(sse.event, sse.data)

    def emit(self, event: str, data: Any) -> int:
        payload = _payload(data)
        seq = len(self.events) + 1
        item = (seq, event, payload)
        self.events.append(item)
        self._pending.append(item)
        self.last_payloads[event] = payload
        self._track(event, payload)
        for queue in self.subscribers:
            queue.put_nowait(item)
        return seq

    def saw(self, event: str) -> bool:
        return event in self.last_payloads

    def payload(self, event: str) -> Any:
        raw = self.last_payloads.get(event)
        return _parse(raw) if raw is not None else None

    # ── Decisions ───────────────────────────────────────────────────────

    async def ask(self, kind: str, question: dict, *, options: list[str], default: str,
                  timeout: float = DECISION_TIMEOUT_S) -> dict:
        """Ask the user to choose one of ``options``; returns ``{"choice", ...}``.

        Waits up to ``timeout`` seconds, then takes ``default``.
        """
        decision_id = uuid.uuid4().hex[:12]
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._decisions[decision_id] = (list(options), future)
        self.emit("decision_required", {"id": decision_id, "kind": kind, "options": options,
                                        "default": default, **question})
        self.note = f"Waiting for your decision: {question.get('title') or kind}"[:300]
        try:
            answer = await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
            by = "user"
        except asyncio.TimeoutError:
            answer, by = {"choice": default}, "timeout"
        finally:
            self._decisions.pop(decision_id, None)
        self.note = None
        self.emit("decision_made", {"id": decision_id, "kind": kind, "by": by, **answer})
        return answer

    def answer(self, decision_id: str, choice: str, data: Optional[dict] = None) -> Optional[str]:
        """Resolve a pending question. Returns an error message, or None on success."""
        pending = self._decisions.get(decision_id)
        if pending is None:
            return "This question is no longer waiting for an answer."
        options, future = pending
        if choice not in options:
            return f"'{choice}' is not one of: {', '.join(options)}"
        if not future.done():
            future.set_result({**(data or {}), "choice": choice})
        return None

    # ── Progress ────────────────────────────────────────────────────────

    def _track(self, event: str, payload: str) -> None:
        if event == "pipeline":
            parsed = _parse(payload)
            layers = parsed.get("layers", []) if isinstance(parsed, dict) else []
            self._visible = {
                str(l.get("name")): str(l.get("label") or l.get("name"))
                for l in layers
                if isinstance(l, dict) and not l.get("hidden")
            }
            self._done = set()
        elif event == "layer":
            parsed = _parse(payload)
            if not isinstance(parsed, dict):
                return
            name = str(parsed.get("name"))
            if name not in self._visible:
                return
            state = parsed.get("state")
            if state == "active":
                self.current_label = self._visible[name]
                self.note = None
            elif state in ("completed", "skipped", "failed"):
                self._done.add(name)
        elif event == "status":
            self.note = payload[:300]

    def progress(self) -> dict:
        return {
            "total": len(self._visible),
            "done": len(self._done),
            "label": self.current_label,
            "note": self.note,
        }

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "status": self.status,
            "request": self.request,
            "result": self.result,
            "error": self.error,
            "progress": self.progress(),
            "last_seq": len(self.events),
            "created_at": self.created_at,
            "updated_at": _utcnow_iso(),
            "finished_at": self.finished_at,
        }

    # ── Persistence ─────────────────────────────────────────────────────

    async def flush(self, final: bool = False) -> None:
        async with self._write_lock:
            batch, self._pending = self._pending, []
            fields: dict = {
                "layers_total": len(self._visible),
                "layers_done": len(self._done),
                "current_label": self.current_label,
                "note": self.note,
                "last_seq": len(self.events),
            }
            if final:
                fields.update(
                    status=self.status,
                    result=json.dumps(self.result, default=str) if self.result is not None else None,
                    error=self.error,
                    finished_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            elif not batch:
                return
            await asyncio.to_thread(store.write_batch, self.id, _coalesce(batch), fields)

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(_FLUSH_INTERVAL_S)
            try:
                await self.flush()
            except Exception as e:  # never let persistence take a run down
                logger.warning("Run %s flush failed: %s", self.id, e)


def _coalesce(batch: list[tuple[int, str, str]]) -> list[tuple[int, str, str]]:
    """Merge consecutive text chunks — an answer is thousands of token frames."""
    out: list[tuple[int, str, str]] = []
    for seq, event, data in batch:
        if event == "text_chunk" and out and out[-1][1] == "text_chunk":
            out[-1] = (seq, event, out[-1][2] + data)
        else:
            out.append((seq, event, data))
    return out


class RunManager:
    def __init__(self) -> None:
        self._runs: dict[str, LiveRun] = {}
        self._shutting_down = False

    # ── Lifecycle ───────────────────────────────────────────────────────

    async def start(self, kind: str, title: str, request: dict, runner: Runner) -> LiveRun:
        run = LiveRun(id=uuid.uuid4().hex, kind=kind, title=title.strip()[:500], request=request)
        self._runs[run.id] = run
        await asyncio.to_thread(store.create_run, run.id, kind, run.title, request)
        run.task = asyncio.create_task(self._drive(run, runner), name=f"run:{kind}:{run.id}")
        logger.info("Started %s run %s", kind, run.id)
        return run

    async def _drive(self, run: LiveRun, runner: Runner) -> None:
        """Drive one run as its own trace on Mistral, linked to the request
        that started it — a run outlives that request by minutes."""
        from app.observability import tracing

        with tracing.span(
            f"run {run.kind}", kind="run", root=True, link_current=True,
            attrs={
                "app.run.id": run.id,
                "app.run.kind": run.kind,
                "app.run.title": run.title,
                "app.run.request": run.request,
            },
        ) as span:
            try:
                await self._drive_run(run, runner)
            finally:
                tracing.set_attrs(span, {
                    "app.run.status": run.status,
                    "app.run.result": run.result,
                    "app.run.error": run.error,
                    "app.run.events": len(run.events),
                })
                if run.status in ("failed", "interrupted"):
                    tracing.mark_error(span, run.error or run.status, error_type=f"run_{run.status}")
        await asyncio.to_thread(tracing.flush)

    async def _drive_run(self, run: LiveRun, runner: Runner) -> None:
        flusher = asyncio.create_task(run._flush_loop())
        started = time.monotonic()
        try:
            outcome = await runner(run)
            run.status = outcome.status
            run.result = outcome.result
            run.error = outcome.error
        except asyncio.CancelledError:
            if self._shutting_down:
                run.status, run.error = "interrupted", "The server shut down while this was running."
            else:
                run.status, run.error = "cancelled", "Stopped before it finished."
        except Exception as e:
            logger.exception("%s run %s failed", run.kind, run.id)
            run.status, run.error = "failed", str(e) or e.__class__.__name__
            run.emit("error", run.error)
        finally:
            run.finished_at = _utcnow_iso()
            run.emit("run_end", {
                "status": run.status,
                "result": run.result,
                "error": run.error,
                "ms": round((time.monotonic() - started) * 1000),
            })
            run.finished = True
            for queue in run.subscribers:
                queue.put_nowait(None)

            flusher.cancel()
            try:
                await run.flush(final=True)
            except Exception as e:
                logger.warning("Final flush for run %s failed: %s", run.id, e)
            logger.info("%s run %s ended: %s", run.kind, run.id, run.status)

            if not self._shutting_down:
                asyncio.get_running_loop().call_later(
                    _RETAIN_FINISHED_S, self._runs.pop, run.id, None
                )

    def answer(self, run_id: str, decision_id: str, choice: str,
               data: Optional[dict] = None) -> Optional[str]:
        """Answer a running run's question. Returns an error message, or None."""
        run = self._runs.get(run_id)
        if not run or run.finished:
            return "This run is not running."
        return run.answer(decision_id, choice, data)

    async def cancel(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        if not run or run.finished or not run.task:
            return False
        run.task.cancel()
        return True

    async def shutdown(self) -> None:
        self._shutting_down = True
        tasks = [r.task for r in self._runs.values() if r.task and not r.finished]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ── Reads ───────────────────────────────────────────────────────────

    def live(self, run_id: str) -> Optional[LiveRun]:
        return self._runs.get(run_id)

    async def get(self, run_id: str) -> Optional[dict]:
        run = self._runs.get(run_id)
        if run:
            return run.snapshot()
        return await asyncio.to_thread(store.get_run, run_id)

    async def list_runs(self, *, status: Optional[str], kind: Optional[str], limit: int) -> list[dict]:
        rows = await asyncio.to_thread(store.list_runs, status=status, kind=kind, limit=limit)
        # Overlay the in-memory view: the stored row trails by one flush.
        out = []
        for row in rows:
            run = self._runs.get(row["id"])
            out.append(run.snapshot() if run else row)
        return out

    async def stream(self, run_id: str, after: int = 0) -> AsyncGenerator[str, None]:
        """Replay everything after ``after``, then follow the run live."""
        run = self._runs.get(run_id)
        if run is not None:
            queue: asyncio.Queue = asyncio.Queue()
            run.subscribers.add(queue)
            try:
                last = after
                for seq, event, data in list(run.events):
                    if seq > last:
                        last = seq
                        yield frame(seq, event, data)
                if run.finished:
                    return
                while True:
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_S)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    if item is None:
                        return
                    seq, event, data = item
                    if seq > last:
                        last = seq
                        yield frame(seq, event, data)
            finally:
                run.subscribers.discard(queue)
            return

        # Not in memory: finished a while ago, or started by a previous process.
        rows = await asyncio.to_thread(store.events_after, run_id, after)
        for seq, event, data in rows:
            yield frame(seq, event, data)
        if rows and rows[-1][1] == "run_end":
            return
        record = await asyncio.to_thread(store.get_run, run_id)
        if record is None:
            return
        status = record["status"]
        if status == "running":
            # No task anywhere is driving it — this process never owned it.
            status = "interrupted"
        yield frame(None, "run_end", json.dumps({
            "status": status,
            "result": record.get("result"),
            "error": record.get("error") or (
                "The server restarted while this was running." if status == "interrupted" else None
            ),
        }))


manager = RunManager()
