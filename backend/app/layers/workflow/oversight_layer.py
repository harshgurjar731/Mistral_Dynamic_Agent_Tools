"""
OversightPlacementLayer — puts people where the governance says, and tells each
agent step how to run.

Deterministic; runs after StepTopologyLayer (the graph exists) and before
DataFlowLayer (which then wires the new steps' inputs and outputs).

1. **Stamps** every agent step with its capability's archetype — type,
   patterns, round budget, reflection criteria — which the step runner reads.
2. **Places human review** from each capability's oversight:

   every_transaction  a ``human_review`` step after the agent step
   threshold_based    a condition gate on the threshold, then review on one branch
                      (every_transaction when the threshold is not a simple comparison)
   exceptions_only    a condition gate on the agent's own ``needs_review`` flag
   sample             a review step that reviews a sampled fraction and passes the rest
   human_on_the_loop  no blocking step — the agent step opens a monitoring entry

3. **Gates approvals on connectors**: a connector step whose operation the
   process document marks ``requires_approval`` gets a review in front of it.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.layer import NextFn
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

_COMPARISON = re.compile(r"^\s*([A-Za-z_][\w.]*)\s*(>=|<=|>|<|==|!=)\s*(-?[\d.]+)\s*$")


def _runtime_archetype(archetype: Any) -> dict:
    return {
        "primary_type": archetype.primary_type, "patterns": list(archetype.patterns),
        "max_tool_rounds": archetype.max_tool_rounds,
        "reflection_criteria": list(archetype.reflection_criteria), "reflection_passes": 1,
        "oversight": archetype.oversight.to_dict(),
        # Set when sub-agents were expanded for it: the step then runs through
        # the Conversations API so Mistral executes the handoffs.
        "handoffs": any(isinstance(s, dict) and s.get("capability_id") for s in archetype.sub_agents),
    }


def _sla_seconds(text: str) -> Optional[int]:
    """'4 hours', '1 business day', '30m' → seconds. None when unreadable."""
    match = re.search(r"([\d.]+)\s*(m|min|minute|h|hour|d|day|business day|working day)s?\b", (text or "").lower())
    if not match:
        return None
    value, unit = float(match.group(1)), match.group(2)
    factor = 60 if unit.startswith("m") else 3600 if unit.startswith("h") else 86400
    return int(value * factor)


class OversightPlacementLayer(WorkflowStepLayer):
    name = "oversight_placement"
    label = "Place human oversight"
    detail = ("Adds human review where the governance requires it, gates connector actions that "
              "need approval, and tells each agent step how its type runs.")

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        spec = ctx.workflow_spec
        dag = spec.dag or {}
        steps: list[dict] = dag.get("steps") or []
        if not steps:
            return await next(ctx)

        by_id = {s["id"]: s for s in steps}
        caps = {c.id: c for c in spec.capabilities if c.archetype is not None}
        by_agent = {a["agent_id"]: a["capability_id"] for a in spec.provisioned_agents or []}
        placed: list[str] = []
        stamped = 0

        def cap_for(step: dict):
            if step["id"] in caps:
                return caps[step["id"]]
            return caps.get(by_agent.get((step.get("config") or {}).get("agent_id"), ""))

        def insert_after(step: dict, new_steps: list[dict], entry: dict) -> None:
            """Splice ``new_steps`` (entry first) in after ``step``, or after its whole parallel group."""
            group = step.get("parallel_group")
            members = [s for s in steps if group and s.get("parallel_group") == group] or [step]
            tail = members[0]["next_steps"]
            for s in new_steps:
                if not s.get("next_steps") and s is not entry:
                    s["next_steps"] = list(tail)
            if not entry.get("next_steps") and entry["type"] != "condition":
                entry["next_steps"] = list(tail)
            for m in members:
                m["next_steps"] = [entry["id"]]
            steps.extend(new_steps)
            for s in new_steps:
                by_id[s["id"]] = s

        def review_step(step_id: str, cap: Any, *, review_of: str, title: str, extra: Optional[dict] = None) -> dict:
            oversight = cap.archetype.oversight if cap is not None else None
            rid = f"review_{review_of}"
            n = 2
            while rid in by_id:
                rid, n = f"review_{review_of}_{n}", n + 1
            config = {
                "review_of": review_of, "title": title,
                "reviewer_role": (oversight.reviewer_role if oversight else "") or "",
                "instructions": "Approve to continue, correct the values that are wrong, or reject to stop.",
                "on_timeout": "fail", "workflow_name": spec.workflow_name,
            }
            sla = _sla_seconds(oversight.approval_sla) if oversight and oversight.approval_sla else None
            if sla:
                config["sla_seconds"] = sla
            config.update(extra or {})
            return {"id": rid, "type": "human_review", "tier": None, "description": title,
                    "next_steps": [], "parallel_group": None, "config": config}

        for step in list(steps):
            if step["type"] != "agent":
                continue
            cap = cap_for(step)
            if cap is None:
                continue
            step.setdefault("config", {})["archetype"] = _runtime_archetype(cap.archetype)
            stamped += 1
            oversight = cap.archetype.oversight
            if oversight.model != "human_in_the_loop":
                continue
            title = f"Review {cap.name or step['id']}"
            mode = oversight.applies_to
            if mode == "threshold_based":
                match = _COMPARISON.match(oversight.threshold or "")
                if not match:
                    mode = "every_transaction"
                    placed.append(f"{step['id']}: threshold '{oversight.threshold}' is not a simple "
                                  f"comparison — every case is reviewed")
            if mode == "every_transaction":
                review = review_step(step["id"], cap, review_of=step["id"], title=title)
                insert_after(step, [review], review)
                placed.append(f"{step['id']}: reviewed every time")
            elif mode == "sample":
                rate = oversight.sample_rate or 0.1
                review = review_step(step["id"], cap, review_of=step["id"], title=title,
                                     extra={"sample_rate": rate})
                insert_after(step, [review], review)
                placed.append(f"{step['id']}: {int(rate * 100)}% sampled for review")
            elif mode in ("exceptions_only", "threshold_based"):
                if mode == "exceptions_only":
                    expression = f"{{{{step_{step['id']}_output.needs_review}}}} == True"
                    label = "exceptions only"
                else:
                    field, op, number = match.groups()
                    expression = f"{{{{step_{step['id']}_output.{field}}}}} {op} {number}"
                    label = f"when {oversight.threshold}"
                review = review_step(step["id"], cap, review_of=step["id"], title=f"{title} ({label})")
                group = step.get("parallel_group")
                members = [s for s in steps if group and s.get("parallel_group") == group] or [step]
                tail = list(members[0]["next_steps"])
                gate = {"id": f"gate_{step['id']}", "type": "condition", "tier": None,
                        "description": f"Does {cap.name or step['id']} need review ({label})?",
                        "next_steps": [review["id"]] + ([tail[0]] if tail else []), "parallel_group": None,
                        "config": {"expression": expression, "true_step": review["id"],
                                   "false_step": tail[0] if tail else None,
                                   # An answer the gate cannot read goes to a person, not past them.
                                   "fallback_step": review["id"]}}
                review["next_steps"] = tail
                insert_after(step, [gate, review], gate)
                placed.append(f"{step['id']}: reviewed {label}")

        placed += self._gate_connectors(ctx, steps, by_id, review_step, insert_after)

        spec.dag["steps"] = steps
        ctx.emit("oversight", json.dumps({"placed": placed, "stamped_agent_steps": stamped}))
        ctx.set_layer_summary(self.name, ("; ".join(placed) if placed else "No human review required")
                              + f". {stamped} agent step(s) configured for their type.")
        return await next(ctx)

    def _gate_connectors(self, ctx, steps, by_id, review_step, insert_after) -> list[str]:
        from app.process import pipeline as process_knowledge

        facts = (process_knowledge.active(ctx) or {}).get("facts") or {}
        connectors = ((facts.get("integrations") or {}).get("connectors")) or []
        needs = [c for c in connectors if isinstance(c, dict)
                 and any(isinstance(o, dict) and o.get("requires_approval") for o in c.get("operations") or [])]
        if not needs:
            return []
        placed = []
        names = [(str(c.get("name") or "").lower(), str(c.get("id") or "").lower()) for c in needs]
        for step in list(steps):
            if step["type"] != "connector":
                continue
            config = step.get("config") or {}
            label = " ".join(str(config.get(k) or "") for k in ("connector_name", "connector_id", "tool_name")).lower()
            if not any((n and n in label) or (i and i in label) for n, i in names):
                continue
            preceding = [s for s in steps if step["id"] in (s.get("next_steps") or [])]
            review = review_step(step["id"], None, review_of=preceding[0]["id"] if preceding else step["id"],
                                 title=f"Approve before {config.get('connector_name') or step['id']}")
            review["next_steps"] = [step["id"]]
            for p in preceding:
                p["next_steps"] = [review["id"] if n == step["id"] else n for n in p["next_steps"]]
                if (p.get("config") or {}).get("true_step") == step["id"]:
                    p["config"]["true_step"] = review["id"]
                if (p.get("config") or {}).get("false_step") == step["id"]:
                    p["config"]["false_step"] = review["id"]
            if ctx.workflow_spec.dag.get("entry_step") == step["id"]:
                ctx.workflow_spec.dag["entry_step"] = review["id"]
            steps.append(review)
            by_id[review["id"]] = review
            placed.append(f"{step['id']}: approval required before the connector acts")
        return placed
