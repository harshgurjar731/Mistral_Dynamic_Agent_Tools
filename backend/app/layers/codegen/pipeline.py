"""
The code-requirement pipeline — from a need to a usable tool or activity.

    R1 → R2 → R3 ─┬─ reused ──────────────────────────────────────────→ R8
                  └─ create → [R4 → R5 → R6 → R4b → R7 → R7b] ─────────→ R8
                               ↑___________ issues (≤ MAX_REAUTHORS) _______|

R4b settles every credential the specification names before code is generated
(``app.build_prereqs.code_check``); a credential the user chose to do without
sends the specification back to its author.

R7b executes what R7 built; a version that fails there is rolled back and its
failures are re-authored against like any other issue.

Everything that can cause code to be built calls :func:`resolve_code_need`:
CapabilityGapLayer (chat), ActivityGapLayer (workflow planning), explicit
requests, and a workflow step whose activity is missing at run time.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Optional

from app import progress
from app.core.specs import CodeNeed, CodeRequirement, CodeResolution
from app.layers.codegen.layers import (
    MAX_REAUTHORS,
    BindAndRefreshLayer,
    ContractBindingLayer,
    CredentialCheckLayer,
    NeedNormalisationLayer,
    PolicyGateLayer,
    RequirementContext,
    ReuseResolutionLayer,
    SpecAuthoringLayer,
    SpecPreflightLayer,
    SmokeTestLayer,
    SubmitAndTrackLayer,
)
from app.layers.codegen.profiles import profile_for

logger = logging.getLogger(__name__)

_R1, _R2, _R3 = NeedNormalisationLayer(), PolicyGateLayer(), ReuseResolutionLayer()
_R4, _R5, _R6 = SpecAuthoringLayer(), ContractBindingLayer(), SpecPreflightLayer()
_R7, _R7b, _R8 = SubmitAndTrackLayer(), SmokeTestLayer(), BindAndRefreshLayer()
_R4b = CredentialCheckLayer()


def _default_client():
    from mistralai.client import Mistral

    from app.config import settings
    from app.observability import instrument_client

    return instrument_client(Mistral(api_key=settings.MISTRAL_API_KEY))


async def resolve_code_need(
    need: CodeNeed,
    *,
    client: Any = None,
    on_event: Optional[Callable[[dict], None]] = None,
    catalogue: Optional[list[dict]] = None,
    must_succeed: Optional[list[dict]] = None,
    code_check: Any = None,
) -> CodeResolution:
    """Run the pipeline for one need. Never raises.

    ``must_succeed``: inputs the built version must run without error — for a
    rebuild, the input the previous version failed on.
    ``code_check``: the build's credential view (``build_prereqs.code_check``);
    None checks credentials with nobody to ask.
    """
    ctx = RequirementContext(need=need, profile=profile_for(need.purpose),
                             client=client or _default_client(), on_event=on_event,
                             catalogue=catalogue, must_succeed=list(must_succeed or []),
                             code_check=code_check)
    try:
        if ctx.catalogue is None:
            from app.services.tool_resolver import tool_resolver

            ctx.catalogue = await tool_resolver.list_tools()
        return await _run(ctx)
    except Exception as e:  # noqa: BLE001 — a need ends with a resolution, not a trace
        logger.exception("Code requirement pipeline failed for %s", need.name_hint or need.intent[:60])
        return ctx.resolution or CodeResolution(status="failed", purpose=need.purpose,
                                                name=need.name_hint,
                                                message=f"{type(e).__name__}: {e}")


async def _run(ctx: RequirementContext) -> CodeResolution:
    need = ctx.need
    if need.origin == "feedback" and need.requirement:
        return await _run_feedback(ctx)
    if need.requirement:
        # Runtime recovery: the requirement was authored and screened when the
        # workflow was planned. Rebuild exactly that; do not re-author it.
        ctx.requirement = CodeRequirement.from_dict(need.requirement)
        ctx.requirement.origin = "runtime"
        await _R2.run(ctx)
        if ctx.resolution:
            return ctx.resolution
        await _R6.run(ctx)
        if ctx.issues:
            return ctx.finish("failed", "The stored requirement is no longer valid: "
                              + "; ".join(ctx.issues), issues=list(ctx.issues))
        ctx.valid_requirement = ctx.requirement.as_request()
        await _R7.run(ctx)
        await _R7b.run(ctx)
        await _R8.run(ctx)
        return _settle(ctx)

    for layer in (_R1, _R2, _R3):
        await layer.run(ctx)
        if ctx.resolution:
            if ctx.resolution.status == "reused":
                await _R8.run(ctx)
            return ctx.resolution

    while True:
        ctx.smoke_problems = []
        await _R4.run(ctx)
        if ctx.resolution:
            return ctx.resolution
        await _R5.run(ctx)
        await _R6.run(ctx)
        if not ctx.issues:
            await _R4b.run(ctx)
            if ctx.resolution:
                return ctx.resolution
        if not ctx.issues:
            ctx.valid_requirement = ctx.requirement.as_request()
            await _R7.run(ctx)
            if not ctx.issues:
                await _R7b.run(ctx)
            if not ctx.issues:
                break  # built, pending, or failed for a reason re-authoring cannot fix
        if ctx.reauthors >= MAX_REAUTHORS:
            if ctx.smoke_problems:
                # The spec was sound every time; the code built from it was not.
                await _R8.run(ctx)
                return _settle(ctx)
            ctx.finish("failed", "The specification could not be made implementable: "
                       + "; ".join(ctx.issues), issues=list(ctx.issues))
            return _settle(ctx)
        ctx.reauthors += 1

    await _R8.run(ctx)
    return _settle(ctx)


#: Builds a rebuild-from-failure gets: the first, and one more told why it failed.
MAX_FEEDBACK_BUILDS = 2


async def _run_feedback(ctx: RequirementContext) -> CodeResolution:
    """Rebuild an existing tool or activity after it failed at run time.

    The stored specification is kept — same name, same contract — and the
    tool service is given the failed code, the error and the user's comment
    (``requirement.feedback``). Unlike a runtime recovery, the request is
    screened again: it now carries text the user typed. A build that still
    fails (its examples, or the input it failed on) is rolled back, and the
    generator gets one more attempt told why.
    """
    need = ctx.need
    ctx.requirement = CodeRequirement.from_dict(need.requirement)
    ctx.requirement.origin = "feedback"
    await _R2.run(ctx)
    if ctx.resolution:
        return ctx.resolution

    for attempt in range(1, MAX_FEEDBACK_BUILDS + 1):
        ctx.issues, ctx.smoke_problems = [], []
        await _R6.run(ctx)
        if ctx.issues:
            ctx.finish("failed", "The rebuild request is not a valid specification: "
                       + "; ".join(ctx.issues), issues=list(ctx.issues))
            return _settle(ctx)
        ctx.valid_requirement = ctx.requirement.as_request()
        await _R7.run(ctx)
        if ctx.issues:  # the tool service rejected the specification itself
            ctx.finish("failed", "The tool service rejected the rebuild: " + "; ".join(ctx.issues),
                       issues=list(ctx.issues))
            return _settle(ctx)
        await _R7b.run(ctx)
        if not ctx.smoke_problems:
            break
        if attempt < MAX_FEEDBACK_BUILDS:
            ctx.emit("author", "the rebuilt version still failed — trying once more")
            feedback = dict(ctx.requirement.feedback or {})
            feedback["runtime_error"] = (
                f"{feedback.get('runtime_error', '')}\n\nThe last rebuilt version also failed: "
                + "; ".join(ctx.smoke_problems)).strip()[:4000]
            ctx.requirement.feedback = feedback

    await _R8.run(ctx)
    return _settle(ctx)


def _settle(ctx: RequirementContext) -> CodeResolution:
    """Record, on a failure, whether a run-time retry has anything to build from."""
    resolution = ctx.resolution
    if resolution is None or resolution.usable or resolution.status != "failed":
        return resolution
    resolution.rolled_back = bool((ctx.build or {}).get("rolled_back"))
    if ctx.valid_requirement and not (ctx.issues and not ctx.smoke_problems):
        # The last spec passed every check, so the failure was in building it
        # (tool service down, timed out, or the code came out broken). Keep
        # the latest corrected examples if the tool service supplied any.
        retry = dict(ctx.valid_requirement)
        if ctx.requirement is not None and ctx.requirement.name == retry.get("name"):
            retry["examples"] = list(ctx.requirement.examples)
        resolution.retry_requirement = retry
    return resolution


async def resolve_code_needs(
    needs: list[CodeNeed],
    *,
    client: Any = None,
    on_event: Optional[Callable[[dict], None]] = None,
    concurrency: int = 3,
    code_check: Any = None,
) -> list[CodeResolution]:
    """Resolve several needs concurrently, sharing one catalogue fetch.

    Built names are added to the shared catalogue as they land, so two needs
    in the same plan cannot both claim one name.
    """
    from app.services.tool_resolver import tool_resolver

    catalogue = await tool_resolver.list_tools()
    client = client or _default_client()
    gate = asyncio.Semaphore(max(1, concurrency))

    async def one(index: int, need: CodeNeed) -> CodeResolution:
        async with gate:
            # Each need fills its own share of the bar, however far the others are.
            with progress.part(index, len(needs),
                               f"Building {need.purpose} {need.name_hint or ''}".strip()):
                resolution = await resolve_code_need(need, client=client, on_event=on_event,
                                                     catalogue=catalogue, code_check=code_check)
            if resolution.name and resolution.status in ("built", "pending_approval"):
                catalogue.append({"name": resolution.name, "purpose": need.purpose,
                                  "status": "pending_approval"})
            return resolution

    return list(await asyncio.gather(*(one(i, n) for i, n in enumerate(needs))))
