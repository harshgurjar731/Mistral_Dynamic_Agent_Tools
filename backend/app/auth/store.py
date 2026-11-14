"""
Accounts, sessions, workspaces, roles and the audit log.

Every function opens and closes its own database session and returns plain
dicts, like the other stores in this backend. Errors a person can act on are
raised as ``AuthError`` with an HTTP status and a message meant to be shown.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_

from app.auth import config as cfg
from app.auth import mistral_keys
from app.auth import passwords as pw
from app.auth.context import Principal
from app.auth.models import (
    Admin, AuditEvent, AuthSession, AuthToken, Membership, Role, User, Workspace,
)
from app.auth.permissions import SYSTEM_ROLES, clean_permissions
from app.database import SessionLocal

logger = logging.getLogger(__name__)


class AuthError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() + "Z" if value else None


def _id() -> str:
    return uuid.uuid4().hex


def _db():
    if SessionLocal is None:
        raise AuthError("The database is unavailable.", 503, "unavailable")
    return SessionLocal()


def _email(value: str) -> str:
    email = (value or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 254:
        raise AuthError("Enter a valid email address.", 422, "email")
    return email


def _name(value: str, what: str = "name", limit: int = 120) -> str:
    name = " ".join((value or "").split())
    if not name:
        raise AuthError(f"Enter a {what}.", 422, what)
    if len(name) > limit:
        raise AuthError(f"The {what} is too long (at most {limit} characters).", 422, what)
    return name


def _policy(password: str, **kw) -> None:
    try:
        pw.check_policy(password, **kw)
    except pw.PasswordPolicyError as e:
        raise AuthError(str(e), 422, "password") from e


# ── Audit ───────────────────────────────────────────────────────────────────

def _actor_fields(actor: Any) -> dict:
    if isinstance(actor, Principal):
        return {"actor_kind": actor.kind, "actor_id": actor.id, "actor_email": actor.email}
    if isinstance(actor, dict):
        return {"actor_kind": actor.get("kind"), "actor_id": actor.get("id"),
                "actor_email": actor.get("email")}
    return {"actor_kind": "system", "actor_id": None, "actor_email": None}


# Resolved sessions, for a few seconds: the UI polls several endpoints and each
# request would otherwise re-read session, account, membership, role and
# workspace. Every change that could alter a principal is audited, and
# auditing clears this, so a sign-out, revocation, disable or role change is
# seen by the next request.
_PRINCIPAL_TTL = 10.0
_principals: dict[tuple[str, str], tuple[float, Principal]] = {}


def forget_principals() -> None:
    _principals.clear()


def _audit(db, action: str, *, actor: Any = None, target_type: str = None, target_id: str = None,
           workspace_id: str = None, outcome: str = "ok", detail: dict = None, ip: str = None):
    forget_principals()
    db.add(AuditEvent(
        action=action, target_type=target_type, target_id=target_id, workspace_id=workspace_id,
        outcome=outcome, detail=json.dumps(detail) if detail else None, ip=ip,
        **_actor_fields(actor),
    ))


def audit(action: str, **kw) -> None:
    """Record an event on its own (outside another store call)."""
    try:
        with _db() as db:
            _audit(db, action, **kw)
            db.commit()
    except Exception as e:  # noqa: BLE001 — never fail a request over the log
        logger.warning("Audit write failed for %s: %s", action, e)


#: Audit actions (after ``user.`` / ``admin.``) that make up the authentication
#: log: the admin console's "Authentication" filter, ``action="auth"``. These
#: are recorded here only — sign-in requests are never exported to Mistral.
AUTH_ACTIONS = ("login", "logout", "logout_all", "session_revoke", "password_change",
                "password_reset", "invite_accept", "switch_workspace")


def audit_log(*, limit: int = 100, offset: int = 0, action: str = None, actor: str = None,
              target_id: str = None, workspace_id: str = None) -> dict:
    with _db() as db:
        q = db.query(AuditEvent)
        if action == "auth":
            q = q.filter(or_(*(AuditEvent.action.like(f"%.{a}") for a in AUTH_ACTIONS)))
        elif action:
            q = q.filter(AuditEvent.action.like(f"{action}%"))
        if actor:
            q = q.filter(AuditEvent.actor_email.like(f"%{actor.lower()}%"))
        if target_id:
            q = q.filter(AuditEvent.target_id == target_id)
        if workspace_id:
            q = q.filter(AuditEvent.workspace_id == workspace_id)
        total = q.count()
        rows = q.order_by(AuditEvent.id.desc()).offset(offset).limit(max(1, min(limit, 500))).all()
        return {"total": total, "events": [_event_dict(r) for r in rows]}


def _event_dict(r: AuditEvent) -> dict:
    return {
        "id": r.id, "at": _iso(r.at), "actor_kind": r.actor_kind, "actor_id": r.actor_id,
        "actor_email": r.actor_email, "action": r.action, "target_type": r.target_type,
        "target_id": r.target_id, "workspace_id": r.workspace_id, "outcome": r.outcome,
        "detail": json.loads(r.detail) if r.detail else None, "ip": r.ip,
    }


def _subject_summary(db, kind: Optional[str], ident: Optional[str]) -> Optional[dict]:
    """Who or what an id names now, for the audit detail view. None if unknown."""
    if not ident:
        return None
    model = {"user": User, "admin": Admin, "workspace": Workspace, "role": Role}.get(kind or "")
    row = db.get(model, ident) if model is not None else None
    if row is None:
        return {"type": kind, "id": ident, "exists": False}
    return {"type": kind, "id": ident, "exists": getattr(row, "status", None) != "deleted",
            "name": getattr(row, "name", None), "email": getattr(row, "email", None),
            "status": getattr(row, "status", None)}


def audit_event(event_id: int, *, related: int = 10) -> dict:
    """One audit event in full: who and what it names, as they are now, and the
    events just before and after it by the same person and on the same target."""
    with _db() as db:
        r = db.get(AuditEvent, event_id)
        if r is None:
            raise AuthError("That audit event does not exist.", 404, "not_found")
        out = _event_dict(r)
        out["actor"] = _subject_summary(db, r.actor_kind, r.actor_id)
        out["target"] = _subject_summary(db, r.target_type, r.target_id)
        ws = db.get(Workspace, r.workspace_id) if r.workspace_id else None
        out["workspace"] = {"id": ws.id, "name": ws.name} if ws else None

        def _around(*conds) -> list[dict]:
            q = db.query(AuditEvent).filter(AuditEvent.id != r.id, *conds)
            return [_event_dict(e) for e in q.order_by(AuditEvent.id.desc()).limit(related).all()]

        out["by_actor"] = _around(AuditEvent.actor_id == r.actor_id) if r.actor_id else []
        out["on_target"] = _around(AuditEvent.target_id == r.target_id) if r.target_id else []
        prev = db.query(AuditEvent.id).filter(AuditEvent.id < r.id).order_by(AuditEvent.id.desc()).first()
        nxt = db.query(AuditEvent.id).filter(AuditEvent.id > r.id).order_by(AuditEvent.id.asc()).first()
        out["older_id"] = prev[0] if prev else None
        out["newer_id"] = nxt[0] if nxt else None
        return out


# ── Roles ───────────────────────────────────────────────────────────────────

def ensure_system_roles() -> int:
    """Create or refresh the built-in roles from code. Returns how many changed."""
    changed = 0
    with _db() as db:
        for spec in SYSTEM_ROLES:
            row = db.query(Role).filter(Role.system_key == spec.key).first()
            perms = json.dumps(sorted(spec.permissions))
            if row is None:
                # A custom role may already use the name; the built-in one wins it.
                clash = db.query(Role).filter(Role.name == spec.name).first()
                if clash is not None:
                    clash.name = f"{clash.name} (custom)"
                db.add(Role(id=_id(), name=spec.name, description=spec.description,
                            permissions=perms, system_key=spec.key))
                changed += 1
            elif (row.permissions, row.description, row.name) != (perms, spec.description, spec.name):
                row.permissions, row.description, row.name = perms, spec.description, spec.name
                changed += 1
        db.commit()
    return changed


def _role_dict(r: Role, members: int = 0) -> dict:
    return {"id": r.id, "name": r.name, "description": r.description or "",
            "permissions": json.loads(r.permissions or "[]"), "system": bool(r.system_key),
            "system_key": r.system_key, "members": members,
            "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at)}


def list_roles() -> list[dict]:
    with _db() as db:
        counts = dict(db.query(Membership.role_id, func.count(Membership.id))
                      .group_by(Membership.role_id).all())
        order = {s.key: i for i, s in enumerate(SYSTEM_ROLES)}
        rows = db.query(Role).all()
        rows.sort(key=lambda r: (0, order.get(r.system_key, 0)) if r.system_key else (1, r.name.lower()))
        return [_role_dict(r, counts.get(r.id, 0)) for r in rows]


def get_role(role_id: str) -> dict:
    with _db() as db:
        r = db.get(Role, role_id)
        if r is None:
            raise AuthError("That role does not exist.", 404, "not_found")
        n = db.query(Membership).filter(Membership.role_id == r.id).count()
        return _role_dict(r, n)


def create_role(*, name: str, description: str = "", permissions: Iterable[str] = (),
                actor: Any = None) -> dict:
    name = _name(name, "role name", 60)
    perms = clean_permissions(permissions)
    if not perms:
        raise AuthError("Give the role at least one permission.", 422, "permissions")
    with _db() as db:
        if db.query(Role).filter(func.lower(Role.name) == name.lower()).first():
            raise AuthError(f"A role named “{name}” already exists.", 409, "duplicate")
        r = Role(id=_id(), name=name, description=(description or "").strip()[:500],
                 permissions=json.dumps(perms), created_by=_actor_fields(actor)["actor_email"])
        db.add(r)
        _audit(db, "role.create", actor=actor, target_type="role", target_id=r.id,
               detail={"name": name, "permissions": perms})
        db.commit()
        return _role_dict(r)


def update_role(role_id: str, *, name: str = None, description: str = None,
                permissions: Iterable[str] = None, actor: Any = None) -> dict:
    with _db() as db:
        r = db.get(Role, role_id)
        if r is None:
            raise AuthError("That role does not exist.", 404, "not_found")
        if r.system_key:
            raise AuthError("Built-in roles cannot be changed. Duplicate it to make your own.",
                            409, "system_role")
        before = _role_dict(r)
        if name is not None:
            name = _name(name, "role name", 60)
            clash = db.query(Role).filter(func.lower(Role.name) == name.lower(), Role.id != r.id).first()
            if clash:
                raise AuthError(f"A role named “{name}” already exists.", 409, "duplicate")
            r.name = name
        if description is not None:
            r.description = description.strip()[:500]
        if permissions is not None:
            perms = clean_permissions(permissions)
            if not perms:
                raise AuthError("Give the role at least one permission.", 422, "permissions")
            r.permissions = json.dumps(perms)
        _audit(db, "role.update", actor=actor, target_type="role", target_id=r.id,
               detail={"before": {k: before[k] for k in ("name", "permissions")},
                       "after": {"name": r.name, "permissions": json.loads(r.permissions)}})
        db.commit()
        n = db.query(Membership).filter(Membership.role_id == r.id).count()
        return _role_dict(r, n)


def delete_role(role_id: str, *, reassign_to: str = None, actor: Any = None) -> dict:
    with _db() as db:
        r = db.get(Role, role_id)
        if r is None:
            raise AuthError("That role does not exist.", 404, "not_found")
        if r.system_key:
            raise AuthError("Built-in roles cannot be deleted.", 409, "system_role")
        members = db.query(Membership).filter(Membership.role_id == r.id).all()
        if members:
            if not reassign_to:
                raise AuthError(f"{len(members)} membership(s) use this role. Choose a role to "
                                "move them to first.", 409, "in_use")
            target = db.get(Role, reassign_to)
            if target is None or target.id == r.id:
                raise AuthError("Choose another existing role to move its members to.", 422,
                                "reassign")
            for m in members:
                m.role_id = target.id
        db.delete(r)
        _audit(db, "role.delete", actor=actor, target_type="role", target_id=role_id,
               detail={"name": r.name, "moved": len(members), "to": reassign_to})
        db.commit()
        return {"deleted": role_id, "moved": len(members)}


# ── Workspaces ──────────────────────────────────────────────────────────────

_key_cache: dict[str, tuple[Optional[str], float]] = {}
_key_lock = threading.Lock()
_KEY_TTL = 60.0


def _forget_key(workspace_id: str) -> None:
    with _key_lock:
        _key_cache.pop(workspace_id, None)
    try:
        from app.dependencies import forget_workspace_client

        forget_workspace_client(workspace_id)
    except Exception:
        pass


def workspace_key(workspace_id: str) -> Optional[str]:
    """The Mistral key a workspace's calls use. None when it has none or is disabled."""
    now = time.monotonic()
    with _key_lock:
        hit = _key_cache.get(workspace_id)
        if hit and now - hit[1] < _KEY_TTL:
            return hit[0]
    key: Optional[str] = None
    try:
        with _db() as db:
            ws = db.get(Workspace, workspace_id)
            if ws is not None and not ws.disabled:
                if ws.key_source == "platform":
                    from app.config import settings

                    key = settings.MISTRAL_API_KEY or None
                elif ws.key_ciphertext:
                    key = mistral_keys.decrypt(ws.key_ciphertext, workspace_id=ws.id)
    except Exception as e:  # noqa: BLE001
        logger.error("Could not load the Mistral key of workspace %s: %s", workspace_id, e)
        key = None
    with _key_lock:
        _key_cache[workspace_id] = (key, now)
    return key


