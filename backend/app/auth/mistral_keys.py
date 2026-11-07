"""
Mistral API keys for workspaces: checking, fingerprinting and encrypting them.

Mistral has no endpoint that says which workspace a key belongs to or who owns
it. All it can tell us is whether a key works, so that is what "verified"
means here: ``GET /v1/models`` answered 200. To confirm that a replacement key
belongs to the *same* Mistral workspace, ``same_workspace`` looks up an agent
the old key can see with the new key — agent ids are visible only inside their
own Mistral workspace.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from app.config import settings
from app.vault import crypto

logger = logging.getLogger(__name__)

_TIMEOUT = 12.0


@dataclass
class KeyCheck:
    ok: bool
    #: valid | invalid | unreachable | rate_limited | error
    status: str
    message: str
    models: int = 0


def _base() -> str:
    return (settings.MISTRAL_API_BASE_URL or "https://api.mistral.ai").rstrip("/")


def normalise(key: str) -> str:
    return (key or "").strip().strip('"').strip("'")


def fingerprint(key: str) -> str:
    return hashlib.sha256(normalise(key).encode()).hexdigest()


def hint(key: str) -> str:
    key = normalise(key)
    return f"••••{key[-4:]}" if len(key) >= 8 else "••••"


def verify(key: str) -> KeyCheck:
    """Does Mistral accept this key? Never raises."""
    key = normalise(key)
    if len(key) < 16 or any(c.isspace() for c in key):
        return KeyCheck(False, "invalid", "That does not look like a Mistral API key.")
    try:
        r = httpx.get(f"{_base()}/v1/models", headers={"Authorization": f"Bearer {key}"},
                      timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        logger.warning("Mistral key check could not reach Mistral: %s", e)
        return KeyCheck(False, "unreachable", "Mistral could not be reached. Try again shortly.")
    if r.status_code == 200:
        try:
            count = len((r.json() or {}).get("data") or [])
        except ValueError:
            count = 0
        return KeyCheck(True, "valid", f"Key accepted by Mistral ({count} models available).", count)
    if r.status_code in (401, 403):
        return KeyCheck(False, "invalid", "Mistral rejected this key (it is wrong, revoked or expired).")
    if r.status_code == 429:
        return KeyCheck(False, "rate_limited", "Mistral is rate limiting this key. Try again in a minute.")
    return KeyCheck(False, "error", f"Mistral answered {r.status_code}. Try again shortly.")


def same_workspace(old_key: str, new_key: str) -> Optional[bool]:
    """True/False when it can be told, None when the old key sees no agent."""
    try:
        r = httpx.get(f"{_base()}/v1/agents", params={"page": 0, "page_size": 1},
                      headers={"Authorization": f"Bearer {normalise(old_key)}"}, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        data = r.json()
        items = data if isinstance(data, list) else (data.get("data") or data.get("items") or [])
        if not items:
            return None
        agent_id = items[0].get("id")
        if not agent_id:
            return None
        r2 = httpx.get(f"{_base()}/v1/agents/{agent_id}",
                       headers={"Authorization": f"Bearer {normalise(new_key)}"}, timeout=_TIMEOUT)
        if r2.status_code == 200:
            return True
        if r2.status_code in (404, 403):
            return False
        return None
    except (httpx.HTTPError, ValueError, AttributeError):
        return None


def _entry(workspace_id: str) -> str:
    return f"workspace-key:{workspace_id}"


def encrypt(key: str, *, workspace_id: str, version: int) -> str:
    return crypto.encrypt(normalise(key), entry_id=_entry(workspace_id), version=version)


def decrypt(ciphertext: str, *, workspace_id: str) -> str:
    return crypto.decrypt(ciphertext, entry_id=_entry(workspace_id))
