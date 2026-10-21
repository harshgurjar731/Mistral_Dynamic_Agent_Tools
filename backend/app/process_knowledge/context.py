"""
ProcessContext — the selected documents, shaped for each layer that reads them.

Every element a layer can use gets a stable reference id (``stage:affordability``,
``control:kyc``, ``risk:unexplained_decline``). Layers are asked to name the
references they actually used, and only references in this index are recorded,
so the "where was process knowledge used" display reports what a layer did, not
what it was shown.

Each view is a compact rendering for one decision and is capped in size: a
topology decision needs stage order and decision outcomes, not the glossary,
and every character here is paid for on every call that reads it.
"""

from __future__ import annotations

import json
from typing import Any, Optional

#: Upper bound on one rendered view. Roughly 2k tokens.
_VIEW_CHARS = 7000

_SECTIONS = ("stages", "controls", "exceptions", "risks", "regulations", "actors",
             "kpis", "data_entities")
_PREFIX = {"stages": "stage", "controls": "control", "exceptions": "exception", "risks": "risk",
           "regulations": "regulation", "actors": "actor", "kpis": "kpi",
           "data_entities": "data"}


def _label(item: dict, section: str) -> str:
    for key in ("name", "label", "description", "condition", "id"):
        if item.get(key):
            return str(item[key])[:120]
    return section


def _item_id(item: dict, index: int) -> str:
    return str(item.get("id") or item.get("name") or index).strip().lower().replace(" ", "_")


def build(documents: list[dict], *, mode: str, message: str = "",
          candidates: Optional[list[dict]] = None, scope_label: str = "") -> dict:
    """Assemble the context from resolved documents (primary first)."""
    primary = documents[0]
    content = primary.get("content") or {}
    refs: dict[str, dict] = {}
    merged: dict[str, list] = {s: [] for s in _SECTIONS}

    for doc in documents:
        body = doc.get("content") or {}
        is_primary = doc is primary
        for section in _SECTIONS:
            for i, item in enumerate(body.get(section) or []):
                if not isinstance(item, dict):
                    continue
                ref = f"{_PREFIX[section]}:{_item_id(item, i)}"
                if ref in refs:
                    # A subprocess restating a parent's stage id: the parent wins.
                    continue
                refs[ref] = {"type": _PREFIX[section], "label": _label(item, section),
                             "document_id": doc["id"], "document_version": doc.get("version"),
                             "concept_id": doc.get("concept_id")}
                merged[section].append({**item, "_ref": ref,
                                        **({} if is_primary else {"_from": doc.get("title")})})

    return {
        "enabled": True,
        "mode": mode,
        "message": message,
        "scope_label": scope_label,
        "documents": [
            {"id": d["id"], "title": d.get("title"), "version": d.get("version"),
             "concept_id": d.get("concept_id"), "source": d.get("source"),
             "path": d.get("path"), "label": d.get("label"), "stats": d.get("stats") or {},
             "role": "primary" if d is primary else "related"}
            for d in documents
        ],
        "candidates": candidates or [],
        "process": content.get("process") or {},
        "objective": content.get("objective") or "",
        "scope": content.get("scope") or {},
        "triggers": content.get("triggers") or [],
        "glossary": content.get("glossary") or {},
        **merged,
        "refs": refs,
    }


# ── Views ──────────────────────────────────────────────────────────────────


def _stage_line(s: dict, *, io: bool = True, decision: bool = True) -> str:
    parts = [f"- [{s['_ref']}] {s.get('name') or s.get('id')}"]
    if s.get("actor_type"):
        parts.append(f"({s['actor_type']}" + (f": {s['actor']}" if s.get("actor") else "") + ")")
    line = " ".join(parts)
    if s.get("purpose"):
        line += f" — {s['purpose']}"
    extra = []
    if io and s.get("inputs"):
        extra.append(f"inputs: {', '.join(map(str, s['inputs']))}")
    if io and s.get("outputs"):
        extra.append(f"outputs: {', '.join(map(str, s['outputs']))}")
    if s.get("depends_on"):
        extra.append(f"after: {', '.join(map(str, s['depends_on']))}")
    if s.get("controls"):
        extra.append(f"controls: {', '.join(map(str, s['controls']))}")
    if decision and isinstance(s.get("decision"), dict):
        outs = [
            str(o.get("label")) + (f"→{o['next_stage']}" if o.get("next_stage") else "")
            + (f" when {o['condition']}" if o.get("condition") else "")
            for o in s["decision"].get("outcomes") or [] if isinstance(o, dict)
        ]
        if outs:
            extra.append("decision: " + "; ".join(outs))
    if s.get("_from"):
        extra.append(f"from subprocess '{s['_from']}'")
    return line + (f"\n    {' | '.join(extra)}" if extra else "")


