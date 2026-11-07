"""The auth tables. All ``auth_*`` and never workspace-scoped themselves."""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class Workspace(Base):
    """A group of users backed by one Mistral API key."""

    __tablename__ = "auth_workspaces"

    id = Column(String, primary_key=True)                       # uuid4 hex
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    #: ``platform``: uses the backend's MISTRAL_API_KEY (the Default workspace,
    #: which owns everything created before workspaces existed).
    #: ``stored``: its own key, encrypted with the vault's master key.
    key_source = Column(String, nullable=False, default="stored")
    key_ciphertext = Column(Text, nullable=True)
    key_version = Column(Integer, nullable=False, default=1)
    #: sha256 of the key — finds a key already used by another workspace.
    key_fingerprint = Column(String, nullable=True, index=True)
    key_hint = Column(String, nullable=True)                    # "••••3f9a"
    #: valid | invalid | unchecked
    key_status = Column(String, nullable=False, default="unchecked")
    key_checked_at = Column(DateTime, nullable=True)
    key_error = Column(Text, nullable=True)
    key_rotated_at = Column(DateTime, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    disabled = Column(Boolean, nullable=False, default=False)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Role(Base):
    __tablename__ = "auth_roles"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    permissions = Column(Text, nullable=False, default="[]")     # JSON list
    #: Built-in roles cannot be edited or deleted; duplicate one instead.
    system_key = Column(String, nullable=True, unique=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class User(Base):
    __tablename__ = "auth_users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)   # lowercased
    name = Column(String, nullable=False)
    #: None until the invite is accepted.
    password_hash = Column(String, nullable=True)
    #: invited | active | disabled | deleted
    status = Column(String, nullable=False, default="invited")
    must_change_password = Column(Boolean, nullable=False, default=False)
    failed_logins = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, nullable=True)
    #: Where a sign-in lands when the user belongs to several workspaces.
    last_workspace_id = Column(String, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)


class Membership(Base):
    """A user's place in a workspace, with their role there."""

    __tablename__ = "auth_memberships"
    __table_args__ = (UniqueConstraint("user_id", "workspace_id", name="uq_membership"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    role_id = Column(String, nullable=False, index=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Admin(Base):
    __tablename__ = "auth_admins"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=True)
    #: invited | active | disabled
    status = Column(String, nullable=False, default="active")
    must_change_password = Column(Boolean, nullable=False, default=False)
    failed_logins = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AuthSession(Base):
    """A signed-in browser. The cookie holds a random token; only its hash is stored."""

    __tablename__ = "auth_sessions"

    id = Column(String, primary_key=True)                       # sha256(token)
    #: Shown in "your sessions" lists; never the token.
    public_id = Column(String, nullable=False, unique=True)
    kind = Column(String, nullable=False)                       # user | admin
    subject_id = Column(String, nullable=False, index=True)
    workspace_id = Column(String, nullable=True)                # a user's active workspace
    created_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)


class AuthToken(Base):
    """A one-time link: an invite, or a password reset."""

    __tablename__ = "auth_tokens"

    id = Column(String, primary_key=True)                       # sha256(token)
    kind = Column(String, nullable=False)                       # invite | reset
    subject_kind = Column(String, nullable=False)               # user | admin
    subject_id = Column(String, nullable=False, index=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class AuditEvent(Base):
    __tablename__ = "auth_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(DateTime, server_default=func.now(), index=True)
    actor_kind = Column(String, nullable=True)                  # user | admin | system
    actor_id = Column(String, nullable=True)
    actor_email = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)
    target_type = Column(String, nullable=True)
    target_id = Column(String, nullable=True)
    workspace_id = Column(String, nullable=True)
    outcome = Column(String, nullable=False, default="ok")      # ok | denied | failed
    detail = Column(Text, nullable=True)                        # JSON
    ip = Column(String, nullable=True)
