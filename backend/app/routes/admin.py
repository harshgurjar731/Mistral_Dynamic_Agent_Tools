"""
The admin portal's API: workspaces, users, roles, admins and the audit log.

Every route here except ``POST /admin/auth/login`` needs a platform admin
session — the middleware checks it before the route runs and puts the admin
in ``current_principal()``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.auth import config as cfg
from app.auth import store
from app.auth.context import current_principal
from app.auth.middleware import client_ip, cookies
from app.auth.permissions import PERMISSIONS, SYSTEM_ROLES
from app.auth.store import AuthError
from app.routes.auth import clear_session_cookie, principal_payload, set_session_cookie

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


def _me():
    p = current_principal()
    if p is None or not p.is_admin:
        raise AuthError("Sign in as an admin to continue.", 401, "unauthenticated")
    return p


# ── Admin sign-in ───────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=256)


class PasswordBody(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., max_length=256)


@router.post("/auth/login")
def admin_login(body: LoginBody, request: Request, response: Response):
    result = store.login("admin", body.email, body.password, ip=client_ip(request.scope),
                         user_agent=request.headers.get("user-agent"))
    set_session_cookie(response, request, "admin", result["token"])
    return {"ok": True, "must_change_password": result["must_change_password"]}


@router.post("/auth/logout")
def admin_logout(request: Request, response: Response):
    store.logout(cookies(request.scope).get(cfg.ADMIN_COOKIE), actor=_me(),
                 ip=client_ip(request.scope))
    clear_session_cookie(response, request, "admin")
    return {"ok": True}


@router.get("/auth/me")
def admin_me():
    return principal_payload(_me())


@router.post("/auth/password")
def admin_password(body: PasswordBody, request: Request):
    store.change_password(_me(), body.current_password, body.new_password,
                          ip=client_ip(request.scope))
    return {"ok": True}


@router.get("/auth/sessions")
def admin_sessions():
    return {"sessions": store.list_sessions(_me())}


@router.delete("/auth/sessions/{session_id}")
def admin_revoke_session(session_id: str):
    store.revoke_session(_me(), session_id)
    return {"ok": True}


# ── Overview and catalog ────────────────────────────────────────────────────

@router.get("/overview")
def overview():
    out = store.overview()
    out["recent"] = store.audit_log(limit=12)["events"]
    return out


@router.get("/permissions")
def permissions():
    return {
        "permissions": [{"key": p.key, "group": p.group, "label": p.label,
                         "description": p.description, "shared": p.shared} for p in PERMISSIONS],
        "system_roles": [{"key": r.key, "name": r.name} for r in SYSTEM_ROLES],
    }


# ── Workspaces ──────────────────────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str = Field(..., max_length=120)
    api_key: str = Field(..., max_length=300)
    description: str = Field("", max_length=1000)


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    disabled: Optional[bool] = None


class KeyBody(BaseModel):
    api_key: str = Field(..., max_length=300)
    allow_other_workspace: bool = False


def _provision_later(workspace_id: str) -> None:
    """Create the workspace's platform agents in its own Mistral workspace."""
    from app.auth.provision import provision_workspace

    from app.core.runtime import spawn

    try:
        spawn(provision_workspace(workspace_id), name=f"provision:{workspace_id}")
    except RuntimeError:
        pass


def _worker_summary(workspaces: list[dict]) -> list[dict]:
    """Each workspace's workflow worker, from the supervisor's status file."""
    from app.auth import workers

    try:
        status = workers.read_status()
        files = workers.files_by_workspace()
    except Exception as e:  # noqa: BLE001 — the list must not fail over this
        logger.debug("Worker status unavailable: %s", e)
        return workspaces
    for ws in workspaces:
        entry = status["workers"].get(ws["id"]) or {}
        published = len(files.get(ws["id"], []))
        ws["worker"] = {
            "enabled": status["enabled"],
            "stale": bool(status.get("stale")),
            "state": entry.get("state") or ("idle" if not published else "stopped"),
            "published_workflows": published,
            "deployment": workers.deployment_name(ws["id"]),
        }
    return workspaces


@router.get("/workspaces")
def list_workspaces():
    return {"workspaces": _worker_summary(store.list_workspaces())}


@router.post("/workspaces/check-key")
def check_key(body: KeyBody):
    return store.check_key(body.api_key)


