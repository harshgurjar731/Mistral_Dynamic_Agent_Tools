"""
ExecutionModeLayer — Decides how each capability is executed, and prunes.

Split out of ``GoalDecompositionLayer``, which used to decide what work a goal
required *and* whether each unit needed an agent in the same completion. Those
are different questions answered against different evidence: decomposition
reasons about the goal, execution mode reasons about the platform's inventory
and about cost. Asked together, the mode question loses — a planner listing
capabilities reaches for "agent" as the default and every deterministic step
becomes an LLM call that runs on every execution, forever.

This layer also prunes. A capability whose whole output feeds one successor
that could produce it itself, or a duplicate of another capability, is removed
and its dependents rewired. That is the cheapest optimisation available,
because the step that never runs costs nothing and cannot fail.

Pruning is deliberately conservative: foundation-tier capabilities are never
removed (merging a safety gate into the step it guards defeats the gate), and
merges across a parallel boundary are rejected because concurrent steps cannot
absorb one another.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

_VALID_MODES = {"agent", "activity", "connector"}


class ExecutionModeLayer(WorkflowDecisionLayer):
    """Route each capability to an agent, an activity, or a connector."""

    name = "execution_mode"
    label = "Choose how each step runs"
    detail = "Decides agent vs activity vs integration for each unit of work, and removes what is redundant."
    phase = "execution mode"
    status_message = "Deciding how each step should run…"
    timeout_ms = LONG_TIMEOUT_MS

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            EXECUTION_MODE_SYSTEM_PROMPT,
            EXECUTION_MODE_USER_PROMPT,
        )

        spec = ctx.workflow_spec
        inv = spec.inventory

        capabilities = [
            {
                "id": c.id,
                "name": c.name,
                "purpose": c.purpose,
                "tier": c.tier,
                "inputs": c.inputs,
                "outputs": c.outputs,
                "depends_on": c.depends_on,
                "parallelisable": c.parallelisable,
            }
            for c in spec.capabilities
        ]

        return (
            EXECUTION_MODE_SYSTEM_PROMPT,
            EXECUTION_MODE_USER_PROMPT.format(
                goal=spec.goal,
                capabilities=json.dumps(capabilities, indent=2),
                activities=json.dumps(inv.get("activities", []), indent=2),
                tool_descriptions=inv.get("tool_descriptions", ""),
                connector_descriptions=inv.get("connector_descriptions", "")
                or "None are attachable.",
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec
        by_id = {c.id: c for c in spec.capabilities}

        decisions = data.get("decisions")
        if not isinstance(decisions, list) or not decisions:
            raise ValueError("execution mode returned no decisions")

        pruned: dict[str, str] = {}   # removed capability id -> id it merged into

        for raw in decisions:
            if not isinstance(raw, dict):
                continue
            cap = by_id.get(str(raw.get("capability_id") or "").strip())
            if cap is None:
                continue

            mode = str(raw.get("mode") or "").strip().lower()
            if mode not in _VALID_MODES:
                mode = "agent"

            # Connector mode must name a connector that is attachable here.
            # Checking only that *some* connector exists let a call to a public
            # API (an exchange-rate feed) through as a connector step with
            # nothing bound, which failed at run time with "Connector step is
            # missing 'connector_id'". Without a usable connector, the work is
            # an HTTP activity: code that calls the API, built and verified by
            # the tool service like any other activity.
            connector_id = str(raw.get("connector_id") or "").strip()
            attachable = set(spec.inventory.get("connector_ids") or [])
            if mode == "connector" and connector_id not in attachable:
                logger.info(
                    "Capability '%s' routed to connector %r, which is not attachable — "
                    "building it as an activity instead", cap.id, connector_id or None,
                )
                mode = "activity"
                connector_id = ""

            cap.kind = mode
            cap.connector_id = connector_id or None
            cap.mode_rationale = str(raw.get("rationale") or "")
            cap.agent_needs_tools = bool(raw.get("agent_needs_tools"))

            merge_into = raw.get("merge_into")
            merge_into = str(merge_into).strip() if merge_into and merge_into != "null" else None
            if raw.get("redundant") and merge_into and merge_into in by_id:
                if cap.tier == "foundation":
                    logger.info(
                        "Refusing to prune foundation capability '%s' — a safety gate "
                        "merged into the step it guards is not a gate", cap.id,
                    )
                elif merge_into == cap.id:
                    logger.warning("Capability '%s' cannot merge into itself", cap.id)
                elif cap.parallelisable and by_id[merge_into].parallelisable:
                    logger.info(
                        "Refusing to merge '%s' into '%s' — concurrent steps cannot absorb one another",
                        cap.id, merge_into,
                    )
                else:
                    pruned[cap.id] = merge_into

        if pruned:
            self._prune(spec, pruned)

        counts = {"agent": 0, "activity": 0, "connector": 0}
        for c in spec.capabilities:
            counts[c.kind] = counts.get(c.kind, 0) + 1

        spec.rationale["execution_mode"] = str(data.get("reasoning") or "")
        logger.info(
            "Execution modes: %d agent, %d activity, %d connector (%d pruned)",
            counts["agent"], counts["activity"], counts["connector"], len(pruned),
        )

        ctx.emit("execution_modes", json.dumps({
            "counts": counts,
            "pruned": [
                {"capability": cid, "merged_into": into} for cid, into in pruned.items()
            ],
            "decisions": [
                {
                    "id": c.id,
                    "name": c.name,
                    "mode": c.kind,
                    "tier": c.tier,
                    "agent_needs_tools": c.agent_needs_tools,
                    "rationale": c.mode_rationale,
                }
                for c in spec.capabilities
            ],
            "reasoning": spec.rationale["execution_mode"],
        }))

    def _prune(self, spec, pruned: dict[str, str]) -> None:
        """Drop merged capabilities and rewire everything that depended on them.

        A dependent pointing at a removed id would become an unreachable-step
        validation failure several layers later, where the cause is no longer
        visible.
        """
        # Resolve chains: A merges into B, B merges into C — A must land on C.
        def _resolve(cap_id: str, seen: set[str]) -> str:
            target = pruned.get(cap_id)
            if target is None or target in seen:
                return cap_id
            seen.add(cap_id)
            return _resolve(target, seen)

        survivors = []
        for cap in spec.capabilities:
            if cap.id in pruned:
                logger.info(
                    "Pruned capability '%s' — merged into '%s'", cap.id, pruned[cap.id]
                )
                continue
            cap.depends_on = list(dict.fromkeys(
                _resolve(dep, set()) for dep in cap.depends_on
            ))
            # A capability that ended up depending on itself after rewiring
            # would be a self-loop the topology layer cannot express.
            cap.depends_on = [d for d in cap.depends_on if d != cap.id]
            survivors.append(cap)

        # Absorb the removed capability's outputs into its target, so the
        # data-flow layer still knows those items are produced somewhere.
        by_id = {c.id: c for c in survivors}
        for removed_id, target_id in pruned.items():
            target = by_id.get(_resolve(target_id, set()))
            original = next((c for c in spec.capabilities if c.id == removed_id), None)
            if target and original:
                target.outputs = list(dict.fromkeys(target.outputs + original.outputs))

        spec.capabilities = survivors

    def fallback(self, ctx: PipelineContext) -> None:
        """Leave every capability as an agent step.

        Non-fatal: a workflow of agent steps runs correctly, it is only more
        expensive than it needed to be. Failing the plan over an optimisation
        would trade a working workflow for none at all.
        """
        logger.warning("Execution mode decision failed — every capability stays an agent step")
        for cap in ctx.workflow_spec.capabilities:
            cap.kind = "agent"
            cap.mode_rationale = "Defaulted — the execution-mode decision could not be made."
