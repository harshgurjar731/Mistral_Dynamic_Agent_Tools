"""
Wire an activity step's arguments in the builder — what the planner's data-flow layer does.

An activity step placed by hand starts with ``arguments: {}``; the user had to
type every ``{{step_x_output.field}}`` and only learned from validation that a
name or shape was wrong. :func:`wire_arguments` fills them for one step:

1. arguments already set that the shape check accepts are **kept**;
2. a parameter with the same name as an upstream output field or a workflow
   input is bound to it exactly (nearest upstream step first);
3. what is left is asked of the model (route ``argument_wiring``), given the
   parameter schemas and what each upstream step returns. Its answer is only
   taken where each reference resolves against those schemas — a path an
   activity does not return is dropped, never written in.

The result is checked with ``check_argument_shapes`` before it is returned.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.services.workflow_engine.argument_shapes import (
    MISSING, _Context, activity_contract, check_argument_shapes,
)
from app.services.workflow_engine.builder_context import step_neighbours

logger = logging.getLogger(__name__)

_REF = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
_STEP_OUT = re.compile(r"^step_(.+)_output$")


class WiringError(ValueError):
    pass


def _flagged_params(definition: dict, step_id: str, catalog: dict) -> set[str]:
    out = set()
    for issue in check_argument_shapes(definition, catalog):
        if issue.get("step_id") == step_id:
            # "arguments.<param>…" is that parameter's problem; an issue with the call as a
            # whole (a required parameter left out) says nothing against the others.
            field = str(issue.get("field") or "")
            if field.startswith("arguments."):
                out.add(field.split(".", 2)[1])
    return out


def _exact_sources(upstream: list[dict]) -> dict[str, str]:
    """Field name → reference, nearest upstream step first, then the workflow inputs."""
    sources: dict[str, str] = {}
    for u in upstream:
        for field in u.get("outputs") or []:
            if u.get("kind") == "workflow_input":
                sources.setdefault(field, f"{{{{{field}}}}}")
            else:
                sources.setdefault(field, f"{{{{{u['variable']}.{field}}}}}")
    return sources


def _reference_ok(ref: str, ctx: _Context, upstream_ids: set[str], inputs: set[str]) -> bool:
    parts = [p for p in ref.strip().split(".") if p]
    if not parts:
        return False
    m = _STEP_OUT.match(parts[0])
    if m:
        if m.group(1) not in upstream_ids:
            return False  # a step that does not run before this one
        return ctx.reference(ref) is not MISSING
    if parts[0] in inputs:
        return ctx.reference(ref) is not MISSING
    return False


def _acceptable(value: Any, ctx: _Context, upstream_ids: set[str], inputs: set[str]) -> bool:
    """Every reference inside ``value`` resolves to something that exists before this step."""
    if isinstance(value, str):
        return all(_reference_ok(r, ctx, upstream_ids, inputs) for r in _REF.findall(value))
    if isinstance(value, dict):
        return all(_acceptable(v, ctx, upstream_ids, inputs) for v in value.values())
    if isinstance(value, list):
        return all(_acceptable(v, ctx, upstream_ids, inputs) for v in value)
    return True


_SYSTEM = """You wire the arguments of ONE activity step in a workflow.

An activity is a Python function called with exactly the arguments you give it.
Each argument value is one of:
- a reference to data produced earlier, written {{step_<id>_output.<path>}} for a step's output
  or {{<field>}} for a workflow input, using ONLY paths that appear in the schemas given;
- a nested JSON object whose values are such references, when the parameter is a record;
- a literal JSON value, only when the parameter is a fixed setting (e.g. a currency code).

Bind each parameter to the data that means the same thing, even when names differ
(e.g. annual_income ← {{step_check_output.applicant.income}}). A step listed without an
output_schema returns its answer as text: reference it whole ({{step_<id>_output}}) only for a
text parameter. Never invent a path. Leave a parameter out when nothing provides it.

