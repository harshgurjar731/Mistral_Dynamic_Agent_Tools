"""
The code-requirement layers, R1–R8.

    R1 NeedNormalisation   free text → a structured need (skipped when the
                           caller already has structure)
    R2 PolicyGate          review rules and the safety blocklist
    R3 ReuseResolution     an existing tool/activity of the same purpose?
    R4 SpecAuthoring       author the SynthesisSpec v2              ┐
    R5 ContractBinding     does it fit its neighbours?              │ loop, with
    R6 SpecPreflight       schemas, examples, names                 │ bounded
    R7 SubmitAndTrack      build it on the tool service             ┘ re-authoring
    R8 BindAndRefresh      make it visible to the rest of the platform

Each layer answers one question and records its answer on the context. A
layer that settles the outcome calls ``ctx.finish(...)``; the pipeline stops
there.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from app.core.decision import decide, parse_json
from app.core.specs import CodeNeed, CodeRequirement, CodeResolution
from app.layers.codegen import preflight
from app.layers.codegen.profiles import RequirementProfile, snake

logger = logging.getLogger(__name__)

#: How many times a rejected specification is sent back to its author, across
#: contract, pre-flight and tool-service rejections together.
MAX_REAUTHORS = 2


@dataclass
class RequirementContext:
    need: CodeNeed
    profile: RequirementProfile
    client: Any
    on_event: Optional[Callable[[dict], None]] = None
    catalogue: Optional[list[dict]] = None   # every tool, all purposes
    normalised: dict = field(default_factory=dict)
    requirement: Optional[CodeRequirement] = None
    issues: list[str] = field(default_factory=list)
    reauthors: int = 0
    build: Optional[dict] = None             # the tool service's answer
    resolution: Optional[CodeResolution] = None

    def emit(self, stage: str, message: str, **data) -> None:
        logger.info("[codegen:%s] %s: %s", self.need.name_hint or self.need.purpose, stage, message)
        if self.on_event:
            try:
                self.on_event({"stage": stage, "message": message, **data})
            except Exception:  # noqa: BLE001 — progress never breaks the pipeline
                logger.debug("codegen progress callback failed", exc_info=True)

    def finish(self, status: str, message: str = "", **fields) -> CodeResolution:
        req = self.requirement
        self.resolution = CodeResolution(
            status=status, message=message, purpose=self.need.purpose,
            name=fields.pop("name", req.name if req else self.need.name_hint),
            requirement=req,
            output_schema=fields.pop("output_schema", req.output_schema if req else None),
            **fields,
        )
        return self.resolution


# ── R1 ──────────────────────────────────────────────────────────────────────


class NeedNormalisationLayer:
    name = "need_normalisation"

    async def run(self, ctx: RequirementContext) -> None:
        need = ctx.need
        cap = need.capability or {}
        if cap or need.draft:
            # Already structured by the caller — no model call.
            ctx.normalised = {
                "name": snake(need.name_hint or cap.get("name") or need.draft.get("name") or ""),
                "summary": cap.get("purpose") or need.intent or need.draft.get("description", ""),
                "inputs": list(cap.get("inputs") or []),
                "outputs": list(cap.get("outputs") or []),
            }
            return
        if not need.intent:
            ctx.finish("failed", "Nothing to build: the request is empty.")
            return

        from app.prompts_codegen import NEED_NORMALISE_SYSTEM

        try:
            raw = await decide(ctx.client, route="need_normalise", system=NEED_NORMALISE_SYSTEM,
                               user=f"Purpose: {ctx.profile.noun}\nRequest: {need.intent}",
                               phase="normalise need")
            ctx.normalised = parse_json(raw, {}) or {}
        except Exception as e:  # noqa: BLE001 — authoring can work from the raw text
            logger.warning("Need normalisation failed (continuing with raw text): %s", e)
            ctx.normalised = {"summary": need.intent}
        if not need.name_hint and ctx.normalised.get("name"):
            need.name_hint = snake(ctx.normalised["name"])
        ctx.emit("normalise", ctx.normalised.get("summary") or need.intent)


# ── R2 ──────────────────────────────────────────────────────────────────────


class PolicyGateLayer:
    name = "policy_gate"

    async def run(self, ctx: RequirementContext) -> None:
        need = ctx.need

        # "Reviewed tools only" forbids building agent tools on demand. It is
        # checked here, before any agent exists to attach it to — which is why
        # only the always-on form of the rule can take effect.
        if need.purpose == "tool":
            try:
                from app.rules import store as rules_store

                rule = next((r for r in rules_store.always_on_rules("agent")
                             if r["type"] == "reviewed_tools_only"), None)
            except Exception:  # noqa: BLE001 — the rules store is optional here
                rule = None
            if rule:
                ctx.finish("blocked", f"Rule '{rule['name']}' allows reviewed tools only.",
                           reason=f"rule:{rule['id']}")
                return

        if need.origin == "runtime":
            return  # a stored requirement already passed this gate when it was authored

        from app.prompts_codegen import POLICY_GATE_SYSTEM

        text = json.dumps({"intent": need.intent, "normalised": ctx.normalised,
                           "draft": need.draft}, default=str)
        try:
            raw = await decide(ctx.client, route="policy_gate", system=POLICY_GATE_SYSTEM,
                               user=text, phase="policy gate")
            verdict = parse_json(raw, None)
        except Exception as e:  # noqa: BLE001
            verdict = None
            logger.warning("Policy gate unavailable: %s", e)
        if not isinstance(verdict, dict):
            # Fail closed: code that was never screened is not built.
            ctx.finish("blocked", "The safety screen could not be completed; nothing was built.",
                       reason="policy_unavailable")
            return
        if not verdict.get("allowed", False):
            ctx.finish("blocked", str(verdict.get("reason") or "Blocked by the safety policy."),
                       reason="policy")


# ── R3 ──────────────────────────────────────────────────────────────────────


class ReuseResolutionLayer:
    name = "reuse_resolution"

    async def run(self, ctx: RequirementContext) -> None:
        if ctx.need.origin == "runtime":
            return
        candidates = [t for t in (ctx.catalogue or []) if ctx.profile.in_catalogue(t)]
        if not candidates:
            return

        from app.prompts_codegen import REUSE_EXTRA_ACTIVITY, REUSE_EXTRA_TOOL, REUSE_SYSTEM

        system = (REUSE_SYSTEM.replace("{noun}", ctx.profile.noun)
                  .replace("{extra}", REUSE_EXTRA_ACTIVITY if ctx.need.purpose == "activity"
                           else REUSE_EXTRA_TOOL))
        listing = [_catalogue_entry(t) for t in candidates]
        user = (f"## Needed\n{json.dumps({'intent': ctx.need.intent, **ctx.normalised, 'capability': ctx.need.capability}, indent=2, default=str)}\n\n"
                f"## Existing {ctx.profile.noun}s\n{json.dumps(listing, indent=2, default=str)}")
        try:
            raw = await decide(ctx.client, route="reuse_resolution", system=system, user=user,
                               phase="reuse resolution")
            data = parse_json(raw, {}) or {}
        except Exception as e:  # noqa: BLE001 — building a duplicate beats failing
            logger.warning("Reuse resolution failed (will build): %s", e)
            return

        by_name = {c["name"]: c for c in listing}
        name = str(data.get("existing_name") or "").strip()
        if str(data.get("action", "")).lower() == "exists" and name in by_name:
            entry = by_name[name]
            ctx.emit("reuse", f"reusing '{name}' — {data.get('reason', '')}")
            ctx.finish("reused", str(data.get("reason") or ""), name=name,
                       version=entry.get("version"), tool_id=entry.get("tool_id"),
                       output_schema=entry.get("output_schema"),
                       reason=str(data.get("reason") or ""))


def _catalogue_entry(tool: dict) -> dict:
    fn = (tool.get("schema") or {}).get("function", {}) if isinstance(tool.get("schema"), dict) else {}
    params = fn.get("parameters") or {}
    return {
        "name": fn.get("name") or tool.get("name"),
        "description": fn.get("description", ""),
        "parameters": params.get("properties", {}),
        "required": params.get("required", []),
        "output_schema": tool.get("output_schema"),
        "version": tool.get("version_no"),
        "tool_id": tool.get("id"),
    }


# ── R4 ──────────────────────────────────────────────────────────────────────


class SpecAuthoringLayer:
    name = "spec_authoring"

    async def run(self, ctx: RequirementContext) -> None:
        user = ctx.profile.author_user(need=ctx.need, normalised=ctx.normalised,
                                       issues=ctx.issues, previous=ctx.requirement)
        ctx.emit("author", ("re-authoring after: " + "; ".join(ctx.issues)[:300]) if ctx.issues
                 else f"writing the {ctx.profile.noun} specification")
        try:
            raw = await decide(ctx.client, route="spec_author", system=ctx.profile.author_system,
                               user=user, phase="spec authoring")
            data = parse_json(raw, None)
        except Exception as e:  # noqa: BLE001
            ctx.finish("failed", f"Could not author the specification: {e}")
            return
        if not isinstance(data, dict):
            ctx.finish("failed", "The specification author returned no usable JSON.")
            return
        ctx.requirement = requirement_from_answer(data, ctx.need, ctx.normalised)
        ctx.issues = []


def requirement_from_answer(data: dict, need: CodeNeed, normalised: dict) -> CodeRequirement:
    """A CodeRequirement from the author's JSON, tolerating v1-style fields."""
    input_schema = data.get("input_schema")
    if not isinstance(input_schema, dict):
        params = data.get("parameters") or {}
        if isinstance(params, dict) and "properties" not in params:
            params = {"type": "object", "properties": params}
        input_schema = dict(params) if isinstance(params, dict) else {}
        if isinstance(data.get("required"), list):
            input_schema["required"] = data["required"]
    return CodeRequirement(
        name=str(data.get("name") or need.name_hint or normalised.get("name") or ""),
        description=str(data.get("description") or normalised.get("summary") or need.intent),
        purpose=need.purpose,
        kind=str(data.get("kind") or "pure"),
        input_schema=input_schema,
        output_schema=data.get("output_schema") if isinstance(data.get("output_schema"), dict) else None,
        examples=[e for e in (data.get("examples") or []) if isinstance(e, dict)],
        api_details=str(data.get("api_details") or ""),
        secrets=list(data.get("secrets") or []),
        side_effects=str(data.get("side_effects") or "none"),
        http_fixtures=[f for f in (data.get("http_fixtures") or []) if isinstance(f, dict)],
        origin=need.origin,
    )


