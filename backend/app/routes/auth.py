"""
Sign-in, sign-out and the signed-in user's own account.

These routes read the session cookies themselves (their policy rule is
``SELF``), because several work without a session — signing in, opening an
invite link — and ``/auth/session`` answers for both kinds of account at once.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.auth import config as cfg
from app.auth import store
from app.auth.context import Principal
from app.auth.middleware import client_ip, cookies, is_https
from app.auth.store import AuthError

router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Cookies ─────────────────────────────────────────────────────────────────

def _secure(request: Request) -> bool:
    mode = cfg.cookie_secure_mode()
    return mode == "true" or (mode == "auto" and is_https(request.scope))


def set_session_cookie(response: Response, request: Request, kind: str, token: str) -> None:
    name = cfg.ADMIN_COOKIE if kind == "admin" else cfg.USER_COOKIE
    # Admin sessions end with the browser; user sessions persist until they expire.
    max_age = None if kind == "admin" else cfg.user_max_hours() * 3600
    response.set_cookie(name, token, max_age=max_age, path="/", httponly=True,
                        secure=_secure(request), samesite="lax")


def clear_session_cookie(response: Response, request: Request, kind: str) -> None:
    name = cfg.ADMIN_COOKIE if kind == "admin" else cfg.USER_COOKIE
    response.delete_cookie(name, path="/", httponly=True, secure=_secure(request), samesite="lax")


def _meta(request: Request) -> dict:
    return {"ip": client_ip(request.scope), "user_agent": request.headers.get("user-agent")}


def _user(request: Request) -> Optional[Principal]:
    return store.resolve_session("user", cookies(request.scope).get(cfg.USER_COOKIE))


def _admin(request: Request) -> Optional[Principal]:
    return store.resolve_session("admin", cookies(request.scope).get(cfg.ADMIN_COOKIE))


def require_user(request: Request) -> Principal:
    p = _user(request)
    if p is None:
        raise AuthError("Sign in to continue.", 401, "unauthenticated")
    return p


def principal_payload(p: Principal) -> dict:
    flags = store.account_flags(p)
    out = {"id": p.id, "email": p.email, "name": p.name, **flags}
    if p.kind == "user":
        out.update({
            "workspace": {"id": p.workspace_id, "name": p.workspace_name,
                          "role_id": p.role_id, "role_name": p.role_name},
            "permissions": sorted(p.permissions),
            "workspaces": store.my_workspaces(p),
        })
    return out


# ── Bodies ──────────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=256)


class PasswordBody(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., max_length=256)


class ProfileBody(BaseModel):
    name: str = Field(..., max_length=200)


class WorkspaceBody(BaseModel):
    workspace_id: str = Field(..., max_length=64)


class AcceptBody(BaseModel):
    password: str = Field(..., max_length=256)
    name: Optional[str] = Field(None, max_length=200)


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/session")
def session(request: Request):
    """Who is signed in on this browser, as a user and/or as an admin."""
    user, admin = _user(request), _admin(request)
    return {"user": principal_payload(user) if user else None,
            "admin": principal_payload(admin) if admin else None}


@router.get("/check")
def check(request: Request):
    """For the reverse proxy's forward_auth on files it serves itself."""
    if _user(request) or _admin(request):
        return Response(status_code=204)
    return Response(status_code=401)


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    result = store.login("user", body.email, body.password, **_meta(request))
    set_session_cookie(response, request, "user", result["token"])
    return {"ok": True, "must_change_password": result["must_change_password"]}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = cookies(request.scope).get(cfg.USER_COOKIE)
    store.logout(token, actor=_user(request), ip=client_ip(request.scope))
    clear_session_cookie(response, request, "user")
    return {"ok": True}


@router.post("/logout-all")
def logout_all(request: Request, response: Response):
    p = require_user(request)
    n = store.logout_everywhere(p, ip=client_ip(request.scope))
    clear_session_cookie(response, request, "user")
    return {"ok": True, "sessions_ended": n}


@router.post("/workspace")
def switch_workspace(body: WorkspaceBody, request: Request):
    p = require_user(request)
    store.switch_workspace(p, body.workspace_id)
    return principal_payload(_user(request))


@router.post("/password")
def change_password(body: PasswordBody, request: Request):
    p = require_user(request)
    store.change_password(p, body.current_password, body.new_password, ip=client_ip(request.scope))
    return {"ok": True}


@router.patch("/profile")
def update_profile(body: ProfileBody, request: Request):
    return store.update_profile(require_user(request), name=body.name)


@router.get("/sessions")
def list_sessions(request: Request):
    return {"sessions": store.list_sessions(require_user(request))}


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: str, request: Request):
    store.revoke_session(require_user(request), session_id)
    return {"ok": True}


@router.get("/links/{token}")
def link_info(token: str):
    """What an invite or reset link is for, before the person sets a password."""
    return store.link_info(token)


@router.post("/links/{token}")
def accept_link(token: str, body: AcceptBody, request: Request, response: Response):
    result = store.accept_link(token, password=body.password, name=body.name, **_meta(request))
    set_session_cookie(response, request, result["account"], result["token"])
    return {"ok": True, "account": result["account"]}
