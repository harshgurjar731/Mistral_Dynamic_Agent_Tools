"""/admin/cleanup: every synthesised tool, finished job and generated document
goes; native tools and jobs still running stay."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import SynthesisJob, ToolRecord
from app.routes import management


def _tool(name, tool_id, module_path=None):
    return ToolRecord(
        id=tool_id, name=name, hash=f"h{tool_id}", schema_json="{}", source_code="def run(): pass",
        module_path=module_path, status="approved", version_no=1, is_active=True,
    )


def test_cleanup_keeps_native_tools_and_running_jobs(clean_db, tmp_path, monkeypatch):
    module = tmp_path / "my_tool_h2.py"
    module.write_text("def run(): pass")
    docs = tmp_path / "documents"
    docs.mkdir()
    (docs / "report.md").write_text("generated")
    monkeypatch.setattr(management, "_DOCUMENTS_DIR", str(docs))
    seeded = []
    monkeypatch.setattr("app.seed_native_tools.seed_native_tools", lambda db: seeded.append(True))

    clean_db.add_all([
        _tool("get_weather", 1),
        _tool("my_tool", 2, str(module)),
        _tool("my_activity", 3),
        SynthesisJob(id="done", spec_hash="a", name="my_tool", status="approved", spec_json="{}"),
        SynthesisJob(id="busy", spec_hash="b", name="other", status="running", spec_json="{}"),
    ])
    clean_db.commit()

    app = FastAPI()
    app.include_router(management.router)
    client = TestClient(app)

    preview = client.get("/admin/cleanup").json()
    assert preview == {"tools": 2, "tool_versions": 2, "synthesis_jobs": 2, "documents": 1}

    result = client.post("/admin/cleanup").json()
    assert result["tools"] == 2 and result["synthesis_jobs"] == 1
    assert result["synthesis_jobs_kept_running"] == 1 and result["documents"] == 1

    clean_db.expire_all()
    assert [t.name for t in clean_db.query(ToolRecord).all()] == ["get_weather"]
    assert [j.id for j in clean_db.query(SynthesisJob).all()] == ["busy"]
    assert not module.exists() and not any(docs.iterdir())
    assert seeded == [True], "native tools are re-seeded"
