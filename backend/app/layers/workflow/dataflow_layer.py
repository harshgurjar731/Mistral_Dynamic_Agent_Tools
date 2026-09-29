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
    label = "Wire the data"
    detail = "Decides what each step is handed and what it passes on."
    phase = "data flow"
    status_message = "Wiring data between steps…"
    timeout_ms = LONG_TIMEOUT_MS
    # Templates are instructions to another model, not a classification. A
    # little latitude produces better-framed prompts than near-greedy decoding.
    temperature = 0.2

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

        input_schema = data.get("input_schema")
        input_schema = [s for s in input_schema if isinstance(s, dict)] if isinstance(input_schema, list) else []

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
        logger.warning("Data-flow decision failed — composing templates locally")

        steps = []
        for topo_step in topology.get("steps", []):
            config = dict(topo_step["config"])
            if topo_step["type"] == "agent":
                config["query_template"] = self._compose_template(ctx, topo_step)
            steps.append({**topo_step, "config": config})

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
        spec.rationale["data_flow"] = "Composed locally — the data-flow decision could not be made."
        _check_contracts(ctx)


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
    ctx.metadata["contract_issues"] = issues
    for issue in issues:
        logger.warning("Data-flow contract: %s", issue["message"])