def _member_counts(db) -> dict[str, int]:
    return dict(db.query(Membership.workspace_id, func.count(Membership.id))
                .group_by(Membership.workspace_id).all())


def _ws_dict(w: Workspace, members: int = 0) -> dict:
    return {
        "id": w.id, "name": w.name, "description": w.description or "",
        "key_source": w.key_source, "key_hint": w.key_hint, "key_status": w.key_status,
        "key_checked_at": _iso(w.key_checked_at), "key_error": w.key_error,
        "key_rotated_at": _iso(w.key_rotated_at), "is_default": bool(w.is_default),
        "disabled": bool(w.disabled), "members": members, "created_by": w.created_by,
        "created_at": _iso(w.created_at), "updated_at": _iso(w.updated_at),
    }


def ensure_default_workspace() -> Optional[str]:
    """The workspace that owns everything created before workspaces existed.

    It uses the backend's own MISTRAL_API_KEY, so its key is changed on the
    Settings page rather than here, and it cannot be disabled or deleted.
    """
    import os

    from app.config import settings
    from app.auth import scoping

    with _db() as db:
        ws = db.query(Workspace).filter(Workspace.is_default.is_(True)).first()
        if os.environ.get("APP_WORKSPACE_ID"):
            # A per-workspace workflow worker: its MISTRAL_API_KEY is its own
            # workspace's, not the platform's, so it must not create or
            # "correct" the Default workspace — only learn which one it is.
            scoping.set_default_workspace(ws.id if ws else None)
            return ws.id if ws else None
        if ws is None:
            name = "Default"
            if db.query(Workspace).filter(Workspace.name == name).first():
                name = "Default workspace"
            key = settings.MISTRAL_API_KEY or ""
            ws = Workspace(id=_id(), name=name, key_source="platform", is_default=True,
                           description="Owns everything created before workspaces existed. "
                                       "Uses the platform's MISTRAL_API_KEY.",
                           key_fingerprint=mistral_keys.fingerprint(key) if key else None,
                           key_hint=mistral_keys.hint(key) if key else None,
                           key_status="unchecked")
            db.add(ws)
            _audit(db, "workspace.create", target_type="workspace", target_id=ws.id,
                   workspace_id=ws.id, detail={"name": name, "default": True})
            db.commit()
            logger.info("Created the Default workspace (%s)", ws.id)
        else:
            key = settings.MISTRAL_API_KEY or ""
            fp = mistral_keys.fingerprint(key) if key else None
            if ws.key_fingerprint != fp:
                ws.key_fingerprint = fp
                ws.key_hint = mistral_keys.hint(key) if key else None
                ws.key_status = "unchecked"
                db.commit()
        scoping.set_default_workspace(ws.id)
        return ws.id


