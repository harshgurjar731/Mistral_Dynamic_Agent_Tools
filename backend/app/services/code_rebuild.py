"""
Rebuild a tool or activity from a failure seen while running it.

The user pastes the error (from a workflow run, an agent's tool call, or a
manual test), says what should change, and optionally gives the input it failed
on and the output it should have produced. That becomes a new version of the
same tool through the code-requirement pipeline (``origin="feedback"``):

* the stored specification is kept — same name, same input and output contract;
* the tool service is shown the failed code, the error and the comment;
* the new version must reproduce its worked examples and run the failing input
  without error, or it is rolled back and the previous version stays active;
* an expected output, when given, is added as a worked example, so the fix is
  held to it from now on.

Workflows pinned to the version that failed are re-pinned to the new one, so
the fix reaches the runs that hit the error.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

#: SynthesisSpec v2 fields a rebuild carries over from the stored version.
_SPEC_FIELDS = ("name", "description", "purpose", "kind", "input_schema", "output_schema",
                "examples", "api_details", "secrets", "side_effects", "http_fixtures")


class RebuildError(ValueError):
    """The rebuild cannot start (unknown version, nothing to say about it)."""


def spec_from_record(record: dict) -> dict:
    """The specification a stored version was built from (older rows: from its schema)."""
    spec = record.get("spec") if isinstance(record.get("spec"), dict) else {}
    if spec.get("name"):
        return {k: copy.deepcopy(spec[k]) for k in _SPEC_FIELDS if k in spec}
    fn = (record.get("schema") or {}).get("function") or {}
    return {
        "name": record.get("name"),
        "description": fn.get("description") or record.get("description") or "",
        "purpose": record.get("purpose") or "tool",
        "kind": record.get("kind") or "pure",
        "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        "output_schema": record.get("output_schema"),
        "examples": [],
        "side_effects": record.get("side_effects") or "none",
    }


def build_request(record: dict, *, error: str, comment: str,
                  failing_input: Optional[dict], expected_output: Any) -> tuple[dict, list[str]]:
    """The requirement to rebuild from, and the guidance the safety screen sees."""
    error, comment = (error or "").strip(), (comment or "").strip()
    if not error and not comment:
        raise RebuildError("Paste the error, or say what should change — a rebuild needs one of them.")
    requirement = spec_from_record(record)
    if failing_input and expected_output is not None:
        examples = [e for e in requirement.get("examples") or []
                    if isinstance(e, dict) and e.get("input") != failing_input]
        examples.append({"input": failing_input, "output": expected_output,
                         "note": "Added from a failed run: the rebuilt version must produce this."})
        requirement["examples"] = examples
    requirement["feedback"] = {
        "previous_code": record.get("source_code") or "",
        "runtime_error": error,
        "comment": comment,
        **({"failing_input": failing_input} if failing_input else {}),
    }
    guidance = [g for g in (comment, f"Error seen at run time: {error}" if error else "") if g]
    return requirement, guidance


async def rebuild_from_failure(
    tool_id: int,
    *,
    error: str = "",
    comment: str = "",
    failing_input: Optional[dict] = None,
    expected_output: Any = None,
    update_workflows: bool = True,
    on_event: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Rebuild version ``tool_id``. Returns the outcome, never raises after it starts."""
    from app.core.specs import CodeNeed
    from app.layers.codegen import resolve_code_need
    from app.services.tool_resolver import resolution_to_result, tool_resolver

    record = await tool_resolver.get_tool(int(tool_id))
    if record is None:
        raise RebuildError(f"Version {tool_id} was not found on the tool service.")
    requirement, guidance = build_request(record, error=error, comment=comment,
                                          failing_input=failing_input,
                                          expected_output=expected_output)

    need = CodeNeed(purpose=requirement.get("purpose") or "tool", origin="feedback",
                    name_hint=record["name"], intent=requirement.get("description") or "",
                    guidance=guidance, requirement=requirement)
    resolution = await resolve_code_need(
        need, on_event=on_event, must_succeed=[failing_input] if failing_input else [])

    result = resolution_to_result(resolution)
    result.update(previous_version=record.get("version_no"), previous_tool_id=record.get("id"),
                  repinned=[])
    # Only a version that is approved and active can take over; one held for
    # review is pinned once someone approves it.
    if update_workflows and resolution.status == "built" and resolution.version is not None:
        result["repinned"] = await asyncio.to_thread(
            repin_workflows, record["name"], record.get("version_no"), resolution.version,
            resolution.requirement.as_request() if resolution.requirement else None)
    return result


def repin_workflows(name: str, old_version: Optional[int], new_version: int,
                    requirement: Optional[dict]) -> list[dict]:
    """Point workflow steps that ran the failed version at the rebuilt one.

    Steps pinned to ``old_version`` move to ``new_version``; unpinned steps
    (which run the active version anyway) only get the new requirement, so a
    runtime recovery rebuilds the fixed code. Steps pinned to some other
    version were deliberately held there and are left alone.
    """
    from app.services.workflow_engine.engine import list_workflows, save_workflow
    from app.services.workflow_engine.models import StepType

    changed = []
    for definition in list_workflows():
        steps = []
        for step in definition.steps:
            config = step.config or {}
            if step.type != StepType.TOOL or config.get("tool_name") != name:
                continue
            pinned = config.get("tool_version")
            if pinned is not None and pinned != old_version:
                continue
            new_config = dict(config)
            if pinned is not None:
                new_config["tool_version"] = new_version
            if requirement:
                new_config["code_requirement"] = {k: v for k, v in requirement.items()
                                                  if k != "feedback"}
            step.config = new_config
            steps.append(step.id)
        if steps:
            save_workflow(definition)
            changed.append({"workflow_name": definition.name, "steps": steps,
                            "is_deployed": bool(definition.is_deployed)})
            logger.info("Re-pinned %s in '%s' to %s v%s", steps, definition.name, name, new_version)
    return changed
