"""
DataContractLayer — decide, once, every record the workflow passes between its steps.

Before this layer, field names were never decided: decomposition wrote loose
input and output names, each activity was specified from those names on its
own, agents described their output in prose, and wiring came last. Every layer
re-inferred the shapes, and the SME equipment finance run needed five hand
revisions to make `annual_turnover` and `annual_turnover_gbp` meet.

Here the large model writes the workflow's data dictionary: each **record**
(the application, the credit file, the affordability result, the decision…)
as a JSON Schema with typed, described fields, where it comes from (a run
input or the one capability that produces it), and which records each
capability consumes. The layers after it build to it instead of guessing:

* an activity's input and output schemas *are* its records (enforced on its
  specification, ``app.layers.codegen.profiles``);
* an agent's output schema is the record it produces (enforced at run time,
  ``app.services.workflow_engine.structured_output``);
* every activity argument is wired from the contract, and every run-input
  record becomes a run input with its full nested schema (``DataFlowLayer``).

The decision checks itself: every consumed record exists and is produced
upstream, every record has a typed schema, every capability produces at most
one record. A missing ordering edge (consuming a record whose producer is not
upstream) is added to ``depends_on`` rather than failed, unless it would make
a cycle.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

RUN_INPUT = "run_input"
_NAME = re.compile(r"^[a-z][a-z0-9_]{1,60}$")
_TYPES = {"string", "number", "integer", "boolean", "object", "array", "null"}

DATA_CONTRACT_SYSTEM_PROMPT = """\
You are the data architect of an automated workflow. The work has been split
into capabilities (steps); you decide the DATA CONTRACT every step will be
built to: the records passed between steps, their exact fields, and which
step produces and consumes each one. Code is generated from your schemas and
agents are held to them, so they must be precise.

## Records
A record is one named JSON object passed between steps, e.g. `application`,
`credit_file`, `affordability_result`, `decision_record`, `decision_letter`.
- name: snake_case, a noun for what the data IS (not the step that made it).
- origin: "run_input" when the person running the workflow supplies it, or the
  id of the ONE capability that produces it.
