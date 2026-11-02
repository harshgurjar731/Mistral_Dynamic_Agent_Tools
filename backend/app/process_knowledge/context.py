"""Moved to :mod:`app.process.context`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.context``.
"""

import sys

from app.process import context as _moved

sys.modules[__name__] = _moved
