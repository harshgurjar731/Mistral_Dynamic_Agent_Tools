"""
The prerequisite decision: what does this build need from its user?

One completion on the ``prerequisite_analysis`` route. It sees what is being
built and the vault's catalogue (names and purposes, never values), and lists
only what the platform cannot supply or safely invent.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.build_prereqs.models import CATEGORIES, VAULT_CATEGORIES, PrereqItem
from app.core.decision import decide, parse_json

logger = logging.getLogger(__name__)

#: More than this is a sign the model is listing everything it can think of.
MAX_ITEMS = 12

_SYSTEM = """\
You decide, BEFORE anything is built, what an AI build needs from its user that \
the platform cannot supply or invent. A build that only discovers this after it \
is finished is wasted, so be accurate — but most builds need nothing.

List only what is genuinely required from the USER:
- credential: an API key, token, password, client secret, connection string or
  certificate for a third-party service the work must call for live data or to
  act. NOT for anything a language model does itself (writing, summarising,
  classifying, reasoning, translating) and NOT for pure computation.
- endpoint: the base URL of a service specific to this user — their CRM, their
  internal API, their tenant. Never for a public API with a well-known URL.
- configuration: a non-secret account setting such a service needs (account id,
  region, tenant id, sender address, project id).
{information_rule}
Already provided by the platform — never list these: the Mistral API (models,
agents, document libraries, web search, code interpreter, image generation),
documents the user uploads, and the workflow's run-time input (it arrives when
the workflow runs). A step routed to a connector authenticates through that
connector; list nothing for it.

Prefer a service that needs no credential when it serves the need equally well,
and say how in "alternative" — the user may choose to proceed without the
service, and "alternative" is what the build does then.

For credential, endpoint and configuration items, "name" is the environment-
variable-style name the code will read it by (UPPER_SNAKE_CASE, service first,
e.g. OPENWEATHER_API_KEY, ACME_CRM_BASE_URL). If an entry in the VAULT
CATALOGUE already holds it, use that entry's exact name and set "vault_match" to
it. Two steps that call the same service share one item.

Return ONLY a JSON object:
{{"items": [{{
   "key": "<the name, or info_<snake_case> for an information item>",
   "category": "credential" | "endpoint" | "configuration"{information_category},
   "name": "<UPPER_SNAKE_CASE; omit for information>",
   "label": "<what it is, for a person: 'OpenWeather API key'>",
   "service": "<the service, e.g. 'OpenWeather'; empty for information>",
   "secret_kind": "api_key" | "token" | "password" | "username" | "url" | "connection_string" | "client_id" | "client_secret" | "certificate" | "config" | "other",
   "why": "<one sentence: what part of the work needs it>",
   "used_by": ["<capability id>"],
   "required": true | false,
   "format_hint": "<what a valid value looks like, if known>",
   "alternative": "<how the work could be done without it, or ''>",
   "vault_match": "<exact vault name, or null>",
   "default": "<for information: a sensible default the user can accept, or null>"
}}],
 "reasoning": "<one or two sentences: why these, or why nothing is needed>"}}
