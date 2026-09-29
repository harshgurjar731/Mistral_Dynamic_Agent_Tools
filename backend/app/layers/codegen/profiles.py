"""
Requirement profiles — how authoring a tool differs from authoring an activity.

The counterpart of the tool service's CodeProfile. The layers are shared; the
profile decides what the specification must say and how it must fit what is
around it:

    tool       written for an agent to choose and call: descriptions, enums,
               examples of valid calls; exact outputs optional
    activity   written for a workflow: every capability output is a named
               output field, and worked examples carry exact values
"""

from __future__ import annotations

import json
import re
from typing import Optional

from app.core.specs import CodeRequirement
from app.prompts_codegen import ACTIVITY_SPEC_SYSTEM, TOOL_SPEC_SYSTEM

_SNAKE = re.compile(r"[^a-z0-9]+")


def snake(text: str) -> str:
    value = _SNAKE.sub("_", str(text or "").strip().lower()).strip("_")
    if value and not value[0].isalpha():
        value = f"f_{value}"
    return value[:64]


class RequirementProfile:
    purpose = "tool"
    noun = "agent tool"
    author_system = TOOL_SPEC_SYSTEM

    def in_catalogue(self, tool: dict) -> bool:
        """Whether a catalogue entry can satisfy a need of this purpose."""
        purpose = tool.get("purpose") or "tool"
        active = tool.get("is_active", tool.get("status") == "approved")
        return purpose == self.purpose and tool.get("status") == "approved" and bool(active)

    def author_user(self, *, need, normalised: dict, issues: list[str],
                    previous: Optional[CodeRequirement]) -> str:
        parts = [f"## Need\n{need.intent or normalised.get('summary', '')}"]
        if need.goal:
            parts.append(f"## Wider goal\n{need.goal}")
        if normalised:
            parts.append("## Structured need\n" + json.dumps(normalised, indent=2))
        if need.draft:
            parts.append("## Draft from the caller (refine it; do not trust it blindly)\n"
                         + json.dumps(need.draft, indent=2, default=str))
        parts.extend(self.context_blocks(need))
        if issues and previous is not None:
            parts.append("## Your previous specification was rejected\n"
                         + json.dumps(previous.as_request(), indent=2, default=str)
                         + "\n\nProblems to fix:\n" + "\n".join(f"- {i}" for i in issues))
        return "\n\n".join(parts)

    def context_blocks(self, need) -> list[str]:
        return []

    def bind_contract(self, need, req: CodeRequirement) -> list[str]:
        """Does the spec fit what surrounds it? Returns issues."""
        issues = []
        props = (req.input_schema or {}).get("properties") or {}
        undocumented = [n for n, d in props.items()
                        if not (isinstance(d, dict) and str(d.get("description") or "").strip())]
        if undocumented:
            issues.append("every parameter needs a description an agent can choose values "
                          "from; missing for: " + ", ".join(undocumented))
        return issues

    def preflight(self, req: CodeRequirement) -> list[str]:
        return []


class ActivityRequirementProfile(RequirementProfile):
    purpose = "activity"
    noun = "workflow activity"
    author_system = ACTIVITY_SPEC_SYSTEM

    def context_blocks(self, need) -> list[str]:
        blocks = []
        cap = need.capability or {}
        if cap:
            blocks.append(
                "## Capability this activity implements\n"
                + json.dumps({k: cap.get(k) for k in ("id", "name", "purpose", "inputs", "outputs")},
                             indent=2)
                + "\nThe output_schema must contain every name in \"outputs\"."
            )
        if need.upstream:
            blocks.append("## Steps that feed it (their outputs become its inputs)\n"
                          + json.dumps(need.upstream, indent=2, default=str))
        if need.downstream:
            blocks.append("## Steps that read its output\n"
                          + json.dumps(need.downstream, indent=2, default=str))
        return blocks

    def bind_contract(self, need, req: CodeRequirement) -> list[str]:
        issues = []
        out_props = ((req.output_schema or {}).get("properties") or {})
        if not out_props:
            return ["output_schema must declare the fields later steps read"]
        wanted = [snake(o) for o in (need.capability or {}).get("outputs") or [] if snake(o)]
        missing = [o for o in wanted if o not in out_props]
        if missing:
            issues.append("output_schema is missing the capability outputs later steps "
                          "will reference: " + ", ".join(missing)
                          + f" (present: {', '.join(sorted(out_props))})")
        with_output = [e for e in req.examples if isinstance(e, dict) and e.get("output") is not None]
        if len(with_output) < (2 if req.kind == "pure" else 1):
            issues.append("give at least 2 worked examples with exact outputs")
        if req.side_effects in ("write", "delete"):
            issues.append("an activity may not write or delete; that belongs to a connector step")
        return issues


PROFILES = {"tool": RequirementProfile(), "activity": ActivityRequirementProfile()}


def profile_for(purpose: str) -> RequirementProfile:
    return PROFILES.get(purpose or "tool", PROFILES["tool"])
