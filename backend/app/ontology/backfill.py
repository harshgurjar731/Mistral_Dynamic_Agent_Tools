"""Moved to :mod:`app.catalog.backfill`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.backfill``.
"""

import sys

from app.catalog import backfill as _moved

sys.modules[__name__] = _moved
