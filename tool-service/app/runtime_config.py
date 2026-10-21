"""
Runtime configuration — setting definitions, persisted overrides, effective values.

One value per setting, resolved in this order:

1. an override saved from the Settings page (``runtime_settings.json``),
2. the environment / ``.env`` (what ``Settings()`` loaded at boot),
3. the built-in default in code.

"Reset to default" removes the override, so the value falls back to 2, then 3.

Settings that are fields of the pydantic ``Settings`` object are written back
onto it, so every existing ``settings.X`` read picks the new value up on its
next call. Settings that are not fields (the model routes) are read through
:meth:`SettingsStore.value`.

A setting marked ``apply="restart"`` is saved at once but only takes effect
when the process starts again — the database URL, the Neo4j driver and the
worker subprocess are built once.

This module has no imports from the application on purpose: the backend
carries an identical copy (``backend/app/app_settings/core.py``). Keep the
two in step.
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    description: str
    icon: str = "settings"


@dataclass(frozen=True)
class SettingDef:
    key: str
    section: str
    label: str
    description: str
    #: string | int | float | bool | enum | model | model_list | secret
    type: str = "string"
    #: None: the default of the ``Settings`` field of the same name.
    default: Any = None
    #: Where the value is read — shown on the Settings page.
    used_in: tuple[str, ...] = ()
    #: live | restart
    apply: str = "live"
    editable: bool = True
    options: tuple[str, ...] = ()
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    #: For model settings: the catalog capability the model needs
    #: (chat, function_calling, moderation, ...).
    capability: Optional[str] = None
    #: Rows that belong together (one model route = model, effort, timeout, fallback).
    group: Optional[str] = None
    #: A model setting that also accepts "none" (no fallback model).
    allow_none: bool = False


_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def coerce(defn: SettingDef, raw: Any) -> Any:
    """``raw`` as the setting's type, or ValueError with a message worth showing."""
    t = defn.type
    if t == "bool":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in _TRUE:
            return True
        if text in _FALSE:
            return False
        raise ValueError(f"{defn.label}: expected true or false")
    if t in ("int", "float"):
        try:
            number = int(raw) if t == "int" else float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{defn.label}: expected a number") from None
        if t == "int" and isinstance(raw, float) and not raw.is_integer():
            raise ValueError(f"{defn.label}: expected a whole number")
        if defn.minimum is not None and number < defn.minimum:
            raise ValueError(f"{defn.label}: must be at least {defn.minimum:g}")
        if defn.maximum is not None and number > defn.maximum:
            raise ValueError(f"{defn.label}: must be at most {defn.maximum:g}")
        return number
    if t == "enum":
        text = str(raw).strip()
        if text not in defn.options:
            raise ValueError(f"{defn.label}: must be one of {', '.join(defn.options)}")
        return text
    if t == "model_list":
        items = raw.split(",") if isinstance(raw, str) else list(raw or [])
        seen: list[str] = []
        for item in items:
            name = str(item).strip()
            if name and name not in seen:
                seen.append(name)
        if not seen:
            raise ValueError(f"{defn.label}: choose at least one model")
        return seen
    text = "" if raw is None else str(raw).strip()
    if t == "model":
        if not text:
            raise ValueError(f"{defn.label}: a model is required")
        if text.lower() == "none":
            if not defn.allow_none:
                raise ValueError(f"{defn.label}: a model is required")
            return "none"
    return text


