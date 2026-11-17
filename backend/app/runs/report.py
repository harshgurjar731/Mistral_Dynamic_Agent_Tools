"""
The planning report of a background run — what happened, when, and for how long.

Built from the run's own event log, so it covers live runs, finished runs and
runs replayed from SQLite alike:

* **layers** — every layer of the pipeline manifest, with when it started and
  ended, its measured duration, outcome, summary, error and its sublayers;
* **decisions** — every question the run asked, when, the answer, who gave it
  (the user, or the deadline taking the recommended choice) and how long the
  run waited;
* **rewinds** — each time a check sent the run back to an earlier layer;
* **calls** — model and tool calls (``app.progress`` steps), by kind and by
  model, with their time;
* **errors** — the errors the run reported.

Events recorded before timestamps were kept have no ``at``; the report then
still has durations (``ms`` comes from the layer events) but no start times.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Optional

Event = tuple  # (seq, event, data, at_ms | None)


def _parse(data: Any) -> Any:
    if not isinstance(data, str):
        return data
    try:
        return json.loads(data)
    except (TypeError, ValueError):
        return data


def _ms(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _flatten(entries: list, depth: int = 0, parent: Optional[str] = None) -> list[dict]:
    """Manifest entries in display order, stages before their layers."""
    out: list[dict] = []
    for entry in entries or []:
        if not isinstance(entry, dict) or entry.get("hidden"):
            continue
        name = str(entry.get("name") or "")
        if not name:
            continue
        children = entry.get("children") or []
        out.append({
            "name": name,
            "label": str(entry.get("label") or name),
            "detail": str(entry.get("detail") or ""),
            "stage": bool(entry.get("stage") or children),
            "parent": parent,
            "depth": depth,
        })
        out.extend(_flatten(children, depth + 1, name))
        out.extend(_flatten(entry.get("concurrent") or [], depth + 1, name))
    return out


def build_report(summary: dict, events: list[Event]) -> dict:
    started_ms = _ms(summary.get("created_at"))
    finished_ms = _ms(summary.get("finished_at"))
    running = summary.get("status") == "running"
    now_ms = int(time.time() * 1000)

    layers: dict[str, dict] = {}
    order: list[str] = []
    decisions: dict[str, dict] = {}
    rewinds: list[dict] = []
    errors: list[dict] = []
    steps: dict[Any, dict] = {}
    counts: dict[str, int] = {}
    last_at: Optional[int] = None
    timed = False

    def layer(name: str) -> dict:
        if name not in layers:
            layers[name] = {"name": name, "label": name, "detail": "", "stage": False,
                            "parent": None, "depth": 0, "state": "pending",
                            "started_at": None, "ended_at": None, "ms": None,
                            "summary": None, "error": None, "subs": [], "runs": 0}
            order.append(name)
        return layers[name]

    for item in events:
        seq, event, data = item[0], item[1], item[2]
        at = item[3] if len(item) > 3 else None
        if at:
            timed = True
            last_at = at
        counts[event] = counts.get(event, 0) + 1
        payload = _parse(data)

        if event == "pipeline" and isinstance(payload, dict):
            for entry in _flatten(payload.get("layers") or []):
                row = layer(entry["name"])
                row.update({k: entry[k] for k in ("label", "detail", "stage", "parent", "depth")})
        elif event == "layer" and isinstance(payload, dict) and payload.get("name"):
            row = layer(str(payload["name"]))
            state = str(payload.get("state") or "")
            if state == "active":
                row["runs"] += 1
                # A rewound layer runs again: its timing is the latest run's.
                row["started_at"] = at
                row["ended_at"] = None
                row["error"] = None
            elif state in ("completed", "failed", "skipped"):
                row["ended_at"] = at
            if state:
                row["state"] = state
            if payload.get("ms") is not None:
                row["ms"] = payload["ms"]
            if payload.get("summary"):
                row["summary"] = payload["summary"]
            if payload.get("error"):
                row["error"] = payload["error"]
        elif event == "sublayer" and isinstance(payload, dict) and payload.get("parent"):
            row = layer(str(payload["parent"]))
            sub_id = str(payload.get("id") or "")
            sub = next((s for s in row["subs"] if s["id"] == sub_id), None)
            if sub is None:
                sub = {"id": sub_id, "label": sub_id, "state": "active", "ms": None,
                       "summary": None, "error": None, "started_at": at}
                row["subs"].append(sub)
            for key in ("label", "state", "ms", "summary", "error"):
                if payload.get(key) not in (None, ""):
                    sub[key] = payload[key]
        elif event == "rewind" and isinstance(payload, dict):
            rewinds.append({"round": payload.get("round"), "to": payload.get("to"),
                            "from": payload.get("from"), "reason": payload.get("reason"),
                            "at": at})
        elif event == "decision_required" and isinstance(payload, dict) and payload.get("id"):
            decisions[str(payload["id"])] = {
                "id": str(payload["id"]),
                "kind": payload.get("kind"),
                "title": payload.get("title") or payload.get("question") or payload.get("kind"),
                "options": payload.get("options") or [],
                "recommended": payload.get("recommended") or payload.get("default"),
                "asked_at": at,
                "answered_at": None,
                "waited_ms": None,
                "choice": None,
                "by": None,
                "extended": 0,
            }
        elif event == "decision_extended" and isinstance(payload, dict):
            d = decisions.get(str(payload.get("id")))
            if d:
                d["extended"] += 1
        elif event == "decision_made" and isinstance(payload, dict):
            d = decisions.get(str(payload.get("id")))
            if d:
                d["choice"] = payload.get("choice")
                d["by"] = payload.get("by")
                d["answered_at"] = at
                if at and d["asked_at"]:
                    d["waited_ms"] = max(0, at - d["asked_at"])
        elif event == "step" and isinstance(payload, dict) and payload.get("id") is not None:
            step = steps.setdefault(payload["id"], {"kind": None, "name": None, "state": "active",
                                                    "ms": None, "error": None})
            for key in ("kind", "name", "state", "ms", "error"):
                if payload.get(key) not in (None, ""):
                    step[key] = payload[key]
        elif event in ("error", "fatal_error"):
            message = payload.get("error") if isinstance(payload, dict) else payload
            errors.append({"at": at, "message": str(message or "")[:2000]})

    end_ms = finished_ms or (now_ms if running else last_at)
    duration_ms = (end_ms - started_ms) if (started_ms and end_ms) else None

    # Each layer's offset from the start, for a time chart.
    out_layers = []
    for name in order:
        row = layers[name]
        if row["ms"] is None and row["started_at"] and row["ended_at"]:
            row["ms"] = row["ended_at"] - row["started_at"]
        if row["state"] == "active" and row["started_at"] and running:
            row["elapsed_ms"] = now_ms - row["started_at"]
        row["offset_ms"] = (row["started_at"] - started_ms) if (row["started_at"] and started_ms) else None
        out_layers.append(row)

    out_decisions = list(decisions.values())
    for d in out_decisions:
        if d["answered_at"] is None and d["asked_at"] and running:
            d["waited_ms"] = now_ms - d["asked_at"]
        d["offset_ms"] = (d["asked_at"] - started_ms) if (d["asked_at"] and started_ms) else None
    waiting_ms = sum(d["waited_ms"] or 0 for d in out_decisions)

    by_kind: dict[str, dict] = {}
    models: dict[str, dict] = {}
    for step in steps.values():
        kind = str(step["kind"] or "step")
        agg = by_kind.setdefault(kind, {"kind": kind, "count": 0, "ms": 0, "failed": 0})
        agg["count"] += 1
        agg["ms"] += int(step["ms"] or 0)
        agg["failed"] += 1 if step["state"] == "failed" else 0
        if kind == "model":
            name = str(step["name"] or "model")
            m = models.setdefault(name, {"name": name, "count": 0, "ms": 0, "failed": 0})
            m["count"] += 1
            m["ms"] += int(step["ms"] or 0)
            m["failed"] += 1 if step["state"] == "failed" else 0

    visible = [l for l in out_layers if not l["stage"]]
    return {
        "run": summary,
        "timed": timed,
        "started_at": summary.get("created_at"),
        "finished_at": summary.get("finished_at"),
        "duration_ms": duration_ms,
        "waiting_ms": waiting_ms,
        "working_ms": (duration_ms - waiting_ms) if duration_ms is not None else None,
        "layers": out_layers,
        "layer_counts": {
            "total": len(visible),
            "completed": sum(1 for l in visible if l["state"] == "completed"),
            "failed": sum(1 for l in visible if l["state"] == "failed"),
            "skipped": sum(1 for l in visible if l["state"] == "skipped"),
        },
        "decisions": out_decisions,
        "rewinds": rewinds,
        "calls": sorted(by_kind.values(), key=lambda a: -a["count"]),
        "models": sorted(models.values(), key=lambda m: -m["count"]),
        "errors": errors,
        "event_counts": counts,
    }
