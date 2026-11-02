"""Moved to :mod:`app.catalog.seed_loader`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.seed_loader``.
"""

import sys

from app.catalog import seed_loader as _moved

sys.modules[__name__] = _moved
