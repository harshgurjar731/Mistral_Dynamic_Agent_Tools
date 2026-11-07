"""
Who is making the current request, and in which workspace.

Set by the auth middleware for the length of one request. Context variables
are copied into every task and thread the request starts (``asyncio`` tasks,
``asyncio.to_thread``, Starlette's thread pool), so a background run started
by a request keeps its workspace — and with it its Mistral key and its data —
until it finishes.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator, Optional


@dataclass(frozen=True)
class Principal:
    #: ``user`` or ``admin``.
    kind: str
    id: str
    email: str
    name: str
    session_id: str
    #: The user's active workspace; None for an admin.
    workspace_id: Optional[str] = None
    workspace_name: Optional[str] = None
    role_id: Optional[str] = None
    role_name: Optional[str] = None
    permissions: frozenset[str] = field(default_factory=frozenset)
    #: Signed in with a temporary password: only the password change is open.
    must_change_password: bool = False

    @property
    def is_admin(self) -> bool:
        return self.kind == "admin"

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    @property
    def actor(self) -> str:
        """How the vault, rules and audit logs name this person."""
        return f"{self.kind}:{self.email}"


_principal: ContextVar[Optional[Principal]] = ContextVar("auth_principal", default=None)
_workspace: ContextVar[Optional[str]] = ContextVar("auth_workspace", default=None)
_unscoped: ContextVar[bool] = ContextVar("auth_unscoped", default=False)


def current_principal() -> Optional[Principal]:
    return _principal.get()


#: The workspace a whole process works for: a per-workspace workflow worker.
#: Temporal runs activities on threads that do not inherit context variables,
#: so the worker sets this once instead (``set_process_workspace``).
_process_workspace: Optional[str] = None


def set_process_workspace(workspace_id: Optional[str]) -> None:
    global _process_workspace
    _process_workspace = workspace_id or None


def current_workspace_id() -> Optional[str]:
    """The workspace data and Mistral calls are scoped to, or None (system)."""
    if _unscoped.get():
        return None
    return _workspace.get() or _process_workspace


def current_actor(default: str = "system") -> str:
    p = _principal.get()
    return p.actor if p else default


@contextmanager
def use_principal(principal: Optional[Principal]) -> Iterator[None]:
    t1 = _principal.set(principal)
    t2 = _workspace.set(principal.workspace_id if principal else None)
    try:
        yield
    finally:
        _workspace.reset(t2)
        _principal.reset(t1)


@contextmanager
def use_workspace(workspace_id: Optional[str]) -> Iterator[None]:
    """Run code as if in ``workspace_id`` — boot provisioning, tests."""
    token = _workspace.set(workspace_id)
    try:
        yield
    finally:
        _workspace.reset(token)


@contextmanager
def unscoped() -> Iterator[None]:
    """See every workspace's rows. For the auth store and admin maintenance only."""
    token = _unscoped.set(True)
    try:
        yield
    finally:
        _unscoped.reset(token)