def list_workspaces() -> list[dict]:
    with _db() as db:
        counts = _member_counts(db)
        rows = db.query(Workspace).order_by(Workspace.is_default.desc(), Workspace.name).all()
        return [_ws_dict(w, counts.get(w.id, 0)) for w in rows]


def get_workspace(workspace_id: str) -> dict:
    from app.auth import scoping

    with _db() as db:
        w = db.get(Workspace, workspace_id)
        if w is None:
            raise AuthError("That workspace does not exist.", 404, "not_found")
        out = _ws_dict(w, db.query(Membership).filter(Membership.workspace_id == w.id).count())
    out["data"] = scoping.count_rows(workspace_id)
    return out


def _check_new_key(db, api_key: str, *, exclude: str = None) -> mistral_keys.KeyCheck:
    from app.config import settings

    key = mistral_keys.normalise(api_key)
    if not key:
        raise AuthError("Enter the workspace's Mistral API key.", 422, "api_key")
    fp = mistral_keys.fingerprint(key)
    q = db.query(Workspace).filter(Workspace.key_fingerprint == fp)
    if exclude:
        q = q.filter(Workspace.id != exclude)
    clash = q.first()
    if clash is not None:
        raise AuthError(f"This key is already used by the workspace “{clash.name}”.", 409,
                        "duplicate_key")
    if settings.MISTRAL_API_KEY and fp == mistral_keys.fingerprint(settings.MISTRAL_API_KEY) \
            and not exclude:
        raise AuthError("This is the platform's own key, which the Default workspace uses.", 409,
                        "duplicate_key")
    check = mistral_keys.verify(key)
    if not check.ok:
        status = 422 if check.status == "invalid" else 503
        raise AuthError(check.message, status, f"key_{check.status}")
    return check


def check_key(api_key: str) -> dict:
    """Verify a key without saving it — the "Test key" button."""
    with _db() as db:
        check = _check_new_key(db, api_key)
    return {"ok": True, "status": check.status, "message": check.message, "models": check.models}


def create_workspace(*, name: str, api_key: str, description: str = "", actor: Any = None) -> dict:
    name = _name(name, "workspace name", 80)
    with _db() as db:
        if db.query(Workspace).filter(func.lower(Workspace.name) == name.lower()).first():
            raise AuthError(f"A workspace named “{name}” already exists.", 409, "duplicate")
        check = _check_new_key(db, api_key)
        ws_id = _id()
        key = mistral_keys.normalise(api_key)
        w = Workspace(
            id=ws_id, name=name, description=(description or "").strip()[:500],
            key_source="stored", key_version=1,
            key_ciphertext=mistral_keys.encrypt(key, workspace_id=ws_id, version=1),
            key_fingerprint=mistral_keys.fingerprint(key), key_hint=mistral_keys.hint(key),
            key_status="valid", key_checked_at=_now(), key_error=None,
            created_by=_actor_fields(actor)["actor_email"],
        )
        db.add(w)
        _audit(db, "workspace.create", actor=actor, target_type="workspace", target_id=ws_id,
               workspace_id=ws_id, detail={"name": name, "key": w.key_hint, "models": check.models})
        db.commit()
        return _ws_dict(w)


def update_workspace(workspace_id: str, *, name: str = None, description: str = None,
                     disabled: bool = None, actor: Any = None) -> dict:
    with _db() as db:
        w = db.get(Workspace, workspace_id)
        if w is None:
            raise AuthError("That workspace does not exist.", 404, "not_found")
        changes: dict = {}
        if name is not None:
            name = _name(name, "workspace name", 80)
            clash = db.query(Workspace).filter(func.lower(Workspace.name) == name.lower(),
                                               Workspace.id != w.id).first()
            if clash:
                raise AuthError(f"A workspace named “{name}” already exists.", 409, "duplicate")
            changes["name"] = [w.name, name]
            w.name = name
        if description is not None:
            w.description = description.strip()[:500]
        if disabled is not None and bool(disabled) != bool(w.disabled):
            if w.is_default and disabled:
                raise AuthError("The Default workspace cannot be disabled.", 409, "default")
            w.disabled = bool(disabled)
            changes["disabled"] = bool(disabled)
        action = "workspace.disable" if changes.get("disabled") is True else (
            "workspace.enable" if changes.get("disabled") is False else "workspace.update")
        _audit(db, action, actor=actor, target_type="workspace", target_id=w.id,
               workspace_id=w.id, detail=changes or None)
        db.commit()
        n = db.query(Membership).filter(Membership.workspace_id == w.id).count()
        out = _ws_dict(w, n)
    _forget_key(workspace_id)
    return out


def recheck_key(workspace_id: str, *, actor: Any = None) -> dict:
    with _db() as db:
        w = db.get(Workspace, workspace_id)
        if w is None:
            raise AuthError("That workspace does not exist.", 404, "not_found")
        key = None
        if w.key_source == "platform":
            from app.config import settings

            key = settings.MISTRAL_API_KEY
        elif w.key_ciphertext:
            try:
                key = mistral_keys.decrypt(w.key_ciphertext, workspace_id=w.id)
            except Exception:
                key = None
        if not key:
            w.key_status, w.key_error = "invalid", "No key is stored for this workspace."
        else:
            check = mistral_keys.verify(key)
            if check.status in ("valid", "invalid"):
                w.key_status = check.status
            w.key_error = None if check.ok else check.message
        w.key_checked_at = _now()
        _audit(db, "workspace.key_check", actor=actor, target_type="workspace", target_id=w.id,
               workspace_id=w.id, outcome="ok" if w.key_status == "valid" else "failed",
               detail={"status": w.key_status, "error": w.key_error})
        db.commit()
        n = db.query(Membership).filter(Membership.workspace_id == w.id).count()
        return _ws_dict(w, n)


def mark_key_invalid(workspace_id: str, message: str) -> None:
    """Called when Mistral answers 401 to a workspace's key mid-request."""
    try:
        with _db() as db:
            w = db.get(Workspace, workspace_id)
            if w is not None and w.key_status != "invalid":
                w.key_status, w.key_error, w.key_checked_at = "invalid", message[:300], _now()
                _audit(db, "workspace.key_rejected", target_type="workspace", target_id=w.id,
                       workspace_id=w.id, outcome="failed", detail={"error": message[:300]})
                db.commit()
    except Exception:
        pass


