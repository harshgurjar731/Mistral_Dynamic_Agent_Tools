"""
Process document validation — one checker for every place a document enters.

The Processes page, both orchestration pages, the AI fix and a template change
all call :func:`validate`. A document is only ever used by a pipeline once this
says it is valid, so the checks are deliberately thorough, and every problem is
reported with where it is, what was expected, what was found and how to fix it
— a bare "invalid JSON" would leave a user guessing.

Four passes, each only once the one before it can run:

1. **File** — size, encoding, JSON syntax (with line and column).
2. **Schema** — every JSON Schema violation, not just the first.
3. **Meaning** — references that resolve, ids that are unique, no dependency
   cycles, mandatory controls that apply somewhere.
4. **Placement** — the document describes the process it is filed under.

Unknown fields are warnings: a template that is stricter than its documents
should not make a useful document unusable.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

_MAX_ISSUES = 200


def _issue(severity: str, code: str, path: str, message: str, *, expected: Any = None,
           found: Any = None, fix: str = "") -> dict:
    return {
        "severity": severity,
        "code": code,
        "path": path or "(document)",
        "message": message,
        "expected": _short(expected),
        "found": _short(found),
        "fix": fix,
    }


def _short(value: Any, limit: int = 160) -> Optional[str]:
    if value is None:
        return None
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _path(parts) -> str:
    out = ""
    for part in parts:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += f".{part}" if out else str(part)
    return out


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


# ── 1. File ────────────────────────────────────────────────────────────────


def _decode(raw: bytes | str, max_kb: int) -> tuple[Optional[str], list[dict]]:
    if isinstance(raw, str):
        text = raw
        size = len(raw.encode("utf-8", errors="ignore"))
    else:
        size = len(raw)
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            return None, [_issue(
                "error", "encoding", "(file)",
                f"The file is not UTF-8 text (byte {e.start} cannot be decoded).",
                expected="UTF-8 encoded JSON", found="binary or another encoding",
                fix="Save the file as UTF-8 (in most editors: Save As → Encoding: UTF-8).",
            )]
    if size > max_kb * 1024:
        return None, [_issue(
            "error", "too_large", "(file)",
            f"The file is {size // 1024} KB; the limit is {max_kb} KB.",
            expected=f"≤ {max_kb} KB", found=f"{size // 1024} KB",
            fix="Split it into one document per process or subprocess, or raise "
                "'Max process document size' in Settings → Process knowledge.",
        )]
    if not text.strip():
        return None, [_issue("error", "empty", "(file)", "The file is empty.",
                             fix="Start from the downloaded template.")]
    return text.lstrip("﻿"), []


def _syntax_hint(text: str, err: json.JSONDecodeError) -> str:
    line = text.splitlines()[err.lineno - 1] if 0 < err.lineno <= len(text.splitlines()) else ""
    before = text[: err.pos].rstrip()
    if "trailing comma" in err.msg.lower():
        # Python 3.13+ names it directly.
        return "Remove the trailing comma before the closing brace or bracket."
    if re.search(r",\s*$", before) and err.msg.startswith("Expecting property name"):
        return "Remove the trailing comma before the closing brace."
    if before.endswith(",") and "Expecting value" in err.msg:
        return "Remove the trailing comma before the closing bracket."
    if "'" in line and ("Expecting property name enclosed in double quotes" in err.msg
                        or "Expecting value" in err.msg):
        return "JSON needs double quotes: replace 'single quotes' with \"double quotes\"."
    if line.strip().startswith(("//", "#", "/*")):
        return "JSON does not allow comments — delete the comment line."
    if "Expecting ',' delimiter" in err.msg:
        return "A comma is missing between two values or fields on or just before this line."
    if "Unterminated string" in err.msg:
        return "A string is missing its closing double quote."
    if "Extra data" in err.msg:
        return "There is content after the end of the document — keep a single top-level object."
    return "Fix the JSON syntax at the position shown, or use Fix with AI."


def _parse(text: str) -> tuple[Any, list[dict]]:
    try:
        return json.loads(text), []
    except json.JSONDecodeError as e:
        lines = text.splitlines()
        snippet = lines[e.lineno - 1].strip() if 0 < e.lineno <= len(lines) else ""
        return None, [_issue(
            "error", "invalid_json", f"line {e.lineno}, column {e.colno}",
            f"Not valid JSON: {e.msg}.",
            expected="valid JSON", found=snippet or None, fix=_syntax_hint(text, e),
        )]


# ── 2. Schema ──────────────────────────────────────────────────────────────


def _schema_issues(doc: Any, schema: dict) -> list[dict]:
    from jsonschema import Draft202012Validator

    validator = Draft202012Validator(schema)
    issues: list[dict] = []
    for err in sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path))):
        path = _path(err.absolute_path)
        kind = err.validator
        sub = err.schema if isinstance(err.schema, dict) else {}
        if kind == "required":
            missing = [p for p in err.validator_value if isinstance(err.instance, dict)
                       and p not in err.instance]
            for name in missing:
                child = ((sub.get("properties") or {}).get(name) or {})
                issues.append(_issue(
                    "error", "missing_field", f"{path}.{name}" if path else name,
                    f"Required field '{name}' is missing.",
                    expected=child.get("type") or "a value", found="(absent)",
                    fix=f"Add \"{name}\"" + (f" — {child['description']}." if child.get("description")
                                              else ".")
                        + " The template shows its shape.",
                ))
            continue
        if kind == "type":
            issues.append(_issue(
                "error", "wrong_type", path,
                f"Expected {err.validator_value}, found {_type_name(err.instance)}.",
                expected=err.validator_value, found=err.instance,
                fix=_type_fix(err.validator_value, err.instance),
            ))
        elif kind == "enum":
            issues.append(_issue(
                "error", "not_allowed", path,
                f"'{err.instance}' is not one of the allowed values.",
                expected=" | ".join(map(str, err.validator_value)), found=err.instance,
                fix=f"Use one of: {', '.join(map(str, err.validator_value))}.",
            ))
        elif kind == "pattern":
            issues.append(_issue(
                "error", "bad_format", path,
                "The value does not match the required format.",
                expected=sub.get("description") or err.validator_value, found=err.instance,
                fix="Use lower_snake_case: lowercase letters, digits and underscores, "
                    "e.g. \"credit_check\"." if "a-z0-9" in str(err.validator_value)
                    else f"Match the pattern {err.validator_value}.",
            ))
        elif kind in ("minLength", "minItems"):
            what = "characters" if kind == "minLength" else "items"
            issues.append(_issue(
                "error", "too_short", path,
                f"Needs at least {err.validator_value} {what}.",
                expected=f"≥ {err.validator_value} {what}",
                found=f"{len(err.instance)} {what}" if hasattr(err.instance, "__len__") else err.instance,
                fix="Fill this in — an empty value gives the pipelines nothing to work with."
                    if kind == "minLength" else f"Add at least {err.validator_value} {what}.",
            ))
        elif kind == "additionalProperties":
            # Reported by the unknown-field pass as a warning when the template
            # allows extras; an explicit `false` makes it an error.
            extras = sorted(set(err.instance) - set((sub.get("properties") or {}).keys())) \
                if isinstance(err.instance, dict) else []
            for name in extras:
                issues.append(_issue(
                    "error", "unknown_field", f"{path}.{name}" if path else name,
                    f"'{name}' is not allowed here by the template.",
                    expected=", ".join(sorted((sub.get("properties") or {}).keys())) or None,
                    fix=f"Remove '{name}', or rename it to one of the template's fields.",
                ))
        else:
            issues.append(_issue("error", f"schema_{kind}", path, err.message,
                                 expected=err.validator_value, found=err.instance,
                                 fix="Change the value so it satisfies the template."))
        if len(issues) >= _MAX_ISSUES:
            break
    return issues


def _type_fix(expected: Any, found: Any) -> str:
    exp = expected if isinstance(expected, str) else "/".join(map(str, expected))
    if exp == "array" and isinstance(found, str):
        return f"Wrap it in a list: [\"{found}\"]."
    if exp == "string" and isinstance(found, list):
        return "Give a single string, or join the items into one sentence."
    if exp == "boolean" and isinstance(found, str):
        return "Use true or false without quotes."
    if exp in ("number", "integer") and isinstance(found, str):
        return "Use a number without quotes."
    if exp == "object":
        return "Use an object: { \"field\": value, … } — see the template for the fields."
    return f"Change the value to a {exp}."


def _unknown_fields(doc: Any, schema: dict, path: str = "") -> list[dict]:
    """Keys the template does not describe. Warnings unless it forbids extras
    (that case is already an error from the schema pass)."""
    out: list[dict] = []
    if isinstance(doc, dict) and isinstance(schema, dict):
        props = schema.get("properties")
        if isinstance(props, dict) and props and schema.get("additionalProperties") is not False:
            for key in doc:
                if key not in props and not isinstance(schema.get("additionalProperties"), dict):
                    out.append(_issue(
                        "warning", "unknown_field", f"{path}.{key}" if path else key,
                        f"'{key}' is not part of the template and will be ignored by the layers "
                        f"that read known fields.",
                        expected=", ".join(sorted(props)),
                        fix="Rename it to a template field if it was meant to be one, or remove it.",
                    ))
        for key, value in doc.items():
            child = (props or {}).get(key) if isinstance(props, dict) else None
            if child:
                out += _unknown_fields(value, child, f"{path}.{key}" if path else key)
    elif isinstance(doc, list) and isinstance(schema, dict) and isinstance(schema.get("items"), dict):
        for i, item in enumerate(doc):
            out += _unknown_fields(item, schema["items"], f"{path}[{i}]")
    return out


# ── 3. Meaning ─────────────────────────────────────────────────────────────


def _ids(items: Any) -> list[str]:
    return [str(i.get("id")) for i in items if isinstance(i, dict) and i.get("id")] \
        if isinstance(items, list) else []


def _semantic_issues(doc: dict) -> list[dict]:
    out: list[dict] = []
    stages = doc.get("stages") if isinstance(doc.get("stages"), list) else []
    stage_ids = _ids(stages)
    stage_set = set(stage_ids)
    control_ids = set(_ids(doc.get("controls")))
    actor_ids = set(_ids(doc.get("actors")))

    for section in ("stages", "controls", "exceptions", "risks", "regulations", "actors"):
        seen: set[str] = set()
        for i, item_id in enumerate(_ids(doc.get(section))):
            if item_id in seen:
                out.append(_issue(
                    "error", "duplicate_id", f"{section}[{i}].id",
                    f"The id '{item_id}' is used twice in {section}.",
                    expected="unique ids", found=item_id,
                    fix="Give each entry its own id; references resolve by id.",
                ))
            seen.add(item_id)

    for i, stage in enumerate(stages):
        if not isinstance(stage, dict):
            continue
        for dep in stage.get("depends_on") or []:
            if dep not in stage_set:
                out.append(_issue(
                    "error", "unknown_reference", f"stages[{i}].depends_on",
                    f"Stage '{stage.get('id')}' depends on '{dep}', which is not a stage.",
                    expected=", ".join(stage_ids), found=dep,
                    fix="Use the id of a stage defined in this document, or remove it.",
                ))
            elif dep == stage.get("id"):
                out.append(_issue("error", "self_dependency", f"stages[{i}].depends_on",
                                  f"Stage '{dep}' depends on itself.",
                                  fix="Remove the stage's own id from depends_on."))
        for ref in stage.get("controls") or []:
            if control_ids and ref not in control_ids:
                out.append(_issue(
                    "error", "unknown_reference", f"stages[{i}].controls",
                    f"Stage '{stage.get('id')}' refers to control '{ref}', which is not defined.",
                    expected=", ".join(sorted(control_ids)), found=ref,
                    fix="Add the control to `controls`, or fix the id.",
                ))
            elif not control_ids:
                out.append(_issue(
                    "warning", "unknown_reference", f"stages[{i}].controls",
                    f"Stage '{stage.get('id')}' names control '{ref}' but `controls` is empty.",
                    fix="Describe the control in `controls` so it can be checked.",
                ))
        actor = stage.get("actor")
        if actor and actor_ids and actor not in actor_ids:
            out.append(_issue(
                "warning", "unknown_reference", f"stages[{i}].actor",
                f"Stage '{stage.get('id')}' names actor '{actor}', which is not in `actors`.",
                expected=", ".join(sorted(actor_ids)), found=actor,
                fix="Add the actor, or use an existing actor id.",
            ))
        decision = stage.get("decision")
        if isinstance(decision, dict):
            for j, outcome in enumerate(decision.get("outcomes") or []):
                nxt = outcome.get("next_stage") if isinstance(outcome, dict) else None
                if nxt and nxt not in stage_set:
                    out.append(_issue(
                        "error", "unknown_reference", f"stages[{i}].decision.outcomes[{j}].next_stage",
                        f"Outcome '{outcome.get('label')}' goes to '{nxt}', which is not a stage.",
                        expected=", ".join(stage_ids), found=nxt,
                        fix="Point next_stage at a defined stage id.",
                    ))

    cycle = _find_cycle({
        s.get("id"): [d for d in (s.get("depends_on") or []) if d in stage_set]
        for s in stages if isinstance(s, dict) and s.get("id")
    })
    if cycle:
        out.append(_issue(
            "error", "dependency_cycle", "stages",
            f"Stages depend on each other in a loop: {' → '.join(cycle)}.",
            fix="Break the loop — a stage cannot (indirectly) wait for itself.",
        ))

    for section in ("controls", "exceptions"):
        for i, item in enumerate(doc.get(section) or []):
            if not isinstance(item, dict):
                continue
            for ref in item.get("applies_to") or []:
                if ref not in stage_set:
                    out.append(_issue(
                        "error", "unknown_reference", f"{section}[{i}].applies_to",
                        f"'{item.get('id')}' applies to '{ref}', which is not a stage.",
                        expected=", ".join(stage_ids), found=ref,
                        fix="Use stage ids from `stages`.",
                    ))
            if section == "controls" and item.get("mandatory") is True:
                applied = bool(item.get("applies_to")) or any(
                    item.get("id") in (s.get("controls") or []) for s in stages if isinstance(s, dict)
                )
                if not applied:
                    out.append(_issue(
                        "warning", "control_unapplied", f"controls[{i}]",
                        f"Mandatory control '{item.get('id')}' does not apply to any stage, so "
                        f"coverage cannot be checked.",
                        fix="List the stages it applies to in `applies_to`.",
                    ))

    process = doc.get("process") if isinstance(doc.get("process"), dict) else {}
    if process.get("level") == "subprocess" and not process.get("parent_process"):
        out.append(_issue(
            "warning", "missing_parent", "process.parent_process",
            "A subprocess should name its parent process.",
            fix="Set parent_process to the parent process id.",
        ))
    return out


def _find_cycle(graph: dict[str, list[str]]) -> Optional[list[str]]:
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(node: str) -> Optional[list[str]]:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if state.get(nxt) == 1:
                return stack[stack.index(nxt):] + [nxt]
            if state.get(nxt) is None:
                found = visit(nxt)
                if found:
                    return found
        stack.pop()
        state[node] = 2
        return None

    for node in graph:
        if state.get(node) is None:
            found = visit(node)
            if found:
                return found
    return None


# ── 4. Placement ───────────────────────────────────────────────────────────


def _norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _placement_issues(doc: dict, concept_id: str) -> list[dict]:
    from app.ontology import store

    concept = store.get_concept(concept_id)
    if not concept:
        return [_issue("error", "unknown_process", "(placement)",
                       f"'{concept_id}' is not a process in the ontology.")]
    out: list[dict] = []
    process = doc.get("process") if isinstance(doc.get("process"), dict) else {}
    level = process.get("level")
    if level and level != concept.get("level_name"):
        out.append(_issue(
            "error", "wrong_level", "process.level",
            f"The document is a {level}, but it is being filed under a "
            f"{concept.get('level_name')}.",
            expected=concept.get("level_name"), found=level,
            fix=f"Set process.level to \"{concept.get('level_name')}\", or upload it under a "
                f"{level} instead.",
        ))

    name_match = _norm(concept["label"]) in {
        _norm(process.get("name")), _norm(process.get("id")),
        _norm((doc.get("classification") or {}).get(concept.get("level_name") or "")),
    } or _norm(concept_id.rsplit(".", 1)[-1]) == _norm(process.get("id"))
    if not name_match:
        out.append(_issue(
            "warning", "name_mismatch", "process.name",
            f"The document describes '{process.get('name') or process.get('id')}', but it is being "
            f"filed under '{concept['label']}'.",
            expected=concept["label"], found=process.get("name") or process.get("id"),
            fix="Check it is the right file for this process, or rename one of them.",
        ))

    domain_id = store.domain_of(concept_id)
    classification = doc.get("classification") if isinstance(doc.get("classification"), dict) else {}
    if domain_id and classification:
        chain = [domain_id, *store._ancestor_chain(domain_id)]
        labels = set()
        for cid in chain:
            c = store.get_concept(cid)
            if c:
                labels |= {_norm(c["label"]), _norm(cid), _norm(cid.rsplit(".", 1)[-1])}
        claimed = [classification.get(k) for k in ("industry", "domain", "subdomain")
                   if classification.get(k)]
        stray = [c for c in claimed if _norm(c) not in labels]
        if stray:
            path = " › ".join(
                (store.get_concept(c) or {}).get("label", c) for c in reversed(chain))
            out.append(_issue(
                "warning", "classification_mismatch", "classification",
                f"The document says {', '.join(map(str, stray))}, but this process is filed under "
                f"{path}.",
                expected=path, found=", ".join(map(str, stray)),
                fix="Update classification to match where the process lives in the ontology.",
            ))
    return out


# ── Entry point ────────────────────────────────────────────────────────────


def validate(raw: bytes | str | dict, template: dict, *, concept_id: Optional[str] = None,
             max_kb: Optional[int] = None, classification: Optional[dict] = None) -> dict:
    """Check one document. Never raises; everything wrong is in the report.

    Returns ``{valid, errors, warnings, issues, summary, document, template, stats}``
    where ``document`` is the parsed JSON when it parsed.
    """
    from app.config import settings

    limit = int(max_kb or getattr(settings, "PROCESS_DOC_MAX_KB", 512) or 512)
    issues: list[dict] = []
    doc: Any = None

    if isinstance(raw, dict):
        doc = raw
    else:
        text, problems = _decode(raw, limit)
        issues += problems
        if text is not None:
            doc, problems = _parse(text)
            issues += problems

    if doc is not None and not isinstance(doc, dict):
        issues.append(_issue(
            "error", "not_an_object", "(document)",
            f"The document must be a JSON object; found {_type_name(doc)}.",
            expected="object", found=_type_name(doc),
            fix="Wrap the content in { … } using the template's top-level fields.",
        ))
    elif isinstance(doc, dict):
        schema = template.get("schema") or {}
        issues += _schema_issues(doc, schema)
        issues += _unknown_fields(doc, schema)
        issues += _semantic_issues(doc)
        if concept_id:
            issues += _placement_issues(doc, concept_id)

    issues = issues[:_MAX_ISSUES]
    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warning"]
    stats = _stats(doc) if isinstance(doc, dict) else {}
    if errors:
        summary = (f"{len(errors)} error(s) must be fixed"
                   + (f", {len(warnings)} warning(s)" if warnings else "") + ".")
    else:
        summary = "Matches the template" + (f" — {len(warnings)} warning(s)." if warnings else ".")
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
        "summary": summary,
        "document": doc if isinstance(doc, dict) else None,
        "template": {
            "id": template.get("id"), "name": template.get("name"),
            "version": template.get("version"),
            # Which node set it, and whether it was inherited from above.
            "concept_id": template.get("concept_id"),
            "scope_path": template.get("scope_path"),
            "inherited": bool(template.get("inherited")),
        },
        # For an unfiled upload: where it was classified, which chose the template.
        **({"classification": classification} if classification else {}),
        "stats": stats,
    }


def _stats(doc: dict) -> dict:
    def count(key: str) -> int:
        value = doc.get(key)
        return len(value) if isinstance(value, list) else 0

    return {
        "stages": count("stages"),
        "controls": count("controls"),
        "mandatory_controls": sum(1 for c in doc.get("controls") or []
                                  if isinstance(c, dict) and c.get("mandatory") is True),
        "risks": count("risks"),
        "regulations": count("regulations"),
        "exceptions": count("exceptions"),
        "actors": count("actors"),
        "kpis": count("kpis"),
    }


def public_report(report: dict) -> dict:
    """The report without the parsed document, for storage and the API."""
    return {k: v for k, v in report.items() if k != "document"}
