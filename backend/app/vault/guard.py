"""
The vault's admin token.

The backend has no user accounts, so anyone who can reach the API can use it.
Setting ``VAULT_ADMIN_TOKEN`` in the backend's environment closes the vault's
write and reveal routes to callers who do not send it as ``X-Vault-Token``.
Reading what entries exist (never their values) stays open, because builds
and the prerequisite checks need it.

It is deliberately an environment variable and not a Settings-page value:
a guard that the guarded API can change is no guard.
"""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def required() -> bool:
    return bool(os.environ.get("VAULT_ADMIN_TOKEN", "").strip())


def require_admin(x_vault_token: Optional[str] = Header(default=None)) -> None:
    """FastAPI dependency for vault writes and reveals."""
    expected = os.environ.get("VAULT_ADMIN_TOKEN", "").strip()
    if not expected:
        return
    if not x_vault_token or not hmac.compare_digest(x_vault_token.strip(), expected):
        raise HTTPException(status_code=401,
                            detail="This vault action needs the vault admin token "
                                   "(Settings → Vault → Unlock).")