@router.post("/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreate):
    ws = await run_in_threadpool(lambda: store.create_workspace(
        name=body.name, api_key=body.api_key, description=body.description, actor=_me()))
    _provision_later(ws["id"])
    return ws


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: str):
    from app.auth import workers

    out = store.get_workspace(workspace_id)
    try:
        out["worker"] = workers.worker_for(workspace_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("Worker status unavailable: %s", e)
    return out


@router.patch("/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, body: WorkspaceUpdate):
    return store.update_workspace(workspace_id, name=body.name, description=body.description,
                                  disabled=body.disabled, actor=_me())


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str):
    return store.delete_workspace(workspace_id, actor=_me())


@router.post("/workspaces/{workspace_id}/check")
def recheck_key(workspace_id: str):
    return store.recheck_key(workspace_id, actor=_me())


@router.post("/workspaces/{workspace_id}/rotate-key")
async def rotate_key(workspace_id: str, body: KeyBody):
    ws = await run_in_threadpool(lambda: store.rotate_key(
        workspace_id, api_key=body.api_key, allow_other_workspace=body.allow_other_workspace,
        actor=_me()))
    if ws.get("same_mistral_workspace") is not True:
        _provision_later(workspace_id)
    return ws


@router.get("/workspaces/{workspace_id}/members")
def workspace_members(workspace_id: str):
    return {"members": store.workspace_members(workspace_id)}


# ── Users ───────────────────────────────────────────────────────────────────

class MembershipBody(BaseModel):
    workspace_id: str = Field(..., max_length=64)
    role_id: str = Field(..., max_length=64)


class UserCreate(BaseModel):
    email: str = Field(..., max_length=254)
    name: str = Field(..., max_length=200)
    memberships: list[MembershipBody] = Field(..., min_length=1, max_length=100)


class UserUpdate(BaseModel):
    email: Optional[str] = Field(None, max_length=254)
    name: Optional[str] = Field(None, max_length=200)


class MembershipsBody(BaseModel):
    memberships: list[MembershipBody] = Field(..., min_length=1, max_length=100)


@router.get("/users")
def list_users(q: Optional[str] = Query(None, max_length=200),
               workspace_id: Optional[str] = None, status: Optional[str] = None):
    return {"users": store.list_users(q=q, workspace_id=workspace_id, status=status)}


@router.post("/users", status_code=201)
def create_user(body: UserCreate):
    return store.create_user(email=body.email, name=body.name,
                             memberships=[m.model_dump() for m in body.memberships], actor=_me())


@router.get("/users/{user_id}")
def get_user(user_id: str):
    out = store.get_user(user_id)
    out["activity"] = store.audit_log(limit=20, target_id=user_id)["events"]
    return out


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserUpdate):
    return store.update_user(user_id, name=body.name, email=body.email, actor=_me())


@router.put("/users/{user_id}/memberships")
def set_memberships(user_id: str, body: MembershipsBody):
    return store.set_memberships(user_id, [m.model_dump() for m in body.memberships], actor=_me())


@router.post("/users/{user_id}/link")
def user_link(user_id: str):
    return store.issue_link(user_id, actor=_me())


@router.post("/users/{user_id}/disable")
def disable_user(user_id: str):
    return store.set_user_status(user_id, disabled=True, actor=_me())


@router.post("/users/{user_id}/enable")
def enable_user(user_id: str):
    return store.set_user_status(user_id, disabled=False, actor=_me())


@router.post("/users/{user_id}/unlock")
def unlock_user(user_id: str):
    return store.unlock_user(user_id, actor=_me())


@router.post("/users/{user_id}/sessions/revoke")
def revoke_user_sessions(user_id: str):
    return store.revoke_user_sessions(user_id, actor=_me())


@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    return store.delete_user(user_id, actor=_me())


# ── Roles ───────────────────────────────────────────────────────────────────

class RoleBody(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    description: Optional[str] = Field(None, max_length=1000)
    permissions: Optional[list[str]] = Field(None, max_length=200)


@router.get("/roles")
def list_roles():
    return {"roles": store.list_roles()}


@router.post("/roles", status_code=201)
def create_role(body: RoleBody):
    return store.create_role(name=body.name or "", description=body.description or "",
                             permissions=body.permissions or [], actor=_me())


@router.get("/roles/{role_id}")
def get_role(role_id: str):
    return store.get_role(role_id)


@router.patch("/roles/{role_id}")
def update_role(role_id: str, body: RoleBody):
    return store.update_role(role_id, name=body.name, description=body.description,
                             permissions=body.permissions, actor=_me())


@router.delete("/roles/{role_id}")
def delete_role(role_id: str, reassign_to: Optional[str] = None):
    return store.delete_role(role_id, reassign_to=reassign_to, actor=_me())


# ── Admins ──────────────────────────────────────────────────────────────────

class AdminCreate(BaseModel):
    email: str = Field(..., max_length=254)
    name: str = Field(..., max_length=200)


class AdminUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    disabled: Optional[bool] = None


@router.get("/admins")
def list_admins():
    return {"admins": store.list_admins(), "me": _me().id}


@router.post("/admins", status_code=201)
def create_admin(body: AdminCreate):
    return store.create_admin(email=body.email, name=body.name, actor=_me())


@router.patch("/admins/{admin_id}")
def update_admin(admin_id: str, body: AdminUpdate):
    return store.update_admin(admin_id, name=body.name, disabled=body.disabled, actor=_me())


@router.post("/admins/{admin_id}/link")
def admin_link(admin_id: str):
    return store.admin_link(admin_id, actor=_me())


@router.delete("/admins/{admin_id}")
def delete_admin(admin_id: str):
    return store.delete_admin(admin_id, actor=_me())


# ── System health ───────────────────────────────────────────────────────────

@router.get("/health")
async def system_health(refresh: bool = False):
    """Every component, with latency and details; ``refresh`` skips the cache."""
    from app import health

    return await health.admin_health(refresh=refresh)


# ── Audit ───────────────────────────────────────────────────────────────────

@router.get("/audit")
def audit(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
          action: Optional[str] = Query(None, max_length=80),
          actor: Optional[str] = Query(None, max_length=254),
          workspace_id: Optional[str] = None):
    return store.audit_log(limit=limit, offset=offset, action=action, actor=actor,
                           workspace_id=workspace_id)
