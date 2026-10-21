"""
Settings — read and changed by the backend's Settings page.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.runtime_settings import get_store

router = APIRouter(prefix="/settings", tags=["Settings"])


class UpdateRequest(BaseModel):
    values: dict[str, Any]


class ResetRequest(BaseModel):
    section: Optional[str] = None
    keys: Optional[list[str]] = None


@router.get("")
def get_settings():
    return get_store().export()


@router.put("")
def update_settings(body: UpdateRequest):
    try:
        changed = get_store().update(body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"changed": changed, **get_store().export()}


@router.post("/reset")
def reset_settings(body: ResetRequest):
    reset = get_store().reset(keys=body.keys, section=body.section)
    return {"reset": reset, **get_store().export()}
