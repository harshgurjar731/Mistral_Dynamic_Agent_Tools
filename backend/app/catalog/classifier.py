"""Merged into :mod:`app.catalog.tagging`.

Aliases the old module to the same object so existing imports and patches
keep working. New code imports ``app.catalog.tagging``.
"""

import sys

from app.catalog import tagging as _moved

sys.modules[__name__] = _moved
