"""Moved to :mod:`app.process.ai`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.process.ai``.
"""

import sys

from app.process import ai as _moved

sys.modules[__name__] = _moved