class SettingsStore:
    """Definitions + overrides for one service."""

    def __init__(self, sections: Iterable[Section], defs: Iterable[SettingDef],
                 path: str | os.PathLike, target: str):
        self.sections = list(sections)
        self.defs = {d.key: d for d in defs}
        self.path = Path(path)
        self.target = target
        self._settings: Any = None
        self._overrides: dict[str, Any] = {}
        self._baseline: dict[str, Any] = {}
        self._builtin: dict[str, Any] = {}
        self._running: dict[str, Any] = {}
        self._updated_at: Optional[float] = None
        self._lock = threading.RLock()
        self._load()

    # ── persistence ────────────────────────────────────────────────────
    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        overrides = data.get("overrides") if isinstance(data, dict) else None
        if not isinstance(overrides, dict):
            return
        for key, raw in overrides.items():
            defn = self.defs.get(key)
            if defn is None:
                continue  # a setting that no longer exists
            try:
                self._overrides[key] = coerce(defn, raw)
            except ValueError:
                continue  # an invalid saved value must not stop the service
        self._updated_at = data.get("updated_at")

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._updated_at = time.time()
        payload = {"version": 1, "updated_at": self._updated_at, "overrides": self._overrides}
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp, self.path)

    # ── the settings object ────────────────────────────────────────────
    def _is_field(self, key: str) -> bool:
        fields = getattr(type(self._settings), "model_fields", None) or {}
        return key in fields

    def _from_attr(self, defn: SettingDef, value: Any) -> Any:
        if defn.type == "model_list" and isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    def _to_attr(self, defn: SettingDef, value: Any) -> Any:
        if defn.type == "model_list" and isinstance(value, list):
            return ",".join(value)
        return value

    def install(self, settings_obj: Any) -> None:
        """Snapshot the boot values, then apply every saved override.

        Called once at import time, so restart-only overrides apply here too:
        this *is* the start.
        """
        with self._lock:
            self._settings = settings_obj
            fields = getattr(type(settings_obj), "model_fields", None) or {}
            for key, defn in self.defs.items():
                if key in fields:
                    builtin = defn.default if defn.default is not None else fields[key].default
                    baseline = self._from_attr(defn, getattr(settings_obj, key))
                else:
                    builtin = defn.default
                    env = os.environ.get(key)
                    baseline = builtin
                    if env is not None and env.strip():
                        try:
                            baseline = coerce(defn, env)
                        except ValueError:
                            pass
                self._builtin[key] = self._from_attr(defn, builtin)
                self._baseline[key] = baseline
                if key in self._overrides and key in fields:
                    setattr(settings_obj, key, self._to_attr(defn, self._overrides[key]))
                self._running[key] = self.value(key)

    # ── reads ──────────────────────────────────────────────────────────
    def value(self, key: str) -> Any:
        with self._lock:
            if key in self._overrides:
                return self._overrides[key]
            return self._baseline.get(key, self.defs[key].default if key in self.defs else None)

    def is_overridden(self, key: str) -> bool:
        return key in self._overrides

    def describe(self, key: str) -> dict:
        defn = self.defs[key]
        value = self.value(key)
        baseline = self._baseline.get(key)
        builtin = self._builtin.get(key)
        if key in self._overrides:
            source = "override"
        elif baseline != builtin:
            source = "env"
        else:
            source = "default"
        secret = defn.type == "secret"
        return {
            "key": key,
            "target": self.target,
            "section": defn.section,
            "label": defn.label,
            "description": defn.description,
            "type": defn.type,
            "value": ("••••••••" if value else "") if secret else value,
            "is_set": bool(value),
            "default": ("••••••••" if baseline else "") if secret else baseline,
            "builtin_default": None if secret else builtin,
            "source": source,
            "apply": defn.apply,
            "restart_pending": defn.apply == "restart" and value != self._running.get(key),
            "editable": defn.editable and not secret,
            "used_in": list(defn.used_in),
            "options": list(defn.options),
            "min": defn.minimum,
            "max": defn.maximum,
            "capability": defn.capability,
            "group": defn.group,
            "allow_none": defn.allow_none,
        }

    def export(self) -> dict:
        by_section: dict[str, list[dict]] = {s.id: [] for s in self.sections}
        for key, defn in self.defs.items():
            by_section.setdefault(defn.section, []).append(self.describe(key))
        return {
            "target": self.target,
            "updated_at": self._updated_at,
            "sections": [
                {"id": s.id, "title": s.title, "description": s.description,
                 "icon": s.icon, "target": self.target, "settings": by_section.get(s.id, [])}
                for s in self.sections
            ],
        }

    # ── writes ─────────────────────────────────────────────────────────
    def _apply_live(self, key: str) -> None:
        defn = self.defs[key]
        if defn.apply == "live" and self._settings is not None and self._is_field(key):
            setattr(self._settings, key, self._to_attr(defn, self.value(key)))

    def update(self, values: dict[str, Any]) -> list[str]:
        """Validate every value first, then save them together."""
        unknown = [k for k in values if k not in self.defs]
        if unknown:
            raise ValueError(f"Unknown setting(s): {', '.join(sorted(unknown))}")
        cleaned: dict[str, Any] = {}
        for key, raw in values.items():
            defn = self.defs[key]
            if not defn.editable or defn.type == "secret":
                raise ValueError(f"{defn.label} can only be changed in the environment (.env)")
            cleaned[key] = coerce(defn, raw)
        with self._lock:
            changed = []
            for key, value in cleaned.items():
                if value == self._baseline.get(key):
                    # Same as the default: no override needed.
                    if self._overrides.pop(key, None) is not None:
                        changed.append(key)
                elif self._overrides.get(key) != value:
                    self._overrides[key] = value
                    changed.append(key)
            if changed:
                self._save()
                for key in changed:
                    self._apply_live(key)
            return changed

    def reset(self, keys: Optional[Iterable[str]] = None, section: Optional[str] = None) -> list[str]:
        """Drop overrides — all, one section's, or the named keys."""
        with self._lock:
            if keys is not None:
                targets = [k for k in keys if k in self._overrides]
            elif section is not None:
                targets = [k for k in self._overrides if self.defs[k].section == section]
            else:
                targets = list(self._overrides)
            for key in targets:
                self._overrides.pop(key, None)
            if targets:
                self._save()
                for key in targets:
                    self._apply_live(key)
            return targets
