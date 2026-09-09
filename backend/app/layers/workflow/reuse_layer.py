"""
CapabilityReuseLayer — Decides, per capability, reuse or create.

Split out of the old analysis prompt, which decided what work was needed and
who should do it in one completion. Asking a model to design agents and to
resist designing them at the same time biases it toward designing: the reuse
half of the answer is the half that gets shortchanged, and the platform
accumulates near-duplicate agents.

This layer does nothing but resist. It sees the capabilities and the existing
inventory, and its only output is a reuse-or-create verdict per capability.
"""

import json
import logging

from app.core.context import PipelineContext
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

#: Below this the model is guessing, and a wrong reuse is more expensive than
#: an extra agent — it produces a workflow whose steps quietly do the wrong
#: thing, which is far harder to diagnose than one redundant agent.
_MIN_REUSE_CONFIDENCE = 0.6

#: Words in a goal or in a capability's data items that mean the workflow
#: carries exposure an agent's safety posture has to be adequate for. Used to
#: describe the workflow to the reuse decision, not to make the decision.
_SENSITIVE_MARKERS = (
    "patient", "medical", "clinical", "diagnosis", "health", "nhs",
    "personal", "pii", "identifier", "address", "date of birth", "dob",
    "salary", "income", "account", "payment", "card", "iban", "credit",
    "applicant", "customer", "employee", "candidate", "ssn", "passport",
)


def _describe_exposure(spec) -> str:
    """State what this workflow handles, for the safety-fit judgement.

    An agent's purpose can match a capability perfectly while its safety
    posture is wrong for the data this particular workflow moves. The reuse
    decision cannot see that from the capability alone, so the exposure is
    spelled out separately.
    """
    haystack = " ".join([
        spec.goal.lower(),
        " ".join(c.purpose.lower() for c in spec.capabilities),
        " ".join(i.lower() for c in spec.capabilities for i in c.inputs + c.outputs),
    ])
    markers = sorted({m for m in _SENSITIVE_MARKERS if m in haystack})

    lines = []
    if markers:
        lines.append(
            "Sensitive subject matter is present. Terms found in the goal or in "
            "the data moving between steps: " + ", ".join(markers) + "."
        )
    else:
        lines.append("No sensitive personal, financial or health data is evident.")

    reachable = spec.inventory.get("connector_ids") or []
    lines.append(
        f"External systems reachable from this workflow: "
        f"{', '.join(reachable) if reachable else 'none'}."
    )
    lines.append(
        "The final step's output is delivered to a person."
        if spec.capabilities else "No steps."
    )
    return "\n".join(lines)


