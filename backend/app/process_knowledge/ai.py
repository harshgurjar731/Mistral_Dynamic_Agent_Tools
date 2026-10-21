"""
AI help for process documents: fix one that fails the template, or draft one
from a prose description (an SOP, a policy, notes).

Neither ever saves. The result is re-validated and returned with a list of what
changed, so the user reviews a diff and accepts it — a model restructuring a
compliance process unseen is not something to persist on its own say-so.

The model is told to keep the user's content and only reshape it. Anything it
has to invent to satisfy the template is written as ``"TODO: …"`` and listed,
so a placeholder can never pass for a fact.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.process_knowledge import validation

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 2
_MAX_INPUT_CHARS = 60_000

_SYSTEM = """\
You repair and restructure business-process documents so they match a JSON Schema exactly.

Rules — follow all of them:
1. KEEP THE USER'S CONTENT. Reuse their stages, names, controls, wording and ids wherever
   possible. Restructure, rename keys, fix types and syntax; do not rewrite meaning.
2. NEVER INVENT BUSINESS FACTS. When the schema requires a value the input does not contain,
   write a string starting with "TODO: " that says what is needed (for booleans use false,
   for arrays an empty list if allowed). List every such path in "placeholders".
3. Ids must be lower_snake_case. Every reference (depends_on, applies_to, controls,
   next_stage, actor) must point at an id that exists in the document.
4. Return ONLY a JSON object:
   {"document": {...the corrected document...},
    "changes": [{"path": "stages[1].actor_type", "change": "one sentence"}],
    "placeholders": ["stages[2].purpose"],
    "notes": "one or two sentences for the user"}
"""

_FIX_USER = """\
JSON SCHEMA (the template):
{schema}

PROBLEMS FOUND BY THE VALIDATOR:
{issues}
{placement}
THE DOCUMENT AS UPLOADED (may not even be valid JSON):
{document}

Return the corrected document.
"""

_DRAFT_USER = """\
JSON SCHEMA (the template):
{schema}

EXAMPLE OF A COMPLETE DOCUMENT IN THIS FORMAT:
{example}
{placement}
SOURCE MATERIAL — turn this into one process document following the schema. Take stages,
controls, risks, exceptions and regulations from it; do not add ones it does not support:
{text}
"""


def _issues_text(report: dict) -> str:
    rows = []
    for i in report.get("issues") or []:
        rows.append(f"- [{i['severity']}] {i['path']}: {i['message']}"
                    + (f" Expected: {i['expected']}." if i.get("expected") else "")
                    + (f" Fix: {i['fix']}" if i.get("fix") else ""))
    return "\n".join(rows[:120]) or "(none)"


def _placement_text(concept_id: Optional[str]) -> str:
    if not concept_id:
        return ""
    from app.ontology import store
    from app.process_knowledge.resolver import breadcrumb

    concept = store.get_concept(concept_id)
    if not concept:
        return ""
    return (f"\nTHIS DOCUMENT IS FILED UNDER: {breadcrumb(concept_id)} — it is a "
            f"{concept.get('level_name')} named \"{concept['label']}\". Make process.level, "
            f"process.name and classification agree with that.\n")


async def _ask(client, user: str, phase: str) -> dict:
    from app.config import settings
    from app.core.decision import LONG_TIMEOUT_MS, decide, parse_json

    raw = await decide(client, model=settings.MISTRAL_ORCHESTRATOR_MODEL, system=_SYSTEM,
                       user=user, phase=phase, timeout_ms=LONG_TIMEOUT_MS, temperature=0.1)
    data = parse_json(raw, None)
    if not isinstance(data, dict):
        raise ValueError("The model did not return a JSON object.")
    if not isinstance(data.get("document"), dict):
        # Some models return the document itself rather than the wrapper.
        data = {"document": data, "changes": [], "placeholders": [], "notes": ""}
    return data


async def _loop(client, first_user: str, template: dict, concept_id: Optional[str],
                phase: str) -> dict:
    user = first_user
    data: dict = {}
    report: dict = {}
    attempts = 0
    changes: list = []
    for attempts in range(1, _MAX_ATTEMPTS + 1):
        data = await _ask(client, user, phase)
        changes += [c for c in data.get("changes") or [] if isinstance(c, dict)]
        report = validation.validate(data["document"], template, concept_id=concept_id)
        if report["valid"]:
            break
        user = _FIX_USER.format(
            schema=json.dumps(template["schema"], indent=1)[:_MAX_INPUT_CHARS // 2],
            issues=_issues_text(report), placement=_placement_text(concept_id),
            document=json.dumps(data["document"], indent=1)[:_MAX_INPUT_CHARS],
        )
    return {
        "document": data.get("document"),
        "report": validation.public_report(report),
        "valid": report.get("valid", False),
        "changes": changes[:200],
        "placeholders": [str(p) for p in data.get("placeholders") or []][:200],
        "notes": str(data.get("notes") or ""),
        "attempts": attempts,
    }


async def fix(client, raw: Any, template: dict, *, concept_id: Optional[str] = None) -> dict:
    """Restructure ``raw`` (text or parsed JSON) to satisfy ``template``."""
    text = raw if isinstance(raw, str) else json.dumps(raw, indent=1)
    report = validation.validate(text, template, concept_id=concept_id, max_kb=10_000)
    user = _FIX_USER.format(
        schema=json.dumps(template["schema"], indent=1)[:_MAX_INPUT_CHARS // 2],
        issues=_issues_text(report), placement=_placement_text(concept_id),
        document=text[:_MAX_INPUT_CHARS],
    )
    result = await _loop(client, user, template, concept_id, "process document fix")
    result["before"] = validation.public_report(report)
    return result


async def draft(client, text: str, template: dict, *, concept_id: Optional[str] = None) -> dict:
    """Turn prose into a document that satisfies ``template``."""
    from app.process_knowledge.templates import download_payload

    user = _DRAFT_USER.format(
        schema=json.dumps(template["schema"], indent=1)[:_MAX_INPUT_CHARS // 2],
        example=json.dumps(download_payload(template, "example"), indent=1)[:12_000],
        placement=_placement_text(concept_id), text=text[:_MAX_INPUT_CHARS],
    )
    return await _loop(client, user, template, concept_id, "process document draft")