def rotate_key(workspace_id: str, *, api_key: str, allow_other_workspace: bool = False,
               actor: Any = None) -> dict:
    with _db() as db:
        w = db.get(Workspace, workspace_id)
        if w is None:
            raise AuthError("That workspace does not exist.", 404, "not_found")
        if w.key_source == "platform":
            raise AuthError("The Default workspace uses the platform's MISTRAL_API_KEY — change "
                            "it on the Settings page.", 409, "default")
        check = _check_new_key(db, api_key, exclude=w.id)
        new_key = mistral_keys.normalise(api_key)
        old_key = (mistral_keys.decrypt(w.key_ciphertext, workspace_id=w.id)
                   if w.key_ciphertext else "")
        same = mistral_keys.same_workspace(old_key, new_key) if old_key else None
        if same is False and not allow_other_workspace:
            raise AuthError(
                "This key belongs to a different Mistral workspace: the agents, libraries and "
                "conversations this workspace already has would no longer be reachable. Confirm "
                "to switch anyway.", 409, "other_workspace")
        w.key_version = (w.key_version or 1) + 1
        w.key_ciphertext = mistral_keys.encrypt(new_key, workspace_id=w.id, version=w.key_version)
        w.key_fingerprint = mistral_keys.fingerprint(new_key)
        w.key_hint = mistral_keys.hint(new_key)
        w.key_status, w.key_error, w.key_checked_at, w.key_rotated_at = "valid", None, _now(), _now()
        _audit(db, "workspace.key_rotate", actor=actor, target_type="workspace", target_id=w.id,
               workspace_id=w.id, detail={"key": w.key_hint, "same_mistral_workspace": same,
                                          "models": check.models})
        db.commit()
        n = db.query(Membership).filter(Membership.workspace_id == w.id).count()
        out = _ws_dict(w, n)
    _forget_key(workspace_id)
    out["same_mistral_workspace"] = same
    return out


def delete_workspace(workspace_id: str, *, actor: Any = None) -> dict:
    from app.auth import scoping

    with _db() as db:
        w = db.get(Workspace, workspace_id)
        if w is None:
            raise AuthError("That workspace does not exist.", 404, "not_found")
        if w.is_default:
            raise AuthError("The Default workspace cannot be deleted.", 409, "default")
        members = db.query(Membership).filter(Membership.workspace_id == w.id).count()
        if members:
            raise AuthError(f"{members} user(s) still belong to this workspace. Remove them "
                            "first, or disable the workspace instead.", 409, "in_use")
    data = scoping.count_rows(workspace_id)
    if data:
        raise AuthError("This workspace still owns data (" + ", ".join(
            f"{n} in {t}" for t, n in data.items()) + "). Disable it instead, so nothing is lost.",
            409, "has_data")
    with _db() as db:
        w = db.get(Workspace, workspace_id)
        name = w.name
        db.delete(w)
        db.query(AuthSession).filter(AuthSession.workspace_id == workspace_id).update(
            {"revoked_at": _now()}, synchronize_session=False)
        _audit(db, "workspace.delete", actor=actor, target_type="workspace", target_id=workspace_id,
               workspace_id=workspace_id, detail={"name": name})
        db.commit()
    _forget_key(workspace_id)
    return {"deleted": workspace_id}


def workspace_members(workspace_id: str) -> list[dict]:
    with _db() as db:
        rows = (db.query(Membership, User, Role)
                .join(User, User.id == Membership.user_id)
                .join(Role, Role.id == Membership.role_id)
                .filter(Membership.workspace_id == workspace_id, User.status != "deleted")
                .order_by(User.name).all())
        return [{"user_id": u.id, "name": u.name, "email": u.email, "status": u.status,
                 "role_id": r.id, "role_name": r.name, "since": _iso(m.created_at)}
                for m, u, r in rows]


# ── Users ───────────────────────────────────────────────────────────────────

def _memberships_of(db, user_id: str) -> list[dict]:
    rows = (db.query(Membership, Workspace, Role)
            .join(Workspace, Workspace.id == Membership.workspace_id)
            .join(Role, Role.id == Membership.role_id)
            .filter(Membership.user_id == user_id)
            .order_by(Workspace.name).all())
    return [{"workspace_id": w.id, "workspace_name": w.name, "workspace_disabled": bool(w.disabled),
             "role_id": r.id, "role_name": r.name} for m, w, r in rows]


def _locked(row) -> bool:
    return bool(row.locked_until and row.locked_until > _now())


def _user_dict(db, u: User, *, detail: bool = False) -> dict:
    out = {
        "id": u.id, "email": u.email, "name": u.name, "status": u.status,
        "locked": _locked(u), "must_change_password": bool(u.must_change_password),
        "last_login_at": _iso(u.last_login_at), "created_at": _iso(u.created_at),
        "created_by": u.created_by, "memberships": _memberships_of(db, u.id),
    }
    if detail:
        now = _now()
        out["active_sessions"] = db.query(AuthSession).filter(
            AuthSession.kind == "user", AuthSession.subject_id == u.id,
            AuthSession.revoked_at.is_(None), AuthSession.expires_at > now).count()
        pending = db.query(AuthToken).filter(
            AuthToken.subject_kind == "user", AuthToken.subject_id == u.id,
            AuthToken.used_at.is_(None), AuthToken.expires_at > now).order_by(
            AuthToken.created_at.desc()).first()
        out["pending_link"] = ({"kind": pending.kind, "expires_at": _iso(pending.expires_at)}
                               if pending else None)
        out["password_changed_at"] = _iso(u.password_changed_at)
    return out


def _clean_memberships(db, memberships: Iterable[dict]) -> list[tuple[str, str]]:
    out: dict[str, str] = {}
    for m in memberships or []:
        ws_id = str((m or {}).get("workspace_id") or "")
        role_id = str((m or {}).get("role_id") or "")
        if not ws_id or not role_id:
            raise AuthError("Each workspace needs a role.", 422, "memberships")
        if db.get(Workspace, ws_id) is None:
            raise AuthError("One of the chosen workspaces does not exist.", 422, "memberships")
        if db.get(Role, role_id) is None:
            raise AuthError("One of the chosen roles does not exist.", 422, "memberships")
        out[ws_id] = role_id
    if not out:
        raise AuthError("Add the user to at least one workspace.", 422, "memberships")
    return list(out.items())


def _issue_token(db, *, kind: str, subject_kind: str, subject_id: str, actor: Any) -> tuple[str, datetime]:
    now = _now()
    # One live link of each kind per account: issuing a new one voids the old.
    db.query(AuthToken).filter(AuthToken.subject_kind == subject_kind,
                               AuthToken.subject_id == subject_id, AuthToken.kind == kind,
                               AuthToken.used_at.is_(None)).update(
        {"used_at": now}, synchronize_session=False)
    token = pw.new_token()
    expires = now + (timedelta(days=cfg.invite_days()) if kind == "invite"
                     else timedelta(hours=cfg.reset_hours()))
    db.add(AuthToken(id=pw.token_hash(token), kind=kind, subject_kind=subject_kind,
                     subject_id=subject_id, created_by=_actor_fields(actor)["actor_email"],
                     expires_at=expires))
    return token, expires


def _link(kind: str, token: str, expires: datetime) -> dict:
    path = f"/invite/{token}" if kind == "invite" else f"/reset-password/{token}"
    return {"kind": kind, "path": path, "token": token, "expires_at": _iso(expires)}


def list_users(*, q: str = None, workspace_id: str = None, status: str = None,
               include_deleted: bool = False) -> list[dict]:
    with _db() as db:
        query = db.query(User)
        if not include_deleted:
            query = query.filter(User.status != "deleted")
        if status:
            query = query.filter(User.status == status)
        if q:
            like = f"%{q.strip().lower()}%"
            query = query.filter((func.lower(User.email).like(like)) | (func.lower(User.name).like(like)))
        if workspace_id:
            ids = [m.user_id for m in db.query(Membership).filter(Membership.workspace_id == workspace_id)]
            query = query.filter(User.id.in_(ids or ["-"]))
        return [_user_dict(db, u) for u in query.order_by(User.name).all()]


def get_user(user_id: str) -> dict:
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        return _user_dict(db, u, detail=True)


