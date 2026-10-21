"""
The backend's one settings store — every process (API, worker, scripts) builds
it when ``app.config`` is imported, so all of them read the same overrides.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from app.app_settings.core import SettingsStore

#: Next to sql_app.db. Override with RUNTIME_SETTINGS_PATH (tests, deployments).
_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "runtime_settings.json"

_store: Optional[SettingsStore] = None


def get_store() -> SettingsStore:
    global _store
    if _store is None:
        from app.app_settings.registry import SECTIONS, all_defs

        path = os.environ.get("RUNTIME_SETTINGS_PATH") or _DEFAULT_PATH
        _store = SettingsStore(SECTIONS, all_defs(), path, target="backend")
    return _store


def apply_overrides(settings_obj: Any) -> None:
    """Called from app/config.py right after ``Settings()`` is built."""
    get_store().install(settings_obj)


def override(key: str) -> Optional[str]:
    """A saved override as a string, for readers that only know env vars."""
    store = get_store()
    if key not in store.defs or not store.is_overridden(key):
        return None
    value = store.value(key)
    return None if value is None else str(value)
