"""
What later decisions and specifications are told about the settled prerequisites.

Two renderings of the same facts:

* :func:`block` — a prompt section for design decisions (which tools and
  connectors, an agent's instructions, the data flow);
* :func:`code_guidance` — lines added to a ``CodeNeed``'s guidance, which the
  specification author must follow: the exact vault names to list in
  ``secrets`` and read from ``kwargs["_secrets"]``, the services not to use.

Both are empty when the check did not run or found nothing, so prompts are
unchanged for a build that needs nothing from its user.
"""

from __future__ import annotations

from typing import Any, Optional

from app.build_prereqs.models import METADATA_KEY, PrereqItem


def items(ctx: Any) -> list[PrereqItem]:
    raw = ((getattr(ctx, "metadata", None) or {}).get(METADATA_KEY) or {}).get("items") or []
    return [PrereqItem.from_dict(r) for r in raw if isinstance(r, dict)]


def _applies(item: PrereqItem, capability_id: Optional[str]) -> bool:
    return capability_id is None or not item.used_by or capability_id in item.used_by


def _line(item: PrereqItem, *, for_code: bool) -> str:
    what = f"{item.label}" + (f" ({item.service})" if item.service else "")
    if item.status in ("vault", "environment", "deferred") and item.in_vault:
        where = {"vault": "is stored in the platform vault",
                 "environment": "is supplied by the platform at run time",
                 "deferred": "will be added to the platform vault later"}[item.status]
        if for_code:
            kind = ("base URL" if item.category == "endpoint"
                    else "setting" if item.category == "configuration" else "credential")
            return (f"{what} {where} as `{item.secret_name or item.name}`. List "
                    f"\"{item.secret_name or item.name}\" in \"secrets\" and read the {kind} from "
                    f"kwargs['_secrets']['{item.secret_name or item.name}']; never hard-code or "
                    f"invent it, and return a configuration_error envelope when it is absent.")
        return f"{what} {where}; the code that calls {item.service or 'it'} receives it."
    if item.status == "answered":
        return f"The user stated — {item.label}: {item.value}"
    if item.status == "skipped":
        instead = item.instruction or item.alternative
        if item.in_vault:
            return (f"Do NOT use {item.service or item.label}: the user chose to proceed without "
                    f"it ({item.label} is not available)."
                    + (f" Instead: {instead}" if instead else
                       " Do the work another way, or say plainly that this part cannot be done."))
        return (f"{item.label} was not provided."
                + (f" Instead: {instead}" if instead else
                   " Make a clearly stated, conservative assumption."))
    return ""


def block(ctx: Any, capability_id: Optional[str] = None) -> str:
    """A prompt section; "" when there is nothing to say."""
    lines = [_line(i, for_code=False) for i in items(ctx) if _applies(i, capability_id)]
    lines = [l for l in lines if l]
    if not lines:
        return ""
    return ("\n\n## Build prerequisites (settled with the user before building — follow them)\n"
            + "\n".join(f"- {l}" for l in lines))


def code_guidance(ctx: Any, capability_id: Optional[str] = None) -> list[str]:
    """Lines for ``CodeNeed.guidance``."""
    return [l for l in (_line(i, for_code=True) for i in items(ctx) if _applies(i, capability_id))
            if l]


def settled_names(ctx: Any) -> dict[str, str]:
    """Names the user already settled, and how — so the code check does not ask again."""
    return {i.name: i.status for i in items(ctx) if i.in_vault and i.settled and i.name}