def create_user(*, email: str, name: str, memberships: Iterable[dict], actor: Any = None) -> dict:
    email, name = _email(email), _name(name)
    with _db() as db:
        if db.query(User).filter(User.email == email).first():
            raise AuthError("A user with this email already exists.", 409, "duplicate")
        pairs = _clean_memberships(db, memberships)
        u = User(id=_id(), email=email, name=name, status="invited",
                 created_by=_actor_fields(actor)["actor_email"], last_workspace_id=pairs[0][0])
        db.add(u)
        for ws_id, role_id in pairs:
            db.add(Membership(user_id=u.id, workspace_id=ws_id, role_id=role_id,
                              created_by=_actor_fields(actor)["actor_email"]))
        token, expires = _issue_token(db, kind="invite", subject_kind="user", subject_id=u.id,
                                      actor=actor)
        _audit(db, "user.create", actor=actor, target_type="user", target_id=u.id,
               detail={"email": email, "memberships": [{"workspace_id": w, "role_id": r}
                                                       for w, r in pairs]})
        db.commit()
        out = _user_dict(db, u, detail=True)
    out["link"] = _link("invite", token, expires)
    return out


def update_user(user_id: str, *, name: str = None, email: str = None, actor: Any = None) -> dict:
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        changes = {}
        if name is not None:
            u.name = _name(name)
            changes["name"] = u.name
        if email is not None:
            email = _email(email)
            if email != u.email:
                if db.query(User).filter(User.email == email, User.id != u.id).first():
                    raise AuthError("A user with this email already exists.", 409, "duplicate")
                changes["email"] = [u.email, email]
                u.email = email
        _audit(db, "user.update", actor=actor, target_type="user", target_id=u.id, detail=changes)
        db.commit()
        return _user_dict(db, u, detail=True)


def set_memberships(user_id: str, memberships: Iterable[dict], *, actor: Any = None) -> dict:
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        pairs = dict(_clean_memberships(db, memberships))
        before = {m.workspace_id: m.role_id for m in
                  db.query(Membership).filter(Membership.user_id == u.id)}
        for m in db.query(Membership).filter(Membership.user_id == u.id).all():
            if m.workspace_id not in pairs:
                db.delete(m)
            elif m.role_id != pairs[m.workspace_id]:
                m.role_id = pairs[m.workspace_id]
        for ws_id, role_id in pairs.items():
            if ws_id not in before:
                db.add(Membership(user_id=u.id, workspace_id=ws_id, role_id=role_id,
                                  created_by=_actor_fields(actor)["actor_email"]))
        removed = [w for w in before if w not in pairs]
        if removed:
            # Sessions working in a workspace the user just left move elsewhere
            # on their next request (resolve_session picks another membership).
            if u.last_workspace_id in removed:
                u.last_workspace_id = next(iter(pairs))
        _audit(db, "user.memberships", actor=actor, target_type="user", target_id=u.id,
               detail={"before": before, "after": pairs})
        db.commit()
        return _user_dict(db, u, detail=True)


def issue_link(user_id: str, *, actor: Any = None) -> dict:
    """A fresh invite link (never signed in) or password-reset link (active)."""
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        if u.status == "disabled":
            raise AuthError("Enable the user before sending them a link.", 409, "disabled")
        kind = "invite" if u.status == "invited" or not u.password_hash else "reset"
        token, expires = _issue_token(db, kind=kind, subject_kind="user", subject_id=u.id,
                                      actor=actor)
        _audit(db, f"user.{kind}_link", actor=actor, target_type="user", target_id=u.id)
        db.commit()
        return _link(kind, token, expires)


def _revoke_sessions(db, kind: str, subject_id: str, *, keep: str = None) -> int:
    forget_principals()
    q = db.query(AuthSession).filter(AuthSession.kind == kind, AuthSession.subject_id == subject_id,
                                     AuthSession.revoked_at.is_(None))
    if keep:
        q = q.filter(AuthSession.id != keep)
    return q.update({"revoked_at": _now()}, synchronize_session=False)


def set_user_status(user_id: str, *, disabled: bool, actor: Any = None) -> dict:
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        if disabled:
            u.status = "disabled"
            n = _revoke_sessions(db, "user", u.id)
            _audit(db, "user.disable", actor=actor, target_type="user", target_id=u.id,
                   detail={"sessions_ended": n})
        else:
            u.status = "active" if u.password_hash else "invited"
            u.failed_logins, u.locked_until = 0, None
            _audit(db, "user.enable", actor=actor, target_type="user", target_id=u.id)
        db.commit()
        return _user_dict(db, u, detail=True)


def unlock_user(user_id: str, *, actor: Any = None) -> dict:
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        u.failed_logins, u.locked_until = 0, None
        _audit(db, "user.unlock", actor=actor, target_type="user", target_id=u.id)
        db.commit()
        return _user_dict(db, u, detail=True)


def revoke_user_sessions(user_id: str, *, actor: Any = None) -> dict:
    with _db() as db:
        n = _revoke_sessions(db, "user", user_id)
        _audit(db, "user.sessions_revoke", actor=actor, target_type="user", target_id=user_id,
               detail={"sessions_ended": n})
        db.commit()
        return {"sessions_ended": n}


def delete_user(user_id: str, *, actor: Any = None) -> dict:
    """Remove a user.

    Someone who never signed in is deleted outright. Anyone else is
    anonymised: their sign-in, memberships, sessions and links are removed and
    their name and email erased, but the row stays so the audit log and the
    "created by" of what they built keep pointing at something. Everything
    they built stays in its workspace.
    """
    with _db() as db:
        u = db.get(User, user_id)
        if u is None or u.status == "deleted":
            raise AuthError("That user does not exist.", 404, "not_found")
        email = u.email
        db.query(Membership).filter(Membership.user_id == u.id).delete(synchronize_session=False)
        db.query(AuthToken).filter(AuthToken.subject_kind == "user",
                                   AuthToken.subject_id == u.id).delete(synchronize_session=False)
        ended = _revoke_sessions(db, "user", u.id)
        hard = u.last_login_at is None and u.password_hash is None
        if hard:
            db.delete(u)
        else:
            u.status, u.deleted_at = "deleted", _now()
            u.email = f"deleted-{u.id}@deleted.invalid"
            u.name = "Deleted user"
            u.password_hash = None
            u.last_workspace_id = None
        _audit(db, "user.delete", actor=actor, target_type="user", target_id=user_id,
               detail={"email": email, "mode": "removed" if hard else "anonymised",
                       "sessions_ended": ended})
        db.commit()
        return {"deleted": user_id, "mode": "removed" if hard else "anonymised"}


# ── Admins ──────────────────────────────────────────────────────────────────

def _admin_dict(db, a: Admin) -> dict:
    now = _now()
    return {
        "id": a.id, "email": a.email, "name": a.name, "status": a.status, "locked": _locked(a),
        "must_change_password": bool(a.must_change_password),
        "last_login_at": _iso(a.last_login_at), "created_at": _iso(a.created_at),
        "created_by": a.created_by,
        "active_sessions": db.query(AuthSession).filter(
            AuthSession.kind == "admin", AuthSession.subject_id == a.id,
            AuthSession.revoked_at.is_(None), AuthSession.expires_at > now).count(),
    }


def admin_count() -> int:
    with _db() as db:
        return db.query(Admin).filter(Admin.status != "disabled").count()


def ensure_bootstrap_admin() -> Optional[str]:
    """Create the first admin from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD.

    Only when no admin exists at all, and with "must change password" set, so
    the value in the environment stops working at the first sign-in.
    """
    with _db() as db:
        if db.query(Admin).count():
            return None
        email, password, name = cfg.bootstrap_admin()
        if not email or not password:
            logger.warning(
                "⚠️ No platform admin exists. Set ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD in the "
                "backend's environment and restart, or run: python -m app.auth.cli create-admin")
            return None
        try:
            email = _email(email)
            _policy(password, email=email, admin=True)
        except AuthError as e:
            logger.error("⚠️ The first admin was not created: %s", e.message)
            return None
        a = Admin(id=_id(), email=email, name=_name(name), password_hash=pw.hash_password(password),
                  status="active", must_change_password=True, created_by="bootstrap")
        db.add(a)
        _audit(db, "admin.create", target_type="admin", target_id=a.id,
               detail={"email": email, "bootstrap": True})
        db.commit()
        logger.info("✅ Created the first platform admin %s (must change password)", email)
        return a.id


