"""
Runtime configuration — setting definitions, persisted overrides, effective values.

One value per setting, resolved in this order:

1. an override saved from the Settings page (``runtime_settings.json``),
2. the environment / ``.env`` (what ``Settings()`` loaded at boot),
3. the built-in default in code.

"Reset to default" removes the override, so the value falls back to 2, then 3.

Settings that are fields of the pydantic ``Settings`` object are written back
onto it, so every existing ``settings.X`` read picks the new value up on its
next call. Settings that are not fields (model routes, frontend options) are
read through :meth:`SettingsStore.value`.

Every process that builds a store (the API, the workflows worker, each Tool
Service worker) watches the overrides file, so a change saved by one process
reaches the others within a couple of seconds. ``on_change`` hooks rebuild
whatever was built from a value (an HTTP client, a database driver).

A setting marked ``apply="restart"`` is saved at once but only takes effect
when the process starts again.

This module has no imports from the application on purpose: the tool service
carries an identical copy (``tool-service/app/runtime_config.py``). Keep the
two in step.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

logger = logging.getLogger(__name__)

#: How often each process checks the overrides file for changes made elsewhere.
WATCH_INTERVAL_SECONDS = 2.0


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    description: str
    icon: str = "settings"
    #: The Settings page groups sections under these: models | tool_service |
    #: platform | frontend.
    category: str = "platform"


@dataclass(frozen=True)
class SettingDef:
    key: str
    section: str
    label: str
    description: str
    #: string | int | float | bool | enum | model | model_list | secret | json
    type: str = "string"
    #: None: the default of the ``Settings`` field of the same name.
    default: Any = None
    #: Code locations that read the value — shown on the Settings page.
    used_in: tuple[str, ...] = ()
    #: What a user sees change — plain-language areas of the product.
    impact: tuple[str, ...] = ()
    #: live | restart
    apply: str = "live"
    editable: bool = True
    options: tuple[str, ...] = ()
    #: Display labels for ``options``, as (value, label) pairs.
    option_labels: tuple[tuple[str, str], ...] = ()
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    unit: Optional[str] = None
    #: For model settings: the catalog capability the model should have
    #: (chat, function_calling, moderation, ...). A recommendation, not a filter.
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
    if t == "json":
        # Kept as compact JSON text, so every caller sees one string shape.
        if isinstance(raw, (dict, list)):
            return json.dumps(raw, separators=(",", ":"))
        text = "" if raw is None else str(raw).strip()
        if not text:
            return ""
        try:
            return json.dumps(json.loads(text), separators=(",", ":"))
        except ValueError:
            raise ValueError(f"{defn.label}: not valid JSON") from None
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
                 path: str | os.PathLike, target: str, watch: bool = True):
        self.sections = list(sections)
        self.defs = {d.key: d for d in defs}
        self.path = Path(path)
        self.target = target
        self.watch = watch
        self._settings: Any = None
        self._overrides: dict[str, Any] = {}
        self._baseline: dict[str, Any] = {}
        self._builtin: dict[str, Any] = {}
        self._running: dict[str, Any] = {}
        self._hooks: list[tuple[frozenset[str], Callable[[], None]]] = []
        self._updated_at: Optional[float] = None
        self._mtime: Optional[float] = None
        self._watcher: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self._overrides = self._read()

    # ── persistence ────────────────────────────────────────────────────
    def _file_mtime(self) -> Optional[float]:
        try:
            return self.path.stat().st_mtime
        except OSError:
            return None

    def _read(self) -> dict[str, Any]:
        self._mtime = self._file_mtime()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        overrides = data.get("overrides") if isinstance(data, dict) else None
        if not isinstance(overrides, dict):
            return {}
        out: dict[str, Any] = {}
        for key, raw in overrides.items():
            defn = self.defs.get(key)
            if defn is None:
                continue  # a setting that no longer exists
            try:
                out[key] = coerce(defn, raw)
            except ValueError:
                continue  # an invalid saved value must not stop the service
        self._updated_at = data.get("updated_at")
        return out

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._updated_at = time.time()
        payload = {"version": 1, "updated_at": self._updated_at, "overrides": self._overrides}
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp, self.path)
        self._mtime = self._file_mtime()

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
        if self.watch and self._watcher is None:
            self._watcher = threading.Thread(target=self._watch, name="settings-watch", daemon=True)
            self._watcher.start()

    def on_change(self, keys: Iterable[str], fn: Callable[[], None]) -> None:
        """Call ``fn`` whenever one of ``keys`` changes in this process."""
        self._hooks.append((frozenset(keys), fn))

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
            "impact": list(defn.impact),
            "options": list(defn.options),
            "option_labels": dict(defn.option_labels),
            "min": defn.minimum,
            "max": defn.maximum,
            "unit": defn.unit,
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
                 "icon": s.icon, "category": s.category, "target": self.target,
                 "settings": by_section.get(s.id, [])}
                for s in self.sections
            ],
        }

    # ── writes ─────────────────────────────────────────────────────────
    def _apply_live(self, keys: Iterable[str]) -> None:
        keys = list(keys)
        for key in keys:
            defn = self.defs[key]
            if defn.apply == "live" and self._settings is not None and self._is_field(key):
                setattr(self._settings, key, self._to_attr(defn, self.value(key)))
        changed = set(keys)
        for watched, fn in self._hooks:
            if watched & changed:
                try:
                    fn()
                except Exception as e:  # a hook must never fail a save
                    logger.warning("Settings hook for %s failed: %s", sorted(watched), e)

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
                self._apply_live(changed)
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
                self._apply_live(targets)
            return targets

    # ── changes made by other processes ────────────────────────────────
    def sync(self) -> list[str]:
        """Re-read the file if another process changed it; apply what differs."""
        with self._lock:
            if self._file_mtime() == self._mtime:
                return []
            before = dict(self._overrides)
            self._overrides = self._read()
            changed = [k for k in set(before) | set(self._overrides)
                       if before.get(k) != self._overrides.get(k)]
            if changed:
                self._apply_live(changed)
            return changed

    def _watch(self) -> None:
        while True:
            time.sleep(WATCH_INTERVAL_SECONDS)
            try:
                changed = self.sync()
                if changed:
                    logger.info("Settings changed elsewhere, applied: %s", ", ".join(sorted(changed)))
            except Exception as e:
                logger.debug("Settings watch: %s", e)
