"""
The layers that turn a Refine-with-AI turn into a planned fix (``app.workflow_revisions.fix_plan``).

    RevisionDiagnosisLayer   read the failed run being fixed                    (no LLM)
    RevisionPlanLayer        publish the plan the analysis produced             (no LLM)
    RevisionCodeFixLayer     rebuild each activity whose code is at fault,
                             pin the proposal to the fixed version, re-check    (code pipeline)

The analysis itself is ``RevisionIntentLayer``, which now returns code fixes
alongside its edit operations.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from app.core.context import PipelineContext
from app.layers.revision.base import RevisionStepLayer
from app.workflow_revisions import fix_plan

logger = logging.getLogger(__name__)


class RevisionDiagnosisLayer(RevisionStepLayer):
    """Read the failed run — its failing steps, errors, inputs and activity code."""

    name = "revision_diagnosis"
    label = "Read the failed run"
    detail = "Finds the steps that failed, with their errors, inputs and activity code."

    def should_run(self, ctx: PipelineContext) -> bool:
        return super().should_run(ctx) and not ctx.revision_spec.operations_given

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        ctx.emit("status", "Reading the last run…")
        spec.diagnosis = await fix_plan.diagnose(spec.workflow_name, spec.base, spec.execution_id)
        failed = spec.diagnosis.get("failed_steps") or []
        if failed:
            names = ", ".join(str(f.get("step_id")) for f in failed if f.get("step_id"))
            ctx.set_layer_summary(self.name, f"Run failed at {names or 'an unnamed step'}: "
                                             f"{(failed[0].get('error') or '')[:160]}")
        else:
            ctx.set_layer_summary(self.name, "No failed run to fix — working from the instruction.")
        return await next(ctx)


class RevisionPlanLayer(RevisionStepLayer):
    """Publish the fix plan before anything is carried out."""

    name = "revision_plan"
    label = "Plan the fix"
    detail = "Lists every edit and code fix that will be made, then carries them out in order."

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        spec.plan = fix_plan.build_plan(spec)
        fix_plan.publish(ctx, spec)
        edits, fixes = len(spec.operations), len(spec.code_fixes)
        parts = [f"{edits} workflow edit(s)" if edits else "", f"{fixes} code fix(es)" if fixes else ""]
        ctx.set_layer_summary(self.name, " and ".join(p for p in parts if p) or "Nothing to change.")
        return await next(ctx)


def _parse_input(preview: str):
    try:
        value = json.loads(preview or "")
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def pin_version(proposed: dict, tool_name: str, version: int) -> list[str]:
    """Point every step running ``tool_name`` at ``version``. Returns the step ids changed."""
    changed = []
    for step in (proposed or {}).get("steps") or []:
        config = step.get("config") or {}
        if step.get("type") == "tool" and config.get("tool_name") == tool_name:
            if config.get("tool_version") != version:
                step["config"] = {**config, "tool_version": version}
                changed.append(step.get("id"))
    return changed


class RevisionCodeFixLayer(RevisionStepLayer):
    """Rebuild every activity whose code is at fault, and pin the proposal to the fixed version.

    Runs after the edits are applied and repaired, so the pins land on the
    final proposal. The rebuild is the same one the activity page offers
    ("Rebuild from an error"): the specification is revised to what was asked,
    the new version must pass its worked examples and run the input it failed
    on, or it is rolled back. Workflows are not re-pinned here — this proposal
    is, and applying it adopts the new version.
    """

    name = "revision_code_fix"
    label = "Fix activity code"
    detail = "Rebuilds the activities whose code caused the failure and tests the new versions."

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        # The workflow edits were carried out by the layers before this one.
        for outcome in spec.outcomes:
            item = fix_plan.item_for(spec, op_index=outcome.get("index"))
            if item:
                fix_plan.mark(ctx, spec, item["id"], "completed" if outcome.get("ok") else "failed",
                              str(outcome.get("note") or ""))
        for item in spec.plan:
            if item["kind"] == "workflow" and item["status"] == "pending":
                fix_plan.mark(ctx, spec, item["id"], "completed")

        if not spec.code_fixes:
            ctx.set_layer_summary(self.name, "No activity code needed changing.")
            return await next(ctx)

        built = 0
        for i, fix in enumerate(spec.code_fixes):
            item = fix_plan.item_for(spec, fix_index=i)
            item_id = item["id"] if item else f"code{i}"
            fix_plan.mark(ctx, spec, item_id, "in_progress", "Revising the specification and rebuilding…")
            outcome = await self._rebuild(ctx, spec, fix)
            fix.update(outcome)
            if outcome.get("status") == "built":
                built += 1
                fix_plan.mark(ctx, spec, item_id, "completed", outcome.get("message", ""))
            else:
                fix_plan.mark(ctx, spec, item_id, "failed", outcome.get("message", ""))

        if built:
            from app.layers.revision.review_layers import validation_of

            spec.validation = await validation_of(spec.base_issues, spec.proposed, ctx.client)
        elif not spec.operations:
            ctx.error = ("The activity code could not be fixed: "
                         + "; ".join(str(f.get("message")) for f in spec.code_fixes))
        ctx.set_layer_summary(self.name, f"{built} of {len(spec.code_fixes)} activity fix(es) built and tested.")
        return await next(ctx)

    async def _rebuild(self, ctx: PipelineContext, spec, fix: dict) -> dict:
        from app.services.code_rebuild import RebuildError, rebuild_from_failure

        failed = next((f for f in (spec.diagnosis.get("failed_steps") or [])
                       if f.get("tool_name") == fix["tool_name"]), {})
        tool_id = failed.get("tool_id")
        if tool_id is None:
            try:
                record = await fix_plan._activity_record(fix["tool_name"], failed.get("tool_version"))
            except Exception as e:  # noqa: BLE001
                record = None
                logger.debug("No record for %s: %s", fix["tool_name"], e)
            tool_id = (record or {}).get("id")
        if tool_id is None:
            return {"status": "failed", "message": f"Activity '{fix['tool_name']}' was not found on the tool service."}

        comment = fix["change"] + (f"\n\nWhy: {fix['problem']}" if fix.get("problem") else "")
        last = {"at": 0.0}

        def relay(event: dict) -> None:
            message = str(event.get("message") or "").strip()
            now = time.monotonic()
            if message and now - last["at"] > 0.5:
                last["at"] = now
                ctx.emit("status", f"{fix['tool_name']}: {message[:240]}")

        ctx.emit("status", f"Rebuilding {fix['tool_name']}…")
        try:
            result = await rebuild_from_failure(
                int(tool_id), error=failed.get("error") or fix.get("problem") or "",
                comment=comment, failing_input=_parse_input(failed.get("input_preview") or ""),
                update_workflows=False, on_event=relay)
        except RebuildError as e:
            return {"status": "failed", "message": str(e)}
        except Exception as e:  # noqa: BLE001 — a failed rebuild must not lose the proposal
            logger.warning("Rebuild of %s failed: %s", fix["tool_name"], e, exc_info=True)
            return {"status": "failed", "message": f"The rebuild failed: {e}"}

        version = result.get("version")
        if result.get("status") in ("approved", "pending_approval") and version is not None:
            steps = await asyncio.to_thread(pin_version, spec.proposed, fix["tool_name"], int(version))
            held = result.get("status") == "pending_approval"
            return {"status": "built", "version": int(version), "steps": steps,
                    "message": (f"Version v{version} built and tested"
                                + (" (waiting for approval before it can run)" if held else "")
                                + (f"; {', '.join(steps)} will use it when you apply." if steps else "."))}
        return {"status": "failed", "message": str(result.get("message") or "The rebuild did not pass its checks.")}
