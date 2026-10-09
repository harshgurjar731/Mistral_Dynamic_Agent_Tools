"""
The code-requirement pipeline — from a need to a usable tool or activity.

    R1 → R2 → R3 ─┬─ reused ─────────────────────────────────────→ R8
                  └─ create → [R4 → R5 → R6 → R7 → R7b] ─────────→ R8
                               ↑________ issues (≤ MAX_REAUTHORS) ______|

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

from app.core.specs import CodeNeed, CodeRequirement, CodeResolution
from app.layers.codegen.layers import (
    MAX_REAUTHORS,
    BindAndRefreshLayer,
    ContractBindingLayer,
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
) -> CodeResolution:
    """Run the pipeline for one need. Never raises."""
    ctx = RequirementContext(need=need, profile=profile_for(need.purpose),
                             client=client or _default_client(), on_event=on_event,
                             catalogue=catalogue)
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
) -> list[CodeResolution]:
    """Resolve several needs concurrently, sharing one catalogue fetch.

    Built names are added to the shared catalogue as they land, so two needs
    in the same plan cannot both claim one name.
    """
    from app.services.tool_resolver import tool_resolver

    catalogue = await tool_resolver.list_tools()
    client = client or _default_client()
    gate = asyncio.Semaphore(max(1, concurrency))

    async def one(need: CodeNeed) -> CodeResolution:
        async with gate:
            resolution = await resolve_code_need(need, client=client, on_event=on_event,
                                                 catalogue=catalogue)
            if resolution.name and resolution.status in ("built", "pending_approval"):
                catalogue.append({"name": resolution.name, "purpose": need.purpose,
                                  "status": "pending_approval"})
            return resolution

    return list(await asyncio.gather(*(one(n) for n in needs)))
