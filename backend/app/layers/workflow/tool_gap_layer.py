"""
ActivityGapLayer — Resolves the workflow's deterministic steps to activities.

An adapter onto the code-requirement pipeline (``app.layers.codegen``). Each
capability routed to "activity" becomes a ``CodeNeed`` carrying what the
activity must fit: the capability's named inputs and outputs, the steps that
feed it and the steps that read it. The pipeline decides reuse, authors a
specification with an output contract and worked examples, and builds it.

This layer used to author the specifications itself in one batched decision,
with prose output shapes and no examples — so a built activity could return
field names no later step expected, and nothing noticed until a run failed.

What it records for later layers, keyed by capability id:

    metadata["activity_bindings"]      → activity name   (topology binds steps)
    metadata["activity_versions"]      → version number  (steps pin it)
    metadata["activity_requirements"]  → the requirement (runtime recovery)

Failure is non-fatal: a step whose activity could not be built stays unbound
and surfaces as a clear validation or per-step error.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.layer import NextFn
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: The tool service builds by generating and sandboxing real code. Three at a
#: time keeps it responsive for everything else using it.
_SYNTHESIS_CONCURRENCY = 3


class ActivityGapLayer(WorkflowStepLayer):
    """Resolve activity capabilities against the catalogue, building what is missing."""

    name = "activity_gap"
    label = "Resolve activities"
    detail = (
        "Reuses or builds the activities — deterministic code that runs as its own "
        "step in the workflow graph, with no LLM."
    )

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        # ``next`` is the pipeline continuation, shadowing the builtin.
        from app.core.specs import CodeNeed
        from app.layers.codegen import resolve_code_needs

        spec = ctx.workflow_spec
        activity_caps = [c for c in spec.capabilities if c.kind == "activity"]

        if not activity_caps:
            logger.info("No deterministic capabilities — nothing to resolve")
            ctx.emit("activity_plan", json.dumps({
                "reused": [], "built": [], "failed": [],
                "note": "Every step needs judgement — no activities to build.",
            }))
            return await next(ctx)

        ctx.emit("status", f"Resolving {len(activity_caps)} activity(ies)…")
        by_id = {c.id: c for c in spec.capabilities}

        needs = []
        for cap in activity_caps:
            upstream = [
                {"id": u.id, "name": u.name, "kind": u.kind, "outputs": u.outputs}
                for u in (by_id.get(d) for d in cap.depends_on) if u is not None
            ]
            downstream = [
                {"id": c.id, "name": c.name, "kind": c.kind, "inputs": c.inputs}
                for c in spec.capabilities if cap.id in c.depends_on
            ]
            needs.append(CodeNeed(
                purpose="activity",
                origin="workflow",
                intent=cap.purpose,
                name_hint=cap.name,
                goal=spec.goal,
                capability={"id": cap.id, "name": cap.name, "purpose": cap.purpose,
                            "inputs": cap.inputs, "outputs": cap.outputs},
                upstream=upstream,
                downstream=downstream,
            ))

        def relay(event: dict) -> None:
            stage = event.get("stage")
            if stage in ("reuse", "author", "submit", "contract", "preflight"):
                ctx.emit("status", str(event.get("message", ""))[:200])

        resolutions = await resolve_code_needs(needs, client=ctx.client, on_event=relay,
                                               concurrency=_SYNTHESIS_CONCURRENCY)

        bindings = ctx.metadata.setdefault("activity_bindings", {})
        versions = ctx.metadata.setdefault("activity_versions", {})
        requirements = ctx.metadata.setdefault("activity_requirements", {})
        catalogue = spec.inventory.setdefault("activities", [])
        reused, built, failed = [], [], []

        for cap, resolution in zip(activity_caps, resolutions):
            row = {
                "capability": cap.id,
                "capability_name": cap.name,
                "tool_name": resolution.name,
                "version": resolution.version,
                "why_activity": cap.mode_rationale,
                "reason": resolution.reason or resolution.message,
            }
            if resolution.status in ("reused", "built", "pending_approval"):
                bindings[cap.id] = resolution.name
                if resolution.version is not None:
                    versions[cap.id] = resolution.version
                if resolution.requirement is not None:
                    requirements[cap.id] = resolution.requirement.as_request()
                if resolution.name not in {a.get("name") for a in catalogue}:
                    req = resolution.requirement
                    catalogue.append({
                        "name": resolution.name,
                        "description": req.description if req else "",
                        "parameters": ((req.input_schema or {}).get("properties", {}) if req else {}),
                        "required": ((req.input_schema or {}).get("required", []) if req else []),
                        "output_schema": resolution.output_schema,
                        "version": resolution.version,
                    })
                if resolution.status == "reused":
                    reused.append(row)
                else:
                    req = resolution.requirement
                    built.append({
                        **row,
                        "status": resolution.status,
                        "description": req.description if req else "",
                        "parameters": list(((req.input_schema or {}).get("properties") or {}).keys()) if req else [],
                        "required": list((req.input_schema or {}).get("required") or []) if req else [],
                        "outputs": list(((resolution.output_schema or {}).get("properties") or {}).keys()),
                        "examples": len(req.examples) if req else 0,
                    })
            else:
                logger.warning("Activity for '%s' not available: %s", cap.id, resolution.message)
                failed.append({**row, "status": resolution.status,
                               "error": resolution.message, "issues": resolution.issues})

        logger.info("Activities: %d reused, %d built, %d failed", len(reused), len(built), len(failed))
        ctx.emit("activity_plan", json.dumps({
            "reused": reused, "built": built, "failed": failed,
        }, default=str))
        return await next(ctx)