class CapabilityReuseLayer(WorkflowDecisionLayer):
    """Match each required capability against the existing agent inventory."""

    name = "capability_reuse"
    label = "Reuse or create"
    detail = "Decides, per capability, whether an existing agent already covers it."
    phase = "capability reuse"
    status_message = "Checking which agents already exist…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            CAPABILITY_REUSE_SYSTEM_PROMPT,
            CAPABILITY_REUSE_USER_PROMPT,
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
                "inputs": c.inputs,
                "outputs": c.outputs,
            }
            for c in spec.capabilities
            # Activities and connector calls are not satisfied by an agent.
            if c.kind == "agent"
        ]

        return (
            CAPABILITY_REUSE_SYSTEM_PROMPT,
            CAPABILITY_REUSE_USER_PROMPT.format(
                goal=spec.goal,
                exposure=_describe_exposure(spec),
                capabilities=json.dumps(capabilities, indent=2),
                foundation_agents=json.dumps(inv.get("foundation_agents", []), indent=2),
                domain_agents=json.dumps(inv.get("domain_agents", []), indent=2),
                usecase_agents=json.dumps(inv.get("usecase_agents", []), indent=2),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec
        by_id = {c.id: c for c in spec.capabilities}
        valid_agent_ids = {a["id"] for a in spec.inventory.get("all_agents", [])}

        decisions = data.get("decisions")
        if not isinstance(decisions, list):
            raise ValueError("reuse decision returned no decisions list")

        reused = created = 0
        for raw in decisions:
            if not isinstance(raw, dict):
                continue
            cap = by_id.get(str(raw.get("capability_id") or "").strip())
            if cap is None:
                logger.warning(
                    "Reuse decision names unknown capability '%s' — ignoring",
                    raw.get("capability_id"),
                )
                continue

            action = str(raw.get("action") or "").strip().lower()
            agent_id = raw.get("existing_agent_id")
            agent_id = str(agent_id).strip() if agent_id and agent_id != "null" else None

            try:
                confidence = float(raw.get("confidence"))
            except (TypeError, ValueError):
                confidence = 0.0

            if action == "reuse" and agent_id and agent_id not in valid_agent_ids:
                logger.warning(
                    "Capability '%s' would reuse unknown agent id '%s' — creating instead",
                    cap.id, agent_id,
                )
                agent_id = None

            if action == "reuse" and agent_id and confidence < _MIN_REUSE_CONFIDENCE:
                logger.info(
                    "Capability '%s' reuse confidence %.2f below %.2f — creating instead",
                    cap.id, confidence, _MIN_REUSE_CONFIDENCE,
                )
                agent_id = None

            fit = str(raw.get("guardrail_fit") or "").strip().lower()
            gap = str(raw.get("guardrail_gap") or "").strip()
            cap.guardrail_fit = fit or None
            cap.guardrail_gap = gap or None

            # Safety fit is a veto, not a tiebreaker. An agent whose purpose
            # matches but whose stated constraints do not cover this workflow's
            # exposure removes a protection silently — the step still runs, and
            # looks correct, while doing unguarded work.
            if action == "reuse" and agent_id and fit == "insufficient":
                logger.info(
                    "Capability '%s' rejected reuse of %s — guardrail gap: %s",
                    cap.id, agent_id, gap or "unstated",
                )
                agent_id = None
                cap.reuse_reason = (
                    f"An existing agent matched on purpose but its safety posture "
                    f"was insufficient: {gap or 'the gap was not stated'}."
                )

            if action == "reuse" and agent_id:
                cap.reuse_agent_id = agent_id
                cap.reuse_reason = str(raw.get("reason") or "")
                reused += 1
            else:
                cap.reuse_agent_id = None
                # A guardrail veto already wrote a more specific reason.
                cap.reuse_reason = cap.reuse_reason or str(raw.get("reason") or "")
                created += 1

        spec.rationale["reuse"] = str(data.get("reasoning") or "")
        logger.info("Reuse decisions: %d reused, %d to create", reused, created)

        agent_caps = [c for c in spec.capabilities if c.kind == "agent"]
        ctx.emit("reuse_plan", json.dumps({
            "reused": [
                {
                    "capability": c.id, "agent_id": c.reuse_agent_id,
                    "reason": c.reuse_reason, "guardrail_fit": c.guardrail_fit,
                }
                for c in agent_caps if c.reuse_agent_id
            ],
            "to_create": [
                {
                    "capability": c.id, "name": c.name, "tier": c.tier,
                    "reason": c.reuse_reason, "guardrail_fit": c.guardrail_fit,
                    "guardrail_gap": c.guardrail_gap,
                }
                for c in agent_caps if not c.reuse_agent_id
            ],
            "rejected_for_safety": [
                {"capability": c.id, "gap": c.guardrail_gap}
                for c in agent_caps if c.guardrail_fit == "insufficient"
            ],
            "reasoning": spec.rationale["reuse"],
        }))

    def fallback(self, ctx: PipelineContext) -> None:
        """Create everything.

        Non-fatal: a workflow of freshly created agents works, it is just
        wasteful. Failing the run because the reuse check could not be made
        would be a worse trade.
        """
        logger.warning("Reuse decision failed — every agent capability will be created")
        for cap in ctx.workflow_spec.capabilities:
            if cap.kind == "agent":
                cap.reuse_agent_id = None
                cap.reuse_reason = "Reuse check unavailable."
