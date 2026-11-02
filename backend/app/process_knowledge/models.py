"""Moved to :mod:`app.process.models`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.models``.
"""

import sys

from app.process import models as _moved

sys.modules[__name__] = _moved
