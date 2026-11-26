"""
Controls and KPIs at two levels — business and technical.

Template v3 splits both sections so each can be filled by the people who own it:

    "controls": {"business": [...], "technical": [...]}
    "kpis":     {"business": [...], "technical": [...]}

Business controls are set by the process owner and are all mandatory: a build
that no step covers one for is flagged. Technical controls describe how the
build must behave (retries, logging, idempotency) and are advisory. Business
KPIs are required; technical KPIs are optional.

v1/v2 documents keep a flat list, where each control carries its own
``mandatory`` flag. Every reader goes through :func:`leveled`, so layers see one
list either way, each v3 item tagged with its ``level``.
"""

from __future__ import annotations

from typing import Any

BUSINESS = "business"
TECHNICAL = "technical"
LEVELS = (BUSINESS, TECHNICAL)

#: Sections that may be split by level.
SECTIONS = ("controls", "kpis")


def is_leveled(value: Any) -> bool:
    """Whether a section uses the v3 ``{business, technical}`` shape."""
    return isinstance(value, dict)


def leveled_with_paths(value: Any, section: str) -> list[tuple[str, dict]]:
    """``[(path, item)]`` for a controls or KPIs section in either shape.

    v3 items are copies tagged with ``level``; controls also get ``mandatory``
    from their level (business: true, technical: false), whatever they say.
    v1/v2 items are returned as they are.
    """
    if isinstance(value, list):
        return [(f"{section}[{i}]", item) for i, item in enumerate(value) if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    out: list[tuple[str, dict]] = []
    for level in LEVELS:
        items = value.get(level)
        if not isinstance(items, list):
            continue
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            tagged = {**item, "level": level}
            if section == "controls":
                tagged["mandatory"] = level == BUSINESS
            out.append((f"{section}.{level}[{i}]", tagged))
    return out


def leveled(value: Any, section: str) -> list[dict]:
    """A controls or KPIs section as one list, in either shape."""
    return [item for _, item in leveled_with_paths(value, section)]