def create_admin_with_password(*, email: str, name: str, password: str) -> dict:
    """For the CLI: an admin who can sign in at once (and must change password)."""
    email, name = _email(email), _name(name)
    _policy(password, email=email, name=name, admin=True)
    with _db() as db:
        existing = db.query(Admin).filter(Admin.email == email).first()
        if existing:
            existing.password_hash = pw.hash_password(password)
            existing.status, existing.failed_logins, existing.locked_until = "active", 0, None
            existing.must_change_password = True
            _revoke_sessions(db, "admin", existing.id)
            _audit(db, "admin.recover", target_type="admin", target_id=existing.id,
                   detail={"email": email, "cli": True})
            db.commit()
            return _admin_dict(db, existing)
        a = Admin(id=_id(), email=email, name=name, password_hash=pw.hash_password(password),
                  status="active", must_change_password=True, created_by="cli")
        db.add(a)
        _audit(db, "admin.create", target_type="admin", target_id=a.id,
               detail={"email": email, "cli": True})
        db.commit()
        return _admin_dict(db, a)


def list_admins() -> list[dict]:
    with _db() as db:
        return [_admin_dict(db, a) for a in db.query(Admin).order_by(Admin.name).all()]


def create_admin(*, email: str, name: str, actor: Any = None) -> dict:
    email, name = _email(email), _name(name)
    with _db() as db:
        if db.query(Admin).filter(Admin.email == email).first():
            raise AuthError("An admin with this email already exists.", 409, "duplicate")
        a = Admin(id=_id(), email=email, name=name, status="invited",
                  created_by=_actor_fields(actor)["actor_email"])
        db.add(a)
        token, expires = _issue_token(db, kind="invite", subject_kind="admin", subject_id=a.id,
                                      actor=actor)
        _audit(db, "admin.create", actor=actor, target_type="admin", target_id=a.id,
               detail={"email": email})
        db.commit()
        out = _admin_dict(db, a)
    out["link"] = _link("invite", token, expires)
    return out


def _active_admins_except(db, admin_id: str) -> int:
    return db.query(Admin).filter(Admin.status == "active", Admin.id != admin_id).count()


def update_admin(admin_id: str, *, name: str = None, disabled: bool = None,
                 actor: Any = None) -> dict:
    with _db() as db:
        a = db.get(Admin, admin_id)
        if a is None:
            raise AuthError("That admin does not exist.", 404, "not_found")
        if name is not None:
            a.name = _name(name)
        if disabled is not None:
            if disabled:
                if isinstance(actor, Principal) and actor.id == a.id:
                    raise AuthError("You cannot disable your own admin account.", 409, "self")
                if not _active_admins_except(db, a.id):
                    raise AuthError("This is the last active admin.", 409, "last_admin")
                a.status = "disabled"
                _revoke_sessions(db, "admin", a.id)
            else:
                a.status = "active" if a.password_hash else "invited"
                a.failed_logins, a.locked_until = 0, None
        _audit(db, "admin.update", actor=actor, target_type="admin", target_id=a.id,
               detail={"name": name, "disabled": disabled})
        db.commit()
        return _admin_dict(db, a)


def admin_link(admin_id: str, *, actor: Any = None) -> dict:
    with _db() as db:
        a = db.get(Admin, admin_id)
        if a is None:
            raise AuthError("That admin does not exist.", 404, "not_found")
        kind = "invite" if not a.password_hash else "reset"
        token, expires = _issue_token(db, kind=kind, subject_kind="admin", subject_id=a.id,
                                      actor=actor)
        _audit(db, f"admin.{kind}_link", actor=actor, target_type="admin", target_id=a.id)
        db.commit()
        return _link(kind, token, expires)


def delete_admin(admin_id: str, *, actor: Any = None) -> dict:
    with _db() as db:
        a = db.get(Admin, admin_id)
        if a is None:
            raise AuthError("That admin does not exist.", 404, "not_found")
        if isinstance(actor, Principal) and actor.id == a.id:
            raise AuthError("You cannot delete your own admin account.", 409, "self")
        if a.status == "active" and not _active_admins_except(db, a.id):
            raise AuthError("This is the last active admin.", 409, "last_admin")
        _revoke_sessions(db, "admin", a.id)
        db.query(AuthToken).filter(AuthToken.subject_kind == "admin",
                                   AuthToken.subject_id == a.id).delete(synchronize_session=False)
        email = a.email
        db.delete(a)
        _audit(db, "admin.delete", actor=actor, target_type="admin", target_id=admin_id,
               detail={"email": email})
        db.commit()
        return {"deleted": admin_id}


# ── Sign-in ─────────────────────────────────────────────────────────────────

_ip_attempts: dict[str, deque] = {}
_ip_lock = threading.Lock()


def _ip_allowed(ip: Optional[str]) -> bool:
    """Is this address still under its limit of *failed* sign-ins?

    Only failures count: a whole office signing in at nine from one NAT address
    is fine, an address guessing passwords is not.
    """
    if not ip:
        return True
    now = time.monotonic()
    with _ip_lock:
        q = _ip_attempts.get(ip)
        if not q:
            return True
        while q and now - q[0] > cfg.IP_WINDOW_SECONDS:
            q.popleft()
        return len(q) < cfg.ip_attempts_per_window()


def _ip_failed(ip: Optional[str]) -> None:
    if not ip:
        return
    with _ip_lock:
        _ip_attempts.setdefault(ip, deque()).append(time.monotonic())
        if len(_ip_attempts) > 10_000:  # bound memory under a spray
            for k in list(_ip_attempts)[:5_000]:
                _ip_attempts.pop(k, None)


def reset_rate_limits() -> None:
    with _ip_lock:
        _ip_attempts.clear()


_GENERIC = "The email or password is incorrect."


def _create_session(db, *, kind: str, subject_id: str, workspace_id: Optional[str],
                    ip: str = None, user_agent: str = None) -> str:
    token = pw.new_token()
    hours = cfg.admin_max_hours() if kind == "admin" else cfg.user_max_hours()
    now = _now()
    db.add(AuthSession(id=pw.token_hash(token), public_id=_id()[:16], kind=kind,
                       subject_id=subject_id, workspace_id=workspace_id, last_seen_at=now,
                       expires_at=now + timedelta(hours=hours), ip=ip,
                       user_agent=(user_agent or "")[:300]))
    return token


def _pick_workspace(db, user: User, preferred: Optional[str] = None) -> Optional[str]:
    rows = (db.query(Membership.workspace_id)
            .join(Workspace, Workspace.id == Membership.workspace_id)
            .filter(Membership.user_id == user.id, Workspace.disabled.is_(False))
            .order_by(Workspace.name).all())
    ids = [r[0] for r in rows]
    for choice in (preferred, user.last_workspace_id):
        if choice and choice in ids:
            return choice
    return ids[0] if ids else None


