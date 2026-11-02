"""
Markdown → knowledge items, with mistral-large in JSON mode.

Done once, when a source is added — never during a build. Each chunk of the
source yields short, self-contained items, each citing the page it came from.
Guidance items may carry conditions over the process-document attributes and
an effect the archetype layer can apply without a model call; both are checked
against closed lists here, so a model cannot invent an attribute or an effect
the platform does not understand.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

from app.knowledge.store import (
    CONDITION_OPS, GUIDANCE_CATEGORIES, REFERENCE_CATEGORIES, STRENGTHS,
)

logger = logging.getLogger(__name__)

CHUNK_CHARS = 12000
MAX_CHUNKS = 40

#: Attributes a condition may test, with their values. The paths are template-v2 fields.
CONDITION_ATTRIBUTES: dict[str, tuple[str, ...]] = {
    "intervention.implementation_type": ("agent", "hybrid", "rules_engine", "workflow_config",
                                         "integration", "analytics", "manual_process_change"),
    "intervention.category": ("artificial_intelligence", "intelligent_document_processing",
                              "workflow_automation", "process_mining", "rpa", "integration", "analytics"),
    "execution_profile.workflow_determinism": ("fixed_steps", "variable_steps", "open_ended"),
    "execution_profile.interaction_mode": ("user_dialogue", "batch", "event_triggered", "scheduled",
                                           "embedded_assist"),
    "execution_profile.trigger.type": ("user_request", "document_arrival", "schedule", "system_event",
                                       "upstream_step", "manual"),
    "execution_profile.task_horizon": ("single_step", "few_steps", "many_steps", "long_running", "multi_day"),
    "execution_profile.input_variability": ("structured", "standard_forms", "mixed_formats", "unstructured"),
    "execution_profile.memory_need": ("none", "session", "persistent"),
    "governance.action_authority": ("read_only", "recommend", "draft", "write", "transact"),
    "governance.reversibility": ("none", "reversible", "financial_impact", "irreversible"),
    "governance.human_oversight.model": ("human_in_the_loop", "human_on_the_loop",
                                         "human_out_of_the_loop", "not_applicable"),
    "governance.risk.rating": ("low", "medium", "high"),
    "integrations.systems.access": ("read", "write", "read_write", "transact"),
    "data_entities.classification": ("public", "internal", "financial", "pii"),
    "requirements.task_type": ("lookup", "analysis", "generation", "transformation", "conversation"),
    "requirements.complexity": ("simple", "moderate", "complex"),
}

#: Effects an item may declare, and the values each accepts.
EFFECT_KEYS: dict[str, tuple[str, ...]] = {
    "archetype.primary_type": ("task", "goal", "conversational", "none"),
    "archetype.patterns.add": ("tool_using_react", "planner_executor", "reflective", "multi_agent"),
    "archetype.patterns.remove": ("tool_using_react", "planner_executor", "reflective", "multi_agent"),
    "archetype.oversight.model": ("human_in_the_loop", "human_on_the_loop", "human_out_of_the_loop"),
    "archetype.oversight.applies_to": ("every_transaction", "exceptions_only", "sample", "threshold_based"),
    "archetype.model_preference": ("reasoning", "large", "medium", "small", "code", "ocr", "vision"),
    "archetype.max_tool_rounds": (),
}

SYSTEM_PROMPT = """\
You distil documents into knowledge for a platform that builds AI agents and multi-step
workflows on Mistral. Read the excerpt and extract SHORT, SELF-CONTAINED items. Each item
states one thing a builder (or a built agent) should know or do. Skip boilerplate, marketing,
and anything the excerpt does not actually say. Never invent content.

Two kinds:
- "guidance": how to BUILD — which agent type fits which work, how to design agents and
  instructions, workflow patterns, tool and connector use, governance, naming, model choice,
  data handling, anti-patterns.
- "reference": facts about a DOMAIN a built agent may need at run time — definitions,
  regulations, metrics, risks, glossary terms, domain processes.

Fields per item:
- title: <= 12 words.  body: 1-3 sentences, imperative for guidance.  rationale: why (optional).
- kind, category (guidance: archetype | agent_design | instruction_style | workflow_pattern |
  tool_connector | governance | model_choice | naming | data_handling | anti_pattern |
  best_practice; reference: definition | regulation | process | metric | risk | glossary).
- strength (guidance only): must | should | may | avoid — "must"/"avoid" ONLY when the text
  is categorical ("always", "never", "required", "prohibited").
- subject: agent | workflow | both.   audience: builder | runtime | both.
- scope_hint: the business domain or process it is about, in the text's words, or "" if general.
- conditions (guidance only, optional): when it applies, as [{{"attr", "op", "value"}}] using ONLY
  these attributes and values; leave empty if the text gives no such condition:
{attributes}
  ops: eq | ne | in | not_in | exists | contains.
- effect (guidance only, optional): set ONLY when the item directly decides one of these;
  otherwise {{}}:
{effects}
- page: the page number from the nearest "<!-- page N -->" marker before the passage, or null.
- quote: <= 25 words copied verbatim from the excerpt that supports the item.
- confidence: high | medium | low — how clearly the excerpt states it.

Return JSON: {{"items": [ ... ], "reasoning": "<one sentence on what the excerpt covers>"}}.
Return {{"items": []}} when the excerpt has nothing worth keeping.
"""

USER_PROMPT = """\
SOURCE: {title}
EXCERPT {index} of {total}:

