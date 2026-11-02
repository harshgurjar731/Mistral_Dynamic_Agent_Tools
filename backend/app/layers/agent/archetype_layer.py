"""
AgentArchetypeLayer — what shape of agent each piece of work needs.

Runs in both creation pipelines: in the workflow pipeline after
ExecutionModeLayer (only capabilities routed to "agent" need a type), in the
agent pipeline after KnowledgeContextLayer and before the facet group (so
model, tool and instruction choices can read it).

Most capabilities are decided without a model: the process document, the
build guidance and the execution profile settle them (``archetype_rules``).
The rest go to the model in one batched call. Whatever happens, the fallback
is the agent this platform always built — a tool-using agent — so a failure
here changes nothing.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn
from app.layers.agent import archetype_rules as rules

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an agent architect. For each piece of work below, choose the PRIMARY TYPE of agent
and the PATTERNS layered on it.

Primary types:
- "task": a well-defined, bounded job with a clear start and end, usually a fixed workflow
  and a known set of tools ("extract fields from this invoice and write them to SAP").
  Predictable and easy to test — the right answer for most production work.
- "goal": given an outcome rather than steps; decomposes, plans, executes and re-plans until
  done ("prepare a competitive analysis of three vendors"). Flexible, harder to control.
- "conversational": built around dialogue — answers, clarifies, keeps context across turns.

Patterns (zero or more):
- "tool_using_react": alternates reasoning and tool calls (search, APIs, databases).
- "planner_executor": one part makes an inspectable plan, another carries it out — for long,
  multi-step work whose plan should be reviewable before execution.
- "reflective": reviews and corrects its own output before returning it (against sources or
  validation criteria) — whenever outputs feed money, records or decisions.
- "multi_agent": delegates sub-tasks to specialised sub-agents.

Prefer "task" unless the work genuinely needs dialogue or open-ended planning. Follow the
process knowledge and build guidance below where they apply.

Return JSON:
{"decisions": [{"id": "<work id>", "primary_type": "task|goal|conversational",
                "patterns": ["..."], "confidence": "high|medium|low",
                "rationale": "<one sentence>"}],
 "reasoning": "<one sentence>"}
"""


def _work_line(work: dict) -> str:
    hint = f" (deterministic hints so far: {work['hint']})" if work.get("hint") else ""
    return f"- id: {work['id']}\n  name: {work['name']}\n  purpose: {work['purpose']}{hint}"


