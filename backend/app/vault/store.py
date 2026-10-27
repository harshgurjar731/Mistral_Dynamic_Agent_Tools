"""
Vault storage — entries, resolution for the code that uses them, matching,
key rotation and the audit log.

Every function here is synchronous (SQLAlchemy on SQLite); async callers use
``asyncio.to_thread``. No function returns a sensitive value except
:func:`resolve` (for execution) and :func:`reveal` (gated, audited).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from urllib.parse import urlparse

from app.database import SessionLocal
from app.vault import crypto
from app.vault.models import VaultAuditEvent, VaultSecret, VaultSecretVersion

logger = logging.getLogger(__name__)

#: What an entry can hold. ``sensitive`` is the default for a new entry of that
#: kind; the user may change it.
KINDS: dict[str, dict] = {
    "api_key": {"label": "API key", "sensitive": True, "placeholder": "sk-…"},
    "token": {"label": "Access / bearer token", "sensitive": True, "placeholder": "eyJ…"},
    "password": {"label": "Password", "sensitive": True, "placeholder": ""},
    "username": {"label": "Username / login", "sensitive": False, "placeholder": "service-account"},
    "url": {"label": "Service URL / endpoint", "sensitive": False,
            "placeholder": "https://api.example.com/v2"},
    "connection_string": {"label": "Connection string", "sensitive": True,
                          "placeholder": "postgresql://user:pass@host:5432/db"},
    "client_id": {"label": "OAuth client ID", "sensitive": False, "placeholder": ""},
    "client_secret": {"label": "OAuth client secret", "sensitive": True, "placeholder": ""},
    "certificate": {"label": "Certificate / private key (PEM)", "sensitive": True,
                    "placeholder": "-----BEGIN PRIVATE KEY-----"},
    "config": {"label": "Setting (account id, region, tenant…)", "sensitive": False,
               "placeholder": "eu-west-1"},
    "other": {"label": "Other secret", "sensitive": True, "placeholder": ""},
}

#: Names code reads from ``kwargs["_secrets"]``: environment-variable style.
_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
MAX_VALUE_CHARS = 16_384
#: An entry this close to its expiry date is flagged on the Settings page.
EXPIRING_SOON_DAYS = 14


class VaultError(ValueError):
    """A write the vault refuses; the message is for the user."""


class VaultUnavailable(RuntimeError):
    """The database is not reachable."""


def _settings():
    from app.config import settings

    return settings


def _setting(name: str, default):
    return getattr(_settings(), name, default)


def enabled() -> bool:
    return bool(_setting("VAULT_ENABLED", True))


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _session():
    if SessionLocal is None:
        raise VaultUnavailable("The database is unavailable.")
    return SessionLocal()


def _loads(raw: Optional[str]) -> list[str]:
    try:
        value = json.loads(raw or "[]")
        return [str(v) for v in value if str(v).strip()] if isinstance(value, list) else []
    except ValueError:
        return []


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() + "Z" if value else None


# ── Names, values, hints ────────────────────────────────────────────────────


def normalise_name(text: str) -> str:
    """``"OpenWeather api-key"`` → ``"OPENWEATHER_API_KEY"``."""
    value = re.sub(r"[^A-Za-z0-9]+", "_", str(text or "").strip()).strip("_").upper()
    if value and not value[0].isalpha():
        value = f"S_{value}"
    return value[:64]


def valid_name(name: str) -> bool:
    return bool(_NAME.match(name or ""))


def _check_value(kind: str, value: str) -> str:
    if not isinstance(value, str):
        raise VaultError("The value must be text.")
    # A trailing newline from a paste is never part of a key; inner ones are
    # (a PEM block), so only the ends are trimmed.
    value = value.strip()
    if not value:
        raise VaultError("Enter a value.")
    if len(value) > MAX_VALUE_CHARS:
        raise VaultError(f"The value is longer than {MAX_VALUE_CHARS} characters.")
    if kind == "url":
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https", "ws", "wss") or not parsed.netloc:
            raise VaultError("A service URL must start with http:// or https:// and name a host.")
    if kind == "certificate" and "-----BEGIN" not in value:
        raise VaultError("A certificate or key must be in PEM format (-----BEGIN …).")
    if kind in ("api_key", "token", "client_secret", "password") and "\n" in value:
        raise VaultError("This kind of value is a single line; remove the line breaks.")
    return value


def _hint(value: str, sensitive: bool) -> str:
    if not sensitive:
        return value if len(value) <= 200 else value[:199] + "…"
    return f"••••{value[-4:]}" if len(value) >= 12 else "••••"


# ── Status ──────────────────────────────────────────────────────────────────


def _status(row: VaultSecret, now: datetime) -> tuple[str, list[str]]:
    """``(status, flags)`` — status decides whether code may receive it."""
    flags: list[str] = []
    if row.disabled:
        return "disabled", flags
    if row.expires_at and row.expires_at <= now:
        return "expired", flags
    if row.expires_at and row.expires_at <= now + timedelta(days=EXPIRING_SOON_DAYS):
        flags.append("expiring_soon")
    remind = int(_setting("VAULT_ROTATION_REMINDER_DAYS", 90) or 0)
    if remind and row.value_changed_at and row.value_changed_at <= now - timedelta(days=remind):
        flags.append("rotation_due")
    if row.key_id and row.key_id != crypto.primary_key_id():
        flags.append("old_key")
    return "active", flags


def _to_dict(row: VaultSecret, now: Optional[datetime] = None) -> dict:
    now = now or _now()
    status, flags = _status(row, now)
    return {
        "id": row.id, "name": row.name, "label": row.label, "kind": row.kind,
        "kind_label": KINDS.get(row.kind, KINDS["other"])["label"],
        "service": row.service or "", "description": row.description or "",
        "sensitive": bool(row.sensitive), "tags": _loads(row.tags),
        "allowed_consumers": _loads(row.allowed_consumers),
        "hint": row.hint or "", "version": row.version, "status": status, "flags": flags,
        "usable": status == "active", "disabled": bool(row.disabled),
        "expires_at": _iso(row.expires_at), "value_changed_at": _iso(row.value_changed_at),
        "last_used_at": _iso(row.last_used_at), "last_used_by": row.last_used_by,
        "use_count": row.use_count or 0, "origin": row.origin, "origin_ref": row.origin_ref,
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


# ── Audit ───────────────────────────────────────────────────────────────────


def _audit(db, action: str, row: Optional[VaultSecret] = None, *, name: Optional[str] = None,
           actor: str = "user", consumer: Optional[str] = None, outcome: str = "ok",
           detail: str = "") -> None:
    db.add(VaultAuditEvent(action=action, secret_id=row.id if row else None,
                           secret_name=row.name if row else name, actor=actor,
                           consumer=(consumer or None) and str(consumer)[:200],
                           outcome=outcome, detail=(detail or None) and detail[:1000]))


def audit_log(*, secret_id: Optional[str] = None, action: Optional[str] = None,
              limit: int = 100) -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        q = db.query(VaultAuditEvent)
        if secret_id:
            q = q.filter(VaultAuditEvent.secret_id == secret_id)
        if action:
            q = q.filter(VaultAuditEvent.action.in_([a for a in action.split(",") if a]))
        rows = q.order_by(VaultAuditEvent.id.desc()).limit(max(1, min(limit, 1000))).all()
        return [{"id": r.id, "at": _iso(r.at), "action": r.action, "secret_id": r.secret_id,
                 "secret_name": r.secret_name, "actor": r.actor, "consumer": r.consumer,
                 "outcome": r.outcome, "detail": r.detail or ""} for r in rows]
    finally:
        db.close()


def purge_audit() -> int:
    """Remove audit events older than the retention setting. 0 days keeps them all."""
    days = int(_setting("VAULT_AUDIT_RETENTION_DAYS", 180) or 0)
    if not days or SessionLocal is None:
        return 0
    db = SessionLocal()
    try:
        n = db.query(VaultAuditEvent).filter(
            VaultAuditEvent.at < _now() - timedelta(days=days)).delete(synchronize_session=False)
        db.commit()
        return n
    except Exception as e:  # never let housekeeping fail a start-up
        db.rollback()
        logger.warning("Vault audit purge skipped: %s", e)
        return 0
    finally:
        db.close()


# ── Reads ───────────────────────────────────────────────────────────────────


def _find(db, ref: str) -> Optional[VaultSecret]:
    return (db.query(VaultSecret).filter(VaultSecret.id == ref).first()
            or db.query(VaultSecret).filter(VaultSecret.name == ref).first())


def list_secrets() -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        now = _now()
        rows = db.query(VaultSecret).order_by(VaultSecret.service, VaultSecret.name).all()
        return [_to_dict(r, now) for r in rows]
    finally:
        db.close()


def get_secret(ref: str) -> dict:
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        out = _to_dict(row)
        consumers = (db.query(VaultAuditEvent.consumer)
                     .filter(VaultAuditEvent.secret_id == row.id, VaultAuditEvent.action == "use",
                             VaultAuditEvent.consumer.isnot(None))
                     .distinct().limit(50).all())
        out["used_by"] = sorted({c[0] for c in consumers if c[0]})
        return out
    finally:
        db.close()


def summary() -> dict:
    items = list_secrets()
    return {
        "total": len(items),
        "active": sum(1 for s in items if s["status"] == "active"),
        "expired": sum(1 for s in items if s["status"] == "expired"),
        "disabled": sum(1 for s in items if s["status"] == "disabled"),
        "attention": sum(1 for s in items if s["flags"] or s["status"] == "expired"),
        "on_old_key": sum(1 for s in items if "old_key" in s["flags"]),
    }


def catalogue() -> list[dict]:
    """What a prompt may know about the vault: names and what they are for. No values,
    and no hints of sensitive values."""
    return [{"name": s["name"], "label": s["label"], "kind": s["kind"], "service": s["service"],
             "usable": s["usable"], "tags": s["tags"],
             **({"value": s["hint"]} if not s["sensitive"] else {})}
            for s in list_secrets()]


# ── Writes ──────────────────────────────────────────────────────────────────


def _clean_list(values: Optional[Iterable[str]], limit: int = 50) -> list[str]:
    out: list[str] = []
    for v in values or []:
        text = str(v).strip()[:100]
        if text and text not in out:
            out.append(text)
    return out[:limit]


def _expiry(expires_at, default_days: bool) -> Optional[datetime]:
    if expires_at in (None, ""):
        days = int(_setting("VAULT_DEFAULT_EXPIRY_DAYS", 0) or 0) if default_days else 0
        return _now() + timedelta(days=days) if days else None
    if isinstance(expires_at, datetime):
        value = expires_at
    else:
        try:
            value = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        except ValueError:
            raise VaultError("The expiry date is not a valid date.") from None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def create_secret(*, name: str, value: str, label: str = "", kind: str = "api_key",
                  service: str = "", description: str = "", sensitive: Optional[bool] = None,
                  tags: Iterable[str] = (), allowed_consumers: Iterable[str] = (),
                  expires_at=None, origin: str = "settings", origin_ref: Optional[str] = None,
                  actor: str = "user") -> dict:
    if not enabled():
        raise VaultError("The vault is switched off (Settings → Vault).")
    name = normalise_name(name)
    if not valid_name(name):
        raise VaultError("Name it like an environment variable: capital letters, digits and "
                         "underscores, starting with a letter (e.g. OPENWEATHER_API_KEY).")
    if kind not in KINDS:
        raise VaultError(f"Kind must be one of {', '.join(KINDS)}.")
    value = _check_value(kind, value)
    sensitive = KINDS[kind]["sensitive"] if sensitive is None else bool(sensitive)
    db = _session()
    try:
        if db.query(VaultSecret).filter(VaultSecret.name == name).first():
            raise VaultError(f"An entry named {name} already exists — change its value instead.")
        entry_id = uuid.uuid4().hex
        row = VaultSecret(
            id=entry_id, name=name, label=(label or "").strip()[:120] or name.replace("_", " ").title(),
            kind=kind, service=(service or "").strip()[:120] or None,
            description=(description or "").strip()[:2000] or None, sensitive=sensitive,
            tags=json.dumps(_clean_list(tags, 20)),
            allowed_consumers=json.dumps(_clean_list(allowed_consumers)),
            ciphertext=crypto.encrypt(value, entry_id=entry_id, version=1),
            key_id=crypto.primary_key_id(), hint=_hint(value, sensitive), version=1,
            expires_at=_expiry(expires_at, default_days=True), value_changed_at=_now(),
            origin=origin if origin in ("settings", "build", "connector", "import") else "settings",
            origin_ref=(origin_ref or None) and str(origin_ref)[:200],
        )
        db.add(row)
        _audit(db, "create", row, actor=actor,
               detail=f"created from {row.origin}" + (f" ({row.origin_ref})" if row.origin_ref else ""))
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def update_secret(ref: str, *, label: Optional[str] = None, service: Optional[str] = None,
                  description: Optional[str] = None, sensitive: Optional[bool] = None,
                  tags: Optional[Iterable[str]] = None,
                  allowed_consumers: Optional[Iterable[str]] = None,
                  expires_at=..., disabled: Optional[bool] = None, actor: str = "user") -> dict:
    """Change what an entry is, not its value. ``expires_at=None`` clears the expiry."""
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        changed: list[str] = []
        if label is not None:
            if len(label.strip()) < 2:
                raise VaultError("The label is too short.")
            row.label = label.strip()[:120]
            changed.append("label")
        if service is not None:
            row.service = service.strip()[:120] or None
            changed.append("service")
        if description is not None:
            row.description = description.strip()[:2000] or None
            changed.append("description")
        if tags is not None:
            row.tags = json.dumps(_clean_list(tags, 20))
            changed.append("tags")
        if allowed_consumers is not None:
            row.allowed_consumers = json.dumps(_clean_list(allowed_consumers))
            changed.append("allowed consumers")
        if expires_at is not ...:
            row.expires_at = _expiry(expires_at, default_days=False)
            changed.append("expiry")
        if disabled is not None:
            row.disabled = bool(disabled)
            changed.append("disabled" if disabled else "enabled")
        if sensitive is not None and bool(sensitive) != bool(row.sensitive):
            # The hint was derived from the value with the old setting; making an
            # entry sensitive must hide the value the hint was showing.
            value = crypto.decrypt(row.ciphertext, entry_id=row.id)
            row.sensitive, row.hint = bool(sensitive), _hint(value, bool(sensitive))
            changed.append("sensitive" if sensitive else "not sensitive")
        if changed:
            _audit(db, "update", row, actor=actor, detail=", ".join(changed))
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def _keep_versions(db, row: VaultSecret) -> None:
    keep = max(0, int(_setting("VAULT_VERSION_HISTORY", 5) or 0))
    rows = (db.query(VaultSecretVersion).filter(VaultSecretVersion.secret_id == row.id)
            .order_by(VaultSecretVersion.version.desc()).all())
    for old in rows[keep:]:
        db.delete(old)


def set_value(ref: str, value: str, *, actor: str = "user", expires_at=...) -> dict:
    """Replace the value; the previous one is kept as a version for rollback."""
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        value = _check_value(row.kind, value)
        db.add(VaultSecretVersion(secret_id=row.id, version=row.version, ciphertext=row.ciphertext,
                                  key_id=row.key_id, hint=row.hint))
        row.version = (row.version or 1) + 1
        row.ciphertext = crypto.encrypt(value, entry_id=row.id, version=row.version)
        row.key_id, row.hint = crypto.primary_key_id(), _hint(value, bool(row.sensitive))
        row.value_changed_at = _now()
        if expires_at is not ...:
            row.expires_at = _expiry(expires_at, default_days=False)
        db.flush()
        _keep_versions(db, row)
        _audit(db, "set_value", row, actor=actor, detail=f"now version {row.version}")
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def versions(ref: str) -> list[dict]:
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        olds = (db.query(VaultSecretVersion).filter(VaultSecretVersion.secret_id == row.id)
                .order_by(VaultSecretVersion.version.desc()).all())
        current = {"version": row.version, "hint": row.hint or "", "current": True,
                   "created_at": _iso(row.value_changed_at)}
        return [current] + [{"version": v.version, "hint": v.hint or "", "current": False,
                             "created_at": _iso(v.created_at)} for v in olds]
    finally:
        db.close()


def rollback(ref: str, version: int, *, actor: str = "user") -> dict:
    """Make a previous value current again (as a new version, so it can be undone)."""
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        old = (db.query(VaultSecretVersion)
               .filter(VaultSecretVersion.secret_id == row.id, VaultSecretVersion.version == version)
               .first())
        if not old:
            raise LookupError(f"Version {version} of {row.name} is no longer kept.")
        value = crypto.decrypt(old.ciphertext, entry_id=row.id)
        db.add(VaultSecretVersion(secret_id=row.id, version=row.version, ciphertext=row.ciphertext,
                                  key_id=row.key_id, hint=row.hint))
        row.version += 1
        row.ciphertext = crypto.encrypt(value, entry_id=row.id, version=row.version)
        row.key_id, row.hint = crypto.primary_key_id(), _hint(value, bool(row.sensitive))
        row.value_changed_at = _now()
        db.flush()
        _keep_versions(db, row)
        _audit(db, "rollback", row, actor=actor,
               detail=f"restored the value of version {version} as version {row.version}")
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def delete_secret(ref: str, *, actor: str = "user") -> dict:
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        out = {"id": row.id, "name": row.name}
        db.query(VaultSecretVersion).filter(VaultSecretVersion.secret_id == row.id).delete(
            synchronize_session=False)
        _audit(db, "delete", row, actor=actor)
        db.delete(row)
        db.commit()
        return out
    finally:
        db.close()


def reveal(ref: str, *, actor: str = "user") -> dict:
    """The value, for the person managing it. A sensitive value only when revealing
    is switched on (Settings → Vault); always audited."""
    db = _session()
    try:
        row = _find(db, ref)
        if not row:
            raise LookupError(f"No vault entry '{ref}'.")
        if row.sensitive and not _setting("VAULT_ALLOW_REVEAL", False):
            _audit(db, "reveal", row, actor=actor, outcome="denied",
                   detail="revealing sensitive values is switched off")
            db.commit()
            raise PermissionError("Revealing sensitive values is switched off (Settings → Vault). "
                                  "Replace the value instead if you no longer have it.")
        value = crypto.decrypt(row.ciphertext, entry_id=row.id)
        _audit(db, "reveal", row, actor=actor)
        db.commit()
        return {"id": row.id, "name": row.name, "value": value}
    finally:
        db.close()


# ── Resolution for code ─────────────────────────────────────────────────────


@dataclass
class Resolution:
    values: dict[str, str] = field(default_factory=dict)
    #: name → why it was not supplied: missing | disabled | expired | denied | error
    problems: dict[str, str] = field(default_factory=dict)


def _consumer_allowed(row: VaultSecret, consumer: Optional[str]) -> bool:
    allowed = _loads(row.allowed_consumers)
    if not allowed:
        return True
    base = (consumer or "").split("@", 1)[0]
    return bool(base) and any(base == a or (a.endswith("*") and base.startswith(a[:-1]))
                              for a in allowed)


def resolve(names: Iterable[str], *, consumer: str, actor: str = "system") -> Resolution:
    """The values of ``names`` that ``consumer`` may receive, right now.

    Never raises: a vault that is off or unreachable resolves nothing, and the
    code falls back to whatever else supplies its secrets (the tool service's
    environment) or reports a configuration error.
    """
    out = Resolution()
    wanted = [n for n in dict.fromkeys(str(n).strip() for n in names) if n]
    if not wanted:
        return out
    if not enabled() or SessionLocal is None:
        out.problems = {n: "missing" for n in wanted}
        return out
    db = SessionLocal()
    audit_use = bool(_setting("VAULT_AUDIT_USE", True))
    try:
        now = _now()
        rows = {r.name: r for r in db.query(VaultSecret).filter(VaultSecret.name.in_(wanted)).all()}
        for name in wanted:
            row = rows.get(name)
            if row is None:
                out.problems[name] = "missing"
                continue
            status, _ = _status(row, now)
            if status != "active":
                out.problems[name] = status
                _audit(db, "denied", row, actor=actor, consumer=consumer, outcome="denied",
                       detail=f"entry is {status}")
                continue
            if not _consumer_allowed(row, consumer):
                out.problems[name] = "denied"
                _audit(db, "denied", row, actor=actor, consumer=consumer, outcome="denied",
                       detail="not in this entry's allowed consumers")
                continue
            try:
                out.values[name] = crypto.decrypt(row.ciphertext, entry_id=row.id)
            except crypto.VaultCryptoError as e:
                out.problems[name] = "error"
                _audit(db, "use", row, actor=actor, consumer=consumer, outcome="error",
                       detail=str(e))
                continue
            row.last_used_at, row.last_used_by = now, (consumer or "")[:200] or None
            row.use_count = (row.use_count or 0) + 1
            if audit_use:
                _audit(db, "use", row, actor=actor, consumer=consumer)
        db.commit()
    except Exception as e:  # noqa: BLE001 — resolution must never break execution
        db.rollback()
        logger.warning("Vault resolution failed: %s", e)
        out.problems.update({n: "error" for n in wanted if n not in out.values})
    finally:
        db.close()
    return out


def status(names: Iterable[str], consumer: Optional[str] = None) -> dict[str, dict]:
    """Whether each name would resolve for ``consumer`` — without decrypting or
    counting a use."""
    wanted = [n for n in dict.fromkeys(str(n).strip() for n in names) if n]
    if not wanted:
        return {}
    if SessionLocal is None or not enabled():
        return {n: {"exists": False, "usable": False, "reason": "vault_off" if not enabled()
                    else "unavailable"} for n in wanted}
    db = SessionLocal()
    try:
        now = _now()
        try:
            rows = {r.name: r for r in
                    db.query(VaultSecret).filter(VaultSecret.name.in_(wanted)).all()}
        except Exception as e:  # noqa: BLE001 — a check must not fail because the vault did
            logger.warning("Vault status unavailable: %s", e)
            return {n: {"exists": False, "usable": False, "reason": "unavailable"} for n in wanted}
        out = {}
        for name in wanted:
            row = rows.get(name)
            if row is None:
                out[name] = {"exists": False, "usable": False, "reason": "missing"}
                continue
            st, flags = _status(row, now)
            allowed = consumer is None or _consumer_allowed(row, consumer)
            out[name] = {"exists": True, "usable": st == "active" and allowed,
                         "reason": st if st != "active" else ("ok" if allowed else "denied"),
                         "id": row.id, "label": row.label, "kind": row.kind,
                         "service": row.service or "", "flags": flags}
        return out
    finally:
        db.close()


# ── Matching (build prerequisites) ──────────────────────────────────────────


def _tokens(text: str) -> set[str]:
    stop = {"api", "key", "the", "a", "an", "of", "for", "and", "url", "token", "secret", "base"}
    return {t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) > 1} - stop


def candidates(*, name: str = "", service: str = "", label: str = "", kind: str = "",
               limit: int = 5) -> list[dict]:
    """Entries that could satisfy a requirement, best first, scored 0–1.

    Exact name 1.0; same service and kind 0.8; same service 0.6; otherwise the
    overlap of the words in their names, services and labels.
    """
    want_name = normalise_name(name) if name else ""
    want_service = (service or "").strip().lower()
    want_words = _tokens(f"{name} {service} {label}")
    scored = []
    for s in list_secrets():
        if want_name and s["name"] == want_name:
            score = 1.0
        elif want_service and s["service"].lower() == want_service:
            score = 0.8 if (kind and s["kind"] == kind) else 0.6
        else:
            have = _tokens(f"{s['name']} {s['service']} {s['label']}")
            overlap = len(want_words & have) / max(1, len(want_words)) if want_words else 0.0
            score = round(0.5 * overlap + (0.1 if kind and s["kind"] == kind else 0.0), 2)
        if score >= 0.3:
            scored.append({"id": s["id"], "name": s["name"], "label": s["label"],
                           "service": s["service"], "kind": s["kind"], "usable": s["usable"],
                           "status": s["status"], "hint": s["hint"], "score": score})
    scored.sort(key=lambda c: (-c["score"], not c["usable"], c["name"]))
    return scored[:limit]


# ── Key rotation ────────────────────────────────────────────────────────────


def key_status() -> dict:
    info = crypto.key_status()
    info["on_old_key"] = summary()["on_old_key"] if SessionLocal is not None else 0
    return info


def rotate_master_key(*, actor: str = "user") -> dict:
    """Re-encrypt every value and kept version with the newest configured key."""
    db = _session()
    done, failed = 0, []
    try:
        primary = crypto.primary_key_id()
        for row in db.query(VaultSecret).all():
            try:
                row.ciphertext, row.key_id = crypto.rotate(row.ciphertext), primary
                done += 1
            except crypto.VaultCryptoError:
                failed.append(row.name)
        for old in db.query(VaultSecretVersion).all():
            try:
                old.ciphertext, old.key_id = crypto.rotate(old.ciphertext), primary
            except crypto.VaultCryptoError:
                pass  # an unreadable old version cannot be rolled back to anyway
        _audit(db, "rotate_key", None, name="*", actor=actor,
               outcome="ok" if not failed else "error",
               detail=f"{done} re-encrypted with key {primary}"
                      + (f"; unreadable: {', '.join(failed)}" if failed else ""))
        db.commit()
        return {"re_encrypted": done, "unreadable": failed, "primary_key_id": primary}
    finally:
        db.close()