def login(kind: str, email: str, password: str, *, ip: str = None, user_agent: str = None) -> dict:
    """Check a password and open a session. Returns ``{"token", "must_change_password"}``."""
    if not _ip_allowed(ip):
        audit(f"{kind}.login", outcome="denied", ip=ip, detail={"reason": "rate_limited"})
        raise AuthError("Too many sign-in attempts from this address. Wait a few minutes.", 429,
                        "rate_limited")
    model = Admin if kind == "admin" else User
    email = (email or "").strip().lower()
    with _db() as db:
        row = db.query(model).filter(model.email == email).first() if email else None
        if row is None or row.status in ("deleted",):
            pw.verify_password(None, password)
            _audit(db, f"{kind}.login", outcome="failed", ip=ip,
                   detail={"email": email[:254], "reason": "unknown"})
            db.commit()
            _ip_failed(ip)
            raise AuthError(_GENERIC, 401, "credentials")
        actor = {"kind": kind, "id": row.id, "email": row.email}
        if _locked(row):
            pw.verify_password(None, password)
            _audit(db, f"{kind}.login", actor=actor, outcome="denied", ip=ip,
                   detail={"reason": "locked"})
            db.commit()
            raise AuthError("This account is locked after too many failed sign-ins. Try again "
                            "later or ask an admin to unlock it.", 423, "locked")
        if not pw.verify_password(row.password_hash, password):
            row.failed_logins = (row.failed_logins or 0) + 1
            locked = row.failed_logins >= cfg.max_failed_logins()
            if locked:
                row.locked_until = _now() + timedelta(minutes=cfg.lockout_minutes())
                row.failed_logins = 0
            _audit(db, f"{kind}.login", actor=actor, outcome="failed", ip=ip,
                   detail={"reason": "password", "locked": locked})
            db.commit()
            _ip_failed(ip)
            raise AuthError(_GENERIC, 401, "credentials")
        if row.status == "disabled":
            _audit(db, f"{kind}.login", actor=actor, outcome="denied", ip=ip,
                   detail={"reason": "disabled"})
            db.commit()
            raise AuthError("This account is disabled. Contact your administrator.", 403,
                            "disabled")
        if row.status == "invited":
            raise AuthError("Finish setting up your account from your invite link first.", 403,
                            "invited")
        workspace_id = None
        if kind == "user":
            workspace_id = _pick_workspace(db, row)
            if workspace_id is None:
                _audit(db, "user.login", actor=actor, outcome="denied", ip=ip,
                       detail={"reason": "no_workspace"})
                db.commit()
                raise AuthError("Your account is not in any active workspace. Contact your "
                                "administrator.", 403, "no_workspace")
            row.last_workspace_id = workspace_id
        if pw.needs_rehash(row.password_hash):
            row.password_hash = pw.hash_password(password)
        row.failed_logins, row.locked_until, row.last_login_at = 0, None, _now()
        token = _create_session(db, kind=kind, subject_id=row.id, workspace_id=workspace_id,
                                ip=ip, user_agent=user_agent)
        _audit(db, f"{kind}.login", actor=actor, ip=ip, workspace_id=workspace_id)
        db.commit()
        return {"token": token, "must_change_password": bool(row.must_change_password)}


def _principal_for(db, s: AuthSession) -> Optional[Principal]:
    if s.kind == "admin":
        a = db.get(Admin, s.subject_id)
        if a is None or a.status != "active":
            return None
        return Principal(kind="admin", id=a.id, email=a.email, name=a.name, session_id=s.id,
                         must_change_password=bool(a.must_change_password))
    u = db.get(User, s.subject_id)
    if u is None or u.status != "active":
        return None
    ws_id = s.workspace_id
    m = None
    if ws_id:
        m = db.query(Membership).filter(Membership.user_id == u.id,
                                        Membership.workspace_id == ws_id).first()
    ws = db.get(Workspace, ws_id) if m else None
    if m is None or ws is None or ws.disabled:
        ws_id = _pick_workspace(db, u)
        if ws_id is None:
            return None
        s.workspace_id = ws_id
        m = db.query(Membership).filter(Membership.user_id == u.id,
                                        Membership.workspace_id == ws_id).first()
        ws = db.get(Workspace, ws_id)
        db.commit()
    role = db.get(Role, m.role_id)
    perms = frozenset(json.loads(role.permissions or "[]")) if role else frozenset()
    return Principal(kind="user", id=u.id, email=u.email, name=u.name, session_id=s.id,
                     workspace_id=ws.id, workspace_name=ws.name,
                     role_id=role.id if role else None, role_name=role.name if role else None,
                     permissions=perms, must_change_password=bool(u.must_change_password))


def account_flags(principal: Principal) -> dict:
    model = Admin if principal.kind == "admin" else User
    with _db() as db:
        row = db.get(model, principal.id)
        if row is None:
            return {}
        return {"must_change_password": bool(row.must_change_password),
                "last_login_at": _iso(row.last_login_at),
                "password_changed_at": _iso(row.password_changed_at),
                "created_at": _iso(row.created_at)}


def resolve_session(kind: str, token: str) -> Optional[Principal]:
    """The person behind a session cookie, or None. Extends the idle window."""
    if not token or len(token) > 200:
        return None
    sid = pw.token_hash(token)
    hit = _principals.get((kind, sid))
    if hit and time.monotonic() - hit[0] < _PRINCIPAL_TTL:
        return hit[1]
    with _db() as db:
        s = db.get(AuthSession, sid)
        if s is None or s.kind != kind or s.revoked_at is not None:
            return None
        now = _now()
        idle = timedelta(minutes=cfg.admin_idle_minutes() if kind == "admin"
                         else cfg.user_idle_minutes())
        if s.expires_at <= now or (s.last_seen_at and now - s.last_seen_at > idle):
            s.revoked_at = now
            db.commit()
            return None
        principal = _principal_for(db, s)
        if principal is None:
            return None
        if not s.last_seen_at or (now - s.last_seen_at).total_seconds() > 60:
            s.last_seen_at = now
            db.commit()
        if len(_principals) > 20_000:
            _principals.clear()
        _principals[(kind, sid)] = (time.monotonic(), principal)
        return principal


def logout(token: str, *, actor: Any = None, ip: str = None) -> None:
    if not token:
        return
    with _db() as db:
        s = db.get(AuthSession, pw.token_hash(token))
        if s is not None and s.revoked_at is None:
            s.revoked_at = _now()
            _audit(db, f"{s.kind}.logout", actor=actor, ip=ip, workspace_id=s.workspace_id)
            db.commit()


def logout_everywhere(principal: Principal, *, keep_current: bool = False, ip: str = None) -> int:
    with _db() as db:
        n = _revoke_sessions(db, principal.kind, principal.id,
                             keep=principal.session_id if keep_current else None)
        _audit(db, f"{principal.kind}.logout_all", actor=principal, ip=ip,
               detail={"sessions_ended": n, "kept_current": keep_current})
        db.commit()
        return n