class AgentArchetypeLayer(Layer):
    name = "agent_archetype"
    label = "Choose agent types"
    detail = ("Decides task, goal or conversational for each agent, the patterns it needs, and its "
              "oversight — from the process, the build guidance and the execution profile first.")

    def __init__(self, pipeline: str):
        #: "workflow" | "agent"
        self.pipeline = pipeline

    def should_run(self, ctx: PipelineContext) -> bool:
        if not self.enabled:
            return False
        if self.pipeline == "workflow":
            from app.layers.workflow.base import workflow_ready

            return workflow_ready(ctx) and any(c.kind == "agent" for c in ctx.workflow_spec.capabilities)
        return not ctx.agent_id and not ctx.conversation_id

    def _targets(self, ctx: PipelineContext) -> list[tuple[str, str, str, Any]]:
        """(id, name, purpose, capability-or-None) for every agent being designed."""
        if self.pipeline == "workflow":
            return [(c.id, c.name, c.purpose, c) for c in ctx.workflow_spec.capabilities if c.kind == "agent"]
        req = ctx.requirements
        purpose = (req.intent if req else "") or ctx.query
        return [("agent", "The requested agent", purpose[:600], None)]

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.core.decision import decide, parse_json
        from app.knowledge import pipeline as guidance
        from app.process import pipeline as process_knowledge

        ctx.emit("status", "Choosing agent types…")
        pc = process_knowledge.active(ctx) or {}
        facts = dict(pc.get("facts") or {})
        items = guidance.items(ctx)
        requirements = ctx.requirements if self.pipeline == "agent" else None

        work = []
        for wid, name, purpose, cap in self._targets(ctx):
            partials, decided = rules.deterministic(facts, items, capability=cap, requirements=requirements)
            hint = rules.compose(rules.default_for(self.pipeline), [dict(p) for p in partials])
            work.append({"id": wid, "name": name, "purpose": purpose, "cap": cap, "decided": decided,
                         "hint": "" if not partials else f"{hint.primary_type} + {', '.join(hint.patterns)}"})

        model_partials: dict[str, dict] = {}
        undecided = [w for w in work if not w["decided"]]
        llm_summary = ""
        if undecided:
            process_block = process_knowledge.block(ctx, "agent_archetype")
            guidance_block = guidance.block(ctx, "agent_archetype")
            user = ("WORK TO CLASSIFY:\n" + "\n".join(_work_line(w) for w in undecided)
                    + process_block + guidance_block)
            try:
                from app.config import settings

                raw = await decide(ctx.client, model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                                   system=SYSTEM_PROMPT, user=user, phase="agent archetype")
                data = parse_json(raw, {}) or {}
                for d in data.get("decisions") or []:
                    if not isinstance(d, dict) or d.get("primary_type") not in ("task", "goal", "conversational"):
                        continue
                    model_partials[str(d.get("id"))] = {
                        "primary_type": d["primary_type"], "source": "llm",
                        "patterns_add": [p for p in d.get("patterns") or [] if p in
                                         ("tool_using_react", "planner_executor", "reflective", "multi_agent")],
                        "confidence": d.get("confidence") if d.get("confidence") in ("high", "medium", "low") else "medium",
                        "rationale": str(d.get("rationale") or "")[:400]}
                if process_block:
                    process_knowledge.record_refs(ctx, self.name, data)
                if guidance_block:
                    guidance.record_refs(ctx, self.name, data)
                llm_summary = str(data.get("reasoning") or "")
            except Exception as e:
                logger.warning("Archetype decision failed — defaults kept: %s", e)
                llm_summary = "The model could not be asked; defaults were used for the rest."

        decided_list = []
        conflicts: list[str] = []
        for w in work:
            spec = rules.resolve(facts, items, pipeline=self.pipeline, capability=w["cap"],
                                 requirements=requirements, model_partial=model_partials.get(w["id"]))
            if w["cap"] is not None:
                w["cap"].archetype = spec
            else:
                ctx.agent_spec.archetype = spec
                ctx.agent_spec.rationale[self.name] = spec.rationale
            if spec.guidance_ids:
                guidance.record_applied(ctx, self.name, spec.guidance_ids,
                                        how=f"decided {spec.primary_type}",
                                        target=w["id"] if w["cap"] is not None else None)
            conflicts += [f"{w['name']}: {c}" for c in spec.conflicts]
            decided_list.append({"id": w["id"], "name": w["name"], **spec.to_dict()})

        if conflicts:
            ctx.metadata["archetype_conflicts"] = conflicts
        ctx.emit("archetype", json.dumps({"decisions": decided_list, "conflicts": conflicts}, default=str))
        by_source: dict[str, int] = {}
        for d in decided_list:
            by_source[d["source"]] = by_source.get(d["source"], 0) + 1
        summary = ", ".join(f"{d['name']}: {d['primary_type']}"
                            + (f" + {', '.join(d['patterns'])}" if d["patterns"] else "") for d in decided_list[:6])
        sources = ", ".join(f"{n} by {s}" for s, n in sorted(by_source.items()))
        ctx.set_layer_summary(self.name, f"{summary}. Decided {sources}."
                              + (f" {len(conflicts)} conflict(s) — see the archetype panel." if conflicts else "")
                              + (f" {llm_summary}" if llm_summary else ""))
        return await next(ctx)
