"""Moved to :mod:`app.catalog.autotag`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.catalog.autotag``.
"""

import sys

from app.catalog import autotag as _moved

sys.modules[__name__] = _moved
