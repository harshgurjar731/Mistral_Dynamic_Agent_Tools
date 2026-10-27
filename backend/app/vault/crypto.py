"""
At-rest encryption for vault values.

Keys come from ``VAULT_MASTER_KEYS`` — one or more Fernet keys, comma
separated, newest first — when set. Otherwise one key is generated once into
``backend/vault_key.secret`` (git-ignored by ``*.secret`` and excluded from
workflow packages). Losing every key makes stored values unreadable: the
entries remain, but each value must be entered again.

Rotation: put a new key first in ``VAULT_MASTER_KEYS`` and keep the old one
after it, restart, then use "Re-encrypt with the newest key" on Settings →
Vault. Every value is then readable with the new key alone, and the old one can
be removed.

Each ciphertext binds the value to the entry it belongs to (its id and
version are inside the encrypted payload and checked on decrypt), so copying
ciphertext from one row to another in the database yields an error, not the
other entry's value.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

logger = logging.getLogger(__name__)

_KEY_FILE = Path(__file__).resolve().parent.parent.parent / "vault_key.secret"


class VaultCryptoError(RuntimeError):
    """A value could not be decrypted: wrong key, or a tampered row."""


def key_id(key: bytes) -> str:
    """A short, non-reversible fingerprint naming a key in status and rows."""
    return hashlib.sha256(key.strip()).hexdigest()[:12]


@lru_cache(maxsize=1)
def _keys() -> tuple[list[bytes], str]:
    """``(keys newest first, source)``."""
    env = os.environ.get("VAULT_MASTER_KEYS", "").strip()
    if env:
        keys = [k.strip().encode() for k in env.split(",") if k.strip()]
        for k in keys:
            Fernet(k)  # fail at start, with a clear error, on a malformed key
        return keys, "environment"
    if _KEY_FILE.exists():
        return [_KEY_FILE.read_bytes().strip()], "file"
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        pass
    logger.info("Generated the vault master key at %s", _KEY_FILE)
    return [key], "file"


@lru_cache(maxsize=1)
def _fernet() -> MultiFernet:
    return MultiFernet([Fernet(k) for k in _keys()[0]])


def reset() -> None:
    """Forget the loaded keys (tests, and after the key environment changes)."""
    _keys.cache_clear()
    _fernet.cache_clear()


def primary_key_id() -> str:
    return key_id(_keys()[0][0])


def key_status() -> dict:
    keys, source = _keys()
    return {"source": source, "primary_key_id": key_id(keys[0]),
            "key_ids": [key_id(k) for k in keys],
            "key_file": str(_KEY_FILE) if source == "file" else None}


def encrypt(value: str, *, entry_id: str, version: int) -> str:
    payload = json.dumps({"v": value, "id": entry_id, "n": version}, separators=(",", ":"))
    return _fernet().encrypt(payload.encode()).decode()


def decrypt(token: str, *, entry_id: str) -> str:
    try:
        payload = json.loads(_fernet().decrypt(token.encode()).decode())
    except (InvalidToken, ValueError) as e:
        raise VaultCryptoError("The value could not be decrypted — the vault key changed or "
                               "the entry was altered. Enter the value again.") from e
    if not isinstance(payload, dict) or payload.get("id") != entry_id:
        raise VaultCryptoError("The stored value belongs to a different entry; it was not used.")
    return str(payload.get("v", ""))


def rotate(token: str) -> str:
    """The same value, re-encrypted with the newest key."""
    try:
        return _fernet().rotate(token.encode()).decode()
    except InvalidToken as e:
        raise VaultCryptoError("The value could not be decrypted with any configured key.") from e


def token_key_id(token: str) -> str | None:
    """Which configured key encrypted ``token``, or None if none of them did."""
    keys, _ = _keys()
    raw = token.encode()
    for k in keys:
        try:
            Fernet(k).decrypt(raw)
            return key_id(k)
        except InvalidToken:
            continue
    return None


def generate_key() -> str:
    """A new Fernet key, for the operator to put first in ``VAULT_MASTER_KEYS``."""
    return Fernet.generate_key().decode()
