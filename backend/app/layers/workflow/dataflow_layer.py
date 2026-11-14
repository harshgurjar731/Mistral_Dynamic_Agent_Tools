"""
DataFlowLayer — Decides how data moves through a fixed graph.

The second half of the old DAG completion. The topology is already settled and
is not this layer's to change; what it writes is the content of each step's
``config`` — the query template an agent receives, the arguments a tool is
called with, the expression a condition evaluates — plus the workflow's input
schema.

The query templates are the highest-leverage text in the whole planner. A step
whose template is a bare variable reference hands an agent raw upstream output
with no framing, which wastes the instructions that agent was so carefully
given. Asking for them in a prompt that is not simultaneously designing a graph
is the point of the split.

Bindings are re-applied from the topology afterwards rather than trusted from
the model, so this layer cannot rebind a step to a different agent even if it
tries.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer
from app.layers.workflow.topology_layer import BINDING_KEYS

#: Set on tool steps by the topology layer; like bindings, never the model's to change.
_PIN_KEYS = ("tool_version", "code_requirement")

logger = logging.getLogger(__name__)


class DataFlowLayer(WorkflowDecisionLayer):
    """Fill in templates, arguments, expressions and the input schema."""

    name = "data_flow"
    uses_prerequisites = True
    process_view = "data_flow"
    label = "Wire the data"
    detail = "Decides what each step is handed and what it passes on."
    phase = "data flow"
    status_message = "Wiring data between steps…"
    timeout_ms = LONG_TIMEOUT_MS
    # Templates are instructions to another model, not a classification. A
    # little latitude produces better-framed prompts than near-greedy decoding.
    temperature = 0.2

    async def process(self, ctx: PipelineContext, next):
        """The decision, retried once before anything is composed locally.

        A wiring that fell back silently produced a workflow that validated and
        failed its first run, so a failure gets one more attempt, and a fallback
        that still cannot wire an activity is recorded as an error.
        """
        async def stay(c):
            return c

        ctx.metadata.pop(_FALLBACK_KEY, None)
        await super().process(ctx, stay)
        if ctx.metadata.get(_FALLBACK_KEY):
            logger.warning("Data-flow decision failed — retrying once")
            ctx.emit("status", "Wiring the data failed once — trying again…")
            ctx.metadata.pop(_FALLBACK_KEY, None)
            ctx.metadata.pop("dataflow_unwired", None)
            await super().process(ctx, stay)
        return await next(ctx)

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import DATA_FLOW_SYSTEM_PROMPT, DATA_FLOW_USER_PROMPT

        spec = ctx.workflow_spec
        return (
            DATA_FLOW_SYSTEM_PROMPT,
            DATA_FLOW_USER_PROMPT.format(
                goal=spec.goal,
                topology=json.dumps(spec.topology, indent=2),
                agents=json.dumps(spec.provisioned_agents, indent=2),
                activities=json.dumps(spec.inventory.get("activities", []), indent=2),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec
        topology = spec.topology or {}
        topo_steps = {s["id"]: s for s in topology.get("steps", [])}

        returned = {
            s["id"]: s
            for s in (data.get("steps") or [])
            if isinstance(s, dict) and s.get("id")
        }

        merged_steps = []
        for step_id, topo_step in topo_steps.items():
            written = returned.get(step_id) or {}
            config = written.get("config")
            config = dict(config) if isinstance(config, dict) else {}

            # Re-apply the binding last. The data-flow layer writes templates;
            # it does not get to change which agent runs a step, and a model
            # that silently swapped one would produce a workflow that runs but
            # does the wrong work.
            for key in (*BINDING_KEYS, *_PIN_KEYS):
                if key in topo_step["config"]:
                    config[key] = topo_step["config"][key]

            if topo_step["type"] == "agent" and not config.get("query_template"):
                logger.warning(
                    "Step '%s' has no query template — composing one from its description",
                    step_id,
                )
                config["query_template"] = self._compose_template(ctx, topo_step)

            merged_steps.append({
                "id": step_id,
                "type": topo_step["type"],
                "tier": topo_step.get("tier"),
                "description": topo_step.get("description"),
                "next_steps": topo_step["next_steps"],
                "parallel_group": topo_step["parallel_group"],
                "config": config,
            })

        from app.workflow_inputs.schema import normalise_input_schema

        input_schema = data.get("input_schema")
        input_schema = input_schema if isinstance(input_schema, list) else []
        # Every input a capability declares reaches its agent (wired before the
        # input schema is normalised, so a field added to the run's input
        # record is declared with it).
        _enrich_templates(ctx, merged_steps, input_schema, before_schema=True)
        input_schema = normalise_input_schema(input_schema, merged_steps, topology.get("entry_step"))
        _enrich_templates(ctx, merged_steps, input_schema, before_schema=False)

        variables = data.get("variables")
        variables = variables if isinstance(variables, dict) else {}

        spec.dag = {
            "name": topology.get("name") or spec.workflow_name,
            "description": topology.get("description") or spec.description or spec.goal,
            "entry_step": topology.get("entry_step"),
            "steps": merged_steps,
            "input_schema": input_schema,
            "variables": variables,
        }
        spec.rationale["data_flow"] = str(data.get("reasoning") or "")
        _check_contracts(ctx)

        templated = sum(
            1 for s in merged_steps
            if s["type"] == "agent" and s["config"].get("query_template")
        )
        logger.info(
            "Data flow: %d/%d agent steps templated, %d workflow inputs",
            templated,
            sum(1 for s in merged_steps if s["type"] == "agent"),
            len(input_schema),
        )

        ctx.emit("data_flow", json.dumps({
            "input_schema": input_schema,
            "steps": [
                {"id": s["id"], "type": s["type"], "config_keys": sorted(s["config"].keys())}
                for s in merged_steps
            ],
            "reasoning": spec.rationale["data_flow"],
        }))

    def _compose_template(self, ctx: PipelineContext, step: dict) -> str:
        """Write a usable template for a step the model left bare.

        Frames the upstream outputs rather than passing them raw, which is the
        difference between an agent that knows what it has been handed and one
        that is guessing.
        """
        spec = ctx.workflow_spec
        by_id = {c.id: c for c in spec.capabilities}
        cap = by_id.get(step["id"])

        purpose = (cap.purpose if cap else "") or step.get("description") or "Perform this step."
        upstream = [c for c in spec.capabilities if cap and c.id in cap.depends_on]

        if upstream:
            supplied = "\n".join(
                f"{c.name}:\n{{{{step_{c.id}_output}}}}" for c in upstream
            )
            return (
                f"{purpose}\n\n"
                f"You have been given the following from the preceding steps:\n\n"
                f"{supplied}\n\n"
                f"Produce your result as described in your instructions."
            )
        return (
            f"{purpose}\n\n"
            f"Input:\n{{{{workflow_input}}}}\n\n"
            f"Produce your result as described in your instructions."
        )

    def fallback(self, ctx: PipelineContext) -> None:
        """Keep the topology and compose every template locally.

        A graph with composed templates is a working workflow; abandoning the
        run because the wiring decision failed would throw away the agents that
        were just created for it.
        """
        spec = ctx.workflow_spec
        topology = spec.topology or {}
        ctx.metadata[_FALLBACK_KEY] = True
        logger.warning("Data-flow decision failed — composing templates locally")

        steps = []
        unwired: list[dict] = []
        for topo_step in topology.get("steps", []):
            config = dict(topo_step["config"])
            if topo_step["type"] == "agent":
                config["query_template"] = self._compose_template(ctx, topo_step)
            elif topo_step["type"] == "tool" and not config.get("arguments"):
                config["arguments"], missing = _compose_arguments(ctx, topo_step)
                if missing:
                    unwired.append({
                        "severity": "error", "code": "dataflow.unwired",
                        "step_id": topo_step["id"], "field": "arguments",
                        "message": (
                            f"Step '{topo_step['id']}' could not be wired automatically: no earlier "
                            f"step or input provides {', '.join(missing)}. Set its arguments (or ask "
                            "Refine with AI to wire them) before running."),
                    })
            elif topo_step["type"] == "connector" and not config.get("arguments"):
                unwired.append({
                    "severity": "error", "code": "dataflow.unwired",
                    "step_id": topo_step["id"], "field": "arguments",
                    "message": (f"Step '{topo_step['id']}' has no connector arguments: the wiring "
                                "decision failed. Set them before running."),
                })
            steps.append({**topo_step, "config": config})
        ctx.metadata["dataflow_unwired"] = unwired
        _enrich_templates(ctx, steps, [], before_schema=True)
        _enrich_templates(ctx, steps, [], before_schema=False)

        spec.dag = {
            "name": topology.get("name") or spec.workflow_name,
            "description": topology.get("description") or spec.description or spec.goal,
            "entry_step": topology.get("entry_step"),
            "steps": steps,
            "input_schema": [{
                "name": "workflow_input",
                "type": "string",
                "description": "The input this workflow runs against.",
                "required": True,
            }],
            "variables": {},
        }
        spec.rationale["data_flow"] = (
            "Composed locally — the data-flow decision failed twice. Agent prompts were framed "
            "from each step's purpose; activity arguments were wired only where a parameter "
            "matches an earlier field by name"
            + (f", and {len(unwired)} step(s) still need wiring." if unwired else "."))
        ctx.set_layer_summary(self.name, spec.rationale["data_flow"])
        _check_contracts(ctx)


_FALLBACK_KEY = "dataflow_fell_back"


def _enrich_templates(ctx: PipelineContext, steps: list[dict], input_schema: list[dict], *,
                      before_schema: bool) -> None:
    """Deterministic passes over the agent templates (``template_context``).

    Before the input schema is normalised: wire every capability input the
    template leaves out. After: append what each referenced value means.
    """
    from app.layers.workflow.template_context import add_value_legend, ensure_capability_inputs
    from app.services.workflow_engine.argument_shapes import catalog_from_inventory

    spec = ctx.workflow_spec
    activities = catalog_from_inventory((spec.inventory or {}).get("activities", []))
    if before_schema:
        ctx.metadata["dataflow_notes"] = ensure_capability_inputs(
            steps, spec.capabilities, input_schema, activities)
        return
    changed = add_value_legend(steps, spec.provisioned_agents, activities, input_schema)
    if changed:
        logger.info("Data flow: explained the referenced values in %d agent prompt(s)", changed)


def _compose_arguments(ctx: PipelineContext, step: dict) -> tuple[dict, list[str]]:
    """Arguments for an activity step, wired only by exact field name. Returns (arguments, missing).

    A parameter is bound to an upstream activity output field, an upstream
    capability output, or a workflow input of the same name; nothing is guessed
    beyond that.
    """
    from app.services.workflow_engine.argument_shapes import catalog_from_inventory

    spec = ctx.workflow_spec
    catalog = catalog_from_inventory((spec.inventory or {}).get("activities", []))
    params = (catalog.get((step.get("config") or {}).get("tool_name")) or {}).get("input") or {}
    props = params.get("properties") or {}
    required = list(params.get("required") or [])
    by_id = {c.id: c for c in spec.capabilities}
    cap = by_id.get(step["id"])
    upstream = [by_id[d] for d in (cap.depends_on if cap else []) if d in by_id]
    topo = {s["id"]: s for s in (spec.topology or {}).get("steps", [])}

    sources: dict[str, str] = {}
    for up in reversed(upstream):
        tool = ((topo.get(up.id) or {}).get("config") or {}).get("tool_name")
        out = (catalog.get(tool) or {}).get("output") or {}
        for field in list(out.get("properties") or {}) + list(up.outputs or []):
            sources.setdefault(field, f"{{{{step_{up.id}_output.{field}}}}}")
    for name in (cap.inputs if cap else []):
        sources.setdefault(name, f"{{{{{name}}}}}")

    arguments = {name: sources[name] for name in props if name in sources}
    missing = [name for name in required if name not in arguments]
    return arguments, missing


def _check_contracts(ctx: PipelineContext) -> None:
    """Record references to fields an activity's output schema does not have.

    WorkflowValidationLayer turns these into errors: such a reference cannot
    resolve at run time, and it is far cheaper to reject the plan now.
    """
    from app.layers.codegen.contracts import check_output_references

    spec = ctx.workflow_spec
    schemas_by_activity = {
        a.get("name"): a.get("output_schema")
        for a in (spec.inventory or {}).get("activities", [])
        if isinstance(a.get("output_schema"), dict)
    }
    step_schemas = {
        s["id"]: schemas_by_activity.get(s["config"].get("tool_name"))
        for s in (spec.dag or {}).get("steps", [])
        if s.get("type") == "tool" and s.get("config", {}).get("tool_name") in schemas_by_activity
    }
    issues = check_output_references(spec.dag or {}, step_schemas)
    # And the other side of every call: does each argument have the shape of
    # the parameter it fills (required nested fields, records vs. scalars)?
    from app.services.workflow_engine.argument_shapes import (
        catalog_from_inventory, check_argument_shapes,
    )

    issues += check_argument_shapes(
        spec.dag or {}, catalog_from_inventory((spec.inventory or {}).get("activities", [])))
    issues += list(ctx.metadata.get("dataflow_unwired") or [])
    issues += list(ctx.metadata.get("dataflow_notes") or [])
    ctx.metadata["contract_issues"] = issues
    for issue in issues:
        logger.warning("Data-flow contract: %s", issue["message"])