# ── R5 / R6 ────────────────────────────────────────────────────────────────


class ContractBindingLayer:
    name = "contract_binding"

    async def run(self, ctx: RequirementContext) -> None:
        issues = ctx.profile.bind_contract(ctx.need, ctx.requirement)
        if issues:
            ctx.issues.extend(issues)
            ctx.emit("contract", "; ".join(issues)[:400])


class SpecPreflightLayer:
    name = "spec_preflight"

    async def run(self, ctx: RequirementContext) -> None:
        taken = {str(t.get("name")) for t in (ctx.catalogue or []) if t.get("name")}
        keep = ctx.need.origin == "runtime"
        preflight.normalise(ctx.requirement, taken, keep_name=keep)
        issues = preflight.check(ctx.requirement) + ctx.profile.preflight(ctx.requirement)
        if issues:
            ctx.issues.extend(issues)
            ctx.emit("preflight", "; ".join(issues)[:400])


# ── R7 ──────────────────────────────────────────────────────────────────────


class SubmitAndTrackLayer:
    name = "submit"

    async def run(self, ctx: RequirementContext) -> None:
        from app.services.tool_resolver import tool_resolver

        req = ctx.requirement
        ctx.emit("submit", f"building {ctx.profile.noun} '{req.name}'")

        def relay(event: dict) -> None:
            ctx.emit("build", str(event.get("message", ""))[:300],
                     build_stage=event.get("stage"), data=event.get("data"))

        ctx.build = await tool_resolver.run_synthesis(req.as_request(), on_event=relay)
        status = ctx.build.get("status")
        if status == "spec_invalid":
            ctx.issues.extend(ctx.build.get("issues") or [ctx.build.get("message", "spec rejected")])


