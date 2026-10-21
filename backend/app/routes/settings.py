"""
Settings — every configurable value of the backend and the Tool Service in one
place, plus the Mistral model catalog they are checked against.
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.app_settings import catalog, tool_service
from app.app_settings.store import get_store
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["Settings"])

Target = Literal["backend", "tool_service"]


class UpdateRequest(BaseModel):
    backend: dict[str, Any] = {}
    tool_service: dict[str, Any] = {}


class ResetRequest(BaseModel):
    #: None: both services.
    target: Optional[Target] = None
    section: Optional[str] = None
    keys: Optional[list[str]] = None


def _with_status(sections: list[dict], idx: dict) -> list[dict]:
    for section in sections:
        for item in section.get("settings", []):
            if item.get("type") not in ("model", "model_list"):
                continue
            values = item["value"] if isinstance(item["value"], list) else [item["value"]]
            item["model_status"] = {
                v: catalog.model_status(v, item.get("capability"), idx)
                for v in values if v and v != "none"
            }
    return sections


def _catalog_meta() -> dict:
    data = catalog.load()
    return {
        "fetched_at": data.get("fetched_at"),
        "source": data.get("source"),
        "model_count": len(data.get("models", [])),
        "error": data.get("error"),
        "error_at": data.get("error_at"),
        "refresh_hours": settings.MODEL_CATALOG_REFRESH_HOURS,
    }


async def _payload() -> dict:
    idx = catalog.index()
    backend = get_store().export()
    sections = _with_status(backend["sections"], idx)

    remote: dict = {"reachable": False, "error": None, "url": settings.TOOL_SERVICE_URL}
    try:
        ts = await tool_service.get_settings()
        sections += _with_status(ts.get("sections", []), idx)
        remote["reachable"] = True
    except Exception as e:
        remote["error"] = str(e) or type(e).__name__

    pending = any(item.get("restart_pending") for s in sections for item in s["settings"])
    return {
        "sections": sections,
        "tool_service": remote,
        "catalog": _catalog_meta(),
        "restart_pending": pending,
    }


@router.get("")
async def get_settings():
    return await _payload()


@router.put("")
async def update_settings(body: UpdateRequest):
    changed: dict[str, list[str]] = {"backend": [], "tool_service": []}
    store = get_store()
    # What to put back if the Tool Service half fails, so one save never
    # leaves the two services half-applied.
    previous = {k: store.value(k) for k in body.backend if k in store.defs and store.is_overridden(k)}
    try:
        if body.backend:
            changed["backend"] = store.update(body.backend)
        if body.tool_service:
            result = await tool_service.update(body.tool_service)
            changed["tool_service"] = result.get("changed", [])
    except Exception as e:
        if changed["backend"]:
            store.reset(keys=[k for k in changed["backend"] if k not in previous])
            store.update({k: v for k, v in previous.items() if k in changed["backend"]})
        if isinstance(e, ValueError):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=502, detail=f"Tool Service: {e}")
    logger.info("Settings updated: %s", changed)
    return {"changed": changed, **(await _payload())}


@router.post("/reset")
async def reset_settings(body: ResetRequest):
    reset: dict[str, list[str]] = {"backend": [], "tool_service": []}
    if body.target in (None, "backend"):
        reset["backend"] = get_store().reset(keys=body.keys, section=body.section)
    if body.target in (None, "tool_service"):
        try:
            result = await tool_service.reset(keys=body.keys, section=body.section)
            reset["tool_service"] = result.get("reset", [])
        except Exception as e:
            if body.target == "tool_service":
                raise HTTPException(status_code=502, detail=f"Tool Service: {e}")
            logger.warning("Reset skipped the Tool Service: %s", e)
    logger.info("Settings reset to defaults: %s", reset)
    return {"reset": reset, **(await _payload())}


@router.get("/models/catalog")
async def model_catalog():
    data = catalog.load()
    return {**_catalog_meta(), "models": data.get("models", [])}


@router.post("/models/refresh")
async def refresh_models():
    """Re-read the model list from Mistral now, and review configured models."""
    try:
        report = await catalog.refresh()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read models from Mistral: {e}")
    return {"report": report, "catalog": _catalog_meta()}


@router.post("/models/review")
async def review_models(apply: bool = False):
    """Check configured models against the cached catalog; ``apply`` upgrades deprecated ones."""
    return await catalog.review(apply=apply)


@router.get("/public")
async def public_config():
    """What the UI's pickers and defaults read — small, and safe to poll."""
    def label(model: str) -> str:
        latest = model.endswith("-latest")
        pretty = model.removesuffix("-latest").replace("-", " ").title()
        return f"{pretty} (latest)" if latest else pretty

    choices = settings.agent_model_choices
    return {
        "models": {
            "default_agent_model": settings.DEFAULT_AGENT_MODEL,
            "chat_default_model": settings.CHAT_DEFAULT_MODEL,
            "orchestrator_model": settings.MISTRAL_ORCHESTRATOR_MODEL,
            "tiers": {
                "large": settings.AGENT_MODEL_LARGE,
                "medium": settings.AGENT_MODEL_MEDIUM,
                "small": settings.AGENT_MODEL_SMALL,
            },
            "choices": [{"value": m, "label": label(m)} for m in choices],
        },
        "catalog": _catalog_meta(),
    }
