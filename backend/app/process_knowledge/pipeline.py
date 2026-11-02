"""Moved to :mod:`app.process.pipeline`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.pipeline``.
"""

import sys

from app.process import pipeline as _moved

sys.modules[__name__] = _moved