# ── R8 ──────────────────────────────────────────────────────────────────────


class BindAndRefreshLayer:
    name = "bind"

    async def run(self, ctx: RequirementContext) -> None:
        try:
            from app.services.tool_registry import refresh_dynamic_tools

            await refresh_dynamic_tools()
        except Exception as e:  # noqa: BLE001 — the registry refreshes itself on the next miss
            logger.debug("registry refresh failed: %s", e)
        if ctx.resolution is not None:
            return  # reused

        build = ctx.build or {}
        status = build.get("status")
        if build.get("corrected_examples") and isinstance(build.get("examples"), list):
            # The tool service found worked examples that an independent
            # reference implementation and the code both contradict, and
            # corrected them. The stored requirement carries the corrected
            # ones, so a runtime rebuild does not reintroduce the error.
            ctx.requirement.examples = build["examples"]
            ctx.emit("corrected", f"{len(build['corrected_examples'])} worked example(s) corrected "
                                  f"by the tool service's reference check")
        common = dict(name=build.get("tool_name") or ctx.requirement.name,
                      version=build.get("version"), tool_id=build.get("tool_id"),
                      output_schema=build.get("output_schema") or ctx.requirement.output_schema,
                      review_required=bool(build.get("review_required")))
        if status == "approved":
            ctx.finish("built", build.get("message", "built"), **common)
        elif status == "pending_approval":
            ctx.finish("pending_approval", build.get("message", "awaiting approval"), **common)
        else:
            ctx.finish("failed", build.get("message") or "synthesis failed",
                       issues=list(build.get("issues") or []), **common)
