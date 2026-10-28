"""
Ops — one request's progress feed, and the registry that holds them.

An ``Op`` is created by whichever side arrives first: the request carrying its
``X-Op-Id`` (``begin``) or the browser opening its event stream (``stream``).
The browser usually opens the stream a moment after sending the request, and
only if the request has not already answered, so most quick actions never
open one — their events are simply dropped with the op a little later.

Events can be emitted from the event loop or from a worker thread (sync
endpoints, ``asyncio.to_thread``), so the log is guarded by a lock and watchers
are woken with ``call_soon_threadsafe``.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Iterator, Optional

logger = logging.getLogger(__name__)

_OP_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
#: Ops kept at once; the oldest finished (then unclaimed) ones go first.
_MAX_OPS = 500
#: How long a finished op stays replayable.
_RETAIN_S = 120
#: How long a stream waits for a request to claim its op before giving up.
_UNCLAIMED_S = 60
#: Events kept per op. Stages and the end always get through; chatter does not.
_MAX_EVENTS = 400
_MAX_LOGS = 150
_KEEPALIVE_S = 15
#: Events that may be dropped once an op is over its budget.
_CHATTER = {"log", "step"}


def _payload(data: Any) -> str:
    if isinstance(data, str):
        return data
    try:
        return json.dumps(data, default=str)
    except (TypeError, ValueError):
        return str(data)


def _frame(seq: int, event: str, data: str) -> str:
    body = data.replace("\n", "\ndata: ")
    return f"id: {seq}\nevent: {event}\ndata: {body}\n\n"


class Meter:
    """How far one piece of work has measurably got, from reports at any depth.

    Work can be split into parts (``part``), parts into parts, and parts can run
    at the same time. Each report covers a range of the whole — ``(lo, hi)`` —
    and says how far through *its own* range it is. A range is worth the larger
    of what it reported itself and what the ranges inside it add up to, so a
    parent counting finished items and children reporting their own steps
    agree instead of fighting. The result never goes backwards.
    """

    def __init__(self) -> None:
        self._ranges: dict[tuple[float, float], float] = {}
        self._best = 0.0
        self._lock = threading.Lock()

    def measure(self, lo: float, hi: float, local: float) -> float:
        with self._lock:
            key = (round(lo, 9), round(hi, 9))
            self._ranges[key] = max(self._ranges.get(key, 0.0), min(1.0, max(0.0, local)))
            self._best = max(self._best, min(1.0, self._value((0.0, 1.0))))
            return self._best

    def _value(self, outer: tuple[float, float]) -> float:
        lo, hi = outer
        inside = [r for r in self._ranges if r != outer and lo <= r[0] and r[1] <= hi]
        # Only the ranges directly inside ``outer`` — not those inside another one.
        direct = [r for r in inside
                  if not any(o != r and o[0] <= r[0] and r[1] <= o[1] for o in inside)]
        children = sum(self._value(r) for r in direct)
        own = self._ranges.get(outer, 0.0) * (hi - lo)
        return max(own, children)


@dataclass
class Op:
    id: str
    label: str = ""
    created: float = field(default_factory=time.monotonic)
    started: Optional[float] = None
    ended: Optional[float] = None

    events: list[tuple[int, str, str]] = field(default_factory=list)
    subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _logs: int = 0
    _steps: int = 0
    meter: Meter = field(default_factory=Meter)

    @property
    def finished(self) -> bool:
        return self.ended is not None

    def emit(self, event: str, data: Any) -> None:
        payload = _payload(data)
        with self._lock:
            if self.ended is not None:
                return
            if event in _CHATTER and len(self.events) >= _MAX_EVENTS:
                return
            if event == "log":
                if self._logs >= _MAX_LOGS:
                    return
                self._logs += 1
            item = (len(self.events) + 1, event, payload)
            self.events.append(item)
            subscribers = list(self.subscribers)
        self._wake(subscribers, item)

    def end(self, data: dict) -> None:
        with self._lock:
            if self.ended is not None:
                return
            item = (len(self.events) + 1, "op_end", _payload(data))
            self.events.append(item)
            self.ended = time.monotonic()
            subscribers = list(self.subscribers)
        self._wake(subscribers, item)
        self._wake(subscribers, None)

    @staticmethod
    def _wake(subscribers: list, item: Any) -> None:
        for loop, queue in subscribers:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, item)
            except RuntimeError:  # the watcher's loop is gone
                pass

    def next_step(self) -> int:
        with self._lock:
            self._steps += 1
            return self._steps


class OpRegistry:
    def __init__(self) -> None:
        self._ops: OrderedDict[str, Op] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def valid(op_id: Optional[str]) -> bool:
        return bool(op_id and _OP_ID.match(op_id))

    def get_or_create(self, op_id: str) -> Op:
        with self._lock:
            op = self._ops.get(op_id)
            if op is None:
                self._prune()
                op = self._ops[op_id] = Op(id=op_id)
            return op

    def begin(self, op_id: str, label: str) -> Optional[Op]:
        if not self.valid(op_id):
            return None
        op = self.get_or_create(op_id)
        if op.started is not None:   # a second request reusing the id
            return None
        op.started = time.monotonic()
        op.label = label
        op.emit("op_start", {"label": label})
        return op

    def _prune(self) -> None:
        now = time.monotonic()
        for op_id, op in list(self._ops.items()):
            if op.ended is not None and now - op.ended > _RETAIN_S:
                del self._ops[op_id]
            elif op.started is None and now - op.created > _UNCLAIMED_S and not op.subscribers:
                del self._ops[op_id]
        if len(self._ops) < _MAX_OPS:
            return
        # Over the cap: drop finished ops, then unclaimed ones, oldest first.
        for keep_running in (True, False):
            for op_id, op in list(self._ops.items()):
                if len(self._ops) < _MAX_OPS:
                    return
                if op.ended is not None or (not keep_running and op.started is None):
                    del self._ops[op_id]

    async def stream(self, op_id: str, after: int = 0) -> AsyncGenerator[str, None]:
        """Replay everything after ``after``, then follow the op until it ends."""
        op = self.get_or_create(op_id)
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        entry = (loop, queue)
        with op._lock:
            backlog = list(op.events)
            op.subscribers.add(entry)
        try:
            last = after
            for seq, event, data in backlog:
                if seq > last:
                    last = seq
                    yield _frame(seq, event, data)
            if op.finished:
                return
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_S)
                except asyncio.TimeoutError:
                    if op.started is None and time.monotonic() - op.created > _UNCLAIMED_S:
                        # No request ever arrived with this id.
                        yield _frame(last + 1, "op_end", json.dumps({"status": "unknown"}))
                        return
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    return
                seq, event, data = item
                if seq > last:
                    last = seq
                    yield _frame(seq, event, data)
        finally:
            with op._lock:
                op.subscribers.discard(entry)


registry = OpRegistry()

#: Where progress goes: an ``Op`` for a request, a ``LiveRun`` for a background
#: run. Anything with ``emit(event, data)``, ``finished``, ``next_step()`` and a
#: ``meter`` will do.
_CURRENT: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar("progress_op", default=None)
#: The share of the whole that the running code is working on (see ``part``).
_RANGE: contextvars.ContextVar[tuple[float, float]] = contextvars.ContextVar(
    "progress_range", default=(0.0, 1.0))


def current() -> Optional[Any]:
    """The op or run the running code reports to, if any."""
    return _CURRENT.get()


def bind(op: Optional[Any]) -> contextvars.Token:
    return _CURRENT.set(op)


def unbind(token: contextvars.Token) -> None:
    try:
        _CURRENT.reset(token)
    except ValueError:
        pass


def detach() -> None:
    """Stop reporting from this context on — for work that outlives its request
    (a background run started by it), which must not narrate into it."""
    _CURRENT.set(None)


# ── Reporting ─────────────────────────────────────────────────────────────────

def report(label: Optional[str], *, done: Optional[float] = None, total: Optional[float] = None,
           detail: Optional[str] = None) -> None:
    """Say what the work is doing now; ``done``/``total`` say how far through its
    own part (see ``part``) it is, which makes the whole measurable."""
    op = _CURRENT.get()
    if op is None or op.finished:
        return
    data: dict = {}
    if label:
        data["label"] = label[:300]
    if total is not None:
        total = max(0, total)
        done = max(0, min(done or 0, total))
        data["total"], data["done"] = total, done
        lo, hi = _RANGE.get()
        data["fraction"] = round(op.meter.measure(lo, hi, done / total if total else 1.0), 4)
    if detail:
        data["detail"] = detail[:500]
    if data:
        op.emit("stage", data)


@contextmanager
def part(index: int, count: int, label: Optional[str] = None) -> Iterator[None]:
    """Run a block as part ``index`` of ``count`` equal parts of the current work.

    Reports made inside it fill only its share of the bar, so building five
    activities moves the bar across all five, however each measures itself.
    Parts may run concurrently. The part counts as complete when the block ends.
    """
    lo, hi = _RANGE.get()
    count = max(1, count)
    width = (hi - lo) / count
    token = _RANGE.set((lo + width * index, lo + width * (index + 1)))
    try:
        if label:
            report(label, done=0, total=1)
        yield
    finally:
        report(None, done=1, total=1)
        _RANGE.reset(token)


def note(text: str) -> None:
    """A line of detail under the current stage."""
    op = _CURRENT.get()
    if op is not None and text:
        op.emit("note", text[:500])


def step_begin(kind: str, name: str) -> Optional[tuple[Op, int, float]]:
    op = _CURRENT.get()
    if op is None or op.finished:
        return None
    step_id = op.next_step()
    op.emit("step", {"id": step_id, "kind": kind, "name": name[:200], "state": "active"})
    return op, step_id, time.monotonic()


def step_end(handle: Optional[tuple[Op, int, float]], error: Optional[str] = None) -> None:
    if handle is None:
        return
    op, step_id, started = handle
    data: dict = {"id": step_id, "state": "failed" if error else "completed",
                  "ms": round((time.monotonic() - started) * 1000)}
    if error:
        data["error"] = error[:300]
    op.emit("step", data)


@contextmanager
def stage(label: str, *, kind: str = "stage") -> Iterator[None]:
    """A named step with a start and an end, shown as one row with its timing."""
    handle = step_begin(kind, label)
    try:
        yield
    except BaseException as e:
        step_end(handle, str(e) or e.__class__.__name__)
        raise
    else:
        step_end(handle)


#: Pipeline events worth showing for a request that runs a pipeline inline.
PIPELINE_EVENTS = {"pipeline", "layer", "status"}


def pipeline_event(event: str, data: Any) -> None:
    if event not in PIPELINE_EVENTS:
        return
    op = _CURRENT.get()
    if op is not None:
        op.emit(event, data)


# ── Log lines ─────────────────────────────────────────────────────────────────

class _LogForwarder(logging.Handler):
    """The app's own log lines (and anyone's warnings) during a tagged request."""

    def emit(self, record: logging.LogRecord) -> None:
        op = _CURRENT.get()
        if op is None:
            return
        ours = record.name == "app" or record.name.startswith("app.")
        if not ours and record.levelno < logging.WARNING:
            return
        if record.name.startswith("app.progress"):
            return
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        op.emit("log", {"level": record.levelname.lower(), "message": message[:500]})


_log_handler: Optional[_LogForwarder] = None


def install_log_forwarding() -> None:
    global _log_handler
    if _log_handler is not None:
        return
    _log_handler = _LogForwarder(level=logging.INFO)
    logging.getLogger().addHandler(_log_handler)
