"""
Live progress for ordinary requests — what a request is doing, while it does it.

Background runs (``app.runs``) already stream their pipeline. Every other action
— deploy, ingest, test, validate, clean up — is a single request the UI used to
wait on behind a spinner. This module gives each of them a progress feed:

* the browser tags a request with an ``X-Op-Id`` header (any request — the
  middleware binds the op for the request's lifetime, see ``middleware``);
* whatever the request does while it runs is published to that op: the stages
  an endpoint reports itself (``report``), pipeline layers, app spans (tools,
  workflow steps), model calls and the app's own log lines;
* the browser follows ``GET /api/ops/{id}/events`` (SSE) — replay, then live.

Nothing here is required: outside a tagged request every function is a no-op,
so code can report progress unconditionally.
"""

from app.progress.tracker import (
    current,
    detach,
    note,
    part,
    pipeline_event,
    registry,
    report,
    stage,
    step_begin,
    step_end,
)

__all__ = [
    "current", "detach", "note", "part", "pipeline_event", "registry", "report", "stage",
    "step_begin", "step_end",
]
