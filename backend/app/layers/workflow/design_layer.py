"""
AgentDesignLayer — Designs each new workflow agent in its own completion.

The old planner designed every agent a workflow needed inside the single
analysis call that also decided what the workflow was and which agents already
existed. An agent got a few lines of a much larger JSON document, and its
instructions showed it.

Here each new agent gets a completion to itself, with the capability it must
satisfy, what the steps before it produce, and what the steps after it expect.
That last pair is the point: an agent in a pipeline is defined as much by its
contract with its neighbours as by its own purpose, and a whole-workflow prompt
never states that contract for any individual agent.

Designs run concurrently — they are independent by construction, since each is
about one capability — bounded so a twelve-capability workflow does not open
twelve completions at once.
"""

import asyncio
import json
import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS, decide, parse_json
from app.core.specs import AgentSpec, GuardrailSpec
from app.layers.agent.guardrail_layer import parse_guardrails
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: Bounded so a large workflow does not open a completion per capability at
#: once. Design calls are the longest in the chain after the DAG layers.
_DESIGN_CONCURRENCY = 4

_VALID_MODELS = {
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
}
_VALID_TIERS = {"foundation", "domain", "use_case"}


def _kept(selected, valid: list[str]) -> list[str]:
    if not isinstance(selected, (list, tuple)):
        return []
    valid_set = set(valid)
    return [str(s).strip() for s in selected if str(s).strip() in valid_set]


def _str_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


