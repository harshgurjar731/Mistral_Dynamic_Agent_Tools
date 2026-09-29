"""
Synthesis jobs — asynchronous, de-duplicated, observable.

A synthesis takes minutes with reasoning models, which no HTTP request should
be held open for: the backend's 180s timeout used to fire while the service
carried on, so the tool appeared later while the workflow had already recorded
"synthesis failed".

Jobs run on a bounded thread pool. Two requests for the same spec while the
first is still running share one job. Progress events are kept in memory for
streaming and persisted with the job, and a job that was running when the
service stopped is marked ``interrupted`` on the next start rather than left
"running" forever.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Optional

from app.config import settings
from app.models import SynthesisJob
from app.synthesis.spec import SynthesisSpec

logger = logging.getLogger(__name__)

TERMINAL = {"approved", "pending_approval", "failed", "spec_invalid", "interrupted"}


@dataclass
class _Job:
    id: str
    spec_hash: str
    name: str
    purpose: str
    status: str = "queued"
    events: list[dict] = field(default_factory=list)
    result: Optional[dict] = None
    done: threading.Event = field(default_factory=threading.Event)
    created: float = field(default_factory=time.time)


class JobManager:
    def __init__(self, session_factory: Callable, runner: Optional[Callable] = None,
                 workers: Optional[int] = None):
        from app.synthesis.pipeline import run_synthesis

        self._session_factory = session_factory
        self._runner = runner or run_synthesis
        self._pool = ThreadPoolExecutor(max_workers=workers or settings.SYNTHESIS_WORKERS,
                                        thread_name_prefix="synth")
        self._lock = threading.Lock()
        self._jobs: dict[str, _Job] = {}
        self._in_flight: dict[str, str] = {}  # spec_hash → job id

    # ── lifecycle ───────────────────────────────────────────────────────

    def recover(self) -> int:
        """Mark jobs left running by a previous process as interrupted."""
        db = self._session_factory()
        try:
            stale = db.query(SynthesisJob).filter(SynthesisJob.status.in_(("queued", "running"))).all()
            for row in stale:
                row.status = "interrupted"
                row.result_json = json.dumps({
                    "status": "interrupted", "tool_name": row.name,
                    "message": "The service restarted while this job was running; submit it again.",
                })
            db.commit()
            return len(stale)
        finally:
            db.close()

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    # ── submission ──────────────────────────────────────────────────────

    def submit(self, spec: SynthesisSpec) -> tuple[str, bool]:
        """Queue ``spec``. Returns ``(job_id, joined_existing)``."""
        spec_hash = spec.content_hash()
        with self._lock:
            # Finished jobs stay readable from the database; memory keeps an hour.
            cutoff = time.time() - 3600
            for old in [j for j in self._jobs.values() if j.done.is_set() and j.created < cutoff]:
                del self._jobs[old.id]
            existing = self._in_flight.get(spec_hash)
            if existing and existing in self._jobs and not self._jobs[existing].done.is_set():
                return existing, True

            job = _Job(id=uuid.uuid4().hex, spec_hash=spec_hash, name=spec.name, purpose=spec.purpose)
            self._jobs[job.id] = job
            self._in_flight[spec_hash] = job.id

        db = self._session_factory()
        try:
            db.add(SynthesisJob(id=job.id, spec_hash=spec_hash, name=spec.name, purpose=spec.purpose,
                                status="queued", spec_json=json.dumps(spec.to_dict(), default=str)))
            db.commit()
        finally:
            db.close()

        self._emit(job, "queued", "job queued", None)
        self._pool.submit(self._run, job, spec)
        return job.id, False

    def _run(self, job: _Job, spec: SynthesisSpec) -> None:
        self._set_status(job, "running")
        try:
            result = self._runner(spec, self._session_factory,
                                  emit=lambda stage, msg, data: self._emit(job, stage, msg, data),
                                  job_id=job.id)
        except Exception as e:  # noqa: BLE001 — run_synthesis already guards; belt and braces
            logger.exception("job %s crashed", job.id)
            result = {"status": "failed", "tool_name": spec.name, "message": f"job crashed: {e}",
                      "fault": "harness"}
        result = {**result, "job_id": job.id}
        job.result = result
        self._emit(job, "done", result.get("message", ""), {"status": result.get("status")})
        self._set_status(job, result.get("status", "failed"), result)
        with self._lock:
            if self._in_flight.get(job.spec_hash) == job.id:
                del self._in_flight[job.spec_hash]
        job.done.set()

    # ── state ───────────────────────────────────────────────────────────

    def _emit(self, job: _Job, stage: str, message: str, data: Optional[dict]) -> None:
        event = {"seq": len(job.events), "ts": time.time(), "stage": stage, "message": message}
        if data:
            event["data"] = data
        job.events.append(event)

    def _set_status(self, job: _Job, status: str, result: Optional[dict] = None) -> None:
        job.status = status
        db = self._session_factory()
        try:
            row = db.get(SynthesisJob, job.id)
            if row is not None:
                row.status = status
                if result is not None:
                    row.result_json = json.dumps(result, default=str)
                    row.events_json = json.dumps(job.events[-300:], default=str)
                db.commit()
        except Exception:  # noqa: BLE001 — the in-memory job is authoritative while live
            logger.warning("could not persist job %s status", job.id, exc_info=True)
        finally:
            db.close()

    def get(self, job_id: str) -> Optional[dict]:
        job = self._jobs.get(job_id)
        if job is not None:
            return {"job_id": job.id, "status": job.status, "tool_name": job.name,
                    "purpose": job.purpose, "result": job.result, "events": len(job.events)}
        db = self._session_factory()
        try:
            row = db.get(SynthesisJob, job_id)
            if row is None:
                return None
            return {"job_id": row.id, "status": row.status, "tool_name": row.name,
                    "purpose": row.purpose,
                    "result": json.loads(row.result_json) if row.result_json else None,
                    "events": len(json.loads(row.events_json)) if row.events_json else 0}
        finally:
            db.close()

    def events(self, job_id: str, since: int = 0) -> tuple[list[dict], bool]:
        """Events after ``since`` and whether the job has finished."""
        job = self._jobs.get(job_id)
        if job is not None:
            return job.events[since:], job.done.is_set()
        db = self._session_factory()
        try:
            row = db.get(SynthesisJob, job_id)
            if row is None:
                return [], True
            events = json.loads(row.events_json) if row.events_json else []
            return events[since:], row.status in TERMINAL
        finally:
            db.close()

    def wait(self, job_id: str, timeout: float) -> Optional[dict]:
        """The result if the job finishes within ``timeout`` seconds, else None."""
        job = self._jobs.get(job_id)
        if job is None:
            info = self.get(job_id)
            return info.get("result") if info else None
        if job.done.wait(timeout):
            return job.result
        return None


_manager: Optional[JobManager] = None
_manager_lock = threading.Lock()


def get_manager() -> JobManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            from app.database import SessionLocal

            _manager = JobManager(SessionLocal)
        return _manager


def set_manager(manager: Optional[JobManager]) -> None:
    """For tests."""
    global _manager
    with _manager_lock:
        _manager = manager
