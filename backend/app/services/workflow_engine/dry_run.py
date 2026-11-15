"""
Dry runs — a workflow run end to end with its side effects stubbed.

Used by the planner's Verify stage (and the review's "Test") to run a freshly
built workflow on designed scenarios before anyone relies on it. Inside a dry
run:

* **connector steps** are not called — they act on outside systems (send an
  email, write a record). The step returns what it *would* have sent, with its
  arguments resolved exactly as a real run would, so wiring is still checked;
* **human review steps** do not wait for a person — they approve at once.

Agents, activities, conditions and transforms run for real: they are what the
dry run is there to test. The flag is a context variable, so it reaches the
step runners through ``asyncio.gather`` in parallel groups and never leaks
into another request.
"""

from __future__ import annotations

import contextlib
import time
from contextvars import ContextVar
from typing import Any

_ACTIVE: ContextVar[bool] = ContextVar("workflow_dry_run", default=False)


def active() -> bool:
    return _ACTIVE.get()


@contextlib.contextmanager
def enabled():
    token = _ACTIVE.set(True)
    try:
        yield
    finally:
        _ACTIVE.reset(token)


def stubs(step) -> bool:
    kind = getattr(step.type, "value", step.type)
    return active() and kind in ("connector", "human_review")


def stub_result(step, variables: dict):
    """What a stubbed step returns in a dry run."""
    from app.services.workflow_engine.models import StepResult

    started = time.time()
    kind = getattr(step.type, "value", step.type)
    if kind == "human_review":
        output: Any = {"review": {"decision": "approved", "comment": "dry run — approved automatically",
                                  "decided_by": "dry-run", "dry_run": True}}
        preview = "Dry run: approved automatically"
    else:
        from app.services.workflow_engine.step_runners import resolve_connector_arguments

        try:
            arguments = resolve_connector_arguments(step, variables)
        except Exception as e:  # noqa: BLE001 — a wiring fault is what the dry run reports
            from app.services.workflow_engine.models import StepResult as _R

            return _R(step_id=step.id, status="failed", error=f"Dry run: connector arguments: {e}",
                      duration_ms=(time.time() - started) * 1000)
        config = step.config or {}
        output = {"dry_run": True, "connector": config.get("connector_name") or config.get("connector_id"),
                  "tool": config.get("tool_name"), "would_send": arguments}
        preview = f"Dry run: would call {config.get('tool_name')}"
    return StepResult(step_id=step.id, status="completed", output=output,
                      duration_ms=(time.time() - started) * 1000, output_preview=preview)
