"""
RequirementAnalysisLayer — Decides what the user actually needs.

First decision in the agent chain, and the one every later layer reads instead
of the raw query. Splitting it out means the tool layer is choosing tools
against a stated deliverable and a stated complexity rather than re-deriving
both from the request wording, and doing so five times over in five concurrent
branches.
"""

import logging

from app.core.context import PipelineContext
from app.core.decision import AgentDecisionLayer
from app.core.specs import RequirementSpec

logger = logging.getLogger(__name__)

_TASK_TYPES = {"lookup", "analysis", "generation", "transformation", "conversation"}
_COMPLEXITY = {"simple", "moderate", "complex"}
_MODALITY = {"text", "image", "mixed"}


def _one_of(value, allowed: set[str], default: str) -> str:
    """Coerce a model-supplied enum to a value the pipeline understands."""
    text = str(value or "").strip().lower()
    return text if text in allowed else default


def _str_list(value) -> list[str]:
    """Coerce to a list of non-empty strings.

    Models occasionally return a bare string where a list was asked for, and a
    downstream layer iterating that string character by character produces
    nonsense that is hard to trace back here.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


class RequirementAnalysisLayer(AgentDecisionLayer):
    """Turn the raw query into a structured requirement spec."""

    name = "requirement_analysis"
    label = "Understand the request"
    detail = "Decides what you actually need, as a structured brief every later layer reads."
    phase = "requirement analysis"
    status_message = "Understanding what you need…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            REQUIREMENT_ANALYSIS_SYSTEM_PROMPT,
            REQUIREMENT_ANALYSIS_USER_PROMPT,
        )

        image_note = (
            "The request includes an attached image. Treat the modality as "
            "'image' or 'mixed' and account for visual content in the deliverable."
            if ctx.image
            else ""
        )

        return (
            REQUIREMENT_ANALYSIS_SYSTEM_PROMPT,
            REQUIREMENT_ANALYSIS_USER_PROMPT.format(
                user_query=ctx.query,
                image_note=image_note,
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = RequirementSpec(
            intent=str(data.get("intent") or ctx.query)[:1000],
            task_type=_one_of(data.get("task_type"), _TASK_TYPES, "conversation"),
            domain=str(data.get("domain") or "general")[:200],
            deliverable=str(data.get("deliverable") or "")[:1000],
            complexity=_one_of(data.get("complexity"), _COMPLEXITY, "moderate"),
            modality=_one_of(data.get("modality"), _MODALITY, "image" if ctx.image else "text"),
            needs_realtime_data=bool(data.get("needs_realtime_data")),
            needs_documents=bool(data.get("needs_documents")),
            needs_external_system=bool(data.get("needs_external_system")),
            needs_relationship_reasoning=bool(data.get("needs_relationship_reasoning")),
            needs_computation=bool(data.get("needs_computation")),
            success_criteria=_str_list(data.get("success_criteria")),
            constraints=_str_list(data.get("constraints")),
            risk_factors=_str_list(data.get("risk_factors")),
            unknowns=_str_list(data.get("unknowns")),
        )

        # An attached image is a fact about the request, not a judgement. The
        # analysis model does not always notice it even when told.
        if ctx.image and spec.modality == "text":
            spec.modality = "mixed"

        ctx.requirements = spec
        ctx.agent_spec.rationale["requirements"] = str(data.get("reasoning") or "")

        logger.info(
            "Requirements: task_type=%s domain=%s complexity=%s signals=%s",
            spec.task_type, spec.domain, spec.complexity,
            {
                "realtime": spec.needs_realtime_data,
                "docs": spec.needs_documents,
                "external": spec.needs_external_system,
                "graph": spec.needs_relationship_reasoning,
                "compute": spec.needs_computation,
            },
        )

        ctx.emit("requirements", {
            "intent": spec.intent,
            "task_type": spec.task_type,
            "domain": spec.domain,
            "deliverable": spec.deliverable,
            "complexity": spec.complexity,
            "success_criteria": spec.success_criteria,
            "risk_factors": spec.risk_factors,
            "reasoning": ctx.agent_spec.rationale["requirements"],
        })

    def fallback(self, ctx: PipelineContext) -> None:
        """Carry on with the query as its own intent.

        Every later layer needs a RequirementSpec to read. Leaving it None would
        force each of them into its own None-check and its own idea of a
        default; one honest fallback here keeps that in a single place.
        """
        logger.warning("Requirement analysis failed — proceeding with an unanalysed query")
        ctx.requirements = RequirementSpec(
            intent=ctx.query,
            task_type="conversation",
            domain="general",
            deliverable="A helpful, accurate answer to the request.",
            complexity="moderate",
            modality="mixed" if ctx.image else "text",
        )
