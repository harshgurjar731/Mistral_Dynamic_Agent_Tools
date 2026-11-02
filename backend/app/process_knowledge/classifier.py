"""Moved to :mod:`app.process.classifier`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.classifier``.
"""

import sys

from app.process import classifier as _moved

sys.modules[__name__] = _moved
