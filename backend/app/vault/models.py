"""The vault's tables: entries, their previous values, and the audit log."""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class VaultSecret(Base):
    __tablename__ = "vault_secrets"

    id = Column(String, primary_key=True)                     # uuid4 hex
    #: The name code asks for: ``kwargs["_secrets"]["OPENWEATHER_API_KEY"]``.
    name = Column(String, nullable=False, unique=True, index=True)
    label = Column(String, nullable=False)
    #: api_key | token | password | username | url | connection_string |
    #: client_id | client_secret | certificate | config | other — see store.KINDS
    kind = Column(String, nullable=False, default="api_key")
    #: The third-party service, as a person would name it ("OpenWeather").
    service = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    #: False for values that may be shown (a base URL, a region, an account id).
    sensitive = Column(Boolean, nullable=False, default=True)
    tags = Column(Text, nullable=False, default="[]")          # JSON list
    #: JSON list of tool / activity names allowed to receive it; [] = any.
    allowed_consumers = Column(Text, nullable=False, default="[]")
    ciphertext = Column(Text, nullable=False)
    key_id = Column(String, nullable=True)                     # crypto.key_id of the key used
    #: What the UI shows instead of the value: "••••3f9a", or the value itself
    #: when it is not sensitive.
    hint = Column(String, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    disabled = Column(Boolean, nullable=False, default=False)
    expires_at = Column(DateTime, nullable=True)
    value_changed_at = Column(DateTime, server_default=func.now())
    last_used_at = Column(DateTime, nullable=True)
    last_used_by = Column(String, nullable=True)
    use_count = Column(Integer, nullable=False, default=0)
    #: settings | build | connector | import — where the entry was first created.
    origin = Column(String, nullable=False, default="settings")
    #: For an entry created while answering a build's prerequisites: the run.
    origin_ref = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class VaultSecretVersion(Base):
    """A previous value, kept so a bad change can be rolled back."""

    __tablename__ = "vault_secret_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    secret_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False)
    ciphertext = Column(Text, nullable=False)
    key_id = Column(String, nullable=True)
    hint = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class VaultAuditEvent(Base):
    """Who did what with an entry. Never holds a value."""

    __tablename__ = "vault_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(DateTime, server_default=func.now(), index=True)
    #: create | update | set_value | rollback | reveal | delete | use | denied |
    #: missing | rotate_key | bind
    action = Column(String, nullable=False)
    secret_id = Column(String, nullable=True, index=True)
    secret_name = Column(String, nullable=True)
    #: user | system | build — who asked.
    actor = Column(String, nullable=False, default="user")
    #: The tool, activity, connector or build that received or asked for it.
    consumer = Column(String, nullable=True)
    outcome = Column(String, nullable=False, default="ok")   # ok | denied | error
    detail = Column(Text, nullable=True)
