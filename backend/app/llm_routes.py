"""
Model routing for the backend's model jobs — which model does which job.

The same choice as the tool service (``tool-service/app/llm/routes.py``):
``mistral-large-4`` is the largest Mistral model (reasoning, 1M context) and
takes every job where a wrong answer is expensive — deciding reuse, authoring
the specification code is generated and *tested* against, revising it from a
user's rebuild instructions, designing a workflow's run inputs, and refining a
workflow from an instruction. ``mistral-medium-2604`` (Medium 3.5, also
reasoning) is the fallback.

Measured reasoning efforts: ``mistral-large-4`` accepts low/medium/high and
rejects "none"; ``mistral-medium-2604`` accepts high/none; ``mistral-large-2512``
rejects the parameter ("not enabled"). ``core.decision`` drops a rejected
effort and retries, so any route can point at any of them. IDs are pinned
rather than ``-latest`` so a model change is deliberate.

Planning decisions that name no route (every workflow and agent layer) use the
Orchestrator model from Settings with ``ORCHESTRATOR_REASONING_EFFORT`` and
``ORCHESTRATOR_FALLBACK_MODEL`` (``app/config.py``).

Override per role on the Settings page, or from the environment:
``ROUTE_SPEC_AUTHOR_MODEL=...``, ``ROUTE_SPEC_AUTHOR_EFFORT=high|medium|low|none|omit``,
``ROUTE_SPEC_AUTHOR_TIMEOUT_MS=...``. A Settings-page value wins.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, replace
from typing import Optional

logger = logging.getLogger(__name__)

PRIMARY = "mistral-large-4"
FALLBACK = "mistral-medium-2604"
LIGHT = "mistral-small-2603"


@dataclass(frozen=True)
class ModelRoute:
    role: str
    model: str
    reasoning_effort: Optional[str] = None
    timeout_ms: int = 120_000
    temperature: Optional[float] = None
    fallback_model: Optional[str] = None


_ROUTES: dict[str, ModelRoute] = {
    # R1 — turn a free-text request into a structured need.
    "need_normalise": ModelRoute("need_normalise", PRIMARY, "high", 120_000, None, FALLBACK),
    # R2 — safety screen against the blocklist.
    "policy_gate": ModelRoute("policy_gate", PRIMARY, "high", 120_000, None, FALLBACK),
    # R3 — does an existing tool/activity already do this?
    "reuse_resolution": ModelRoute("reuse_resolution", PRIMARY, "high", 180_000, None, FALLBACK),
    # R4 — the specification code is generated and tested against.
    "spec_author": ModelRoute("spec_author", PRIMARY, "high", 300_000, None, FALLBACK),
    # Rebuild from an error: the stored spec revised to do what the user asked.
    "spec_revision": ModelRoute("spec_revision", PRIMARY, "high", 300_000, None, FALLBACK),
    # Gap decisions made by the chat pipeline (CapabilityGapLayer).
    "capability_gap": ModelRoute("capability_gap", PRIMARY, "high", 180_000, None, FALLBACK),
    # What a build needs from the user before it starts (build_prereqs).
    "prerequisite_analysis": ModelRoute("prerequisite_analysis", PRIMARY, "high", 180_000, None,
                                        FALLBACK),
    # The workflow's run inputs: fields, types and one coherent worked example.
    "input_schema": ModelRoute("input_schema", PRIMARY, "high", 240_000, None, FALLBACK),
    # Refine with AI: an instruction → edit operations, and their repair.
    "workflow_revision": ModelRoute("workflow_revision", PRIMARY, "high", 300_000, None, FALLBACK),
}

#: Routes of the tool/activity code pipeline, and Refine with AI (which can rebuild code).
CODE_ROLES = frozenset({"need_normalise", "policy_gate", "reuse_resolution", "spec_author",
                        "spec_revision", "capability_gap", "workflow_revision"})

#: Model families never used for writing or checking tool and activity code.
EXCLUDED_CODE_MODELS: tuple[str, ...] = ("codestral",)


def _excluded(model: Optional[str]) -> bool:
    low = (model or "").strip().lower()
    return bool(low) and any(low.startswith(p) for p in EXCLUDED_CODE_MODELS)


def _guard_code_route(role: str, route: "ModelRoute", base: "ModelRoute") -> "ModelRoute":
    """Keep Codestral off the code routes, whatever the environment or an old override says."""
    if role not in CODE_ROLES:
        return route
    changes: dict = {}
    if _excluded(route.model):
        logger.warning("Route '%s' is set to %s; code is not written by Codestral — using %s",
                       role, route.model, base.model)
        changes["model"] = base.model
    if _excluded(route.fallback_model):
        logger.warning("Route '%s' fallback %s ignored (Codestral); using %s",
                       role, route.fallback_model, base.fallback_model)
        changes["fallback_model"] = base.fallback_model
    return replace(route, **changes) if changes else route


def _env(role: str, field: str) -> Optional[str]:
    key = f"ROUTE_{role.upper()}_{field}"
    # The Settings page wins over the environment.
    from app.app_settings.store import override

    saved = override(key)
    if saved is not None:
        return saved
    value = os.environ.get(key)
    return value.strip() if value and value.strip() else None


def route_for(role: str) -> ModelRoute:
    base = _ROUTES.get(role)
    if base is None:
        raise KeyError(f"No model route for role '{role}'")
    overrides: dict = {}
    if (model := _env(role, "MODEL")):
        overrides["model"] = model
    if (effort := _env(role, "EFFORT")):
        overrides["reasoning_effort"] = None if effort.lower() == "omit" else effort
    if (timeout := _env(role, "TIMEOUT_MS")):
        overrides["timeout_ms"] = int(timeout)
    if (fallback := _env(role, "FALLBACK")):
        overrides["fallback_model"] = None if fallback.lower() == "none" else fallback
    route = replace(base, **overrides) if overrides else base
    return _guard_code_route(role, route, base)


def all_routes() -> dict[str, ModelRoute]:
    return {role: route_for(role) for role in _ROUTES}


def extract_text(content) -> str:
    """The answer text of a message, skipping reasoning ("thinking") chunks.

    With ``reasoning_effort`` set the SDK returns a list of chunks rather than
    a string; treating that list as the answer breaks JSON parsing.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for chunk in content:
            kind = getattr(chunk, "type", None) or (chunk.get("type") if isinstance(chunk, dict) else None)
            if kind == "thinking":
                continue
            text = getattr(chunk, "text", None)
            if text is None and isinstance(chunk, dict):
                text = chunk.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)
    return str(content)
