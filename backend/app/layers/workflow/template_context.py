"""
What an agent step is handed, checked and explained — deterministic, after the data-flow decision.

Two failures from the SME equipment finance run, both invisible to validation:

* **Missing context.** The credit-risk agent's capability listed the internal
  credit file as an input, but its template never interpolated it, so defaults
  and late payments were read as "unknown" and a strong case was referred.
  :func:`ensure_capability_inputs` checks every input a capability declares
  against what its template references, and wires each missing one from the
  step that produces it — or, when nothing does, from the run's input record
  (which the input designer then declares as a field of that record).

* **Misread values.** The policy agent was handed the risk assessment as raw
  JSON and read its 0-100 ``risk_score`` as the applicant's credit score.
  :func:`add_value_legend` appends, under the template, what each referenced
  value means — from the producing activity's output schema descriptions or the
  producing agent's declared output contract — so the meaning travels with the
  data.

Both edit only agent ``query_template`` text, are idempotent, and report what
they changed so the reviewer sees it.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

_REF = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
_STEP_OUT = re.compile(r"^step_(.+)_output$")
LEGEND_MARKER = "What the values above mean (from the contracts of the steps that produce them):"
_LEGEND_BUDGET = 1600
_NOTE_BUDGET = 320


def _tokens(name: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", str(name).lower()) if t}


def _matches(wanted: str, candidate: str) -> bool:
    """Same name, or one name's words contained in the other's ("credit_file" ~ "internal_credit_file")."""
    a, b = _tokens(wanted), _tokens(candidate)
    if not a or not b:
        return False
    return a == b or (len(a) >= 2 and a <= b) or (len(b) >= 2 and b <= a)


#: Words that say nothing about which value is meant.
_GENERIC = {"result", "results", "data", "output", "outputs", "detail", "details", "info",
            "information", "record", "records", "value", "values", "the", "of", "and", "from",
            "step", "response", "summary"}


def _loosely(wanted: str, step_name: str) -> bool:
    """An input named after a whole step ("affordability_results" ~ "Affordability calculation")."""
    a, b = _tokens(wanted) - _GENERIC, _tokens(step_name) - _GENERIC
    return bool(a) and bool(b) and (a <= b or b <= a)


def _refs(template: str) -> list[list[str]]:
    return [[p for p in m.strip().split(".") if p] for m in _REF.findall(template or "")]


def _ancestors(steps: list[dict]) -> dict[str, set[str]]:
    parents: dict[str, set[str]] = {s["id"]: set() for s in steps}
    for s in steps:
        cfg = s.get("config") or {}
        for nxt in [*(s.get("next_steps") or []), cfg.get("true_step"), cfg.get("false_step")]:
            if nxt in parents:
                parents[nxt].add(s["id"])
    out: dict[str, set[str]] = {}

    def walk(sid: str, seen: frozenset) -> set[str]:
        if sid in out:
            return out[sid]
        found: set[str] = set()
        for p in parents.get(sid, ()):
            if p not in seen:
                found |= {p} | walk(p, seen | {p})
        out[sid] = found
        return found

    for s in steps:
        walk(s["id"], frozenset({s["id"]}))
    return out


def _output_fields(step: dict, cap: Any, activities: dict[str, dict]) -> set[str]:
    fields = set(getattr(cap, "outputs", None) or [])
    tool = (step.get("config") or {}).get("tool_name")
    out = (activities.get(tool) or {}).get("output") if tool else None
    if isinstance(out, dict):
        fields |= set((out.get("properties") or {}).keys())
    return fields


def ensure_capability_inputs(steps: list[dict], capabilities: Iterable[Any], input_schema: list[dict],
                             activities: Optional[dict[str, dict]] = None) -> list[dict]:
    """Wire every input an agent capability declares into its template. Returns one note per change."""
    activities = activities or {}
    caps = {c.id: c for c in capabilities or []}
    by_id = {s["id"]: s for s in steps}
    ancestors = _ancestors(steps)
    inputs = [f for f in input_schema or [] if isinstance(f, dict) and f.get("name")]
    input_names = {f["name"] for f in inputs}
    records = [f["name"] for f in inputs if str(f.get("type") or "").lower() == "object"]
    notes: list[dict] = []

    for step in steps:
        if step.get("type") != "agent":
            continue
        cap = caps.get(step["id"])
        template = (step.get("config") or {}).get("query_template") or ""
        if not cap or not template:
            continue
        refs = _refs(template)
        added: list[tuple[str, str]] = []
        for wanted in cap.inputs or []:
            if _covered(wanted, refs, by_id, caps, activities):
                continue
            source = _source(wanted, step["id"], ancestors, by_id, caps, activities, input_names, records)
            if not source:
                notes.append({
                    "severity": "warning", "code": "dataflow.input_unbound",
                    "step_id": step["id"], "field": "query_template",
                    "message": (f"Step '{step['id']}' needs '{wanted}', but no earlier step or run "
                                "input provides it, so the agent will work without it."),
                })
                continue
            added.append((wanted, source))
            refs.append([p for p in source.strip("{}").split(".") if p])
        if added:
            block = "\n\n".join(f"{_label(w)}:\n{src}" for w, src in added)
            marker = "\n\n" + LEGEND_MARKER
            if marker in template:
                head, tail = template.split(marker, 1)
                template = f"{head}\n\nAlso provided:\n\n{block}{marker}{tail}"
            else:
                template = f"{template}\n\nAlso provided:\n\n{block}"
            step["config"]["query_template"] = template
            for wanted, src in added:
                from_run = not _STEP_OUT.match(src.strip("{} ").split(".")[0])
                notes.append({
                    "severity": "warning", "code": "dataflow.input_wired",
                    "step_id": step["id"], "field": "query_template",
                    "message": (f"Step '{step['id']}' needs '{wanted}' but its prompt did not include it; "
                                f"wired {src}"
                                + (" from the run input — make sure every run provides it." if from_run
                                   else ".")),
                })
    return notes


def _label(name: str) -> str:
    return re.sub(r"[_\-]+", " ", str(name)).strip().capitalize() or str(name)


def _covered(wanted: str, refs: list[list[str]], by_id: dict, caps: dict, activities: dict) -> bool:
    for parts in refs:
        if any(_matches(wanted, p) for p in parts):
            return True
        m = _STEP_OUT.match(parts[0]) if parts else None
        if m and len(parts) == 1:
            producer = by_id.get(m.group(1))
            if producer and any(_matches(wanted, f) for f in
                                _output_fields(producer, caps.get(producer["id"]), activities)):
                return True
            cap = caps.get(m.group(1))
            if cap and (_loosely(wanted, getattr(cap, "name", "") or "") or _loosely(wanted, cap.id)):
                return True
    return False


def _source(wanted: str, step_id: str, ancestors: dict, by_id: dict, caps: dict, activities: dict,
            input_names: set[str], records: list[str]) -> Optional[str]:
    """Where ``wanted`` comes from: an earlier step's output, a run input, or the run's input record."""
    for sid in ancestors.get(step_id, ()):
        producer = by_id.get(sid)
        if not producer:
            continue
        for field in sorted(_output_fields(producer, caps.get(sid), activities)):
            if _matches(wanted, field):
                return f"{{{{step_{sid}_output.{field}}}}}" if field in _schema_fields(producer, activities) \
                    else f"{{{{step_{sid}_output}}}}"
        cap = caps.get(sid)
        if cap and (_loosely(wanted, getattr(cap, "name", "") or "") or _loosely(wanted, cap.id)):
            return f"{{{{step_{sid}_output}}}}"
    for name in input_names:
        if _matches(wanted, name):
            return f"{{{{{name}}}}}"
    if len(records) == 1:
        return f"{{{{{records[0]}.{_snake(wanted)}}}}}"
    return None


def _schema_fields(step: dict, activities: dict) -> set[str]:
    tool = (step.get("config") or {}).get("tool_name")
    out = (activities.get(tool) or {}).get("output") if tool else None
    return set((out or {}).get("properties") or {}) if isinstance(out, dict) else set()


def _snake(name: str) -> str:
    return "_".join(sorted(_tokens(name), key=lambda t: str(name).lower().find(t))) or "value"


# ── The legend ─────────────────────────────────────────────────────────────


def _schema_notes(schema: dict, prefix: str, depth: int = 0) -> list[str]:
    lines: list[str] = []
    for name, sub in (schema.get("properties") or {}).items():
        if not isinstance(sub, dict):
            continue
        desc = str(sub.get("description") or "").strip()
        unit = []
        if sub.get("minimum") is not None or sub.get("maximum") is not None:
            unit.append(f"range {sub.get('minimum', '…')}–{sub.get('maximum', '…')}")
        if sub.get("enum"):
            unit.append("one of " + ", ".join(map(str, sub["enum"][:8])))
        text = "; ".join(filter(None, [desc, *unit]))
        if text:
            lines.append(f"- {prefix}{name}: {text}")
        if depth < 1 and isinstance(sub.get("properties"), dict):
            lines.extend(_schema_notes(sub, f"{prefix}{name}.", depth + 1))
    return lines


def add_value_legend(steps: list[dict], provisioned_agents: Iterable[dict],
                     activities: Optional[dict[str, dict]] = None,
                     input_schema: Optional[list[dict]] = None) -> int:
    """Append to each agent template what the values it is handed mean. Returns templates changed."""
    activities = activities or {}
    by_id = {s["id"]: s for s in steps}
    contracts = {a.get("capability_id"): a for a in provisioned_agents or [] if isinstance(a, dict)}
    inputs = {f["name"]: f for f in input_schema or [] if isinstance(f, dict) and f.get("name")}
    changed = 0
    for step in steps:
        if step.get("type") != "agent":
            continue
        template = (step.get("config") or {}).get("query_template") or ""
        if not template or LEGEND_MARKER in template:
            continue
        lines: list[str] = []
        seen: set[str] = set()
        for parts in _refs(template):
            head = parts[0] if parts else ""
            if head in seen:
                continue
            m = _STEP_OUT.match(head)
            producer = by_id.get(m.group(1)) if m else None
            if producer and producer.get("type") == "tool":
                out = (activities.get((producer.get("config") or {}).get("tool_name")) or {}).get("output")
                if isinstance(out, dict):
                    notes = _schema_notes(out, f"{head}.")
                    if notes:
                        seen.add(head)
                        lines.extend(notes)
            elif producer and producer.get("type") == "agent":
                agent = contracts.get(producer["id"]) or {}
                detail = str(agent.get("output_contract_detail") or agent.get("output_contract") or "").strip()
                if detail:
                    seen.add(head)
                    lines.append(f"- {head}: {detail[:_NOTE_BUDGET]}")
            elif head in inputs:
                desc = str(inputs[head].get("description") or "").strip()
                nested = inputs[head].get("schema")
                if desc or isinstance(nested, dict):
                    seen.add(head)
                    if desc:
                        lines.append(f"- {head}: {desc[:_NOTE_BUDGET]}")
                    if isinstance(nested, dict):
                        lines.extend(_schema_notes(nested, f"{head}."))
        if not lines:
            continue
        legend, used = [], 0
        for line in lines:
            if used + len(line) > _LEGEND_BUDGET:
                break
            legend.append(line)
            used += len(line)
        step["config"]["query_template"] = f"{template}\n\n{LEGEND_MARKER}\n" + "\n".join(legend)
        changed += 1
    return changed
