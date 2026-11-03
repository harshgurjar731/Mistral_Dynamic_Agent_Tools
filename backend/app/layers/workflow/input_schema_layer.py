"""
InputSchemaLayer — design the workflow's run inputs and their example.

The data-flow decision writes the input schema as a side effect of wiring
templates, and it showed: inputs typed from their names rather than their use,
records declared as bare "object", inputs the steps read but nobody declared,
and examples the run check itself refused. This layer makes the schema its own
decision, on the large model (``input_schema`` route), with the evidence laid
out — every place each input is read, and the activity parameter schema of
every input passed straight to an activity.

The model's answer is never trusted as is. ``app.workflow_inputs.designer``
runs over it: names stay those the steps reference, a bound input takes its
activity parameter's type and nested schema, undeclared references are
declared, and every example is checked against exactly what a run is held to.
If the decision fails, the same deterministic pass runs over the data-flow
draft, so the schema is still accurate — only less well described.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

_MAX_FIELDS = 40


def planning_catalogue(ctx: PipelineContext) -> list[dict]:
    """Activity parameter/output schemas known to this plan."""
    spec = ctx.workflow_spec
    return list((spec.inventory or {}).get("activities") or [])


def planning_step_outputs(ctx: PipelineContext) -> dict[str, list[str]]:
    """Output names each agent step was designed to produce (capability outputs)."""
    out: dict[str, list[str]] = {}
    for cap in ctx.workflow_spec.capabilities or []:
        outputs = [o for o in (getattr(cap, "outputs", None) or []) if isinstance(o, str)]
        if outputs:
            out[cap.id] = outputs
    return out


def finalise_dag_inputs(ctx: PipelineContext, input_schema: list,
                        example_payload: Optional[dict] = None) -> list[dict]:
    """The deterministic pass over ``spec.dag``'s inputs; returns the new schema."""
    from app.workflow_inputs.designer import finalise_input_schema

    dag = ctx.workflow_spec.dag or {}
    return finalise_input_schema(
        input_schema, dag.get("steps") or [], dag.get("entry_step"),
        variables=dag.get("variables") or {}, catalogue=planning_catalogue(ctx),
        example_payload=example_payload, step_outputs=planning_step_outputs(ctx),
    )


class InputSchemaLayer(WorkflowDecisionLayer):
    """Design the run form: precise inputs and one coherent, valid example."""

    name = "input_schema"
    label = "Design the run inputs"
    detail = "Decides exactly what a run needs from you, and fills in a realistic example."
    phase = "input schema"
    status_message = "Designing the workflow's inputs and an example run…"
    route = "input_schema"
    timeout_ms = LONG_TIMEOUT_MS
    process_view = "data_flow"

    def should_run(self, ctx: PipelineContext) -> bool:
        return super().should_run(ctx) and bool((ctx.workflow_spec.dag or {}).get("steps"))

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import INPUT_SCHEMA_SYSTEM_PROMPT
        from app.workflow_inputs.designer import usage_report

        spec = ctx.workflow_spec
        dag = spec.dag or {}
        # The draft already carries every discovered input and every binding,
        # so the model sees the complete, fixed list of names.
        draft = finalise_dag_inputs(ctx, dag.get("input_schema") or [])
        dag["input_schema"] = draft
        report = usage_report(dag.get("steps") or [], draft, planning_catalogue(ctx))
        steps = [
            {"id": s.get("id"), "type": s.get("type"), "description": s.get("description"),
             "next_steps": s.get("next_steps")}
            for s in dag.get("steps") or []
        ]
        from datetime import date

        user = (
            "TODAY: " + date.today().isoformat() + " (dates in the example should be "
            "realistic relative to this)\n\n"
            "GOAL:\n" + str(spec.goal or "") + "\n\n"
            "WORKFLOW:\n" + str(dag.get("description") or spec.description or "") + "\n\n"
            "STEPS (in order):\n" + json.dumps(steps, indent=2) + "\n\n"
            "INPUTS — current draft (names are fixed):\n"
            + json.dumps(draft[:_MAX_FIELDS], indent=2, default=str) + "\n\n"
            "WHERE EACH INPUT IS READ (and the activity parameter it is bound to, if any):\n"
            + json.dumps(report[:_MAX_FIELDS], indent=2, default=str) + "\n\n"
            "Design the inputs and the example payload."
        )
        return INPUT_SCHEMA_SYSTEM_PROMPT, user

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        dag = ctx.workflow_spec.dag or {}
        draft = list(dag.get("input_schema") or [])
        by_name = {f["name"]: f for f in draft}
        designed: list[dict] = []
        returned = data.get("input_schema") if isinstance(data.get("input_schema"), list) else []
        for raw in returned:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "").strip()
            if name not in by_name:
                # Not referenced by any step: the model may not invent inputs.
                continue
            merged = {**by_name[name], **{k: v for k, v in raw.items() if v is not None}}
            designed.append(merged)
        named = {f["name"] for f in designed}
        # An input the model left out keeps its draft — a step reads it.
        designed += [f for f in draft if f["name"] not in named]

        payload = data.get("example_payload")
        payload = payload if isinstance(payload, dict) else {}
        final = finalise_dag_inputs(ctx, designed, payload)
        dag["input_schema"] = final
        ctx.workflow_spec.rationale["input_schema"] = str(data.get("reasoning") or "")
        self._emit(ctx, final)

    def fallback(self, ctx: PipelineContext) -> None:
        dag = ctx.workflow_spec.dag or {}
        dag["input_schema"] = finalise_dag_inputs(ctx, dag.get("input_schema") or [])
        self._emit(ctx, dag["input_schema"])

    @staticmethod
    def _emit(ctx: PipelineContext, fields: list[dict]) -> None:
        from app.workflow_inputs.designer import example_payload_of

        logger.info("Input schema: %d input(s): %s", len(fields),
                    ", ".join(f"{f['name']}:{f['type']}" for f in fields))
        ctx.emit("input_schema", json.dumps({
            "input_schema": [
                {k: f.get(k) for k in ("name", "type", "label", "required", "format", "description")
                 if f.get(k) is not None}
                for f in fields
            ],
            "example_payload": example_payload_of(fields),
            "reasoning": ctx.workflow_spec.rationale.get("input_schema", ""),
        }, default=str))


def example_for(definition: Any) -> dict:
    """The example payload of a saved definition (its inputs' examples)."""
    from app.workflow_inputs.designer import example_payload_of

    return example_payload_of(getattr(definition, "input_schema", None) or [])
