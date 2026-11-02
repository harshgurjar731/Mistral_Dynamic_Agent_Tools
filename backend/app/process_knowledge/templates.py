"""Moved to :mod:`app.process.templates`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.templates``.
"""

import sys

from app.process import templates as _moved

sys.modules[__name__] = _moved
