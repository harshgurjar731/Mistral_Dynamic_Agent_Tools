"""
StepTopologyLayer — Decides the shape of the execution graph.

The first half of what used to be one DAG completion. That call decided the
steps, their order, their concurrency, every query template, every tool
argument, the input schema and the variable wiring — all at once. The graph is
a structural problem and the templates are a writing problem, and interleaving
them meant neither got sustained attention; templates in particular came back
as bare variable references with no instruction around them.

This layer decides structure only: which steps exist, what each is, how they
connect, and which run concurrently. :class:`DataFlowLayer` writes the
templates against the structure this fixes.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

_VALID_TYPES = {"agent", "tool", "connector", "condition", "transform"}

#: Config keys that belong to the binding, not to the data flow. Kept apart so
#: the data-flow layer can write ``config`` freely without being able to
#: rebind a step to a different agent.
BINDING_KEYS = ("agent_id", "tool_name", "connector_id", "connector_name",
                "true_step", "false_step")


class StepTopologyLayer(WorkflowDecisionLayer):
    """Decide steps, types, edges, parallel groups and bindings."""

    name = "step_topology"
    label = "Shape the graph"
    detail = "Decides which steps exist, how they connect, and which run concurrently."
    phase = "step topology"
    status_message = "Designing the workflow graph…"
    timeout_ms = LONG_TIMEOUT_MS

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            STEP_TOPOLOGY_SYSTEM_PROMPT,
            STEP_TOPOLOGY_USER_PROMPT,
        )

        spec = ctx.workflow_spec
        inv = spec.inventory

        capabilities = [
            {
                "id": c.id,
                "name": c.name,
                "purpose": c.purpose,
                "tier": c.tier,
                "kind": c.kind,
                "depends_on": c.depends_on,
                "parallelisable": c.parallelisable,
                "bound_activity": (ctx.metadata.get("activity_bindings") or {}).get(c.id),
            }
            for c in spec.capabilities
        ]

        return (
            STEP_TOPOLOGY_SYSTEM_PROMPT,
            STEP_TOPOLOGY_USER_PROMPT.format(
                goal=spec.goal,
                capabilities=json.dumps(capabilities, indent=2),
                agents=json.dumps(spec.provisioned_agents, indent=2),
                activities=json.dumps(inv.get("activities", []), indent=2),
                connector_descriptions=inv.get("connector_descriptions", ""),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec

        raw_steps = data.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            raise ValueError("topology returned no steps")

        agent_ids = {a["agent_id"] for a in spec.provisioned_agents}
        by_capability = {
            a["capability_id"]: a["agent_id"] for a in spec.provisioned_agents
        }
        activity_names = {a["name"] for a in spec.inventory.get("activities", [])}

        steps: list[dict] = []
        seen: set[str] = set()
        for index, raw in enumerate(raw_steps):
            if not isinstance(raw, dict):
                continue
            step_id = str(raw.get("id") or f"step_{index}").strip()
            if step_id in seen:
                continue
            seen.add(step_id)

            step_type = str(raw.get("type") or "").strip().lower()
            if step_type not in _VALID_TYPES:
                step_type = "agent"

            binding = raw.get("binding") if isinstance(raw.get("binding"), dict) else {}
            config: dict = {}

            if step_type == "agent":
                agent_id = str(binding.get("agent_id") or "").strip()
                # Prefer the provisioning record over whatever the model wrote.
                # It knows which agent was actually created for this capability;
                # the model is working from a list it may misquote.
                if step_id in by_capability:
                    agent_id = by_capability[step_id]
                elif agent_id not in agent_ids:
                    logger.warning(
                        "Step '%s' binds unknown agent '%s' — leaving unbound for validation",
                        step_id, agent_id,
                    )
                    agent_id = ""
                if agent_id:
                    config["agent_id"] = agent_id

            elif step_type == "tool":
                tool_name = str(binding.get("tool_name") or "").strip()
                bound = (ctx.metadata.get("activity_bindings") or {}).get(step_id)
                if bound:
                    tool_name = bound
                if tool_name:
                    config["tool_name"] = tool_name
                    if tool_name not in activity_names:
                        # Not an error: run_tool_step has a runtime
                        # auto-synthesis fallback for exactly this case.
                        logger.info(
                            "Step '%s' references activity '%s' not in the catalogue",
                            step_id, tool_name,
                        )

            elif step_type == "connector":
                for key in ("connector_id", "connector_name", "tool_name"):
                    value = str(binding.get(key) or "").strip()
                    if value:
                        config[key] = value

            elif step_type == "condition":
                for key in ("true_step", "false_step"):
                    value = str(binding.get(key) or "").strip()
                    if value:
                        config[key] = value

            next_steps = raw.get("next_steps")
            next_steps = [str(s).strip() for s in next_steps] if isinstance(next_steps, list) else []

            parallel_group = raw.get("parallel_group")
            parallel_group = str(parallel_group).strip() if parallel_group else None

            steps.append({
                "id": step_id,
                "type": step_type,
                "tier": raw.get("tier"),
                "description": str(raw.get("description") or "")[:500],
                "next_steps": next_steps,
                "parallel_group": parallel_group or None,
                "config": config,
            })

        known_ids = {s["id"] for s in steps}
        for step in steps:
            dropped = [n for n in step["next_steps"] if n not in known_ids]
            if dropped:
                logger.warning("Step '%s' points at unknown steps %s — dropping", step["id"], dropped)
            step["next_steps"] = [n for n in step["next_steps"] if n in known_ids]

        # Every branch of a parallel group must converge on the same successor.
        # The execution engine advances a whole group from its first member's
        # next_steps, so divergent branches silently lose their successors.
        groups: dict[str, list[dict]] = {}
        for step in steps:
            if step["parallel_group"]:
                groups.setdefault(step["parallel_group"], []).append(step)
        for group_name, members in groups.items():
            targets = {tuple(m["next_steps"]) for m in members}
            if len(targets) > 1:
                canonical = max((m["next_steps"] for m in members), key=len)
                logger.warning(
                    "Parallel group '%s' had divergent successors %s — converging on %s",
                    group_name, targets, canonical,
                )
                for m in members:
                    m["next_steps"] = list(canonical)

        entry_step = str(data.get("entry_step") or "").strip()
        if entry_step not in known_ids:
            entry_step = steps[0]["id"]
            logger.warning("Entry step missing or unknown — defaulting to '%s'", entry_step)

        spec.topology = {
            "name": spec.workflow_name or str(data.get("name") or "generated_workflow"),
            "description": spec.description or str(data.get("description") or spec.goal),
            "entry_step": entry_step,
            "steps": steps,
        }
        spec.rationale["topology"] = str(data.get("reasoning") or "")

        logger.info(
            "Topology: %d steps, entry='%s', %d parallel group(s)",
            len(steps), entry_step, len(groups),
        )

        ctx.emit("topology", json.dumps({
            "entry_step": entry_step,
            "steps": [
                {
                    "id": s["id"],
                    "type": s["type"],
                    "description": s["description"],
                    "next_steps": s["next_steps"],
                    "parallel_group": s["parallel_group"],
                }
                for s in steps
            ],
            "reasoning": spec.rationale["topology"],
        }))

    def fallback(self, ctx: PipelineContext) -> None:
        """Build a linear chain from the capability dependency order.

        The capabilities already carry a dependency order, so a chain through
        them is a real workflow rather than a placeholder — worse than a
        designed graph, but genuinely runnable.
        """
        import json as _json

        spec = ctx.workflow_spec
        logger.warning("Topology decision failed — falling back to a linear chain")

        by_capability = {a["capability_id"]: a["agent_id"] for a in spec.provisioned_agents}
        bindings = ctx.metadata.get("activity_bindings") or {}

        ordered = sorted(spec.capabilities, key=lambda c: len(c.depends_on))
        steps = []
        for index, cap in enumerate(ordered):
            config: dict = {}
            step_type = "tool" if cap.kind == "activity" else "agent"
            if step_type == "agent" and cap.id in by_capability:
                config["agent_id"] = by_capability[cap.id]
            elif step_type == "tool" and cap.id in bindings:
                config["tool_name"] = bindings[cap.id]
            steps.append({
                "id": cap.id,
                "type": step_type,
                "tier": cap.tier,
                "description": cap.purpose,
                "next_steps": [ordered[index + 1].id] if index + 1 < len(ordered) else [],
                "parallel_group": None,
                "config": config,
            })

        if not steps:
            ctx.emit("fatal_error", _json.dumps(
                {"error": "Could not build a workflow graph from the goal."}
            ))
            ctx.set_error("Topology construction failed")
            return

        spec.topology = {
            "name": spec.workflow_name or "generated_workflow",
            "description": spec.description or spec.goal,
            "entry_step": steps[0]["id"],
            "steps": steps,
        }
        spec.rationale["topology"] = "Linear fallback — the topology decision could not be made."
