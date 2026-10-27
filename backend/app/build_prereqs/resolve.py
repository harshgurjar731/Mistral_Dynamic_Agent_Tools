"""
Matching prerequisites against what already exists — the vault, and the Tool
Service's environment — and settling the certain ones without asking.
"""

from __future__ import annotations

import asyncio
import logging

from app.build_prereqs.models import PrereqItem

logger = logging.getLogger(__name__)

#: A candidate this good, and the only one, is certain enough to use unasked.
CERTAIN_SCORE = 0.8


async def attach_candidates(items: list[PrereqItem]) -> None:
    """Fill each vault item's ``candidates``."""
    from app.vault import store as vault

    def work() -> None:
        for item in items:
            if item.in_vault:
                item.candidates = vault.candidates(name=item.name, service=item.service,
                                                   label=item.label, kind=item.secret_kind)
    try:
        await asyncio.to_thread(work)
    except Exception as e:  # noqa: BLE001 — no candidates is a usable answer
        logger.warning("Vault candidates unavailable: %s", e)


def _certain(item: PrereqItem) -> dict | None:
    usable = [c for c in item.candidates if c.get("usable")]
    exact = next((c for c in usable if c["score"] >= 1.0), None)
    if exact:
        return exact
    strong = [c for c in usable if c["score"] >= CERTAIN_SCORE]
    return strong[0] if len(strong) == 1 else None


async def auto_resolve(items: list[PrereqItem], *, use_vault: bool, env_fallback: bool) -> None:
    """Settle what needs no question: a certain vault match, or a name the Tool
    Service's environment already supplies."""
    for item in items:
        if item.settled or not item.in_vault:
            continue
        match = _certain(item) if use_vault else None
        if match:
            settle_vault(item, match["id"], match["name"], auto=True)
    pending = [i for i in items if i.in_vault and not i.settled]
    if not (pending and env_fallback):
        return
    from app.services.tool_resolver import tool_resolver

    status = await tool_resolver.secrets_status([i.name for i in pending]) or {}
    for item in pending:
        info = status.get(item.name) or {}
        if info.get("allowed") and info.get("set"):
            item.status, item.auto, item.secret_name = "environment", True, item.name


def settle_vault(item: PrereqItem, secret_id: str, secret_name: str, *, auto: bool = False) -> None:
    item.status, item.auto = "vault", auto
    item.secret_id, item.secret_name = secret_id, secret_name
    # The code reads the entry by its vault name, whatever the analysis called it.
    item.name = secret_name


def settle_unattended(items: list[PrereqItem]) -> None:
    """Nobody can be asked and the policy is to proceed: build without what is
    missing. A missing credential is deferred — the code is written to read it
    and reports a configuration error until it is added under that name."""
    for item in items:
        if item.settled:
            continue
        if item.in_vault:
            item.status, item.secret_name = "deferred", item.name
        elif item.default:
            item.status, item.value = "answered", item.default
        else:
            item.status = "skipped"
            item.instruction = "Not provided; make a clearly stated, conservative assumption."
