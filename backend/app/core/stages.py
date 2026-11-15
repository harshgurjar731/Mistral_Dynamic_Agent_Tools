"""
Stages, sublayers and backtracking — the structure every creation pipeline is built from.

A pipeline is a flat middleware chain of layers (``app.core.pipeline``). On top
of it:

* **Stages** group consecutive layers under one name ("Understand", "Design",
  "Build", "Verify"…). A stage is only a grouping — execution stays the flat
  chain, so a layer that wraps the rest still wraps it — but the UI draws the
  stage as one row with its layers nested inside, and the stage is announced
  active when its first layer starts and settled when its last one does.

* **Sublayers** are the atomic steps inside a layer, announced as they happen:
  a decision's *decide → check → repair* cycle, each activity being built,
  each scenario of a dry run, each repair round. ``emit_sublayer`` publishes one
  state change; ``sublayer`` wraps a block of work.

* **Backtracking.** A layer that finds a problem another (earlier, side-effect
  free) layer is responsible for asks the pipeline to *rewind*: the pipeline
  restores the spec as it was before that layer, hands the layer the problems
  to fix, and runs the chain again from there. Bounded by ``MAX_REWINDS``.
"""

from __future__ import annotations

import contextlib
import time
from typing import Iterable, Optional

#: ctx.metadata key: a rewind requested by the layer that just ran.
REWIND_KEY = "_rewind_request"
#: ctx.metadata key: {layer_name: [problem, ...]} handed to a layer being re-run.
REPAIR_ISSUES_KEY = "_repair_issues"
#: ctx.metadata key: how many rewinds this run has made.
REWIND_COUNT_KEY = "_rewind_count"
MAX_REWINDS = 2


class Stage:
    """A named, ordered group of layers — drawn as one row with its layers inside."""

    def __init__(self, name: str, label: str, detail: str, layers: list) -> None:
        self.name = name
        self.label = label
        self.detail = detail
        self.layers = list(layers)

    def describe(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "detail": self.detail,
            "stage": True,
            "hidden": False,
            "children": [layer.describe() for layer in self.layers],
        }


# ── Sublayers ──────────────────────────────────────────────────────────────


def emit_sublayer(ctx, parent: str, sub_id: str, state: str, *, label: str = "",
                  summary: str = "", detail: str = "", ms: Optional[float] = None,
                  error: str = "") -> None:
    """Announce one atomic step inside ``parent`` (pending/active/completed/failed/skipped)."""
    payload: dict = {"parent": parent, "id": sub_id, "state": state}
    if label:
        payload["label"] = label[:160]
    if summary:
        payload["summary"] = summary[:500]
    if detail:
        payload["detail"] = detail[:300]
    if ms is not None:
        payload["ms"] = round(ms)
    if error:
        payload["error"] = error[:500]
    ctx.emit("sublayer", payload)


@contextlib.asynccontextmanager
async def sublayer(ctx, parent: str, sub_id: str, label: str, detail: str = ""):
    """Run a block as one sublayer. The block may set ``.summary`` on what it yields;
    an exception marks the sublayer failed and propagates."""
    class _Row:
        summary = ""

    row = _Row()
    started = time.monotonic()
    emit_sublayer(ctx, parent, sub_id, "active", label=label, detail=detail)
    try:
        yield row
    except Exception as e:
        emit_sublayer(ctx, parent, sub_id, "failed", label=label, error=str(e),
                      ms=(time.monotonic() - started) * 1000)
        raise
    emit_sublayer(ctx, parent, sub_id, "completed", label=label, summary=row.summary,
                  ms=(time.monotonic() - started) * 1000)


# ── Backtracking ───────────────────────────────────────────────────────────


def request_rewind(ctx, *, from_layer: str, issues_by_layer: dict[str, list[str]], reason: str) -> bool:
    """Ask the pipeline to re-run from the earliest responsible layer. False when spent."""
    if int(ctx.metadata.get(REWIND_COUNT_KEY) or 0) >= MAX_REWINDS:
        return False
    issues_by_layer = {k: v for k, v in issues_by_layer.items() if v}
    if not issues_by_layer:
        return False
    ctx.metadata[REWIND_KEY] = {"from": from_layer, "issues": issues_by_layer, "reason": reason}
    return True


def repair_issues_for(ctx, layer_name: str) -> list[str]:
    """Problems a re-run layer must fix (consumed on read)."""
    pending = ctx.metadata.get(REPAIR_ISSUES_KEY) or {}
    return list(pending.pop(layer_name, None) or [])


def repair_block(issues: Iterable[str]) -> str:
    issues = [str(i) for i in issues if str(i).strip()]
    if not issues:
        return ""
    lines = "\n".join(f"- {i}" for i in issues[:20])
    return ("\n\n## PROBLEMS FOUND IN YOUR PREVIOUS DESIGN — FIX EVERY ONE\n"
            "A later check of the workflow built from your previous answer found these. "
            "Return the complete corrected answer; keep everything that was right.\n" + lines)