- schema: a JSON Schema object: "type": "object", "properties" with EVERY
  field, each with a "type" and a "description" stating its meaning and unit
  (e.g. "Loan-to-value as a percentage, 85 means 85%", "Monthly instalment in
  GBP, 2 decimals", "Risk score 0-100, higher is riskier — NOT the credit
  score"), "enum" for fixed sets, nested objects and arrays fully specified,
  and "required" listing the fields always present.
- Use ONE name for one fact everywhere: a field means the same thing, with the
  same name and unit, in every record that carries it.

## Capabilities
For each capability: "consumes" — the records it needs (by name) — and
"produces" — the ONE record it outputs (by name), or null for a capability
whose only effect is outside the workflow.
- A capability consumes only records that are run inputs or produced by a
  capability that runs before it.
- Give the produced record every field a later step will read, including
  reasons and identifiers a final letter or report needs.
- A screening or validation step produces a verdict record (e.g.
  `screening_result`), not a copy of what it checked; later steps keep
  consuming the original record.
- What the workflow needs from the person running it is a run-input record —
  usually one: the application, the claim, the request — with every field any
  step reads, nested where the data is nested.

## Output
{
  "records": [
    {"name": "string", "description": "string", "origin": "run_input | <capability id>",
     "schema": {"type": "object", "properties": {}, "required": []}}
  ],
  "capabilities": [
    {"id": "<capability id>", "consumes": ["<record>"], "produces": "<record> | null"}
  ],
  "reasoning": "string"
}
"""

DATA_CONTRACT_USER_PROMPT = """\
GOAL:
{goal}

CAPABILITIES (in dependency order):
{capabilities}

Define the data contract.
"""


def _clean_schema(schema: Any) -> Optional[dict]:
    from app.workflow_inputs.designer import clean_schema

    cleaned = clean_schema(schema) if isinstance(schema, dict) else None
    if cleaned and "properties" in cleaned:
        cleaned["type"] = "object"
    return cleaned


def _schema_problems(record: str, schema: Any, path: str = "") -> list[str]:
    where = f"{record}{'.' + path if path else ''}"
    if not isinstance(schema, dict):
        return [f"record '{where}' has no schema"]
    problems = []
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), None)
    if t not in _TYPES:
        problems.append(f"'{where}' has no valid type")
    if t == "object":
        props = schema.get("properties")
        if not isinstance(props, dict) or not props:
            problems.append(f"'{where}' is an object with no properties — list its fields")
            return problems
        for name, sub in props.items():
            sub_path = f"{path}.{name}" if path else name
            if not isinstance(sub, dict) or not str(sub.get("description") or "").strip():
                problems.append(f"field '{record}.{sub_path}' has no description (meaning and unit)")
            problems += _schema_problems(record, sub, sub_path) if isinstance(sub, dict) else []
        missing = [r for r in schema.get("required") or [] if r not in props]
        if missing:
            problems.append(f"'{where}' requires {', '.join(missing)}, which are not among its properties")
    if t == "array" and not isinstance(schema.get("items"), dict):
        problems.append(f"'{where}' is a list without an item schema")
    return problems


def _ancestors(capabilities: list) -> dict[str, set[str]]:
    by_id = {c.id: c for c in capabilities}
    memo: dict[str, set[str]] = {}

    def walk(cid: str, seen: frozenset) -> set[str]:
        if cid in memo:
            return memo[cid]
        found: set[str] = set()
        for dep in getattr(by_id.get(cid), "depends_on", None) or []:
            if dep in by_id and dep not in seen:
                found |= {dep} | walk(dep, seen | {dep})
        memo[cid] = found
        return found

    return {c.id: walk(c.id, frozenset({c.id})) for c in capabilities}


def check_contract(contract: Optional[dict], capabilities: list) -> list[str]:
    """Every reason the contract cannot be built to; [] when it is sound."""
    if not contract or not contract.get("records"):
        return ["the contract defines no records"]
    records: dict = contract["records"]
    bindings: dict = contract.get("bindings") or {}
    cap_ids = {c.id for c in capabilities}
    problems: list[str] = []

    for name, rec in records.items():
        if not _NAME.match(name):
            problems.append(f"record name '{name}' must be snake_case")
        origin = rec.get("origin")
        if origin != RUN_INPUT and origin not in cap_ids:
            problems.append(f"record '{name}' comes from '{origin}', which is neither run_input nor a capability")
        problems += _schema_problems(name, rec.get("schema"))

    producers: dict[str, str] = {}
    for cap in capabilities:
        b = bindings.get(cap.id)
        if b is None:
            problems.append(f"capability '{cap.id}' has no consumes/produces entry")
            continue
        produced = b.get("produces")
        if produced:
            if produced not in records:
                problems.append(f"'{cap.id}' produces '{produced}', which is not a defined record")
            elif records[produced].get("origin") != cap.id:
                problems.append(f"'{cap.id}' produces '{produced}', but that record's origin is "
                                f"'{records[produced].get('origin')}'")
            elif produced in producers:
                problems.append(f"'{produced}' is produced by both '{producers[produced]}' and '{cap.id}'")
            else:
                producers[produced] = cap.id
        elif cap.kind in ("agent", "activity"):
            problems.append(f"'{cap.id}' ({cap.kind}) produces no record — every agent and activity "
                            "returns one")
        for consumed in b.get("consumes") or []:
            if consumed not in records:
                problems.append(f"'{cap.id}' consumes '{consumed}', which is not a defined record")
            elif consumed == produced:
                problems.append(f"'{cap.id}' consumes the record it produces ('{consumed}')")
    for name, rec in records.items():
        if rec.get("origin") in cap_ids and name not in producers:
            problems.append(f"record '{name}' names '{rec['origin']}' as its origin, but that "
                            "capability does not produce it")
    ancestors = _ancestors(capabilities)
    for cap in capabilities:
        for consumed in (bindings.get(cap.id) or {}).get("consumes") or []:
            producer = producers.get(consumed)
            if producer and producer != cap.id and cap.id in ancestors.get(producer, set()):
                problems.append(f"'{cap.id}' consumes '{consumed}' from '{producer}', which runs after it")
    return problems


def _link_order(capabilities: list, contract: dict) -> list[str]:
    """Add the dependency edge a consumer needs on its producer. Returns notes."""
    producers = {b.get("produces"): cid for cid, b in (contract.get("bindings") or {}).items()
                 if b.get("produces")}
    by_id = {c.id: c for c in capabilities}
    notes = []
    for cap in capabilities:
        ancestors = _ancestors(capabilities)
        for consumed in (contract["bindings"].get(cap.id) or {}).get("consumes") or []:
            producer = producers.get(consumed)
            if not producer or producer == cap.id or producer in ancestors.get(cap.id, set()):
                continue
            if cap.id in ancestors.get(producer, set()):
                continue  # would make a cycle — reported by check_contract
            by_id[cap.id].depends_on = [*cap.depends_on, producer]
            notes.append(f"'{cap.id}' now runs after '{producer}' (it reads '{consumed}')")
    return notes


class DataContractLayer(WorkflowDecisionLayer):
    """The workflow's data dictionary: records, their schemas, producers and consumers."""

    name = "data_contract"
    label = "Define the data contract"
    detail = ("Decides every record passed between steps — fields, types, units — once, "
              "for every activity, agent and input to be built to.")
    phase = "data contract"
    process_view = "data_flow"
    status_message = "Defining the data every step passes on…"
    timeout_ms = LONG_TIMEOUT_MS
    temperature = 0.1
    max_repairs = 2

    def should_run(self, ctx: PipelineContext) -> bool:
        return super().should_run(ctx) and bool(ctx.workflow_spec.capabilities)

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        spec = ctx.workflow_spec
        caps = [{"id": c.id, "name": c.name, "purpose": c.purpose, "kind": c.kind,
                 "needs": c.inputs, "gives": c.outputs, "depends_on": c.depends_on}
                for c in spec.capabilities]
        return (DATA_CONTRACT_SYSTEM_PROMPT,
                DATA_CONTRACT_USER_PROMPT.format(goal=spec.goal, capabilities=json.dumps(caps, indent=2)))

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec
        cap_ids = {c.id for c in spec.capabilities}
        records: dict[str, dict] = {}
        for raw in data.get("records") or []:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            origin = str(raw.get("origin") or "").strip()
            records[name] = {
                "description": str(raw.get("description") or "").strip()[:500],
                "origin": origin,
                "schema": _clean_schema(raw.get("schema")) or raw.get("schema"),
            }
        bindings: dict[str, dict] = {}
        for raw in data.get("capabilities") or []:
            if not isinstance(raw, dict) or raw.get("id") not in cap_ids:
                continue
            produced = raw.get("produces")
            bindings[raw["id"]] = {
                "consumes": [str(r) for r in raw.get("consumes") or [] if str(r).strip()],
                "produces": str(produced).strip() if produced and str(produced).lower() != "null" else None,
            }
        spec.data_contract = {"records": records, "bindings": bindings}
        notes = _link_order(spec.capabilities, spec.data_contract)
        # The capabilities' loose names become the contract's records.
        for cap in spec.capabilities:
            b = bindings.get(cap.id)
            if b:
                cap.inputs = list(b["consumes"])
                cap.outputs = [b["produces"]] if b["produces"] else []
        spec.rationale["data_contract"] = str(data.get("reasoning") or "")
        ctx.emit("data_contract", json.dumps({
            "records": [{"name": n, "origin": r["origin"], "description": r["description"],
                         "fields": sorted(((r.get("schema") or {}).get("properties") or {}).keys())}
                        for n, r in records.items()],
            "bindings": bindings,
            "ordering": notes,
            "reasoning": spec.rationale["data_contract"],
        }, default=str))
        ctx.set_layer_summary(
            self.name,
            f"{len(records)} record(s): " + ", ".join(sorted(records))[:300]
            + (f". {len(notes)} ordering edge(s) added." if notes else ""))

    def postconditions(self, ctx: PipelineContext) -> list[str]:
        spec = ctx.workflow_spec
        return check_contract(spec.data_contract, spec.capabilities)

    def fallback(self, ctx: PipelineContext) -> None:
        # Without a contract the later layers work as before, from capability names.
        ctx.workflow_spec.data_contract = None
        logger.warning("Data contract could not be decided — later layers infer the shapes")


# ── What the later layers read ─────────────────────────────────────────────


def contract_of(spec) -> Optional[dict]:
    c = getattr(spec, "data_contract", None)
    return c if isinstance(c, dict) and c.get("records") else None


def record_schema(spec, name: str) -> Optional[dict]:
    c = contract_of(spec)
    rec = (c or {}).get("records", {}).get(name)
    return rec.get("schema") if isinstance(rec, dict) and isinstance(rec.get("schema"), dict) else None


def record_ref(spec, name: str) -> Optional[str]:
    """The ``{{…}}`` reference a step uses to read record ``name``."""
    c = contract_of(spec)
    rec = (c or {}).get("records", {}).get(name)
    if not rec:
        return None
    if rec.get("origin") == RUN_INPUT:
        return f"{{{{{name}}}}}"
    return f"{{{{step_{rec['origin']}_output.{name}}}}}"


def output_schema_for(spec, cap_id: str) -> Optional[dict]:
    """The output a capability's step must return: ``{"<record>": <schema>}``."""
    c = contract_of(spec)
    produced = ((c or {}).get("bindings", {}).get(cap_id) or {}).get("produces")
    schema = record_schema(spec, produced) if produced else None
    if not schema:
        return None
    return {"type": "object", "properties": {produced: schema}, "required": [produced],
            "description": f"An object holding the '{produced}' record."}


def input_schema_for(spec, cap_id: str) -> Optional[dict]:
    """The parameters an activity for this capability takes: one per consumed record."""
    c = contract_of(spec)
    consumed = ((c or {}).get("bindings", {}).get(cap_id) or {}).get("consumes") or []
    props = {}
    for name in consumed:
        schema = record_schema(spec, name)
        if schema:
            props[name] = {**schema, "description": (c["records"][name].get("description")
                                                     or schema.get("description") or name)}
    if not props:
        return None
    return {"type": "object", "properties": props, "required": list(props)}


def run_input_fields(spec) -> list[dict]:
    """The run-input records, as workflow input fields with their full nested schema."""
    c = contract_of(spec)
    out = []
    for name, rec in ((c or {}).get("records") or {}).items():
        if rec.get("origin") == RUN_INPUT and isinstance(rec.get("schema"), dict):
            out.append({"name": name, "type": "object", "required": True,
                        "label": name.replace("_", " ").capitalize(),
                        "description": rec.get("description") or f"The {name.replace('_', ' ')}.",
                        "schema": rec["schema"]})
    return out


def design_block(spec, cap) -> str:
    """For an agent's design: the records it reads and the exact record it must return."""
    c = contract_of(spec)
    if not c:
        return ""
    b = c.get("bindings", {}).get(cap.id) or {}
    consumed = {n: c["records"][n] for n in b.get("consumes") or [] if n in c["records"]}
    produced = b.get("produces")
    out = output_schema_for(spec, cap.id)
    parts = ["\n\n## DATA CONTRACT (mandatory)"]
    if consumed:
        parts.append("This agent is given these records:\n" + json.dumps(
            {n: {"description": r.get("description"), "schema": r.get("schema")} for n, r in consumed.items()},
            indent=2)[:6000])
    if out:
        parts.append(f"It must answer with exactly this JSON object (the '{produced}' record):\n"
                     + json.dumps(out, indent=2)[:6000]
                     + "\nWrite into agent_instructions that the final answer is this JSON object, "
                       "field for field, and set output_contract_detail to the same structure.")
    return "\n".join(parts)


def wiring_block(spec) -> str:
    """For the data-flow decision: how every record is read, step by step."""
    c = contract_of(spec)
    if not c:
        return ""
    rows = {}
    for cap_id, b in c.get("bindings", {}).items():
        rows[cap_id] = {
            "reads": {n: record_ref(spec, n) for n in b.get("consumes") or []},
            "returns": b.get("produces"),
        }
    return ("\n\nDATA CONTRACT — every step reads and returns exactly these records. Use these "
            "references verbatim in templates and arguments; a field inside a record is read as "
            "<reference without braces>.<field>:\n" + json.dumps(rows, indent=2)[:8000])