class AgentDesignLayer(WorkflowStepLayer):
    """Produce a full configuration for every capability that needs a new agent."""

    name = "agent_design"
    label = "Design each new agent"
    detail = "Gives every new agent its own focused design pass, against its contract with its neighbours."

    async def process(self, ctx: PipelineContext, next):
        from app.config import map_model_name, settings
        from app.prompts_decisions import (
            AGENT_DESIGN_SYSTEM_PROMPT,
            AGENT_DESIGN_USER_PROMPT,
        )

        spec = ctx.workflow_spec
        inv = spec.inventory
        to_design = [
            c for c in spec.capabilities
            if c.kind == "agent" and not c.reuse_agent_id
        ]

        if not to_design:
            logger.info("Every agent capability is satisfied by an existing agent")
            return await next(ctx)

        ctx.emit("status", f"Designing {len(to_design)} agent(s)…")

        by_id = {c.id: c for c in spec.capabilities}
        semaphore = asyncio.Semaphore(_DESIGN_CONCURRENCY)

        def _upstream(cap) -> str:
            """What the steps this capability depends on will hand it."""
            items = []
            for dep_id in cap.depends_on:
                dep = by_id.get(dep_id)
                if dep:
                    items.append({"from": dep.id, "produces": dep.outputs, "purpose": dep.purpose})
            return json.dumps(items, indent=2) if items else "Nothing — this is an entry step."

        def _downstream(cap) -> str:
            """What the steps depending on this capability will need from it."""
            items = [
                {"to": other.id, "expects": other.inputs, "purpose": other.purpose}
                for other in spec.capabilities
                if cap.id in other.depends_on
            ]
            return json.dumps(items, indent=2) if items else "Nothing — this is a terminal step."

        async def _design_one(cap):
            async with semaphore:
                raw = await decide(
                    ctx.client,
                    model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                    system=AGENT_DESIGN_SYSTEM_PROMPT,
                    user=AGENT_DESIGN_USER_PROMPT.format(
                        goal=spec.goal,
                        capability=json.dumps({
                            "id": cap.id,
                            "name": cap.name,
                            "purpose": cap.purpose,
                            "tier": cap.tier,
                            "inputs": cap.inputs,
                            "outputs": cap.outputs,
                        }, indent=2),
                        upstream_outputs=_upstream(cap),
                        downstream_inputs=_downstream(cap),
                        tool_descriptions=inv.get("tool_descriptions", ""),
                        tool_keys=json.dumps(inv.get("tool_keys", [])),
                        connector_descriptions=inv.get("connector_descriptions", ""),
                        connector_ids=json.dumps(inv.get("connector_ids", [])),
                        library_descriptions=inv.get("library_descriptions", ""),
                        library_ids=json.dumps(inv.get("library_ids", [])),
                    ),
                    phase=f"agent design ({cap.id})",
                    timeout_ms=LONG_TIMEOUT_MS,
                    temperature=0.2,
                )
                return cap, parse_json(raw, None)

        results = await asyncio.gather(
            *[_design_one(c) for c in to_design], return_exceptions=True
        )

        designed = 0
        for item in results:
            if isinstance(item, Exception):
                logger.error("Agent design task failed: %s", item)
                continue
            cap, data = item
            if not isinstance(data, dict):
                logger.warning("Agent design for '%s' returned no usable JSON", cap.id)
                cap.spec = self._minimal_spec(cap)
                continue

            model = map_model_name(str(data.get("model") or "").strip())
            if model not in _VALID_MODELS:
                model = "mistral-large-latest"

            try:
                temperature = float(data.get("temperature"))
            except (TypeError, ValueError):
                temperature = 0.3
            temperature = max(0.0, min(1.0, temperature))

            tier = str(data.get("tier") or "").strip().lower()
            if tier not in _VALID_TIERS:
                tier = cap.tier

            instructions = str(data.get("agent_instructions") or "").strip()
            if len(instructions) < 200:
                logger.warning(
                    "Designed instructions for '%s' are only %d chars — composing a fallback",
                    cap.id, len(instructions),
                )
                instructions = self._compose_instructions(cap, data)

            # A step designed around the user's documents with no library to
            # read is worse than one that says so: its instructions tell it to
            # cite sources it cannot reach. Record the request; provisioning
            # creates it empty.
            requested_library = None
            wanted = data.get("create_library")
            if isinstance(wanted, dict) and wanted.get("name"):
                requested_library = {
                    "name": str(wanted.get("name"))[:100],
                    "description": str(wanted.get("description") or "")[:500],
                }

            agent_spec = AgentSpec(
                agent_name=str(data.get("agent_name") or cap.name)[:100],
                description=str(data.get("description") or cap.purpose)[:500],
                tier=tier,
                model=model,
                temperature=temperature,
                tools=_kept(data.get("tools"), inv.get("tool_keys", [])),
                connectors=_kept(data.get("connectors"), inv.get("connector_ids", [])),
                document_library_ids=_kept(
                    data.get("document_library_ids"), inv.get("library_ids", [])
                ),
                knowledge_graph=bool(data.get("knowledge_graph")),
                agent_instructions=instructions,
                requested_library=requested_library,
                # The capability's own purpose is this agent's subject, so the
                # topic-category guard can recognise it.
                guardrails=parse_guardrails(
                    data.get("guardrails") or {},
                    f"{cap.name} {cap.purpose} {spec.goal}",
                ),
            )
            agent_spec.rationale["design"] = str(data.get("reasoning") or "")

            # The output contract is what the data-flow layer writes templates
            # against, so it is carried on the capability rather than buried in
            # the agent's own configuration.
            cap.outputs = cap.outputs or _str_list(data.get("output_contract"))
            ctx.metadata.setdefault("output_contracts", {})[cap.id] = {
                "output_contract": str(data.get("output_contract") or ""),
                "output_contract_detail": str(data.get("output_contract_detail") or ""),
            }

            cap.spec = agent_spec
            designed += 1
            g = agent_spec.guardrails
            ctx.emit("agent_designed", json.dumps({
                "capability": cap.id,
                "agent_name": agent_spec.agent_name,
                "tier": agent_spec.tier,
                "model": agent_spec.model,
                "temperature": agent_spec.temperature,
                "tools": agent_spec.tools,
                "connectors": agent_spec.connectors,
                "document_library_ids": agent_spec.document_library_ids,
                "knowledge_graph": agent_spec.knowledge_graph,
                "output_contract": str(data.get("output_contract") or ""),
                "instruction_chars": len(instructions),
                # The envelope decided for this specific agent. Shown per agent
                # in the timeline: a workflow's agents carry different risk from
                # one another, and one summary for the whole workflow hides that.
                "guardrails": g.describe() if g else None,
                "requested_library": agent_spec.requested_library,
                "reasoning": agent_spec.rationale["design"],
            }))

        # A capability left without a spec would be bound to nothing by the
        # topology layer, producing a step that cannot run.
        for cap in to_design:
            if cap.spec is None:
                cap.spec = self._minimal_spec(cap)

        logger.info("Designed %d of %d agents", designed, len(to_design))
        return await next(ctx)

    # ── Fallbacks ───────────────────────────────────────────────────────

    def _compose_instructions(self, cap, data: dict) -> str:
        """Build instructions from the capability when the design call was thin."""
        contract = str(data.get("output_contract_detail") or data.get("output_contract") or "")
        outputs = ", ".join(cap.outputs) if cap.outputs else "its result"
        inputs = ", ".join(cap.inputs) if cap.inputs else "the input it is given"
        return (
            f"ROLE:\n"
            f"You are {cap.name}, a specialist step inside an automated workflow.\n\n"
            f"TASK:\n{cap.purpose or 'Perform this step of the workflow.'}\n"
            f"You receive {inputs} and must produce {outputs}.\n\n"
            f"REASONING APPROACH:\n"
            f"Read the input in full before acting. Perform your step exactly as "
            f"described, without expanding your remit into neighbouring steps. "
            f"Where the input is incomplete, work with what is present and record "
            f"what was missing.\n\n"
            f"OUTPUT FORMAT:\n"
            f"{contract or 'Return your result as structured markdown with a clear heading per output item.'}\n"
            f"Another automated step consumes this output, so keep the structure "
            f"consistent and do not add commentary around it.\n\n"
            f"CONSTRAINTS:\n"
            f"- Do not fabricate values. Where a value is unavailable, say so explicitly.\n"
            f"- Do not perform work belonging to another step in the workflow.\n\n"
            f"FALLBACK:\n"
            f"If the input is unusable, return a clearly labelled error describing "
            f"what was wrong with it. Never return an empty response."
        )

    def _minimal_spec(self, cap) -> AgentSpec:
        spec = AgentSpec(
            agent_name=cap.name[:100],
            description=cap.purpose[:500] or f"Performs {cap.name}.",
            tier=cap.tier,
            model="mistral-large-latest",
            temperature=0.3,
            tools=[],
            connectors=[],
            document_library_ids=[],
            knowledge_graph=False,
            agent_instructions=self._compose_instructions(cap, {}),
            guardrails=GuardrailSpec(),
        )
        spec.rationale["design"] = "Design call unavailable — composed from the capability."
        return spec
