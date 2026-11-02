"""Moved to :mod:`app.catalog.classifier`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.classifier``.
"""

import sys

from app.catalog import classifier as _moved

sys.modules[__name__] = _moved
