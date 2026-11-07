"""
Authentication and authorization for every request.

A pure ASGI middleware (not ``BaseHTTPMiddleware``) so the principal and
workspace it sets are visible to the endpoint, its streaming body and any task
the endpoint starts.

Order of checks for a protected path:

1. CSRF: a state-changing request carrying a session cookie must come from
   this site (``Origin``/``Referer`` matches the host or a configured CORS
   origin). Cookies are also ``SameSite=Lax``.
2. The route policy (``permissions.match``) decides who may call it; an
   unmatched ``/api`` path is denied.
3. The session cookie for that kind of caller is resolved to a principal.
4. The principal's permissions are checked.
"""

from __future__ import annotations

import json
import logging
from http.cookies import SimpleCookie
from typing import Optional
from urllib.parse import urlsplit

import anyio

from app.auth import config as cfg
from app.auth import permissions as policy
from app.auth.context import Principal, use_principal

logger = logging.getLogger(__name__)

_SAFE = {"GET", "HEAD", "OPTIONS"}

#: Outside /api, these need a signed-in user too (uploaded files, the API docs).
_PROTECTED_PREFIXES = ("/uploads/", "/docs", "/redoc", "/openapi.json")


def _headers(scope) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in scope.get("headers") or []:
        out[k.decode("latin-1").lower()] = v.decode("latin-1")
    return out


def cookies(scope) -> dict[str, str]:
    raw = _headers(scope).get("cookie", "")
    jar = SimpleCookie()
    try:
        jar.load(raw)
    except Exception:
        return {}
    return {k: m.value for k, m in jar.items()}


def client_ip(scope) -> Optional[str]:
    if cfg.trust_forwarded_for():
        fwd = _headers(scope).get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64] or None
    client = scope.get("client")
    return client[0] if client else None


def is_https(scope) -> bool:
    proto = _headers(scope).get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https" or scope.get("scheme") == "https"


def _same_origin(scope) -> bool:
    h = _headers(scope)
    source = h.get("origin") or h.get("referer")
    if not source:
        # Non-browser clients send neither; a browser always sends Origin on a
        # cross-site POST, and SameSite=Lax keeps the cookie off it anyway.
        return True
    try:
        parts = urlsplit(source)
        origin_host = parts.netloc.lower()
    except ValueError:
        return False
    hosts = {h.get("host", "").lower(), h.get("x-forwarded-host", "").split(",")[0].strip().lower()}
    if origin_host and origin_host in hosts:
        return True
    from app.config import settings

    # Explicit origins only: a CORS wildcard must not make every site trusted.
    allowed = {o.rstrip("/").lower() for o in settings.cors_origins_list if o.strip() != "*"}
    return f"{parts.scheme}://{origin_host}" in allowed


async def _send_json(send, status: int, body: dict) -> None:
    payload = json.dumps(body).encode()
    await send({"type": "http.response.start", "status": status, "headers": [
        (b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()),
        (b"cache-control", b"no-store"),
    ]})
    await send({"type": "http.response.body", "body": payload})


async def resolve(kind: str, token: Optional[str]) -> Optional[Principal]:
    """Session cookie → principal, off the event loop (it is a database read)."""
    if not token:
        return None
    from app.auth import store

    return await anyio.to_thread.run_sync(store.resolve_session, kind, token)


def _api_path(path: str) -> Optional[str]:
    from app.config import settings

    prefix = settings.API_PREFIX.rstrip("/")
    if path == prefix:
        return ""
    if path.startswith(prefix + "/"):
        return path[len(prefix):]
    return None


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        api = _api_path(path)
        protected_static = api is None and path.startswith(_PROTECTED_PREFIXES)
        if api is None and not protected_static:
            return await self.app(scope, receive, send)   # /health and the like

        jar = cookies(scope)
        if method not in _SAFE and (cfg.USER_COOKIE in jar or cfg.ADMIN_COOKIE in jar) \
                and not _same_origin(scope):
            return await _send_json(send, 403, {"detail": "Cross-site request refused.",
                                                "code": "csrf"})

        if protected_static:
            principal = await resolve("user", jar.get(cfg.USER_COOKIE)) \
                or await resolve("admin", jar.get(cfg.ADMIN_COOKIE))
            if principal is None:
                return await _send_json(send, 401, {"detail": "Sign in to continue.",
                                                    "code": "unauthenticated"})
            with use_principal(principal):
                return await self.app(scope, receive, send)

        rule = policy.match(method, api)
        if rule is None:
            logger.warning("Denied %s %s: no access rule", method, path)
            return await _send_json(send, 403, {"detail": "This endpoint is not available.",
                                                "code": "no_policy"})
        if rule.access in (policy.PUBLIC, policy.SELF):
            # SELF routes read the cookies themselves (app.routes.auth).
            return await self.app(scope, receive, send)

        principal: Optional[Principal] = None
        if rule.access == policy.ADMIN:
            principal = await resolve("admin", jar.get(cfg.ADMIN_COOKIE))
        elif rule.access == policy.ANY:
            principal = await resolve("user", jar.get(cfg.USER_COOKIE)) \
                or await resolve("admin", jar.get(cfg.ADMIN_COOKIE))
        else:
            principal = await resolve("user", jar.get(cfg.USER_COOKIE))
            if principal is None and rule.admin_ok:
                principal = await resolve("admin", jar.get(cfg.ADMIN_COOKIE))

        if principal is None:
            what = "an admin" if rule.access == policy.ADMIN else "your account"
            return await _send_json(send, 401, {"detail": f"Sign in with {what} to continue.",
                                                "code": "unauthenticated",
                                                "admin": rule.access == policy.ADMIN})

        if principal.must_change_password and not api.startswith("/admin/auth/"):
            return await _send_json(send, 403, {
                "detail": "Set a new password before continuing.",
                "code": "password_change_required"})

        if rule.access == "perm" and not (principal.is_admin and rule.admin_ok):
            if not any(principal.can(p) for p in rule.perms):
                role = principal.role_name or "your role"
                where = f" in {principal.workspace_name}" if principal.workspace_name else ""
                return await _send_json(send, 403, {
                    "detail": f"Your role ({role}){where} doesn't allow this. Ask your "
                              "administrator if you need it.",
                    "code": "forbidden", "needs": list(rule.perms),
                    "workspace": principal.workspace_name, "role": principal.role_name,
                })

        with use_principal(principal):
            await self.app(scope, receive, send)
