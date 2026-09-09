"""
GoalDecompositionLayer — Decides what work the goal requires.

The first judgement in the workflow chain, and deliberately blind to the
inventory: it decides what work must happen, not who does it. The old analysis
prompt answered both at once, which is how a planner ends up proposing to
create an agent that is already sitting in the inventory — asked to design and
to check for duplicates in the same breath, the design half dominates.

Reuse is now a separate decision in :mod:`~app.layers.workflow.reuse_layer`,
made against this layer's output.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS, DecisionLayer
from app.core.specs import CapabilitySpec

logger = logging.getLogger(__name__)

_VALID_TIERS = {"foundation", "domain", "use_case"}


def _slug(text: str, fallback: str) -> str:
    """Coerce to a snake_case identifier usable as a step id."""
    cleaned = "".join(c if c.isalnum() else "_" for c in str(text or "").strip().lower())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned[:64] or fallback


def _str_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


class GoalDecompositionLayer(DecisionLayer):
    """Break the goal into the ordered capabilities it requires."""

    name = "goal_decomposition"
    label = "Decompose the goal"
    detail = "Decides what work the goal requires, before deciding who does it."
    phase = "goal decomposition"
    status_message = "Decomposing the goal into capabilities…"
    timeout_ms = LONG_TIMEOUT_MS

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            GOAL_DECOMPOSITION_SYSTEM_PROMPT,
            GOAL_DECOMPOSITION_USER_PROMPT,
        )

        inv = ctx.workflow_spec.inventory
        return (
            GOAL_DECOMPOSITION_SYSTEM_PROMPT,
            GOAL_DECOMPOSITION_USER_PROMPT.format(
                goal=ctx.workflow_spec.goal,
                scope_description=inv.get("scope_description") or "no specific domain matched",
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec

        spec.workflow_name = _slug(data.get("workflow_name"), "generated_workflow")
        spec.description = str(data.get("description") or spec.goal)[:1000]

        raw_caps = data.get("capabilities")
        if not isinstance(raw_caps, list) or not raw_caps:
            raise ValueError("decomposition returned no capabilities")

        capabilities: list[CapabilitySpec] = []
        seen: set[str] = set()
        for index, raw in enumerate(raw_caps):
            if not isinstance(raw, dict):
                continue
            cap_id = _slug(raw.get("id") or raw.get("name"), f"step_{index}")
            # Ids are the join key for every layer after this one — topology
            # keeps them as step ids and data flow matches on them — so a
            # duplicate would silently collapse two units of work into one.
            while cap_id in seen:
                cap_id = f"{cap_id}_{index}"
            seen.add(cap_id)

            tier = str(raw.get("tier") or "").strip().lower()

            capabilities.append(CapabilitySpec(
                id=cap_id,
                name=str(raw.get("name") or cap_id.replace("_", " ").title())[:100],
                purpose=str(raw.get("purpose") or "")[:500],
                tier=tier if tier in _VALID_TIERS else "domain",
                # ``kind`` is ExecutionModeLayer's decision, not this layer's.
                inputs=_str_list(raw.get("inputs")),
                outputs=_str_list(raw.get("outputs")),
                depends_on=[_slug(d, "") for d in _str_list(raw.get("depends_on"))],
                parallelisable=bool(raw.get("parallelisable")),
            ))

        # Drop dependencies on capabilities that were never emitted. The
        # topology layer treats these as edges, and an edge to a nonexistent
        # step becomes an unreachable-step validation failure much later.
        known = {c.id for c in capabilities}
        for cap in capabilities:
            unknown = [d for d in cap.depends_on if d not in known]
            if unknown:
                logger.warning(
                    "Capability '%s' depends on unknown ids %s — dropping those edges",
                    cap.id, unknown,
                )
            cap.depends_on = [d for d in cap.depends_on if d in known]

        spec.capabilities = capabilities
        spec.rationale["decomposition"] = str(data.get("reasoning") or "")

        logger.info(
            "Decomposed '%s' into %d capabilities: %s",
            spec.workflow_name, len(capabilities), [c.id for c in capabilities],
        )

        ctx.emit("capabilities", json.dumps({
            "workflow_name": spec.workflow_name,
            "description": spec.description,
            "capabilities": [
                {
                    "id": c.id,
                    "name": c.name,
                    "purpose": c.purpose,
                    "tier": c.tier,
                    "depends_on": c.depends_on,
                    "parallelisable": c.parallelisable,
                }
                for c in capabilities
            ],
            "reasoning": spec.rationale["decomposition"],
        }))

    def fallback(self, ctx: PipelineContext) -> None:
        """Decomposition is load-bearing — without it there is nothing to plan.

        Every layer after this one iterates the capability list, so an empty
        list would produce a workflow with no steps rather than an error the
        user can act on. Fail the run here instead.
        """
        ctx.emit(
            "fatal_error",
            json.dumps({"error": "Could not decompose the goal into capabilities. "
                                 "Try stating the goal more concretely."}),
        )
        ctx.set_error("Goal decomposition failed")
