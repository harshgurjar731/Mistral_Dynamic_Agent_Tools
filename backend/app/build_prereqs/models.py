"""What a build needs from its user, and how each need was settled."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

#: credential / endpoint / configuration are held in the vault; information is a
#: fact given in the answer itself.
CATEGORIES = ("credential", "endpoint", "configuration", "information")
VAULT_CATEGORIES = ("credential", "endpoint", "configuration")

#: pending   — not settled yet
#: vault     — a vault entry supplies it (``secret_name``)
#: answered  — the user gave the fact (``value``; information items only)
#: skipped   — proceed without it (``instruction``: what to do instead)
#: environment — the Tool Service's environment supplies it (allow-listed there)
#: deferred  — build anyway; the code reports a configuration error until it
#:             is added to the vault under ``secret_name``
STATUSES = ("pending", "vault", "environment", "answered", "skipped", "deferred")

#: Kept in ``ctx.metadata`` under this key.
METADATA_KEY = "build_prerequisites"


@dataclass
class PrereqItem:
    key: str
    category: str = "credential"
    label: str = ""
    service: str = ""
    why: str = ""
    #: The name code reads it by (vault categories), UPPER_SNAKE_CASE.
    name: str = ""
    secret_kind: str = "api_key"
    sensitive: bool = True
    required: bool = True
    format_hint: str = ""
    #: How the work could be done without it, if at all.
    alternative: str = ""
    #: A sensible value for an information item, offered as the answer's default.
    default: str = ""
    #: Capability ids (workflow) that need it; empty = the whole build.
    used_by: list[str] = field(default_factory=list)
    #: Vault entries that could satisfy it, best first (see vault.store.candidates).
    candidates: list[dict] = field(default_factory=list)

    status: str = "pending"
    #: True when resolved without asking (certain vault match).
    auto: bool = False
    secret_id: Optional[str] = None
    secret_name: Optional[str] = None
    #: An information item's answer. Never set for a vault category.
    value: Optional[str] = None
    instruction: str = ""

    @property
    def in_vault(self) -> bool:
        return self.category in VAULT_CATEGORIES

    @property
    def settled(self) -> bool:
        return self.status != "pending"

    def as_dict(self) -> dict:
        return asdict(self)

    def public(self) -> dict:
        """For the question and the timeline: no value of a vault category, ever."""
        out = self.as_dict()
        if self.in_vault:
            out["value"] = None
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "PrereqItem":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in (data or {}).items() if k in known})


def summary(items: list[PrereqItem]) -> dict:
    counts = {s: 0 for s in STATUSES}
    for item in items:
        counts[item.status] = counts.get(item.status, 0) + 1
    return counts
