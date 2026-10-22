"""
Tool safety rule routes — the Settings page's "Tool safety" section.

    GET    /safety-rules              rules, the places they can apply, strictness levels
    POST   /safety-rules              add a rule
    PATCH  /safety-rules/{id}         switch on/off, strictness, where, wording (own rules)
    DELETE /safety-rules/{id}         delete one of your own rules
    POST   /safety-rules/turn-off     switch every rule off
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.safety import store

router = APIRouter(prefix="/safety-rules", tags=["Tool safety"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except store.SafetyRuleError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


def _payload() -> dict:
    rules = store.list_rules()
    active = [r for r in rules if r["enabled"] and r["applies_to"]]
    return {
        "rules": rules,
        "points": [{"key": k, **v} for k, v in store.POINTS.items()],
        "strictness": [{"key": k, **v} for k, v in store.STRICTNESS.items()],
        "summary": {
            "active_rules": len(active),
            "points_in_use": sorted({p for r in active for p in r["applies_to"]}),
        },
    }


@router.get("")
async def list_rules():
    return _payload()


class RuleCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    rule: str = Field(..., min_length=10, max_length=1000)
    strictness: str = "standard"
    applies_to: list[str] = Field(default_factory=list)
    enabled: bool = False


class RuleUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    rule: Optional[str] = Field(None, max_length=1000)
    strictness: Optional[str] = None
    applies_to: Optional[list[str]] = None
    enabled: Optional[bool] = None


@router.post("", status_code=201)
async def create_rule(body: RuleCreate):
    return _guard(store.create_rule, title=body.title, rule=body.rule, strictness=body.strictness,
                  applies_to=body.applies_to, enabled=body.enabled)


@router.patch("/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate):
    return _guard(store.update_rule, rule_id, title=body.title, rule=body.rule,
                  strictness=body.strictness, applies_to=body.applies_to, enabled=body.enabled)


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str):
    _guard(store.delete_rule, rule_id)
    return {"deleted": rule_id}


@router.post("/turn-off")
async def turn_all_off():
    return {"turned_off": _guard(store.turn_all_off), **_payload()}