def list_sessions(principal: Principal) -> list[dict]:
    with _db() as db:
        now = _now()
        rows = (db.query(AuthSession)
                .filter(AuthSession.kind == principal.kind,
                        AuthSession.subject_id == principal.id,
                        AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
                .order_by(AuthSession.last_seen_at.desc()).all())
        names = {w.id: w.name for w in db.query(Workspace).all()}
        return [{"id": s.public_id, "current": s.id == principal.session_id,
                 "created_at": _iso(s.created_at), "last_seen_at": _iso(s.last_seen_at),
                 "expires_at": _iso(s.expires_at), "ip": s.ip, "user_agent": s.user_agent,
                 "workspace_name": names.get(s.workspace_id)} for s in rows]


def revoke_session(principal: Principal, public_id: str) -> None:
    with _db() as db:
        s = db.query(AuthSession).filter(AuthSession.public_id == public_id,
                                         AuthSession.kind == principal.kind,
                                         AuthSession.subject_id == principal.id).first()
        if s is None:
            raise AuthError("That session does not exist.", 404, "not_found")
        s.revoked_at = _now()
        _audit(db, f"{principal.kind}.session_revoke", actor=principal)
        db.commit()


def switch_workspace(principal: Principal, workspace_id: str) -> None:
    with _db() as db:
        m = (db.query(Membership).join(Workspace, Workspace.id == Membership.workspace_id)
             .filter(Membership.user_id == principal.id, Membership.workspace_id == workspace_id,
                     Workspace.disabled.is_(False)).first())
        if m is None:
            raise AuthError("You are not a member of that workspace.", 403, "not_member")
        s = db.get(AuthSession, principal.session_id)
        u = db.get(User, principal.id)
        if s is None or u is None:
            raise AuthError("Your session has ended. Sign in again.", 401, "session")
        s.workspace_id = workspace_id
        u.last_workspace_id = workspace_id
        _audit(db, "user.switch_workspace", actor=principal, workspace_id=workspace_id)
        db.commit()


def my_workspaces(principal: Principal) -> list[dict]:
    with _db() as db:
        rows = (db.query(Membership, Workspace, Role)
                .join(Workspace, Workspace.id == Membership.workspace_id)
                .join(Role, Role.id == Membership.role_id)
                .filter(Membership.user_id == principal.id, Workspace.disabled.is_(False))
                .order_by(Workspace.name).all())
        return [{"id": w.id, "name": w.name, "description": w.description or "",
                 "role_id": r.id, "role_name": r.name, "key_status": w.key_status,
                 "active": w.id == principal.workspace_id} for m, w, r in rows]


def change_password(principal: Principal, current: str, new: str, *, ip: str = None) -> None:
    model = Admin if principal.kind == "admin" else User
    with _db() as db:
        row = db.get(model, principal.id)
        if row is None:
            raise AuthError("Your session has ended. Sign in again.", 401, "session")
        if not pw.verify_password(row.password_hash, current):
            _audit(db, f"{principal.kind}.password_change", actor=principal, outcome="failed", ip=ip)
            db.commit()
            raise AuthError("Your current password is incorrect.", 403, "current_password")
        if pw.verify_password(row.password_hash, new):
            raise AuthError("Choose a password different from your current one.", 422, "password")
        _policy(new, email=row.email, name=row.name, admin=principal.kind == "admin")
        row.password_hash = pw.hash_password(new)
        row.must_change_password = False
        row.password_changed_at = _now()
        ended = _revoke_sessions(db, principal.kind, principal.id, keep=principal.session_id)
        _audit(db, f"{principal.kind}.password_change", actor=principal, ip=ip,
               detail={"other_sessions_ended": ended})
        db.commit()


def update_profile(principal: Principal, *, name: str) -> dict:
    model = Admin if principal.kind == "admin" else User
    with _db() as db:
        row = db.get(model, principal.id)
        if row is None:
            raise AuthError("Your session has ended. Sign in again.", 401, "session")
        row.name = _name(name)
        _audit(db, f"{principal.kind}.profile", actor=principal, detail={"name": row.name})
        db.commit()
        return {"name": row.name}


# ── Invite and reset links ──────────────────────────────────────────────────

def _token_row(db, token: str) -> AuthToken:
    row = db.get(AuthToken, pw.token_hash(token)) if token and len(token) < 200 else None
    if row is None or row.used_at is not None:
        raise AuthError("This link is invalid or has already been used. Ask your administrator "
                        "for a new one.", 410, "link_invalid")
    if row.expires_at <= _now():
        raise AuthError("This link has expired. Ask your administrator for a new one.", 410,
                        "link_expired")
    return row


def link_info(token: str) -> dict:
    with _db() as db:
        t = _token_row(db, token)
        model = Admin if t.subject_kind == "admin" else User
        row = db.get(model, t.subject_id)
        if row is None or row.status in ("deleted", "disabled"):
            raise AuthError("This account is no longer available.", 410, "link_invalid")
        out = {"kind": t.kind, "account": t.subject_kind, "email": row.email, "name": row.name,
               "expires_at": _iso(t.expires_at), "workspaces": []}
        if t.subject_kind == "user":
            out["workspaces"] = [{"name": m["workspace_name"], "role": m["role_name"]}
                                 for m in _memberships_of(db, row.id)]
        return out


def accept_link(token: str, *, password: str, name: str = None, ip: str = None,
                user_agent: str = None) -> dict:
    """Set the password from an invite or reset link, then sign in."""
    with _db() as db:
        t = _token_row(db, token)
        model = Admin if t.subject_kind == "admin" else User
        row = db.get(model, t.subject_id)
        if row is None or row.status in ("deleted", "disabled"):
            raise AuthError("This account is no longer available.", 410, "link_invalid")
        if name is not None and name.strip():
            row.name = _name(name)
        _policy(password, email=row.email, name=row.name, admin=t.subject_kind == "admin")
        row.password_hash = pw.hash_password(password)
        row.status = "active"
        row.must_change_password = False
        row.password_changed_at = _now()
        row.failed_logins, row.locked_until = 0, None
        t.used_at = _now()
        _revoke_sessions(db, t.subject_kind, row.id)
        workspace_id = None
        if t.subject_kind == "user":
            workspace_id = _pick_workspace(db, row)
            if workspace_id is None:
                db.commit()
                raise AuthError("Your password is set, but your account is not in any active "
                                "workspace yet. Contact your administrator.", 403, "no_workspace")
            row.last_workspace_id = workspace_id
        row.last_login_at = _now()
        session = _create_session(db, kind=t.subject_kind, subject_id=row.id,
                                  workspace_id=workspace_id, ip=ip, user_agent=user_agent)
        _audit(db, f"{t.subject_kind}.{'invite_accept' if t.kind == 'invite' else 'password_reset'}",
               actor={"kind": t.subject_kind, "id": row.id, "email": row.email}, ip=ip,
               workspace_id=workspace_id)
        db.commit()
        return {"account": t.subject_kind, "token": session}


# ── Overview ────────────────────────────────────────────────────────────────

def overview() -> dict:
    with _db() as db:
        now = _now()
        users = dict(db.query(User.status, func.count(User.id)).group_by(User.status).all())
        workspaces = db.query(Workspace).all()
        since = now - timedelta(days=1)
        failed = db.query(AuditEvent).filter(AuditEvent.at >= since,
                                             AuditEvent.action.in_(["user.login", "admin.login"]),
                                             AuditEvent.outcome != "ok").count()
        logins = db.query(AuditEvent).filter(AuditEvent.at >= since,
                                             AuditEvent.action == "user.login",
                                             AuditEvent.outcome == "ok").count()
        sessions = db.query(AuthSession).filter(AuthSession.kind == "user",
                                                AuthSession.revoked_at.is_(None),
                                                AuthSession.expires_at > now).count()
        return {
            "users": {"total": sum(v for k, v in users.items() if k != "deleted"),
                      "active": users.get("active", 0), "invited": users.get("invited", 0),
                      "disabled": users.get("disabled", 0)},
            "workspaces": {"total": len(workspaces),
                           "disabled": sum(1 for w in workspaces if w.disabled),
                           "key_problems": [{"id": w.id, "name": w.name, "status": w.key_status,
                                             "error": w.key_error}
                                            for w in workspaces
                                            if w.key_status == "invalid" and not w.disabled]},
            "roles": db.query(Role).count(),
            "admins": db.query(Admin).filter(Admin.status == "active").count(),
            "active_sessions": sessions,
            "last_24h": {"sign_ins": logins, "failed_sign_ins": failed},
        }


def purge_expired(days: int = 30) -> int:
    """Drop sessions and links that ended more than ``days`` ago."""
    cutoff = _now() - timedelta(days=days)
    with _db() as db:
        n = db.query(AuthSession).filter(
            (AuthSession.expires_at < cutoff) | (AuthSession.revoked_at < cutoff)).delete(
            synchronize_session=False)
        n += db.query(AuthToken).filter(AuthToken.expires_at < cutoff).delete(
            synchronize_session=False)
        db.commit()
        return n
