"""
The code-requirement pipeline — from a need to a usable tool or activity.

    R1 → R2 → R3 ─┬─ reused ──────────────────────────────→ R8
                  └─ create → [R4 → R5 → R6 → R7] ────────→ R8
                               ↑_____ issues (≤ MAX_REAUTHORS) ___|

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
    SubmitAndTrackLayer,
)
from app.layers.codegen.profiles import profile_for

logger = logging.getLogger(__name__)

_R1, _R2, _R3 = NeedNormalisationLayer(), PolicyGateLayer(), ReuseResolutionLayer()
_R4, _R5, _R6 = SpecAuthoringLayer(), ContractBindingLayer(), SpecPreflightLayer()
_R7, _R8 = SubmitAndTrackLayer(), BindAndRefreshLayer()


def _default_client():
    from mistralai.client import Mistral

    from app.config import settings

    return Mistral(api_key=settings.MISTRAL_API_KEY)


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
        await _R7.run(ctx)
        await _R8.run(ctx)
        return ctx.resolution

    for layer in (_R1, _R2, _R3):
        await layer.run(ctx)
        if ctx.resolution:
            if ctx.resolution.status == "reused":
                await _R8.run(ctx)
            return ctx.resolution

    while True:
        await _R4.run(ctx)
        if ctx.resolution:
            return ctx.resolution
        await _R5.run(ctx)
        await _R6.run(ctx)
        if not ctx.issues:
            await _R7.run(ctx)
            if not ctx.issues:
                break  # built, pending, or failed for a reason re-authoring cannot fix
        if ctx.reauthors >= MAX_REAUTHORS:
            return ctx.finish("failed", "The specification could not be made implementable: "
                              + "; ".join(ctx.issues), issues=list(ctx.issues))
        ctx.reauthors += 1

    await _R8.run(ctx)
    return ctx.resolution


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
