"""
The credential check inside the code pipeline (R4b).

The build-level check works from what the build is *for*; a specification
names the credentials its code will *actually* read. Between writing the
specification and generating code, each name in ``secrets`` must be settled:
already settled for this build, usable in the vault, or supplied by the Tool
Service's environment. Anything else is asked about — or, with nobody to ask,
handled by the unattended policy — before a line of code is generated.

A :class:`CodeCheck` is shared by every need of one build, so a name settled for
one activity is not asked about again for the next, and concurrent needs ask one
at a time.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.build_prereqs import ask, resolve
from app.build_prereqs.models import METADATA_KEY, PrereqItem

logger = logging.getLogger(__name__)

_ENDPOINT_SUFFIXES = ("_URL", "_ENDPOINT", "_HOST", "_BASE", "_URI")
_CONFIG_SUFFIXES = ("_ID", "_REGION", "_TENANT", "_ACCOUNT", "_PROJECT", "_ORG", "_DOMAIN",
                    "_SENDER", "_FROM")


def item_for_name(name: str, *, why: str) -> PrereqItem:
    """A prerequisite item for a bare secret name from a specification."""
    from app.vault import store as vault

    upper = name.upper()
    if upper.endswith(_ENDPOINT_SUFFIXES) or "_URL_" in upper:
        category, kind = "endpoint", "url"
    elif upper.endswith(("_CLIENT_ID",)):
        category, kind = "configuration", "client_id"
    elif upper.endswith(_CONFIG_SUFFIXES):
        category, kind = "configuration", "config"
    else:
        category = "credential"
        kind = ("password" if "PASSWORD" in upper or upper.endswith("_PASS") else
                "client_secret" if "CLIENT_SECRET" in upper else
                "connection_string" if "DSN" in upper or "CONNECTION" in upper else
                "token" if "TOKEN" in upper else "api_key")
    words = name.split("_")
    service = words[0].title() if words else ""
    return PrereqItem(key=name, category=category, name=name, secret_kind=kind,
                      sensitive=vault.KINDS.get(kind, vault.KINDS["other"])["sensitive"],
                      label=" ".join(w.capitalize() if w not in ("API", "URL", "ID") else w
                                     for w in words),
                      service=service, why=why)


class CodeCheck:
    """One build's view of which secret names are settled, and how to ask about more."""

    def __init__(self, ctx: Any = None):
        self.ctx = ctx
        self._lock = asyncio.Lock()
        self._settled: dict[str, PrereqItem] = {}
        if ctx is not None:
            from app.build_prereqs import guidance

            for item in guidance.items(ctx):
                if item.in_vault and item.settled and item.name:
                    self._settled[item.name] = item

    @property
    def can_ask(self) -> bool:
        return self.ctx is not None and ask.can_ask(self.ctx)

    def settled(self, name: str) -> Optional[PrereqItem]:
        return self._settled.get(name)

    async def settle(self, names: list[str], *, subject: str, why: str) -> tuple[str, list[PrereqItem]]:
        """``(choice, items)`` for ``names`` not yet settled. choice: continue | cancel | stop."""
        from app.config import settings

        async with self._lock:
            # Another need may have settled some of these while this one waited.
            todo = [n for n in names if n not in self._settled]
            if not todo:
                return "continue", [self._settled[n] for n in names]
            items = [item_for_name(n, why=why) for n in todo]
            await resolve.attach_candidates(items)
            await resolve.auto_resolve(
                items, use_vault=bool(settings.VAULT_ENABLED and settings.PREREQ_AUTO_USE_VAULT),
                env_fallback=bool(settings.VAULT_ENV_FALLBACK))
            pending = [i for i in items if not i.settled]
            choice = "continue"
            if pending and self.can_ask:
                choice = await ask.settle_interactively(
                    self.ctx, items, stage="code", subject=subject,
                    title=f"'{subject}' needs {len(pending)} credential(s) the first check did "
                          f"not find")
            elif pending and settings.PREREQ_UNATTENDED_POLICY == "stop":
                choice = "stop"
            else:
                resolve.settle_unattended(items)
            if choice == "continue":
                for item in items:
                    # Under the name the spec used: a vault pick may have renamed it.
                    self._settled[item.key] = item
                self._remember(items, subject)
            by_key = {i.key: i for i in items}
            return choice, [self._settled.get(n) or by_key[n] for n in names]

    def _remember(self, items: list[PrereqItem], subject: str) -> None:
        """Add to the build's prerequisites, for the timeline and later prompts."""
        if self.ctx is None:
            return
        record = self.ctx.metadata.setdefault(METADATA_KEY, {"items": [], "stage": "code"})
        known = {i.get("key") for i in record.get("items") or []}
        for item in items:
            if item.key not in known:
                record.setdefault("items", []).append(item.as_dict())
        # Its own event name, so the timeline files it under the layer that was
        # building code (activity_gap, capability_gap), not the build-level check.
        self.ctx.emit("code_prerequisites", {"stage": "code", "subject": subject,
                                             "asked": self.can_ask,
                                             "items": [i.public() for i in items]})
