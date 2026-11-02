"""Moved to :mod:`app.process.store`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.store``.
"""

import sys

from app.process import store as _moved

sys.modules[__name__] = _moved
