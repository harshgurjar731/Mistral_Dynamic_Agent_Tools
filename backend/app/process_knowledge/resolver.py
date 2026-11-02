"""Moved to :mod:`app.process.resolver`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.resolver``.
"""

import sys

from app.process import resolver as _moved

sys.modules[__name__] = _moved
