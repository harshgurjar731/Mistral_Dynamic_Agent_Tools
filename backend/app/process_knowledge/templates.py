"""
Process templates — the format every process document must follow.

A template is a JSON Schema. It can be uploaded in either of two forms:

* **a JSON Schema** — used as is, after checking it is itself a valid schema;
* **an example document** — a schema is inferred from it: every key present
  becomes required, with the type it had. Shown back for confirmation before
  it is saved, because an inference is a guess about intent.

A built-in template is seeded on first boot and is the default until another
is chosen. Its shape is what the process-knowledge layer reads best — stages,
controls, risks — but any template works: retrieval and the prompt rendering
read whatever of those fields a document has.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any, Optional

from app.database import SessionLocal
from app.process_knowledge.models import ProcessTemplate

logger = logging.getLogger(__name__)

SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

_ID_PATTERN = "^[a-z0-9][a-z0-9_.-]*$"
_ID = {"type": "string", "pattern": _ID_PATTERN, "description": "lower_snake_case identifier"}
_STR_LIST = {"type": "array", "items": {"type": "string", "minLength": 1}}

DEFAULT_SCHEMA: dict = {
    "$schema": SCHEMA_DIALECT,
    "title": "Process knowledge document",
    "description": "One business process or subprocess: what it is for, the stages it runs "
                   "in order, the controls it must satisfy and how it fails.",
    "type": "object",
    "required": ["template_version", "process", "classification", "objective", "stages"],
    "properties": {
        "template_version": {"type": "string", "description": "Template version, e.g. \"1.0\""},
        "process": {
            "type": "object",
            "description": "Identity of this process.",
            "required": ["id", "name", "level"],
            "properties": {
                "id": _ID,
                "name": {"type": "string", "minLength": 3, "description": "Display name"},
                "level": {"type": "string", "enum": ["process", "subprocess"]},
                "parent_process": {"type": "string",
                                   "description": "For a subprocess: the parent process id"},
                "version": {"type": "string", "description": "Version of this document"},
                "owner": {"type": "string", "description": "Team or role that owns the process"},
            },
        },
        "classification": {
            "type": "object",
            "description": "Where the process sits in the ontology. Labels or concept ids.",
            "required": ["industry", "domain"],
            "properties": {
                "industry": {"type": "string", "minLength": 1},
                "domain": {"type": "string", "minLength": 1},
                "subdomain": {"type": "string"},
                "process": {"type": "string"},
                "subprocess": {"type": "string"},
            },
        },
        "objective": {"type": "string", "minLength": 10,
                      "description": "What the process achieves, in one or two sentences"},
        "scope": {
            "type": "object",
            "properties": {"in_scope": _STR_LIST, "out_of_scope": _STR_LIST},
        },
        "triggers": {**_STR_LIST, "description": "What starts the process"},
        "actors": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name", "type"],
                "properties": {
                    "id": _ID,
                    "name": {"type": "string", "minLength": 1},
                    "type": {"type": "string", "enum": ["human", "system", "agent", "external"]},
                    "responsibilities": _STR_LIST,
                },
            },
        },
        "stages": {
            "type": "array",
            "minItems": 1,
            "description": "The ordered stages of the process.",
            "items": {
                "type": "object",
                "required": ["id", "name", "purpose", "actor_type"],
                "properties": {
                    "id": _ID,
                    "name": {"type": "string", "minLength": 2},
                    "purpose": {"type": "string", "minLength": 5},
                    "actor_type": {"type": "string", "enum": ["agent", "human", "system"],
                                   "description": "Who performs the stage"},
                    "actor": {"type": "string", "description": "Actor id from `actors`"},
                    "inputs": _STR_LIST,
                    "outputs": _STR_LIST,
                    "depends_on": {**_STR_LIST, "description": "Stage ids that must finish first"},
                    "decision": {
                        "type": "object",
                        "required": ["outcomes"],
                        "properties": {
                            "question": {"type": "string"},
                            "outcomes": {
                                "type": "array",
                                "minItems": 2,
                                "items": {
                                    "type": "object",
                                    "required": ["label"],
                                    "properties": {
                                        "label": {"type": "string", "minLength": 1},
                                        "condition": {"type": "string"},
                                        "next_stage": {"type": "string"},
                                    },
                                },
                            },
                        },
                    },
                    "controls": {**_STR_LIST, "description": "Control ids applied at this stage"},
                    "sla": {"type": "string"},
                    "notes": {"type": "string"},
                },
            },
        },
        "controls": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "description", "mandatory"],
                "properties": {
                    "id": _ID,
                    "description": {"type": "string", "minLength": 5},
                    "mandatory": {"type": "boolean"},
                    "applies_to": {**_STR_LIST, "description": "Stage ids"},
                    "regulation": {"type": "string", "description": "Regulation id or name"},
                },
            },
        },
        "exceptions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "condition", "handling"],
                "properties": {
                    "id": _ID,
                    "condition": {"type": "string", "minLength": 3},
                    "handling": {"type": "string", "minLength": 3},
                    "applies_to": _STR_LIST,
                },
            },
        },
        "risks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "description"],
                "properties": {
                    "id": _ID,
                    "description": {"type": "string", "minLength": 5},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "mitigation": {"type": "string"},
                },
            },
        },
        "regulations": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": _ID,
                    "name": {"type": "string", "minLength": 2},
                    "requirement": {"type": "string"},
                },
            },
        },
        "data_entities": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "fields": _STR_LIST,
                    "classification": {"type": "string",
                                       "enum": ["public", "internal", "financial", "pii"]},
                },
            },
        },
        "kpis": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "target": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
        },
        "subprocesses": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": _ID, "name": {"type": "string"},
                               "stage": {"type": "string", "description": "Stage it expands"}},
            },
        },
        "glossary": {"type": "object", "additionalProperties": {"type": "string"}},
    },
}

DEFAULT_EXAMPLE: dict = {
    "template_version": "1.0",
    "process": {"id": "residential_mortgage_approval", "name": "Residential mortgage approval",
                "level": "process", "version": "1.0", "owner": "Mortgage underwriting"},
    "classification": {"industry": "BFSI", "domain": "Lending", "subdomain": "Mortgage",
                       "process": "Residential mortgage approval"},
    "objective": "Decide whether to lend on a residential property, at what terms, with a "
                 "recorded rationale for every outcome.",
    "scope": {"in_scope": ["First-time buyers", "Remortgage"],
              "out_of_scope": ["Buy-to-let", "Commercial property"]},
    "triggers": ["A completed mortgage application is submitted"],
    "actors": [
        {"id": "applicant", "name": "Applicant", "type": "external"},
        {"id": "underwriter", "name": "Underwriter", "type": "human",
         "responsibilities": ["Decide referred cases"]},
        {"id": "credit_bureau", "name": "Credit bureau", "type": "system"},
    ],
    "stages": [
        {"id": "intake", "name": "Application intake", "actor_type": "agent",
         "purpose": "Capture applicant, property and loan details and check completeness.",
         "inputs": ["application_form"], "outputs": ["application_record"]},
        {"id": "identity_check", "name": "Identity and fraud check", "actor_type": "system",
         "actor": "credit_bureau", "purpose": "Verify identity and screen for fraud signals.",
         "inputs": ["application_record"], "outputs": ["kyc_result"],
         "depends_on": ["intake"], "controls": ["kyc"]},
        {"id": "affordability", "name": "Affordability assessment", "actor_type": "agent",
         "purpose": "Compare verified income with committed outgoings under a stressed rate.",
         "inputs": ["application_record", "kyc_result"], "outputs": ["affordability_result"],
         "depends_on": ["identity_check"], "controls": ["stress_test"]},
        {"id": "decision", "name": "Credit decision", "actor_type": "agent",
         "purpose": "Apply policy rules and decide.",
         "inputs": ["affordability_result"], "outputs": ["decision_record"],
         "depends_on": ["affordability"],
         "decision": {"question": "Does the case meet policy?", "outcomes": [
             {"label": "approve", "condition": "All policy rules pass"},
             {"label": "refer", "condition": "Marginal case", "next_stage": "manual_review"},
             {"label": "decline", "condition": "A hard policy rule fails"}]},
         "controls": ["decision_rationale"]},
        {"id": "manual_review", "name": "Underwriter review", "actor_type": "human",
         "actor": "underwriter", "purpose": "Decide cases the automated decision referred.",
         "inputs": ["decision_record"], "outputs": ["final_decision"],
         "depends_on": ["decision"]},
    ],
    "controls": [
        {"id": "kyc", "description": "Identity must be verified before any credit decision.",
         "mandatory": True, "applies_to": ["identity_check"], "regulation": "aml"},
        {"id": "stress_test", "description": "Affordability is tested at a stressed rate.",
         "mandatory": True, "applies_to": ["affordability"]},
        {"id": "decision_rationale",
         "description": "Every decision records the reasons that produced it.",
         "mandatory": True, "applies_to": ["decision", "manual_review"]},
    ],
    "exceptions": [
        {"id": "missing_documents", "condition": "Income evidence is missing or unreadable",
         "handling": "Pause and request the documents; do not decide.", "applies_to": ["intake"]},
    ],
    "risks": [
        {"id": "unexplained_decline", "description": "A decline without a stated reason.",
         "severity": "high", "mitigation": "Require decision_rationale on every outcome."},
    ],
    "regulations": [
        {"id": "aml", "name": "Anti-money laundering",
         "requirement": "Verify identity and screen sanctions before lending."},
    ],
    "data_entities": [
        {"name": "application_record", "fields": ["applicant_name", "income", "loan_amount"],
         "classification": "pii"},
    ],
    "kpis": [{"name": "Time to decision", "target": "< 2 working days"}],
    "glossary": {"LTV": "Loan to value — loan amount divided by property value."},
}


# ── Inference and skeletons ────────────────────────────────────────────────


def _json_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "null"


def infer_schema(example: Any, *, title: str = "Inferred process template") -> dict:
    """A schema an example document satisfies, with every present key required.

    Arrays take the merged shape of their items, so a stage that has a
    ``decision`` and one that does not still produce one item schema — with
    ``decision`` optional, since not every item carried it.
    """

    def walk(value: Any) -> dict:
        kind = _json_type(value)
        if kind == "object":
            return {
                "type": "object",
                "required": sorted(value.keys()),
                "properties": {k: walk(v) for k, v in value.items()},
            }
        if kind == "array":
            items = [walk(v) for v in value]
            return {"type": "array", "items": _merge(items)} if items else {"type": "array"}
        if kind == "integer":
            # "number", not "integer": an example's 3 does not mean 3.5 is wrong.
            return {"type": "number"}
        return {"type": kind}

    def _merge(schemas: list[dict]) -> dict:
        objects = [s for s in schemas if s.get("type") == "object"]
        if objects and len(objects) == len(schemas):
            props: dict[str, list[dict]] = {}
            counts: dict[str, int] = {}
            for s in objects:
                for k, v in s["properties"].items():
                    props.setdefault(k, []).append(v)
                    counts[k] = counts.get(k, 0) + 1
            return {
                "type": "object",
                "required": sorted(k for k, n in counts.items() if n == len(objects)),
                "properties": {k: _merge(v) for k, v in props.items()},
            }
        types = sorted({s.get("type") for s in schemas if isinstance(s.get("type"), str)})
        if len(types) == 1:
            return schemas[0]
        return {"type": types} if types else {}

    schema = walk(example)
    schema["$schema"] = SCHEMA_DIALECT
    schema["title"] = title
    return schema


def skeleton_from_schema(schema: dict) -> Any:
    """A fill-in-the-blanks document shaped like ``schema``.

    Placeholders say what goes there, taken from each field's description,
    enum or type. Arrays get one item, so the shape of an entry is visible.
    """

    def walk(node: dict, name: str = "") -> Any:
        if not isinstance(node, dict):
            return None
        kind = node.get("type")
        if isinstance(kind, list):
            kind = next((k for k in kind if k != "null"), kind[0] if kind else None)
        if "enum" in node and node["enum"]:
            return node["enum"][0]
        if kind == "object" or "properties" in node:
            props = node.get("properties") or {}
            if not props and isinstance(node.get("additionalProperties"), dict):
                return {"<term>": "<definition>"}
            return {k: walk(v, k) for k, v in props.items()}
        if kind == "array":
            item = walk(node.get("items") or {"type": "string"}, name)
            return [item]
        if kind == "boolean":
            return True
        if kind in ("integer", "number"):
            return 0
        hint = node.get("description") or name.replace("_", " ") or "value"
        return f"<{hint}>"

    return walk(schema)


def check_schema(schema: Any) -> list[str]:
    """Problems with ``schema`` as a JSON Schema. Empty when it is usable."""
    from jsonschema import Draft202012Validator, SchemaError

    if not isinstance(schema, dict):
        return ["A template must be a JSON object."]
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as e:
        return [f"Not a valid JSON Schema: {e.message} (at {'/'.join(map(str, e.path)) or 'root'})"]
    if schema.get("type") not in (None, "object"):
        return ["The template's root must describe an object (\"type\": \"object\")."]
    return []


def looks_like_schema(data: Any) -> bool:
    """Whether an uploaded template is a schema rather than an example."""
    return isinstance(data, dict) and (
        "$schema" in data
        or (data.get("type") == "object" and isinstance(data.get("properties"), dict))
    )


# ── Store ──────────────────────────────────────────────────────────────────


def _to_dict(row: ProcessTemplate, *, full: bool = True) -> dict:
    out = {
        "id": row.id,
        "name": row.name,
        "version": row.version,
        "description": row.description or "",
        "kind": row.kind,
        "is_default": bool(row.is_default),
        "builtin": bool(row.builtin),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
    if full:
        out["schema"] = json.loads(row.schema)
        out["example"] = json.loads(row.example) if row.example else None
    return out


def ensure_builtin() -> None:
    """Seed the built-in template once, and make sure something is default."""
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        if not db.query(ProcessTemplate).filter(ProcessTemplate.builtin.is_(True)).first():
            db.add(ProcessTemplate(
                name="Standard process template", version=1,
                description="The built-in format: identity, classification, stages, controls, "
                            "exceptions, risks, regulations, data entities and KPIs.",
                schema=json.dumps(DEFAULT_SCHEMA), example=json.dumps(DEFAULT_EXAMPLE),
                kind="schema", is_default=False, builtin=True,
            ))
            db.flush()
        if not db.query(ProcessTemplate).filter(ProcessTemplate.is_default.is_(True)).first():
            builtin = db.query(ProcessTemplate).filter(ProcessTemplate.builtin.is_(True)).first()
            if builtin:
                builtin.is_default = True
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Could not seed the built-in process template: %s", e)
    finally:
        db.close()


def list_templates() -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        rows = db.query(ProcessTemplate).order_by(ProcessTemplate.name, ProcessTemplate.version).all()
        return [_to_dict(r, full=False) for r in rows]
    finally:
        db.close()


def get_template(template_id: Optional[int] = None) -> Optional[dict]:
    """One template, or the default one when no id is given."""
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        q = db.query(ProcessTemplate)
        row = (q.filter(ProcessTemplate.id == template_id).first() if template_id
               else q.filter(ProcessTemplate.is_default.is_(True)).first())
        if row is None and not template_id:
            row = q.filter(ProcessTemplate.builtin.is_(True)).first()
        return _to_dict(row) if row else None
    finally:
        db.close()


def default_template() -> dict:
    """The default template, falling back to the in-code one if the table is empty."""
    found = get_template()
    if found:
        return found
    return {"id": None, "name": "Standard process template", "version": 1, "kind": "schema",
            "is_default": True, "builtin": True, "schema": copy.deepcopy(DEFAULT_SCHEMA),
            "example": copy.deepcopy(DEFAULT_EXAMPLE), "description": ""}


def create_template(name: str, schema: dict, *, example: Any = None, kind: str = "schema",
                    description: str = "", make_default: bool = False) -> dict:
    problems = check_schema(schema)
    if problems:
        raise ValueError("; ".join(problems))
    if SessionLocal is None:
        raise RuntimeError("The database is unavailable.")
    db = SessionLocal()
    try:
        latest = (db.query(ProcessTemplate).filter(ProcessTemplate.name == name)
                  .order_by(ProcessTemplate.version.desc()).first())
        row = ProcessTemplate(
            name=name.strip() or "Process template",
            version=(latest.version + 1) if latest else 1,
            description=description, schema=json.dumps(schema),
            example=json.dumps(example) if example is not None else None,
            kind=kind, is_default=False, builtin=False,
        )
        db.add(row)
        db.flush()
        if make_default:
            db.query(ProcessTemplate).update({ProcessTemplate.is_default: False})
            row.is_default = True
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def set_default(template_id: int) -> dict:
    if SessionLocal is None:
        raise RuntimeError("The database is unavailable.")
    db = SessionLocal()
    try:
        row = db.query(ProcessTemplate).filter(ProcessTemplate.id == template_id).first()
        if not row:
            raise LookupError(f"Template {template_id} not found.")
        db.query(ProcessTemplate).update({ProcessTemplate.is_default: False})
        row.is_default = True
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def delete_template(template_id: int) -> None:
    if SessionLocal is None:
        raise RuntimeError("The database is unavailable.")
    db = SessionLocal()
    try:
        row = db.query(ProcessTemplate).filter(ProcessTemplate.id == template_id).first()
        if not row:
            raise LookupError(f"Template {template_id} not found.")
        if row.builtin:
            raise ValueError("The built-in template cannot be deleted.")
        if row.is_default:
            raise ValueError("Make another template the default before deleting this one.")
        db.delete(row)
        db.commit()
    finally:
        db.close()


def download_payload(template: dict, kind: str) -> Any:
    """What the download buttons hand out: ``schema``, ``example`` or ``blank``."""
    if kind == "schema":
        return template["schema"]
    if kind == "example":
        return template.get("example") or skeleton_from_schema(template["schema"])
    return skeleton_from_schema(template["schema"])
