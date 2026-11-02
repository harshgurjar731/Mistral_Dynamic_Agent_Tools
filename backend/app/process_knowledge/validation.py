"""Moved to :mod:`app.process.validation`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.validation``.
"""

import sys

from app.process import validation as _moved

sys.modules[__name__] = _moved