Return JSON only: {"arguments": {"<param>": <value>}, "notes": {"<param>": "<why, one line>"}}"""


async def _ask_model(client: Any, step: dict, params: dict, upstream: list[dict],
                     wired: dict, todo: list[str]) -> tuple[dict, dict]:
    from app.core.decision import decide

    props = params.get("properties") or {}
    user = json.dumps({
        "step": {"id": step.get("id"), "activity": (step.get("config") or {}).get("tool_name"),
                 "description": step.get("description") or ""},
        "parameters_to_wire": {p: props.get(p) for p in todo},
        "required": [p for p in params.get("required") or [] if p in todo],
        "already_wired": wired,
        "available_before_this_step": upstream,
    }, indent=2, default=str)[:24_000]
    data = await decide(client, system=_SYSTEM, user=user, phase="argument_wiring",
                        route="argument_wiring")
    if not isinstance(data, dict):
        return {}, {}
    args = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    notes = data.get("notes") if isinstance(data.get("notes"), dict) else {}
    return args, notes


async def wire_arguments(definition: dict, step_id: str, *, catalog: Optional[dict] = None,
                         client: Any = None, use_model: bool = True) -> dict:
    """Proposed arguments for one activity step. Nothing is saved.

    Returns ``{"arguments", "sources": {param: kept|exact|model}, "notes",
    "missing": [required params left unwired], "issues": [shape issues left]}``.
    """
    steps = {s.get("id"): s for s in definition.get("steps") or [] if isinstance(s, dict)}
    step = steps.get(step_id)
    if not step:
        raise WiringError(f"There is no step '{step_id}' in this workflow.")
    kind = str(getattr(step.get("type"), "value", step.get("type")) or "")
    cfg = step.get("config") or {}
    if kind != "tool" or not cfg.get("tool_name"):
        raise WiringError("Only an activity step with an activity chosen has arguments to wire.")
    if catalog is None:
        from app.services.workflow_engine.rule_validation import _activity_catalog

        catalog = await _activity_catalog()
    params = (activity_contract(step, catalog) or {}).get("input") or {}
    props = params.get("properties") if isinstance(params.get("properties"), dict) else {}
    if not props:
        raise WiringError(f"The activity '{cfg['tool_name']}' declares no inputs to wire "
                          "(or the tool service could not be reached).")
    required = [p for p in params.get("required") or [] if p in props]

    existing = cfg.get("arguments", cfg.get("arguments_template"))
    existing = existing if isinstance(existing, dict) else {}
    flagged = _flagged_params(definition, step_id, catalog)
    upstream, _ = step_neighbours(definition, step_id=step_id, catalog=catalog)
    upstream_ids = {u["id"] for u in upstream if u.get("kind") != "workflow_input"}
    inputs = {str(f.get("name")) for f in definition.get("input_schema") or []
              if isinstance(f, dict) and f.get("name")}
    shape_ctx = _Context(definition, catalog)

    arguments: dict = {}
    sources: dict[str, str] = {}
    notes: dict[str, str] = {}
    for name, value in existing.items():
        if name in props and name not in flagged and value not in ("", None, {}) \
                and _acceptable(value, shape_ctx, upstream_ids, inputs):
            arguments[name], sources[name] = value, "kept"
    exact = _exact_sources(upstream)
    for name in props:
        if name not in arguments and name in exact:
            arguments[name], sources[name] = exact[name], "exact"

    todo = [p for p in props if p not in arguments]
    if todo and use_model and upstream:
        try:
            proposed, why = await _ask_model(client or _client(), step, params, upstream,
                                             arguments, todo)
        except Exception as e:  # noqa: BLE001 — exact wiring still stands
            logger.warning("Argument wiring model call failed for %s: %s", step_id, e)
            proposed, why = {}, {}
        for name in todo:
            if name not in proposed:
                continue
            value = proposed[name]
            if value in (None, "") or not _acceptable(value, shape_ctx, upstream_ids, inputs):
                notes[name] = "The model's suggestion referenced data that does not exist here; left out."
                continue
            arguments[name], sources[name] = value, "model"
            if isinstance(why.get(name), str):
                notes[name] = why[name][:300]

    trial = json.loads(json.dumps(definition, default=str))
    for s in trial.get("steps") or []:
        if isinstance(s, dict) and s.get("id") == step_id:
            s.setdefault("config", {})["arguments"] = arguments
            s["config"].pop("arguments_template", None)
    issues = [i for i in check_argument_shapes(trial, catalog) if i.get("step_id") == step_id]
    return {
        "arguments": arguments,
        "sources": sources,
        "notes": notes,
        "missing": [p for p in required if p not in arguments],
        "issues": issues,
    }


def _client():
    from app.layers.codegen.pipeline import _default_client

    return _default_client()
