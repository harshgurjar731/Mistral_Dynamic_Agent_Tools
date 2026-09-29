"""
At-rest encryption for remote-server credentials.

The key comes from ``REMOTE_SERVER_SECRET_KEY`` (a Fernet key) when set;
otherwise one is generated once into ``backend/remote_servers_key.secret``
(git-ignored by ``*.secret`` and excluded from workflow packages). Losing that
file makes stored credentials unreadable — the servers remain, but their
passwords/keys must be re-entered.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_KEY_FILE = Path(__file__).resolve().parent.parent.parent / "remote_servers_key.secret"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    env_key = os.environ.get("REMOTE_SERVER_SECRET_KEY", "").strip()
    if env_key:
        return Fernet(env_key.encode())
    if _KEY_FILE.exists():
        return Fernet(_KEY_FILE.read_bytes().strip())
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        pass
    logger.info("Generated remote-server secret key at %s", _KEY_FILE)
    return Fernet(key)


def encrypt(values: dict) -> str | None:
    clean = {k: v for k, v in values.items() if v not in (None, "")}
    if not clean:
        return None
    return _fernet().encrypt(json.dumps(clean).encode()).decode()


def decrypt(blob: str | None) -> dict:
    if not blob:
        return {}
    try:
        return json.loads(_fernet().decrypt(blob.encode()).decode())
    except (InvalidToken, ValueError) as e:
        logger.warning("Could not decrypt remote-server secrets (key changed?): %s", e)
        return {}
