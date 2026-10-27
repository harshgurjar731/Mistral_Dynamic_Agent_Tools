"""
Asking the user to settle prerequisites, and validating what they answer.

The question is a ``decision_required`` event of kind ``prerequisites`` with
the items to settle. The answer's choice is ``continue`` or ``cancel``; with
continue, ``answers`` says how each item was settled:

    {"key": "OPENWEATHER_API_KEY", "action": "vault", "secret_id": "…"}
    {"key": "info_tax_rate",       "action": "text",  "text": "18%"}
    {"key": "ACME_CRM_BASE_URL",   "action": "skip",  "instruction": "Read the CRM export instead"}
    {"key": "SMTP_PASSWORD",       "action": "defer"}

There is no way to send a value through an answer: a credential the user types
is stored in the vault first (``POST /vault/secrets``) and the answer names the
new entry. ``text`` is refused for anything held in the vault.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.build_prereqs.models import PrereqItem

logger = logging.getLogger(__name__)

KIND = "prerequisites"
OPTIONS = ["continue", "cancel"]
ACTIONS = ("vault", "text", "skip", "defer")
#: Times the same question is asked again when an answer could not be used.
MAX_ROUNDS = 3
MAX_TEXT = 2000


def can_ask(ctx: Any) -> bool:
    return callable(getattr(getattr(ctx, "event_queue", None), "ask", None))


def _vault_flags() -> dict:
    try:
        from app.config import settings
        from app.vault import guard

        return {"enabled": bool(settings.VAULT_ENABLED),
                "admin_token_required": guard.required()}
    except Exception:  # noqa: BLE001
        return {"enabled": False, "admin_token_required": False}


async def ask(ctx: Any, items: list[PrereqItem], *, stage: str, title: str, subject: str = "",
              default: str = "continue", problems: Optional[list[str]] = None,
              round_no: int = 1) -> dict:
    """Ask about ``items``; returns the raw answer ``{"choice", "answers"?}``."""
    from app.layers.workflow import plan_control

    question = {
        "title": title,
        "stage": stage,                 # workflow | agent | code
        "subject": subject,             # what is being built, for the dialog's heading
        "items": [i.public() for i in items],
        "problems": problems or [],
        "round": round_no,
        "vault": _vault_flags(),
        "created": plan_control.created(ctx),
        "run_id": getattr(ctx.event_queue, "id", None),
    }
    return await ctx.event_queue.ask(KIND, question, options=OPTIONS, default=default)


async def apply_answers(items: list[PrereqItem], answers: Any) -> list[str]:
    """Settle ``items`` from ``answers``. Returns problems the user must fix; an item
    whose answer is a problem stays pending."""
    from app.build_prereqs.resolve import settle_vault
    from app.vault import store as vault

    by_key = {i.key: i for i in items}
    problems: list[str] = []
    for answer in answers if isinstance(answers, list) else []:
        if not isinstance(answer, dict):
            continue
        item = by_key.get(str(answer.get("key") or ""))
        action = str(answer.get("action") or "")
        if item is None or action not in ACTIONS:
            continue
        if action == "vault":
            ref = str(answer.get("secret_id") or "").strip()
            try:
                entry = await asyncio.to_thread(vault.get_secret, ref) if ref else None
            except Exception:  # noqa: BLE001 — a vanished entry is a problem to report
                entry = None
            if not entry:
                problems.append(f"{item.label}: the chosen vault entry no longer exists.")
            elif not entry["usable"]:
                problems.append(f"{item.label}: vault entry {entry['name']} is {entry['status']}.")
            else:
                settle_vault(item, entry["id"], entry["name"])
        elif action == "text":
            text = str(answer.get("text") or "").strip()[:MAX_TEXT]
            if item.in_vault:
                problems.append(f"{item.label}: store it in the vault — values for code are "
                                f"never passed as plain answers.")
            elif not text:
                problems.append(f"{item.label}: the answer is empty.")
            else:
                item.status, item.value = "answered", text
        elif action == "skip":
            item.status = "skipped"
            item.instruction = str(answer.get("instruction") or "").strip()[:MAX_TEXT]
        elif action == "defer":
            if not item.in_vault:
                problems.append(f"{item.label}: only a credential or URL can be added later.")
            else:
                item.status, item.secret_name = "deferred", item.name
    return problems


def finish_unanswered(items: list[PrereqItem]) -> None:
    """After ``continue``: what the user left untouched is built without, the
    same way an unattended build is."""
    from app.build_prereqs.resolve import settle_unattended

    settle_unattended(items)


async def settle_interactively(ctx: Any, items: list[PrereqItem], *, stage: str, title: str,
                               subject: str = "") -> str:
    """Ask until every item is settled or the user cancels. Returns the choice."""
    problems: list[str] = []
    for round_no in range(1, MAX_ROUNDS + 1):
        pending = [i for i in items if not i.settled]
        if not pending:
            return "continue"
        answer = await ask(ctx, items, stage=stage, title=title, subject=subject,
                           problems=problems, round_no=round_no)
        if str(answer.get("choice")) == "cancel":
            return "cancel"
        problems = await apply_answers(items, answer.get("answers"))
        if not problems:
            break
        if round_no == MAX_ROUNDS:
            logger.info("Prerequisite answers still had problems after %d rounds: %s",
                        MAX_ROUNDS, problems)
    finish_unanswered(items)
    return "continue"
