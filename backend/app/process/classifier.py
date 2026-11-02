"""
Where a process document belongs — now :func:`app.catalog.tagging.place_document`.

Kept as the process package's name for it, so ``classifier.classify`` keeps
meaning "place this document" here.
"""

from app.catalog.tagging import (  # noqa: F401
    place_document as classify,
    place_from_document as from_document,
    place_from_goal as from_goal,
)
