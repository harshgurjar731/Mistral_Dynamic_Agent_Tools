"""
Process-wide concurrency plumbing: threads, background tasks and fair queues.

* **Threads.** Mistral's SDK, SQLite and file I/O are blocking, so the backend
  hands them to threads (``asyncio.to_thread`` — 200+ call sites — and
  Starlette's pool for sync endpoints). Python's default pool has
  ``min(32, CPUs + 4)`` threads: six on a 2-vCPU VM, shared by every user, so
  the seventh concurrent model call waits for one of the first six to finish.
  ``configure_threads`` sizes both pools for I/O-bound work instead.
* **Background tasks.** ``asyncio.create_task`` keeps only a weak reference; a
  task nobody holds can be garbage-collected mid-flight and silently never
  finish. ``spawn`` holds every task until it is done and logs its failure.
* **Fair queues.** ``key_gate`` gives each Mistral key its own FIFO semaphore,
  so one workspace's heavy use queues behind its own quota and never in front
  of another workspace's work.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Optional

logger = logging.getLogger(__name__)


def thread_count() -> int:
    """Threads for blocking I/O: ``WORKER_THREADS``, else 8 per CPU (32–256)."""
    raw = os.environ.get("WORKER_THREADS", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return min(int(raw), 512)
    return max(32, min(256, (os.cpu_count() or 2) * 8))


_configured = False


def configure_threads() -> int:
    """Size the default executor and Starlette's thread limiter. Idempotent;
    call from inside the running loop (the app's lifespan)."""
    global _configured
    n = thread_count()
    if _configured:
        return n
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=n, thread_name_prefix="io"))
    try:
        import anyio.to_thread

        anyio.to_thread.current_default_thread_limiter().total_tokens = n
    except Exception as e:  # noqa: BLE001
        logger.debug("anyio thread limiter not resized: %s", e)
    _configured = True
    return n


# ── Background tasks ────────────────────────────────────────────────────────

_TASKS: set[asyncio.Task] = set()


def _done(task: asyncio.Task) -> None:
    _TASKS.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Background task %s failed: %s", task.get_name(), exc,
                     exc_info=(type(exc), exc, exc.__traceback__))


def spawn(coro: Awaitable[Any], *, name: str) -> asyncio.Task:
    """Start a task that is guaranteed to run to the end (or to fail loudly)."""
    task = asyncio.ensure_future(coro)
    task.set_name(name)
    _TASKS.add(task)
    task.add_done_callback(_done)
    return task


def background_tasks() -> list[asyncio.Task]:
    return [t for t in _TASKS if not t.done()]


async def drain(timeout: float = 10.0) -> None:
    """At shutdown: give background tasks a moment to finish, then cancel them."""
    pending = background_tasks()
    if not pending:
        return
    done, still = await asyncio.wait(pending, timeout=timeout)
    for task in still:
        task.cancel()
    if still:
        await asyncio.gather(*still, return_exceptions=True)


# ── Per-key FIFO gates ──────────────────────────────────────────────────────

_gates: dict[tuple[int, str, str], tuple[int, asyncio.Semaphore]] = {}


def current_key_id() -> str:
    """A short, non-reversible id for the caller's Mistral key ("platform" if none)."""
    try:
        from app.dependencies import current_mistral_api_key

        key = current_mistral_api_key()
    except Exception:  # noqa: BLE001 — a missing key is the request's own error
        key = ""
    return hashlib.sha256(key.encode()).hexdigest()[:12] if key else "platform"


def key_gate(name: str, limit: int, key_id: Optional[str] = None) -> asyncio.Semaphore:
    """The FIFO semaphore ``name`` for one Mistral key, sized ``limit``.

    asyncio's Semaphore wakes waiters in the order they arrived, so this is a
    fair queue. A new limit (from the Settings page) takes effect for waiters
    that arrive after the change.
    """
    limit = max(1, int(limit))
    # Keyed by loop too: a semaphore belongs to the loop that first awaits it.
    k = (id(asyncio.get_running_loop()), name, key_id or current_key_id())
    hit = _gates.get(k)
    if hit is None or hit[0] != limit:
        hit = (limit, asyncio.Semaphore(limit))
        _gates[k] = hit
    return hit[1]
