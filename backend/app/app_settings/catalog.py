"""
The Mistral model catalog — read live from Mistral's ``GET /v1/models``.

That endpoint is the authoritative list of what the account can call: ids,
aliases, capabilities, context length, default temperature and deprecation
(with the replacement Mistral names). It is cached to ``model_catalog.json``
so the Settings page works offline and between refreshes.

After every refresh :func:`review` checks each configured model — backend and
Tool Service — against it, and, with AUTO_UPGRADE_DEPRECATED_MODELS on,
switches a deprecated model to its replacement.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_PATH = Path(__file__).resolve().parents[2] / "model_catalog.json"
_lock = asyncio.Lock()

#: Capability a setting asks for → the catalog flag that satisfies it.
_CAPABILITY_FLAG = {
    "chat": "completion_chat",
    "function_calling": "function_calling",
    "moderation": "moderation",
    "ocr": "ocr",
    "vision": "vision",
    "reasoning": "reasoning",
}


def _path() -> Path:
    return Path(os.environ.get("MODEL_CATALOG_PATH") or _PATH)


def _normalise(card: dict) -> dict:
    caps = card.get("capabilities") or {}
    return {
        "id": card.get("id"),
        "name": card.get("name") or None,
        "description": card.get("description") or None,
        "type": card.get("type") or "base",
        "owned_by": card.get("owned_by"),
        "created": card.get("created"),
        "max_context_length": card.get("max_context_length"),
        "aliases": list(card.get("aliases") or []),
        "deprecation": card.get("deprecation"),
        "deprecation_replacement_model": card.get("deprecation_replacement_model"),
        "default_model_temperature": card.get("default_model_temperature"),
        "capabilities": {k: bool(v) for k, v in caps.items() if isinstance(v, bool)},
    }


def load() -> dict:
    """The cached catalog, or an empty one that says it was never fetched."""
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("models"), list):
            return data
    except (OSError, ValueError):
        pass
    return {"fetched_at": None, "source": None, "models": [], "error": None}


def _save(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def index(catalog: Optional[dict] = None) -> dict[str, dict]:
    """Every id *and* alias → its card."""
    catalog = catalog or load()
    out: dict[str, dict] = {}
    for card in catalog.get("models", []):
        if card.get("id"):
            out.setdefault(card["id"], card)
        for alias in card.get("aliases") or []:
            out.setdefault(alias, card)
    return out


def _parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def model_status(model: str, capability: Optional[str] = None,
                 idx: Optional[dict] = None) -> dict:
    """ok | unknown | deprecated | retired | incapable — plus a message."""
    idx = idx if idx is not None else index()
    if not idx:
        return {"status": "unchecked", "message": "Catalog not fetched yet"}
    card = idx.get(model)
    if card is None:
        return {"status": "unknown",
                "message": f"'{model}' is not in the Mistral model list for this account"}
    replacement = card.get("deprecation_replacement_model")
    when = _parse_date(card.get("deprecation"))
    if when is not None:
        retired = when <= datetime.now(timezone.utc)
        return {
            "status": "retired" if retired else "deprecated",
            "deprecation": card.get("deprecation"),
            "replacement": replacement,
            "message": (f"'{model}' {'was retired' if retired else 'is deprecated, retiring'} "
                        f"on {when.date().isoformat()}"
                        + (f" — Mistral recommends '{replacement}'" if replacement else "")),
        }
    flag = _CAPABILITY_FLAG.get(capability or "")
    if flag and not (card.get("capabilities") or {}).get(flag):
        return {"status": "incapable",
                "message": f"'{model}' does not support {capability.replace('_', ' ')}"}
    return {"status": "ok", "message": ""}


async def fetch() -> dict:
    """Read /v1/models from Mistral and cache it. Raises on failure."""
    key = settings.MISTRAL_API_KEY
    if not key or key == "your_mistral_api_key_here":
        raise RuntimeError("MISTRAL_API_KEY is not set — cannot read the model list")
    url = f"{settings.MISTRAL_API_BASE_URL.rstrip('/')}/v1/models"
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.get(url, headers={"Authorization": f"Bearer {key}"})
    if resp.status_code != 200:
        raise RuntimeError(f"Mistral returned {resp.status_code}: {resp.text[:300]}")
    cards = resp.json().get("data") or []
    models = sorted((_normalise(c) for c in cards if c.get("id")), key=lambda c: c["id"])
    return {"fetched_at": time.time(), "source": url, "models": models, "error": None}


async def refresh() -> dict:
    """Fetch, diff against the cached copy, save, then review configured models."""
    async with _lock:
        previous = {m["id"] for m in load().get("models", [])}
        try:
            data = await fetch()
        except Exception as e:
            stale = load()
            stale["error"] = str(e)
            stale["error_at"] = time.time()
            _save(stale)
            raise
        _save(data)
        current = {m["id"] for m in data["models"]}
        report = await review(apply=settings.AUTO_UPGRADE_DEPRECATED_MODELS)
        report.update({
            "fetched_at": data["fetched_at"],
            "model_count": len(current),
            "added": sorted(current - previous) if previous else [],
            "removed": sorted(previous - current) if previous else [],
        })
        logger.info("Model catalog refreshed: %d models, %d issue(s), %d upgraded",
                    len(current), len(report["issues"]), len(report["upgraded"]))
        return report


async def review(apply: bool = False) -> dict:
    """Check every configured model; with ``apply``, upgrade deprecated ones."""
    from app.app_settings import tool_service
    from app.app_settings.store import get_store

    idx = index()
    issues: list[dict] = []
    upgrades: dict[str, dict[str, Any]] = {"backend": {}, "tool_service": {}}

    def check(target: str, key: str, label: str, model: Any, capability: Optional[str]):
        names = model if isinstance(model, list) else [model]
        for name in names:
            if not name or name == "none":
                continue
            st = model_status(name, capability, idx)
            if st["status"] in ("ok", "unchecked"):
                continue
            issues.append({"target": target, "key": key, "label": label, "model": name, **st})
            if st.get("replacement") and not isinstance(model, list):
                upgrades[target][key] = st["replacement"]

    store = get_store()
    for key, defn in store.defs.items():
        if defn.type in ("model", "model_list"):
            check("backend", key, defn.label, store.value(key), defn.capability)

    try:
        remote = await tool_service.get_settings()
        for section in remote.get("sections", []):
            for item in section.get("settings", []):
                if item.get("type") in ("model", "model_list"):
                    check("tool_service", item["key"], item.get("label") or item["key"],
                          item.get("value"), item.get("capability"))
    except Exception as e:
        logger.info("Catalog review skipped the Tool Service: %s", e)

    upgraded: list[dict] = []
    if apply:
        if upgrades["backend"]:
            store.update(upgrades["backend"])
        if upgrades["tool_service"]:
            try:
                await tool_service.update(upgrades["tool_service"])
            except Exception as e:
                logger.warning("Could not upgrade Tool Service models: %s", e)
                upgrades["tool_service"] = {}
        upgraded = [{"target": t, "key": k, "model": v}
                    for t, changes in upgrades.items() for k, v in changes.items()]
    return {"issues": issues, "upgraded": upgraded}


def is_stale() -> bool:
    hours = float(settings.MODEL_CATALOG_REFRESH_HOURS or 0)
    if hours <= 0:
        return False
    fetched = load().get("fetched_at")
    return not fetched or (time.time() - float(fetched)) > hours * 3600


async def refresh_loop() -> None:
    """Background task: refresh whenever the cached catalog goes stale."""
    while True:
        try:
            if is_stale():
                await refresh()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Model catalog refresh failed: %s", e)
        # Re-check hourly, so a changed interval applies without a restart.
        await asyncio.sleep(3600)