At most {max_items} items. Use "items": [] when nothing is needed.
"""

_INFORMATION_RULE = """\
- information: a fact or business rule the work depends on that only the user
  knows and that cannot be safely assumed (a tax rate, an approval threshold, a
  policy limit, a fixed recipient). Not anything the request already states."""


def system_prompt(*, ask_information: bool) -> str:
    return _SYSTEM.format(
        information_rule=_INFORMATION_RULE if ask_information else "",
        information_category=' | "information"' if ask_information else "",
        max_items=MAX_ITEMS,
    )


def _vault_block() -> str:
    try:
        from app.vault import store as vault

        if not vault.enabled():
            return "The vault is switched off: nothing is stored."
        catalogue = vault.catalogue()
    except Exception as e:  # noqa: BLE001 — the analysis works without it
        logger.debug("vault catalogue unavailable: %s", e)
        catalogue = []
    if not catalogue:
        return "(empty — the user has stored nothing yet)"
    return json.dumps(catalogue, indent=1)


def workflow_user_prompt(goal: str, capabilities: list[Any]) -> str:
    steps = [{"id": c.id, "name": c.name, "purpose": c.purpose, "runs_as": c.kind,
              "inputs": c.inputs, "outputs": c.outputs,
              **({"connector": c.connector_id} if c.kind == "connector" and c.connector_id else {})}
             for c in capabilities]
    return (f"BUILDING: a workflow.\n\nGOAL:\n{goal}\n\n"
            "STEPS (runs_as: agent = an LLM agent with tools; activity = deterministic code "
            "that will be generated; connector = an integration through a connector):\n"
            f"{json.dumps(steps, indent=1)}\n\nVAULT CATALOGUE:\n{_vault_block()}")


def tool_user_prompt(task: str, purpose: str) -> str:
    what = ("a workflow activity — deterministic code that runs as one workflow step"
            if purpose == "activity" else "an agent tool — a function an AI agent calls")
    return (f"BUILDING: {what}. Its code will be generated from the request below.\n\n"
            f"REQUEST:\n{task}\n\nVAULT CATALOGUE:\n{_vault_block()}")


def agent_user_prompt(query: str, requirement_block: str) -> str:
    return (f"BUILDING: an agent that answers the request below, given tools generated for "
            f"it if needed.\n\nREQUEST:\n{query}\n\nANALYSED REQUIREMENT:\n{requirement_block}"
            f"\n\nVAULT CATALOGUE:\n{_vault_block()}")


async def analyse(client: Any, *, user: str, ask_information: bool,
                  known_steps: Optional[set[str]] = None) -> tuple[list[PrereqItem], str]:
    """``(items, reasoning)``. Raises on a failed call — the layer decides what then."""
    raw = await decide(client, route="prerequisite_analysis",
                       system=system_prompt(ask_information=ask_information), user=user,
                       phase="build prerequisites")
    data = parse_json(raw, None)
    if not isinstance(data, dict):
        raise ValueError("the prerequisite analysis returned no usable JSON")
    items = parse_items(data.get("items"), ask_information=ask_information,
                        known_steps=known_steps)
    return items, str(data.get("reasoning") or "")[:600]


def _snake(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")[:48]


def parse_items(raw: Any, *, ask_information: bool,
                known_steps: Optional[set[str]] = None) -> list[PrereqItem]:
    """The model's items, cleaned: known categories, valid names, no duplicates."""
    from app.vault import store as vault

    items: list[PrereqItem] = []
    seen: set[str] = set()
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        category = str(entry.get("category") or "").strip().lower()
        if category not in CATEGORIES or (category == "information" and not ask_information):
            continue
        label = str(entry.get("label") or "").strip()[:160]
        kind = str(entry.get("secret_kind") or "").strip().lower()
        if category in VAULT_CATEGORIES:
            name = vault.normalise_name(entry.get("vault_match") or entry.get("name")
                                        or f"{entry.get('service', '')} {label}")
            if not vault.valid_name(name):
                continue
            key = name
            if kind not in vault.KINDS:
                kind = {"endpoint": "url", "configuration": "config"}.get(category, "api_key")
            sensitive = vault.KINDS[kind]["sensitive"]
        else:
            name, kind, sensitive = "", "", False
            key = "info_" + (_snake(entry.get("key") or label) or f"item_{len(items)}")
            key = key.replace("info_info_", "info_")
        if not label or key in seen:
            continue
        seen.add(key)
        used_by = [str(u) for u in (entry.get("used_by") or []) if str(u).strip()]
        if known_steps is not None:
            used_by = [u for u in used_by if u in known_steps]
        default = entry.get("default")
        items.append(PrereqItem(
            key=key, category=category, label=label,
            service=str(entry.get("service") or "").strip()[:120],
            why=str(entry.get("why") or "").strip()[:400], name=name, secret_kind=kind,
            sensitive=sensitive, required=entry.get("required") is not False,
            format_hint=str(entry.get("format_hint") or "").strip()[:200],
            alternative=str(entry.get("alternative") or "").strip()[:400],
            default=str(default).strip()[:400] if default not in (None, "") else "",
            used_by=used_by,
        ))
        if len(items) >= MAX_ITEMS:
            break
    return items
