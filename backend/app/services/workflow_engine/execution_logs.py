"""
Per-execution log capture.

The engine and the step runners already narrate what they are doing through the
standard ``logging`` module — which agent is being called, which tool round is
in flight, why a step was retried. That narration only ever reached the server
console, so the UI had nothing to show while a workflow was running.

This module tees those records into a per-execution ring buffer that the SSE
stream can tail. It works by attaching one handler to the ``app`` logger tree
and keying records on a context variable, so every existing ``logger.info``
call is captured without touching a single call site.

Threading note: steps run their blocking SDK calls through ``asyncio.to_thread``,
so records arrive from worker threads. ``asyncio.to_thread`` and ``asyncio``
task creation both propagate ``contextvars``, so the execution id follows the
work — but the buffer itself must be thread-safe and must not touch asyncio
primitives. Readers poll by sequence number instead of waiting on an event.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

# Which execution the current task/thread is working on. Unset outside a run,
# which is what stops unrelated request logging from being captured.
CURRENT_EXECUTION: ContextVar[Optional[str]] = ContextVar("current_execution", default=None)
CURRENT_STEP: ContextVar[Optional[str]] = ContextVar("current_step", default=None)

# Retained per execution. Enough to cover a long multi-round run without letting
# a runaway loop exhaust memory.
MAX_RECORDS = 2000

# Executions kept in memory. Oldest buffers are dropped once this is exceeded.
MAX_EXECUTIONS = 50

_LEVEL_NAMES = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}


@dataclass(frozen=True)
class LogRecord:
    """One captured line, in the shape the UI renders."""
    seq: int
    timestamp: str
    level: str
    logger: str
    message: str
    step_id: Optional[str] = None


class _ExecutionLog:
    """A bounded, thread-safe log buffer for one execution."""

    __slots__ = ("_records", "_lock", "_next_seq")

    def __init__(self) -> None:
        self._records: deque[LogRecord] = deque(maxlen=MAX_RECORDS)
        self._lock = threading.Lock()
        self._next_seq = 0

    def append(self, level: str, logger_name: str, message: str, step_id: Optional[str]) -> None:
        with self._lock:
            record = LogRecord(
                seq=self._next_seq,
                timestamp=datetime.now(timezone.utc).isoformat(),
                level=level,
                logger=logger_name,
                message=message,
                step_id=step_id,
            )
            self._next_seq += 1
            self._records.append(record)

    def since(self, seq: int) -> list[LogRecord]:
        """Records with ``seq >= seq``, oldest first."""
        with self._lock:
            return [r for r in self._records if r.seq >= seq]

    def all(self, limit: Optional[int] = None) -> list[LogRecord]:
        with self._lock:
            records = list(self._records)
        return records[-limit:] if limit else records

    @property
    def next_seq(self) -> int:
        with self._lock:
            return self._next_seq


_buffers: "dict[str, _ExecutionLog]" = {}
_buffers_lock = threading.Lock()


def _buffer_for(execution_id: str, create: bool = True) -> Optional[_ExecutionLog]:
    with _buffers_lock:
        buffer = _buffers.get(execution_id)
        if buffer is None and create:
            # Evict the oldest buffer rather than growing without bound. dicts
            # preserve insertion order, so the first key is the oldest run.
            while len(_buffers) >= MAX_EXECUTIONS:
                _buffers.pop(next(iter(_buffers)))
            buffer = _ExecutionLog()
            _buffers[execution_id] = buffer
        return buffer


class _ExecutionLogHandler(logging.Handler):
    """Routes any record emitted inside a run into that run's buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        execution_id = CURRENT_EXECUTION.get()
        if not execution_id:
            return
        try:
            buffer = _buffer_for(execution_id)
            if buffer is None:
                return
            buffer.append(
                level=_LEVEL_NAMES.get(record.levelno, record.levelname),
                logger_name=record.name,
                message=record.getMessage(),
                step_id=CURRENT_STEP.get(),
            )
        except Exception:
            # A logging handler that raises would break the very code it is
            # observing, so failures here are swallowed by design.
            self.handleError(record)


_handler: Optional[_ExecutionLogHandler] = None
_install_lock = threading.Lock()


def install(logger_name: str = "app") -> None:
    """Attach the capture handler. Idempotent — safe to call on every startup."""
    global _handler
    with _install_lock:
        if _handler is not None:
            return
        _handler = _ExecutionLogHandler()
        _handler.setLevel(logging.INFO)
        target = logging.getLogger(logger_name)
        target.addHandler(_handler)
        # The engine's own narration is INFO; without this the root level could
        # filter it out before the handler ever sees it.
        if target.level > logging.INFO or target.level == logging.NOTSET:
            target.setLevel(logging.INFO)


def record(execution_id: str, level: str, message: str, step_id: Optional[str] = None) -> None:
    """Write a line directly, for events that are not already logged."""
    buffer = _buffer_for(execution_id)
    if buffer:
        buffer.append(level=level, logger_name="workflow", message=message, step_id=step_id)


def get(execution_id: str, since: int = 0, limit: Optional[int] = None) -> list[dict]:
    """Captured lines for an execution, as plain dicts."""
    buffer = _buffer_for(execution_id, create=False)
    if not buffer:
        return []
    records = buffer.since(since) if since else buffer.all(limit)
    if limit and len(records) > limit:
        records = records[-limit:]
    return [asdict(r) for r in records]


def next_seq(execution_id: str) -> int:
    buffer = _buffer_for(execution_id, create=False)
    return buffer.next_seq if buffer else 0


def has_logs(execution_id: str) -> bool:
    return _buffer_for(execution_id, create=False) is not None


def clear(execution_id: str) -> None:
    with _buffers_lock:
        _buffers.pop(execution_id, None)
