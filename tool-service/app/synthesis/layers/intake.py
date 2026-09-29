"""
G1 Intake and G2 Identity — decide whether there is anything to build.
"""

from __future__ import annotations

from app.config import settings
from app.synthesis import registry
from app.synthesis.layers.base import Layer, NextFn, SynthesisContext


class IntakeLayer(Layer):
    """G1 — reject a spec that cannot be implemented, before spending a model call.

    A contradictory or underspecified spec is the caller's to fix. Sending it
    into the repair loop instead makes the model "fix" code against a target
    that cannot be hit, and the failure then reads as a code defect.
    """

    name = "intake"
    label = "Validate the specification"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        issues, warnings = ctx.profile.validate_spec(ctx.spec, strict=settings.STRICT_ACTIVITY_SPEC)
        ctx.warnings.extend(warnings)
        for w in warnings:
            ctx.emit("intake", f"warning: {w}")
        if issues:
            return ctx.finish(
                "spec_invalid",
                "The specification cannot be implemented as written: " + "; ".join(issues),
                issues=issues, fault="spec",
            )
        return next(ctx)


class IdentityLayer(Layer):
    """G2 — reuse an existing version built from this exact spec."""

    name = "identity"
    label = "Check for an existing build"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        ctx.spec_hash = ctx.spec.content_hash()
        db = ctx.session_factory()
        try:
            for record in registry.versions_of(db, ctx.spec.name):
                if ctx.spec_hash not in (registry.spec_of(record).content_hash(),
                                         _request_hash(record)):
                    continue
                if record.status == "approved":
                    if not record.is_active:
                        registry.activate(db, record)
                    return ctx.finish("approved", "Already built from this specification",
                                      tool_id=record.id, version=record.version_no, reused=True)
                if record.status == "pending_approval":
                    return ctx.finish("pending_approval", "Built from this specification and awaiting approval",
                                      tool_id=record.id, version=record.version_no, reused=True,
                                      review_required=bool(record.review_required))
                # A rejected build is rebuilt: the rejection was of that code.
        finally:
            db.close()
        return next(ctx)


def _request_hash(record) -> str:
    """The hash of the spec as originally requested (before G7 corrections)."""
    import json

    try:
        return (json.loads(record.report_json or "{}") or {}).get("request_hash") or ""
    except ValueError:
        return ""
