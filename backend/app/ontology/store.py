"""Moved to :mod:`app.catalog.store`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.store``.
"""

import sys

from app.catalog import store as _moved

sys.modules[__name__] = _moved
