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
    metadata["build_issues"]           → validation issues (finalize layer)

Building is tried properly first: an activity that fails is built once more,
on its own, before giving up. Every new build is smoke-tested by the pipeline
and a broken one is rolled back, so what binds here actually runs.

If anything still fails, planning stops and asks the user (``plan_control``):

* retry    — build the failed activities again (and ask again if they still fail)
* rollback — remove everything this plan has created so far, and stop
* manual   — finish the workflow without them; they are built, or their code
  written by hand, after the workflow is saved

Choosing manual (also the default when nobody can be asked) leaves each failed
activity one of two ways:

* deferred — its specification passed every check and only the build failed
  (tool service down or slow, or the code kept coming out broken). The step is
  bound with that specification, so the first run rebuilds it; validation
  warns.
* unbuilt — the specification itself could not be made sound, or the safety
  policy blocked it. Nothing at run time can fix that; validation reports an
  error, so the workflow is saved but not registered until it is rebuilt or
  re-planned.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.layer import NextFn
from app.layers.workflow import plan_control
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: The tool service builds by generating and sandboxing real code. Three at a
#: time keeps it responsive for everything else using it.
_SYNTHESIS_CONCURRENCY = 3

#: Statuses a second attempt cannot change.
_FINAL_FAILURES = ("blocked",)


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
        from app.core.specs import CodeNeed, CodeRequirement
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
            if stage in ("reuse", "author", "submit", "contract", "preflight", "smoke", "rollback"):
                ctx.emit("status", str(event.get("message", ""))[:200])

        resolutions = await resolve_code_needs(needs, client=ctx.client, on_event=relay,
                                               concurrency=_SYNTHESIS_CONCURRENCY)

        # A second attempt, one at a time, for what failed. Most failures here
        # are the tool service being restarted or saturated by the concurrent
        # first pass, which a sequential retry gets past.
        attempts = 1
        retry_at = [i for i, r in enumerate(resolutions)
                    if not _resolved(r) and r.status not in _FINAL_FAILURES]
        if retry_at:
            ctx.emit("status", f"Retrying {len(retry_at)} activity(ies) that could not be built…")
            await _retry(resolutions, needs, retry_at, ctx, relay)
            attempts += 1

        # Still failing after every automatic attempt: the user decides.
        recorded: set[int] = set()
        choice = "manual"
        while True:
            _record_new(ctx, resolutions, recorded)
            failing = [i for i, r in enumerate(resolutions) if not _resolved(r)]
            if not failing:
                break
            choice = await plan_control.ask_build_failed(ctx, "activity", plan_control.failure_rows([
                {"id": activity_caps[i].id, "name": resolutions[i].name or activity_caps[i].name,
                 "step": activity_caps[i].name, "error": resolutions[i].message,
                 "rolled_back": resolutions[i].rolled_back}
                for i in failing]), attempts=attempts)
            if choice == "retry":
                ctx.emit("status", f"Retrying {len(failing)} activity(ies) at your request…")
                await _retry(resolutions, needs, failing, ctx, relay)
                attempts += 1
                continue
            if choice == "rollback":
                await plan_control.roll_back_plan(ctx, "activities could not be built")
                return await next(ctx)
            break  # manual

        bindings = ctx.metadata.setdefault("activity_bindings", {})
        versions = ctx.metadata.setdefault("activity_versions", {})
        requirements = ctx.metadata.setdefault("activity_requirements", {})
        catalogue = spec.inventory.setdefault("activities", [])
        build_issues = ctx.metadata.setdefault("build_issues", [])
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
            if _resolved(resolution):
                bindings[cap.id] = resolution.name
                if resolution.version is not None:
                    versions[cap.id] = resolution.version
                if resolution.requirement is not None:
                    requirements[cap.id] = resolution.requirement.as_request()
                _catalogue(catalogue, resolution.name, resolution.requirement,
                           resolution.output_schema, resolution.version)
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
                continue

            logger.warning("Activity for '%s' not available: %s", cap.id, resolution.message)
            deferred = bool(resolution.retry_requirement)
            if deferred:
                # Bind the step to the specification that passed every check;
                # the step runner rebuilds it on the first run.
                retry = resolution.retry_requirement
                req = CodeRequirement.from_dict(retry)
                bindings[cap.id] = req.name
                requirements[cap.id] = retry
                _catalogue(catalogue, req.name, req, req.output_schema, None)
                row["tool_name"] = req.name
                build_issues.append({
                    "severity": "warning", "code": "activity.deferred", "step_id": cap.id,
                    "field": "tool_name",
                    "message": (f"Activity '{req.name}' for '{cap.name}' could not be built "
                                f"now ({_short(resolution.message)}); it will be built from its "
                                f"checked specification on the first run."),
                })
            else:
                build_issues.append({
                    "severity": "error", "code": "activity.unbuilt", "step_id": cap.id,
                    "field": "tool_name",
                    "message": (f"No activity could be built for '{cap.name}': "
                                f"{_short(resolution.message)}. Retry the build or write its "
                                f"code, then register the workflow."),
                })
            failed.append({**row, "status": resolution.status,
                           "error": resolution.message, "issues": resolution.issues,
                           "deferred": deferred, "rolled_back": resolution.rolled_back,
                           "manual": choice == "manual"})

        logger.info("Activities: %d reused, %d built, %d failed (%d deferred to run time)",
                    len(reused), len(built), len(failed), sum(1 for f in failed if f["deferred"]))
        ctx.emit("activity_plan", json.dumps({
            "reused": reused, "built": built, "failed": failed,
        }, default=str))
        return await next(ctx)


def _resolved(resolution) -> bool:
    return resolution.status in ("reused", "built", "pending_approval")


def _catalogue(catalogue: list, name: str, req, output_schema, version) -> None:
    """List an activity in the plan's inventory, for the data-flow layer."""
    if not name or name in {a.get("name") for a in catalogue}:
        return
    catalogue.append({
        "name": name,
        "description": req.description if req else "",
        "parameters": ((req.input_schema or {}).get("properties", {}) if req else {}),
        "required": ((req.input_schema or {}).get("required", []) if req else []),
        "output_schema": output_schema,
        "version": version,
    })


def _short(text: str, limit: int = 300) -> str:
    text = str(text or "unknown error").strip().rstrip(".")
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def _retry(resolutions: list, needs: list, at: list[int], ctx, relay) -> None:
    """Build ``needs[at]`` again, one at a time, keeping any improvement."""
    from app.layers.codegen import resolve_code_needs

    retried = await resolve_code_needs([needs[i] for i in at], client=ctx.client,
                                       on_event=relay, concurrency=1)
    for i, again in zip(at, retried):
        if _resolved(again):
            resolutions[i] = again
        elif not _resolved(resolutions[i]) and (again.retry_requirement
                                                or not resolutions[i].retry_requirement):
            # The latest reason it failed — unless an earlier attempt kept a
            # checked specification this one lost.
            resolutions[i] = again


def _record_new(ctx, resolutions: list, recorded: set[int]) -> None:
    """Add newly built activities to the plan's created ledger (for rollback)."""
    for i, r in enumerate(resolutions):
        if i in recorded or not _resolved(r) or not r.created or not r.tool_id:
            continue
        plan_control.record_created(ctx, "activity", r.tool_id, r.name, version=r.version)
        recorded.add(i)