def _simple(items: list[dict], *fields: str) -> list[str]:
    lines = []
    for item in items:
        bits = [str(item.get(f)) for f in fields if item.get(f) not in (None, "", [])]
        flag = ""
        if item.get("mandatory") is True:
            flag = " (MANDATORY)"
        if item.get("severity"):
            flag = f" ({item['severity']})"
        applies = item.get("applies_to")
        tail = f" — applies to: {', '.join(map(str, applies))}" if applies else ""
        lines.append(f"- [{item['_ref']}]{flag} " + " — ".join(bits) + tail)
    return lines


def _section(title: str, lines: list[str]) -> str:
    return f"{title}:\n" + "\n".join(lines) if lines else ""


def _focus_stages(ctx: dict, focus: Optional[str]) -> list[dict]:
    if not focus:
        return []
    want = focus.split(":", 1)[-1]
    return [s for s in ctx["stages"] if s["_ref"] == f"stage:{want}" or s.get("id") == want]


def _related_to(items: list[dict], stage_ids: set[str], stage_controls: set[str]) -> list[dict]:
    return [
        i for i in items
        if set(map(str, i.get("applies_to") or [])) & stage_ids
        or str(i.get("id")) in stage_controls
    ]


def render(ctx: dict, view: str, *, focus: Optional[str] = None) -> str:
    """The text block for one layer. Empty string when there is nothing useful."""
    head = ctx.get("process") or {}
    name = head.get("name") or (ctx["documents"][0].get("title") if ctx.get("documents") else "")
    stages, controls = ctx["stages"], ctx["controls"]
    parts: list[str] = []

    def add(text: str) -> None:
        if text:
            parts.append(text)

    if view in ("decomposition", "agent_instructions", "agent_identity", "revision"):
        add(f"Objective: {ctx['objective']}" if ctx.get("objective") else "")
        scope = ctx.get("scope") or {}
        if scope.get("in_scope") or scope.get("out_of_scope"):
            add("Scope: in — " + ", ".join(map(str, scope.get("in_scope") or []))
                + ("; out — " + ", ".join(map(str, scope["out_of_scope"]))
                   if scope.get("out_of_scope") else ""))
        if ctx.get("triggers"):
            add("Triggers: " + "; ".join(map(str, ctx["triggers"])))

    if view in ("decomposition", "topology", "revision"):
        add(_section("Stages, in order", [_stage_line(s) for s in stages]))
        add(_section("Mandatory controls", _simple(
            [c for c in controls if c.get("mandatory") is True], "description")))
        if view != "decomposition":
            add(_section("Exceptions", _simple(ctx["exceptions"], "condition", "handling")))
    elif view == "execution_mode":
        add(_section("Who performs each stage", [
            f"- [{s['_ref']}] {s.get('name')}: {s.get('actor_type') or 'unspecified'}"
            + (f" ({s['actor']})" if s.get("actor") else "") for s in stages]))
        add(_section("Actors", _simple(ctx["actors"], "name", "type")))
    elif view == "data_flow":
        add(_section("Stage inputs and outputs (use these names where they fit)",
                     [_stage_line(s, decision=False) for s in stages]))
        add(_section("Data entities", [
            f"- [{d['_ref']}] {d.get('name')}"
            + (f" ({d['classification']})" if d.get("classification") else "")
            + (f": {', '.join(map(str, d['fields']))}" if d.get("fields") else "")
            for d in ctx["data_entities"]]))
    elif view in ("guardrail", "agent_guardrail"):
        add(_section("Risks", _simple(ctx["risks"], "description", "mitigation")))
        add(_section("Controls", _simple(controls, "description")))
        add(_section("Regulations", _simple(ctx["regulations"], "name", "requirement")))
        add(_section("Data sensitivity", [
            f"- [{d['_ref']}] {d.get('name')}: {d.get('classification')}"
            for d in ctx["data_entities"] if d.get("classification")]))
    elif view in ("rules", "agent_rules"):
        add(_section("Controls", _simple(controls, "description", "regulation")))
        add(_section("Regulations", _simple(ctx["regulations"], "name", "requirement")))
    elif view in ("agent_tools", "agent_connectors", "agent_libraries"):
        add(_section("Stages and what they read and produce",
                     [_stage_line(s, decision=False) for s in stages]))
        add(_section("Systems and actors involved",
                     _simple([a for a in ctx["actors"] if a.get("type") in ("system", "external")],
                             "name", "type")))
        add(_section("Data entities", [f"- [{d['_ref']}] {d.get('name')}"
                                       for d in ctx["data_entities"]]))
    elif view == "agent_identity":
        add(_section("Stages", [f"- [{s['_ref']}] {s.get('name')}" for s in stages]))
    elif view == "design":
        focused = _focus_stages(ctx, focus)
        if focused:
            ids = {str(s.get("id")) for s in focused}
            stage_controls = {str(c) for s in focused for c in s.get("controls") or []}
            add(_section("The process stage this agent performs",
                         [_stage_line(s) for s in focused]))
            add(_section("Controls it must satisfy",
                         _simple(_related_to(controls, ids, stage_controls), "description")))
            add(_section("Exceptions it must handle",
                         _simple(_related_to(ctx["exceptions"], ids, set()), "condition", "handling")))
        else:
            add(_section("Process stages (find the one this agent performs)",
                         [_stage_line(s, decision=False) for s in stages]))
            add(_section("Mandatory controls",
                         _simple([c for c in controls if c.get("mandatory") is True], "description")))
        add(_section("Risks", _simple(ctx["risks"], "description", "mitigation")))
        add(_section("Regulations", _simple(ctx["regulations"], "name", "requirement")))
    elif view == "agent_instructions":
        add(_section("Stages", [_stage_line(s) for s in stages]))
        add(_section("Controls", _simple(controls, "description")))
        add(_section("Exceptions", _simple(ctx["exceptions"], "condition", "handling")))
        add(_section("Risks", _simple(ctx["risks"], "description", "mitigation")))
        add(_section("KPIs", [f"- [{k['_ref']}] {k.get('name')}"
                              + (f": {k['target']}" if k.get("target") else "")
                              for k in ctx["kpis"]]))
        if ctx.get("glossary"):
            add("Glossary: " + "; ".join(f"{k} = {v}" for k, v in list(ctx["glossary"].items())[:20]))

    body = "\n\n".join(p for p in parts if p)
    if not body:
        return ""
    if len(body) > _VIEW_CHARS:
        body = body[: _VIEW_CHARS - 40].rstrip() + "\n… (truncated to fit)"
    source = ctx["documents"][0] if ctx.get("documents") else {}
    origin = {"uploaded": "uploaded with this request", "inventory": "matched from the process inventory",
              "workflow": "the process this workflow was built for"}.get(ctx.get("mode"), "")
    return (
        f"── PROCESS KNOWLEDGE: \"{name}\" v{source.get('version') or 1}"
        + (f" ({origin})" if origin else "") + " ──\n"
        "A reference process for this request. Follow it where it fits; the user's request "
        "wins on any conflict. Ids in [brackets] are reference ids.\n\n" + body
    )


