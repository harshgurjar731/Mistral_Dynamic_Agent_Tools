"""Moved to :mod:`app.catalog.match`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.match``.
"""

import sys

from app.catalog import match as _moved

sys.modules[__name__] = _moved
