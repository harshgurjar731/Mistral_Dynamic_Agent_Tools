"""Job API: de-duplication, waiting, recovery, and the HTTP surface."""

import threading
import time

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import SynthesisJob
from app.synthesis import jobs
from app.synthesis.jobs import JobManager
from tests.samples import GST_SPEC, gst_spec


def _slow_runner(release: threading.Event, calls: list):
    def runner(spec, session_factory, emit=None, job_id=None):
        calls.append(spec.name)
        emit("build", "working", None)
        release.wait(5)
        return {"status": "approved", "tool_name": spec.name, "message": "ok", "tool_id": 7, "version": 1}
    return runner


def test_identical_in_flight_requests_share_a_job(clean_db):
    release, calls = threading.Event(), []
    manager = JobManager(SessionLocal, runner=_slow_runner(release, calls), workers=2)
    first, joined_a = manager.submit(gst_spec())
    second, joined_b = manager.submit(gst_spec())
    assert first == second and joined_b and not joined_a
    release.set()
    result = manager.wait(first, 5)
    assert result["status"] == "approved" and result["job_id"] == first
    assert calls == ["apply_gst"]
    events, done = manager.events(first)
    assert done and [e["stage"] for e in events][:2] == ["queued", "build"]
    manager.shutdown()


def test_wait_times_out_while_running(clean_db):
    release, calls = threading.Event(), []
    manager = JobManager(SessionLocal, runner=_slow_runner(release, calls), workers=1)
    job_id, _ = manager.submit(gst_spec())
    assert manager.wait(job_id, 0.2) is None
    release.set()
    assert manager.wait(job_id, 5)["status"] == "approved"
    manager.shutdown()


def test_recover_marks_orphans_interrupted(clean_db):
    clean_db.add(SynthesisJob(id="orphan", spec_hash="h", name="x", purpose="tool",
                              status="running", spec_json="{}"))
    clean_db.commit()
    manager = JobManager(SessionLocal, runner=lambda *a, **k: {}, workers=1)
    assert manager.recover() == 1
    assert manager.get("orphan")["status"] == "interrupted"
    manager.shutdown()


def test_http_job_api_and_legacy_synthesize(clean_db, monkeypatch):
    from app.config import settings
    from app.main import app

    release, calls = threading.Event(), []
    manager = JobManager(SessionLocal, runner=_slow_runner(release, calls), workers=2)
    jobs.set_manager(manager)
    monkeypatch.setattr(settings, "SYNTHESIZE_WAIT_SECONDS", 0.3)
    try:
        client = TestClient(app)
        pending = client.post("/synthesize", json=GST_SPEC)
        assert pending.status_code == 202 and pending.json()["job_id"]
        job_id = pending.json()["job_id"]

        again = client.post("/synthesis/jobs", json=GST_SPEC)
        assert again.status_code == 202 and again.json()["job_id"] == job_id
        assert again.json()["joined_existing"] is True

        release.set()
        for _ in range(50):
            info = client.get(f"/synthesis/jobs/{job_id}").json()
            if info["result"]:
                break
            time.sleep(0.1)
        assert info["result"]["status"] == "approved"

        stream = client.get(f"/synthesis/jobs/{job_id}/events")
        assert "event: result" in stream.text and "working" in stream.text

        assert client.get("/synthesis/jobs/nope").status_code == 404
        assert "codegen" in client.get("/models").json()
    finally:
        jobs.set_manager(None)
        manager.shutdown()
