"""
ActivityGapLayer — Decides which deterministic steps must be built.

The counterpart to :class:`CapabilityReuseLayer`: that layer resolves agent
capabilities against existing agents, this one resolves activity capabilities
against existing activities. Same shape of question, different inventory.

Synthesis failure is non-fatal here. A step whose activity could not be built
keeps its ``tool_name`` and meets ``run_tool_step``'s own runtime
auto-synthesis fallback, or surfaces a clear per-step error at run time — both
of which beat blocking a whole workflow from ever being saved.

Not a ``DecisionLayer`` subclass: the decision is followed by ``await`` calls
to the tool service, and the base class's ``apply`` hook is synchronous.
"""

import asyncio
import json
import logging

from app.core.context import PipelineContext
from app.core.decision import decide, parse_json
from app.core.layer import NextFn
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: The tool service synthesises by generating and sandboxing real code. Three
#: at a time keeps that service responsive for everything else using it.
_SYNTHESIS_CONCURRENCY = 3


class ActivityGapLayer(WorkflowStepLayer):
    """Resolve activity capabilities against the catalogue, building what is missing."""

    name = "activity_gap"
    label = "Resolve deterministic steps"
    detail = "Decides which function steps exist already and builds the rest."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        # ``next`` is the pipeline continuation, shadowing the builtin. Nothing
        # in this method may use ``next()`` for iteration.
        from app.config import settings
        from app.prompts_decisions import (
            ACTIVITY_GAP_SYSTEM_PROMPT,
            ACTIVITY_GAP_USER_PROMPT,
        )
        from app.services.tool_registry import refresh_dynamic_tools
        from app.services.tool_resolver import tool_resolver

        spec = ctx.workflow_spec
        activity_caps = [c for c in spec.capabilities if c.kind == "activity"]

        if not activity_caps:
            logger.info("No deterministic capabilities — nothing to resolve")
            # Say so explicitly. A silent layer reads in the timeline as "this
            # did not happen", when in fact it ran and found nothing to do.
            ctx.emit("activity_plan", json.dumps({
                "reused": [], "built": [], "failed": [],
                "note": "Every step needs judgement — no deterministic steps to build.",
            }))
            return await next(ctx)

        ctx.emit("status", "Resolving deterministic steps…")

        existing = spec.inventory.get("activities", [])
        try:
            raw = await decide(
                ctx.client,
                model=settings.MISTRAL_CODING_MODEL,
                system=ACTIVITY_GAP_SYSTEM_PROMPT,
                user=ACTIVITY_GAP_USER_PROMPT.format(
                    goal=spec.goal,
                    capabilities=json.dumps(
                        [
                            {
                                "capability_id": c.id,
                                "name": c.name,
                                "purpose": c.purpose,
                                "inputs": c.inputs,
                                "outputs": c.outputs,
                            }
                            for c in activity_caps
                        ],
                        indent=2,
                    ),
                    activities=json.dumps(existing, indent=2),
                ),
                phase="activity gap",
            )
            data = parse_json(raw, {}) or {}
        except Exception as e:
            logger.error("Activity gap decision failed (non-fatal): %s", e)
            return await next(ctx)

        by_id = {c.id: c for c in activity_caps}
        existing_names = {a["name"] for a in existing}
        to_build: dict[str, dict] = {}
        # Collected and emitted once at the end. Emitting per activity produced
        # a scatter of one-line rows with no statement of what was decided
        # overall — which deterministic steps already existed, which had to be
        # built, and what each one actually does.
        reused_activities: list[dict] = []
        built_activities: list[dict] = []
        failed_activities: list[dict] = []

        for raw_res in data.get("resolutions") or []:
            if not isinstance(raw_res, dict):
                continue
            cap = by_id.get(str(raw_res.get("capability_id") or "").strip())
            if cap is None:
                continue

            action = str(raw_res.get("action") or "").strip().lower()
            existing_name = raw_res.get("existing_activity_name")

            if action == "exists" and existing_name in existing_names:
                # Bind the capability to the activity that already does the job.
                cap.reuse_agent_id = None
                ctx.metadata.setdefault("activity_bindings", {})[cap.id] = existing_name
                reused_activities.append({
                    "capability": cap.id,
                    "capability_name": cap.name,
                    "tool_name": existing_name,
                })
                continue

            spec_obj = raw_res.get("specification")
            if not isinstance(spec_obj, dict) or not spec_obj.get("name"):
                logger.warning("Activity for '%s' has no usable specification", cap.id)
                continue
            to_build[cap.id] = spec_obj

        if not to_build:
            ctx.emit("activity_plan", json.dumps({
                "reused": reused_activities, "built": [], "failed": [],
                "reasoning": str(data.get("reasoning") or ""),
            }))
            return await next(ctx)

        ctx.emit("status", f"Building {len(to_build)} activity(ies)…")
        semaphore = asyncio.Semaphore(_SYNTHESIS_CONCURRENCY)

        async def _build(cap_id: str, activity: dict):
            async with semaphore:
                result = await tool_resolver.trigger_synthesis(
                    name=activity["name"],
                    description=activity.get("description", ""),
                    parameters=activity.get("parameters", {}) or {},
                    required=activity.get("required", []) or [],
                    api_details=activity.get(
                        "api_details",
                        "No external API. This is a pure computation using the standard library.",
                    ),
                    expected_output_shape=activity.get(
                        "expected_output_shape", "A dictionary containing the result."
                    ),
                    # A standalone workflow step, not a capability an agent calls.
                    purpose="activity",
                )
                return cap_id, activity["name"], result

        results = await asyncio.gather(
            *[_build(cap_id, a) for cap_id, a in to_build.items()],
            return_exceptions=True,
        )

        built = 0
        for item in results:
            if isinstance(item, Exception):
                logger.warning("Activity synthesis task failed (non-fatal): %s", item)
                failed_activities.append({"tool_name": "unknown", "error": str(item)})
                continue
            cap_id, tool_name, result = item
            status = result.get("status", "unknown")
            if status in ("failed", "error"):
                logger.warning(
                    "Activity synthesis failed for '%s' (non-fatal): %s",
                    tool_name, result.get("message"),
                )
                failed_activities.append({
                    "tool_name": tool_name,
                    "error": result.get("message", "synthesis failed"),
                })
                continue
            built += 1
            ctx.metadata.setdefault("activity_bindings", {})[cap_id] = tool_name
            built_spec = to_build.get(cap_id, {})
            # Publish it into the catalogue so the topology layer can bind a
            # step to it in the same run that created it.
            spec.inventory.setdefault("activities", []).append({
                "name": tool_name,
                "description": built_spec.get("description", ""),
                "parameters": built_spec.get("parameters", {}),
                "required": built_spec.get("required", []),
            })
            cap = by_id.get(cap_id)
            built_activities.append({
                "capability": cap_id,
                "capability_name": cap.name if cap else cap_id,
                "tool_name": tool_name,
                "description": built_spec.get("description", ""),
                "parameters": list((built_spec.get("parameters") or {}).keys()),
                "required": built_spec.get("required", []),
                "status": status,
            })

        if built:
            await refresh_dynamic_tools()
        logger.info("Built %d of %d requested activities", built, len(to_build))

        ctx.emit("activity_plan", json.dumps({
            "reused": reused_activities,
            "built": built_activities,
            "failed": failed_activities,
            "reasoning": str(data.get("reasoning") or ""),
        }))

        return await next(ctx)