{text}
"""


def _render_attributes() -> str:
    return "\n".join(f"    {k}: {', '.join(v)}" for k, v in CONDITION_ATTRIBUTES.items())


def _render_effects() -> str:
    return "\n".join(f"    {k}: {', '.join(v) if v else 'an integer 1-20'}" for k, v in EFFECT_KEYS.items())


def chunks(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Split on headings and page markers, then pack sections up to ``size``."""
    text = (text or "").strip()
    if not text:
        return []
    sections = re.split(r"(?=^#{1,3} |^<!-- page \d+ -->)", text, flags=re.M)
    out, current = [], ""
    for section in sections:
        if len(section) > size:
            for start in range(0, len(section), size):
                piece = section[start:start + size]
                if current:
                    out.append(current)
                    current = ""
                out.append(piece)
            continue
        if len(current) + len(section) > size and current:
            out.append(current)
            current = ""
        current += section
    if current.strip():
        out.append(current)
    return out


def clean_item(raw: Any) -> Optional[dict]:
    """A model-proposed item, checked against the closed lists. None when unusable."""
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()[:200]
    body = str(raw.get("body") or raw.get("statement") or "").strip()[:2000]
    if not title or not body:
        return None
    kind = "reference" if str(raw.get("kind")).lower() == "reference" else "guidance"
    categories = REFERENCE_CATEGORIES if kind == "reference" else GUIDANCE_CATEGORIES
    category = str(raw.get("category") or "").lower()
    if category not in categories:
        category = "definition" if kind == "reference" else "best_practice"
    strength = str(raw.get("strength") or "should").lower() if kind == "guidance" else None
    if strength is not None and strength not in STRENGTHS:
        strength = "should"

    conditions = []
    for c in raw.get("conditions") or [] if kind == "guidance" else []:
        if not isinstance(c, dict):
            continue
        attr, op, value = str(c.get("attr") or ""), str(c.get("op") or "eq"), c.get("value")
        allowed = CONDITION_ATTRIBUTES.get(attr)
        if allowed is None or op not in CONDITION_OPS:
            continue
        values = value if isinstance(value, list) else [value]
        if op != "exists" and not all(str(v).lower() in allowed for v in values):
            continue
        conditions.append({"attr": attr, "op": op, "value": value})

    effect = {}
    for key, value in (raw.get("effect") or {}).items() if kind == "guidance" and isinstance(raw.get("effect"), dict) else []:
        allowed = EFFECT_KEYS.get(key)
        if allowed is None:
            continue
        if key == "archetype.max_tool_rounds":
            try:
                n = int(value)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 20:
                effect[key] = n
            continue
        values = value if isinstance(value, list) else [value]
        values = [str(v).lower() for v in values if str(v).lower() in allowed]
        if values:
            effect[key] = values if key.endswith((".add", ".remove")) else values[0]

    subject = str(raw.get("subject") or "both").lower()
    audience = str(raw.get("audience") or ("runtime" if kind == "reference" else "builder")).lower()
    page = raw.get("page")
    try:
        page = int(page) if page not in (None, "") else None
    except (TypeError, ValueError):
        page = None
    confidence = str(raw.get("confidence") or "medium").lower()
    return {
        "kind": kind, "category": category, "title": title, "body": body,
        "rationale": str(raw.get("rationale") or "").strip()[:600],
        "strength": strength, "subject": subject if subject in ("agent", "workflow", "both") else "both",
        "audience": audience if audience in ("builder", "runtime", "both") else "builder",
        "conditions": conditions, "effect": effect,
        "scope_hint": str(raw.get("scope_hint") or "").strip()[:200],
        "page": page, "quote": str(raw.get("quote") or "").strip()[:300],
        "confidence": confidence if confidence in ("high", "medium", "low") else "medium",
    }


async def distill(client: Any, text: str, *, title: str = "") -> tuple[list[dict], list[str]]:
    """All items in a source. Returns ``(items, notes)``; a failed chunk is noted, not fatal."""
    from app.config import settings
    from app.core.decision import LONG_TIMEOUT_MS, decide, parse_json

    every = chunks(text)
    pieces = every[:MAX_CHUNKS]
    system = SYSTEM_PROMPT.format(attributes=_render_attributes(), effects=_render_effects())

    async def one(index: int, piece: str):
        raw = await decide(
            client, model=settings.KNOWLEDGE_DISTILL_MODEL, system=system,
            user=USER_PROMPT.format(title=title or "untitled", index=index, total=len(pieces), text=piece),
            phase=f"knowledge distillation ({index}/{len(pieces)})", timeout_ms=LONG_TIMEOUT_MS,
            temperature=0.1)
        data = parse_json(raw, {}) or {}
        return [item for item in (clean_item(r) for r in data.get("items") or []) if item]

    results = await asyncio.gather(*[one(i, p) for i, p in enumerate(pieces, 1)], return_exceptions=True)
    items, notes = [], []
    for i, result in enumerate(results, 1):
        if isinstance(result, Exception):
            notes.append(f"Excerpt {i} could not be distilled: {str(result)[:200]}")
            continue
        items.extend(result)
    if len(every) > MAX_CHUNKS:
        notes.append(f"Only the first {MAX_CHUNKS} of {len(every)} excerpts were distilled.")
    return items, notes


def describe_vocabulary() -> dict:
    """For the UI: what conditions and effects may name."""
    return {"condition_attributes": {k: list(v) for k, v in CONDITION_ATTRIBUTES.items()},
            "condition_ops": list(CONDITION_OPS),
            "effect_keys": {k: list(v) for k, v in EFFECT_KEYS.items()}}

