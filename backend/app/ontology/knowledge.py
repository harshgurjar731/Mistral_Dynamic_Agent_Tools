"""Moved to :mod:`app.knowledge.reference`.

Aliases the old import path to the same module object, so existing imports,
patches and SQLAlchemy models keep working. New code imports ``app.knowledge.reference``.
"""

import sys

from app.knowledge import reference as _moved

sys.modules[__name__] = _moved
