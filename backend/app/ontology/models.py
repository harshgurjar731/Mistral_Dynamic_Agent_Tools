"""Moved to :mod:`app.catalog.models`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.models``.
"""

import sys

from app.catalog import models as _moved

sys.modules[__name__] = _moved
