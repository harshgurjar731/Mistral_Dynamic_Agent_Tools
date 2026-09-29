"""
Model routing for the code-requirement pipeline — which model does which job.

The same choice as the tool service (``tool-service/app/llm/routes.py``):
``mistral-medium-2604`` (Medium 3.5) is Mistral's newest large-tier model and
the only one of that tier with reasoning, so it takes the jobs where a wrong
answer is expensive — deciding reuse, and authoring the specification that
code is generated and *tested* against. ``mistral-small-2603`` takes the cheap
structuring and screening jobs. ``mistral-large-2512`` is the fallback.

These models accept ``reasoning_effort`` of ``"high"`` or ``"none"`` only
(measured; other values are rejected with a 400). IDs are pinned rather than
``-latest`` so a model change is deliberate.

Override per role from the environment: ``ROUTE_SPEC_AUTHOR_MODEL=...``,
``ROUTE_SPEC_AUTHOR_EFFORT=none|high|omit``, ``ROUTE_SPEC_AUTHOR_TIMEOUT_MS=...``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Optional

PRIMARY = "mistral-medium-2604"
FALLBACK = "mistral-large-2512"
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
    "need_normalise": ModelRoute("need_normalise", LIGHT, "none", 60_000, 0.1, PRIMARY),
    # R2 — safety screen against the blocklist.
    "policy_gate": ModelRoute("policy_gate", LIGHT, "none", 60_000, 0.0, PRIMARY),
    # R3 — does an existing tool/activity already do this?
    "reuse_resolution": ModelRoute("reuse_resolution", PRIMARY, "high", 180_000, None, FALLBACK),
    # R4 — the specification code is generated and tested against.
    "spec_author": ModelRoute("spec_author", PRIMARY, "high", 240_000, None, FALLBACK),
    # Gap decisions made by the chat pipeline (CapabilityGapLayer).
    "capability_gap": ModelRoute("capability_gap", PRIMARY, "none", 120_000, 0.1, FALLBACK),
}


def _env(role: str, field: str) -> Optional[str]:
    value = os.environ.get(f"ROUTE_{role.upper()}_{field}")
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
    return replace(base, **overrides) if overrides else base


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
