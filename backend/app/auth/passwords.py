"""Password hashing (argon2id), the password policy, and one-time tokens."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# OWASP's argon2id baseline: 19 MiB, t=2, p=1.
_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)

#: Verified against when the account does not exist, so a wrong email takes as
#: long as a wrong password and the response time says nothing.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

MIN_USER_LENGTH = 10
MIN_ADMIN_LENGTH = 12
MAX_LENGTH = 128

_COMMON = {
    "password", "password1", "password123", "passw0rd", "qwerty", "qwertyuiop",
    "letmein", "welcome", "welcome1", "admin", "administrator", "changeme",
    "iloveyou", "123456789", "1234567890", "12345678910", "abc123456", "trustno1",
    "mistral", "mistralai", "football", "baseball", "dragon", "monkey", "sunshine",
}


#: Words in a display name that say nothing about the person.
_GENERIC_NAME_WORDS = {"admin", "platform", "user", "team", "test", "account", "service"}


class PasswordPolicyError(ValueError):
    pass


def check_policy(password: str, *, email: str = "", name: str = "", admin: bool = False) -> None:
    """Length and a blocklist, per NIST 800-63B — no composition rules."""
    minimum = MIN_ADMIN_LENGTH if admin else MIN_USER_LENGTH
    if not isinstance(password, str) or len(password) < minimum:
        raise PasswordPolicyError(f"Use at least {minimum} characters.")
    if len(password) > MAX_LENGTH:
        raise PasswordPolicyError(f"Use at most {MAX_LENGTH} characters.")
    lowered = password.lower()
    if lowered in _COMMON or lowered.rstrip("!1") in _COMMON or len(set(password)) < 4:
        raise PasswordPolicyError("This password is too common or too simple. Choose another.")
    local = (email or "").split("@")[0].lower()
    if len(local) >= 4 and local in lowered:
        raise PasswordPolicyError("The password must not contain your email address.")
    for part in (name or "").lower().split():
        if len(part) >= 4 and part not in _GENERIC_NAME_WORDS and part in lowered:
            raise PasswordPolicyError("The password must not contain your name.")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    if not stored:
        try:
            _hasher.verify(_DUMMY_HASH, password or "")
        except (VerificationError, InvalidHashError):
            pass
        return False
    try:
        return _hasher.verify(stored, password or "")
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored)
    except Exception:
        return False


# ── Tokens ──────────────────────────────────────────────────────────────────

def new_token() -> str:
    """256 bits, URL-safe. Given to the browser once; only its hash is kept."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def same(a: str, b: str) -> bool:
    return hmac.compare_digest((a or "").encode(), (b or "").encode())
