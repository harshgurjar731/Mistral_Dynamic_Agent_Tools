"""
Rebuild the activity behind one step of a saved workflow.

The planner's activity layer can leave a step without a working activity —
deferred to its first run, or unbuilt. This retries the build on demand, through
the same code-requirement pipeline (with its smoke test and rollback), and
re-binds the step only when the result is usable. A failed attempt changes
nothing in the workflow.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.layers.codegen.contracts import _REF, _strings
from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep

logger = logging.getLogger(__name__)


class RebuildError(ValueError):
    """The step cannot be rebuilt (missing, or not an activity step)."""


def _step(definition: WorkflowDefinition, step_id: str) -> WorkflowStep:
    step = next((s for s in definition.steps if s.id == step_id), None)
    if step is None:
        raise RebuildError(f"Step '{step_id}' is not in workflow '{definition.name}'")
    if step.type != StepType.TOOL:
        raise RebuildError(f"Step '{step_id}' is a {step.type.value} step, not an activity step")
    return step


def _need_for(definition: WorkflowDefinition, step: WorkflowStep):
    from app.core.specs import CodeNeed

    config = step.config or {}
    tool_name = str(config.get("tool_name") or "").strip()
    requirement: Optional[dict] = config.get("code_requirement")
    if isinstance(requirement, dict) and requirement.get("name"):
        # The specification the planner checked: rebuild exactly that.
        return CodeNeed(purpose="activity", origin="runtime",
                        name_hint=requirement["name"],
                        intent=requirement.get("description", ""),
                        requirement=requirement)

    # No stored specification (the planner could not make one sound): author
    # a fresh one from what the workflow says the step takes and must return.
    outputs = sorted({
        field
        for other in definition.steps if other.id != step.id
        for text in _strings(other.config or {})
        for ref, field in _REF.findall(text) if ref == step.id
    })
    arguments = config.get("arguments") or config.get("arguments_template") or {}
    purpose = step.description or f"Step '{step.id}' of workflow '{definition.name}'"
    return CodeNeed(
        purpose="activity", origin="workflow", intent=purpose,
        name_hint=tool_name or step.id, goal=definition.description or "",
        capability={"id": step.id, "name": step.id, "purpose": purpose,
                    "inputs": sorted(arguments) if isinstance(arguments, dict) else [],
                    "outputs": outputs},
    )


async def rebuild_step_activity(definition: WorkflowDefinition, step_id: str):
    """Rebuild ``step_id``'s activity. Returns ``(resolution, changed)``.

    ``changed`` is True when the step was re-bound and the definition must be
    saved. Raises :class:`RebuildError` for a step that is not an activity step.
    """
    from app.layers.codegen import resolve_code_need

    step = _step(definition, step_id)
    resolution = await resolve_code_need(_need_for(definition, step))
    logger.info("Rebuild of step '%s' in '%s': %s — %s", step_id, definition.name,
                resolution.status, resolution.message)
    if resolution.status not in ("reused", "built", "pending_approval"):
        return resolution, False

    config = dict(step.config or {})
    config["tool_name"] = resolution.name
    if resolution.version is not None:
        config["tool_version"] = resolution.version
    else:
        config.pop("tool_version", None)
    if resolution.requirement is not None:
        config["code_requirement"] = resolution.requirement.as_request()
    step.config = config
    return resolution, True
