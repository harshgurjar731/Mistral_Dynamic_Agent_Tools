"""
Vault routes — the Settings page's "Vault" section, and the lookups builds use.

    GET    /vault                          entries (no values), kinds, summary, key status
    POST   /vault/secrets                  add an entry                         (admin)
    GET    /vault/secrets/{ref}            one entry, and what has used it
    PATCH  /vault/secrets/{ref}            label, service, expiry, access, on/off (admin)
    PUT    /vault/secrets/{ref}/value      replace the value                    (admin)
    POST   /vault/secrets/{ref}/reveal     the value, when revealing is allowed (admin)
    GET    /vault/secrets/{ref}/versions   previous values (hints only)
    POST   /vault/secrets/{ref}/rollback   make a previous value current        (admin)
    DELETE /vault/secrets/{ref}            delete an entry and its versions     (admin)
    GET    /vault/status?names=A,B         whether each name would resolve
    GET    /vault/candidates               entries that could satisfy a requirement
    GET    /vault/audit                    who did what (never a value)
    POST   /vault/rotate-key               re-encrypt everything with the newest key (admin)
    POST   /vault/generate-key             a new master key to configure        (admin)

``ref`` is an entry's id or its name. "(admin)" routes need ``X-Vault-Token``
when ``VAULT_ADMIN_TOKEN`` is set (``app.vault.guard``).
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.vault import crypto, guard, store

router = APIRouter(prefix="/vault", tags=["Vault"])
_admin = [Depends(guard.require_admin)]


async def _call(fn, *args, **kwargs):
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except store.VaultError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except crypto.VaultCryptoError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except store.VaultUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


def _flags() -> dict:
    from app.config import settings

    return {
        "enabled": bool(getattr(settings, "VAULT_ENABLED", True)),
        "allow_reveal": bool(getattr(settings, "VAULT_ALLOW_REVEAL", False)),
        "admin_token_required": guard.required(),
        "env_fallback": bool(getattr(settings, "VAULT_ENV_FALLBACK", True)),
    }


@router.get("")
async def overview():
    secrets = await asyncio.to_thread(store.list_secrets)
    return {
        "secrets": secrets,
        "kinds": [{"key": k, **v} for k, v in store.KINDS.items()],
        "summary": await asyncio.to_thread(store.summary),
        "key": await asyncio.to_thread(store.key_status),
        **_flags(),
    }


class SecretCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=64)
    value: str = Field(..., min_length=1, max_length=store.MAX_VALUE_CHARS)
    label: str = Field("", max_length=120)
    kind: str = "api_key"
    service: str = Field("", max_length=120)
    description: str = Field("", max_length=2000)
    sensitive: Optional[bool] = None
    tags: list[str] = Field(default_factory=list)
    allowed_consumers: list[str] = Field(default_factory=list)
    expires_at: Optional[str] = None
    #: Set by the build prerequisites dialog: which run asked for it.
    origin: str = "settings"
    origin_ref: Optional[str] = Field(None, max_length=200)


class SecretUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=120)
    service: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    sensitive: Optional[bool] = None
    tags: Optional[list[str]] = None
    allowed_consumers: Optional[list[str]] = None
    #: "" or null clears the expiry; omit to leave it.
    expires_at: Optional[str] = None
    clear_expiry: bool = False
    disabled: Optional[bool] = None


class SecretValue(BaseModel):
    value: str = Field(..., min_length=1, max_length=store.MAX_VALUE_CHARS)


class Rollback(BaseModel):
    version: int = Field(..., ge=1)


@router.post("/secrets", status_code=201, dependencies=_admin)
async def create_secret(body: SecretCreate):
    return await _call(store.create_secret, **body.model_dump())


@router.get("/secrets/{ref}")
async def get_secret(ref: str):
    return await _call(store.get_secret, ref)


@router.patch("/secrets/{ref}", dependencies=_admin)
async def update_secret(ref: str, body: SecretUpdate):
    data = body.model_dump(exclude={"expires_at", "clear_expiry"})
    if body.clear_expiry:
        data["expires_at"] = None
    elif body.expires_at:
        data["expires_at"] = body.expires_at
    return await _call(store.update_secret, ref, **data)


@router.put("/secrets/{ref}/value", dependencies=_admin)
async def set_value(ref: str, body: SecretValue):
    return await _call(store.set_value, ref, body.value)


@router.post("/secrets/{ref}/reveal", dependencies=_admin)
async def reveal(ref: str):
    return await _call(store.reveal, ref)


@router.get("/secrets/{ref}/versions")
async def versions(ref: str):
    return {"versions": await _call(store.versions, ref)}


@router.post("/secrets/{ref}/rollback", dependencies=_admin)
async def rollback(ref: str, body: Rollback):
    return await _call(store.rollback, ref, body.version)


@router.delete("/secrets/{ref}", dependencies=_admin)
async def delete_secret(ref: str):
    return {"deleted": await _call(store.delete_secret, ref)}


@router.get("/status")
async def status(names: str = Query("", description="Comma-separated names"),
                 consumer: Optional[str] = None):
    wanted = [n.strip() for n in names.split(",") if n.strip()]
    return {"secrets": await asyncio.to_thread(store.status, wanted, consumer)}


@router.get("/tool-requirements")
async def tool_requirements(tools: str = Query("", description="Comma-separated tool names")):
    """The credentials each named tool or activity reads, and whether each would
    reach it now — from the vault, or (when allowed) the Tool Service's
    environment. For forms that attach tools directly, without a build."""
    from app.config import settings
    from app.services.tool_resolver import tool_resolver

    wanted = [t.split("@", 1)[0].strip() for t in tools.split(",") if t.strip()]
    if not wanted:
        return {"tools": [], "missing": 0}
    listing = {t.get("name"): t for t in await tool_resolver.list_tools()}
    needs = {name: [str(s) for s in (listing.get(name) or {}).get("secrets") or []]
             for name in wanted}
    names = sorted({s for secrets in needs.values() for s in secrets})
    env_status = (await tool_resolver.secrets_status(names) or {}
                  if names and settings.VAULT_ENV_FALLBACK else {})
    rows, missing = [], 0
    for tool, secrets in needs.items():
        status = await asyncio.to_thread(store.status, secrets, tool) if secrets else {}
        items = []
        for name in secrets:
            info = status.get(name) or {}
            env = env_status.get(name) or {}
            source = ("vault" if info.get("usable") else
                      "environment" if env.get("allowed") and env.get("set") else None)
            missing += source is None
            items.append({"name": name, "source": source, "reason": info.get("reason"),
                          "id": info.get("id"), "label": info.get("label")})
        rows.append({"tool": tool, "known": tool in listing, "secrets": items})
    return {"tools": rows, "missing": missing}


@router.get("/candidates")
async def candidates(name: str = "", service: str = "", label: str = "", kind: str = "",
                     limit: int = Query(5, ge=1, le=20)):
    return {"candidates": await asyncio.to_thread(
        store.candidates, name=name, service=service, label=label, kind=kind, limit=limit)}


@router.get("/audit")
async def audit(secret_id: Optional[str] = None, action: Optional[str] = None,
                limit: int = Query(100, ge=1, le=1000)):
    return {"events": await asyncio.to_thread(store.audit_log, secret_id=secret_id,
                                              action=action, limit=limit)}


@router.post("/rotate-key", dependencies=_admin)
async def rotate_key():
    return await _call(store.rotate_master_key)


@router.post("/generate-key", dependencies=_admin)
async def generate_key():
    """A fresh key. Not stored: the operator puts it first in ``VAULT_MASTER_KEYS``."""
    return {"key": crypto.generate_key(),
            "instructions": [
                "Put this key FIRST in the backend's VAULT_MASTER_KEYS, followed by every key "
                "already in use (comma separated). If the vault uses the generated key file, "
                "add the contents of backend/vault_key.secret after it.",
                "Restart the backend (and the workflow worker).",
                "Choose 'Re-encrypt with the newest key' here.",
                "Once no entry is on an old key, remove the old keys from VAULT_MASTER_KEYS.",
            ]}
