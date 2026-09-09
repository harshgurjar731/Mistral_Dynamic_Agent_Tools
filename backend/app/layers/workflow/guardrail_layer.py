"""
WorkflowGuardrailLayer — Reviews the assembled workflow's safety.

The counterpart to the agent pipeline's ``GuardrailConfigLayer``, and placed
for the same reason: risk is a property of the assembled thing, not of any one
part. An agent's envelope is decided once its tools and connectors are known; a
workflow's is decided once its whole path is known.

The analysis this performs is one no per-step review can. Data entering at the
first step and reaching a write-capable connector at the last is a property of
the path, and every individual step on that path can look unremarkable.

It reports and annotates rather than rewriting the graph. Inserting steps after
the topology has been fixed would invalidate the structure the data-flow layer
just wired, so missing gates are surfaced for a human to act on instead.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS
from app.layers.workflow.base import WorkflowDecisionLayer

logger = logging.getLogger(__name__)

_VALID_PII = {"allow", "redact", "refuse"}


def _str_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


class WorkflowGuardrailLayer(WorkflowDecisionLayer):
    """Trace the assembled workflow for exposure and gate coverage."""

    name = "workflow_guardrail"
    label = "Review the whole path"
    detail = "Decides what the assembled workflow exposes, which no single step reveals."
    phase = "workflow guardrail review"
    status_message = "Reviewing workflow safety…"
    timeout_ms = LONG_TIMEOUT_MS

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            WORKFLOW_GUARDRAIL_SYSTEM_PROMPT,
            WORKFLOW_GUARDRAIL_USER_PROMPT,
        )

        spec = ctx.workflow_spec

        # Which connectors are reachable at all, and through which agent. The
        # model cannot trace exposure without knowing this, and it is spread
        # across the agent records rather than visible in the graph.
        reachable = []
        for agent in spec.provisioned_agents:
            for connector_id in agent.get("connectors") or []:
                reachable.append({
                    "connector_id": connector_id,
                    "via_agent": agent["agent_name"],
                    "at_step": agent["capability_id"],
                })
        for step in (spec.dag or {}).get("steps", []):
            if step["type"] == "connector" and step["config"].get("connector_id"):
                reachable.append({
                    "connector_id": step["config"]["connector_id"],
                    "via_agent": None,
                    "at_step": step["id"],
                })

        return (
            WORKFLOW_GUARDRAIL_SYSTEM_PROMPT,
            WORKFLOW_GUARDRAIL_USER_PROMPT.format(
                goal=spec.goal,
                dag=json.dumps(spec.dag, indent=2),
                agents=json.dumps(spec.provisioned_agents, indent=2),
                connector_detail=json.dumps(reachable, indent=2) if reachable
                else "None — this workflow reaches no external systems.",
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.workflow_spec

        raw_policy = data.get("workflow_policy")
        raw_policy = raw_policy if isinstance(raw_policy, dict) else {}
        pii = str(raw_policy.get("pii_policy") or "").strip().lower()

        try:
            max_steps = int(raw_policy.get("max_total_steps"))
        except (TypeError, ValueError):
            max_steps = 50
        # The engine's own safety cap is 50; a higher number here would be
        # advisory only, which is worse than saying nothing.
        max_steps = max(1, min(50, max_steps))

        step_policies = {}
        for raw in data.get("step_policies") or []:
            if isinstance(raw, dict) and raw.get("step_id") and raw.get("policy"):
                step_policies[str(raw["step_id"])] = str(raw["policy"])

        guardrails = {
            "has_input_gate": bool(data.get("has_input_gate")),
            "input_gate_step": data.get("input_gate_step") or None,
            "has_output_gate": bool(data.get("has_output_gate")),
            "output_gate_step": data.get("output_gate_step") or None,
            "missing_gates": [
                g for g in (data.get("missing_gates") or []) if isinstance(g, dict)
            ],
            "data_exposure": [
                e for e in (data.get("data_exposure") or []) if isinstance(e, dict)
            ],
            "step_policies": step_policies,
            "workflow_policy": {
                "pii_policy": pii if pii in _VALID_PII else "redact",
                "max_total_steps": max_steps,
                "halt_on": _str_list(raw_policy.get("halt_on")),
                "audit": _str_list(raw_policy.get("audit")),
            },
            "reasoning": str(data.get("reasoning") or ""),
        }

        # Annotate the steps the review flagged. Step runners ignore config keys
        # they do not know, so this rides along with the definition and is
        # visible in the builder without changing execution.
        annotated = 0
        for step in (spec.dag or {}).get("steps", []):
            policy = step_policies.get(step["id"])
            if policy:
                step["config"]["guardrail_policy"] = policy
                annotated += 1

        spec.guardrails = guardrails
        spec.rationale["guardrails"] = guardrails["reasoning"]

        logger.info(
            "Workflow guardrails: input_gate=%s output_gate=%s missing=%d exposures=%d "
            "policies=%d (annotated %d steps)",
            guardrails["has_input_gate"], guardrails["has_output_gate"],
            len(guardrails["missing_gates"]), len(guardrails["data_exposure"]),
            len(step_policies), annotated,
        )

        ctx.emit("workflow_guardrails", json.dumps(guardrails))

    def fallback(self, ctx: PipelineContext) -> None:
        """Record that the review did not happen.

        Silently omitting the guardrail block would read downstream as "this
        workflow was reviewed and found clean", which is the one wrong
        conclusion to allow.
        """
        ctx.workflow_spec.guardrails = {
            "reviewed": False,
            "reasoning": "The workflow safety review could not be completed.",
        }
        ctx.emit("workflow_guardrails", json.dumps(ctx.workflow_spec.guardrails))