def refs_instruction(extra: str = "") -> str:
    return (
        "\n\nPROCESS REFERENCES: also include in your JSON output a top-level \"process_refs\" "
        "array — [{\"ref\": \"<a reference id from the PROCESS KNOWLEDGE block, e.g. "
        "stage:intake>\", \"how\": \"<one sentence: what you did because of it>\"}]. List only "
        "elements that actually changed your decision; use [] if none did." + extra
    )


def summary_line(ctx: dict) -> str:
    docs = ctx.get("documents") or []
    if not docs:
        return ""
    primary = docs[0]
    extra = f" + {len(docs) - 1} related" if len(docs) > 1 else ""
    how = {"uploaded": "Using uploaded", "inventory": "Matched from inventory",
           "workflow": "Using the workflow's"}.get(ctx.get("mode"), "Using")
    s = primary.get("stats") or {}
    counts = ", ".join(f"{s[k]} {k}" for k in ("stages", "controls", "risks") if s.get(k))
    return (f"{how}: {primary.get('title')} v{primary.get('version') or 1}{extra}"
            + (f" — {counts}" if counts else "") + ".")


def to_event(ctx: Optional[dict], *, enabled: bool, message: str = "", mode: str = "none",
             candidates: Optional[list[dict]] = None, scope_label: str = "") -> str:
    """The ``process_knowledge`` SSE payload."""
    if ctx:
        payload: dict[str, Any] = {
            "enabled": True, "mode": ctx["mode"], "message": ctx.get("message") or summary_line(ctx),
            "documents": ctx["documents"], "candidates": ctx.get("candidates") or [],
            "scope_label": ctx.get("scope_label") or scope_label,
            "elements": {k: len(ctx.get(k) or []) for k in _SECTIONS},
            "process": ctx.get("process") or {}, "objective": ctx.get("objective") or "",
        }
    else:
        payload = {"enabled": enabled, "mode": mode, "message": message, "documents": [],
                   "candidates": candidates or [], "scope_label": scope_label, "elements": {}}
    return json.dumps(payload, default=str)
