"""
Auth configuration, from the environment only.

Deliberately not part of ``app.config.Settings``: those values are editable on
the Settings page, and the rules that protect that page must not be.
"""

from __future__ import annotations

import os


def _int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


# ── Sessions ────────────────────────────────────────────────────────────────

USER_COOKIE = "mdat_session"
ADMIN_COOKIE = "mdat_admin"


def user_idle_minutes() -> int:
    """A user session ends after this long without a request."""
    return _int("AUTH_SESSION_IDLE_MINUTES", 12 * 60, 5, 30 * 24 * 60)


def user_max_hours() -> int:
    """…and after this long in any case, active or not."""
    return _int("AUTH_SESSION_MAX_HOURS", 7 * 24, 1, 90 * 24)


def admin_idle_minutes() -> int:
    return _int("AUTH_ADMIN_IDLE_MINUTES", 30, 5, 24 * 60)


def admin_max_hours() -> int:
    return _int("AUTH_ADMIN_MAX_HOURS", 12, 1, 7 * 24)


def cookie_secure_mode() -> str:
    """``auto`` (Secure when the request came over HTTPS), ``true`` or ``false``."""
    raw = os.environ.get("AUTH_COOKIE_SECURE", "auto").strip().lower()
    return raw if raw in ("auto", "true", "false") else "auto"


# ── Sign-in protection ──────────────────────────────────────────────────────

def max_failed_logins() -> int:
    """Failed sign-ins in a row before the account is locked."""
    return _int("AUTH_MAX_FAILED_LOGINS", 5, 3, 50)


def lockout_minutes() -> int:
    return _int("AUTH_LOCKOUT_MINUTES", 15, 1, 24 * 60)


def ip_attempts_per_window() -> int:
    """Sign-in attempts one address may make per window, across all accounts."""
    return _int("AUTH_IP_ATTEMPTS", 30, 5, 1000)


IP_WINDOW_SECONDS = 300


# ── Links ───────────────────────────────────────────────────────────────────

def invite_days() -> int:
    return _int("AUTH_INVITE_DAYS", 7, 1, 30)


def reset_hours() -> int:
    return _int("AUTH_RESET_HOURS", 24, 1, 7 * 24)


# ── First admin ─────────────────────────────────────────────────────────────

def bootstrap_admin() -> tuple[str, str, str]:
    """``(email, password, name)`` for the first admin, or empty strings."""
    return (
        os.environ.get("ADMIN_EMAIL", "").strip().lower(),
        os.environ.get("ADMIN_INITIAL_PASSWORD", ""),
        os.environ.get("ADMIN_NAME", "").strip() or "Platform admin",
    )


def trust_forwarded_for() -> bool:
    """Take the client address from X-Forwarded-For (behind Caddy or Vite)."""
    return _bool("AUTH_TRUST_PROXY", True)
