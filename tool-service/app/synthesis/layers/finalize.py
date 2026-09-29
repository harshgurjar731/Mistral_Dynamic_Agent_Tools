"""
G8 Review gate, G9 Register, G10 Publish.
"""

from __future__ import annotations

from app import metrics
from app.config import settings
from app.synthesis import registry
from app.synthesis.layers.base import Layer, NextFn, SynthesisContext
from app.synthesis.layers.build import report_of


class ReviewGateLayer(Layer):
    """G8 — auto-approve, or hold for a person."""

    name = "review"
    label = "Decide on approval"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        ctx.review = ctx.profile.review(ctx.spec, ctx.verdict, ctx.plan,
                                        auto_approve_enabled=settings.AUTO_APPROVE_DYNAMIC_TOOLS)
        ctx.emit("review", ("auto-approved: " if ctx.review.auto_approve else "held for review: ")
                 + ctx.review.reason)
        return next(ctx)


class RegisterLayer(Layer):
    """G9 — store the version; install and activate it when approved."""

    name = "register"
    label = "Register the version"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        status = "approved" if ctx.review.auto_approve else "pending_approval"
        report = report_of(ctx)
        report["review"] = {"auto_approve": ctx.review.auto_approve,
                            "review_required": ctx.review.review_required,
                            "reason": ctx.review.reason}
        db = ctx.session_factory()
        try:
            record = registry.create_version(
                db,
                spec=ctx.spec,
                code=ctx.candidate.code,
                status=status,
                report=report,
                test_plan=ctx.plan.to_dict() if ctx.plan else None,
                review_required=ctx.review.review_required,
                spec_hash=ctx.spec_hash,
            )
            ctx.registered = (record.id, record.version_no, record.status)
        except registry.RegistrationError as e:
            metrics.incr("synthesis.fault.harness.register")
            return ctx.finish("failed", f"Verified, but registration failed: {e}",
                              fault="harness", report=report)
        finally:
            db.close()
        return next(ctx)


class PublishLayer(Layer):
    """G10 — announce the result."""

    name = "publish"
    label = "Publish"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        tool_id, version_no, status = ctx.registered
        metrics.incr(f"synthesis.{ctx.spec.purpose}.{status}")
        message = ("Built, verified and approved" if status == "approved"
                   else "Built and verified; awaiting approval")
        report = report_of(ctx)
        return ctx.finish(
            status, message,
            tool_id=tool_id, version=version_no,
            review_required=ctx.review.review_required,
            input_schema=ctx.spec.input_schema,
            output_schema=ctx.spec.output_schema,
            corrected_examples=ctx.corrections,
            examples=[{"input": e.input, "output": e.output, "note": e.note} for e in ctx.spec.examples],
            report={k: report[k] for k in ("history", "model", "weak_plan", "elapsed_seconds",
                                            "warnings", "corrected_examples")},
        )
