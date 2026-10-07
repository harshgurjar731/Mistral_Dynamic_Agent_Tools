"""
Row <-> API conversion, validation and secret handling for remote servers.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.remote_server_model import RemoteServer, RemoteDeployment
from app.remote_servers import secrets as secret_box
from app.remote_servers.providers import get_provider, secret_keys, PURPOSES


class ValidationError(ValueError):
    pass


def _loads(text: str | None, default):
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def server_config(server: RemoteServer) -> dict:
    """Non-secret config, with legacy rows (url only) normalised."""
    config = _loads(server.config, {})
    if (server.provider or "mcp_code_endpoint") == "mcp_code_endpoint" and not config.get("url"):
        config["url"] = server.url
    return config


def server_secrets(server: RemoteServer) -> dict:
    return secret_box.decrypt(server.secrets)


def display_address(provider_id: str, config: dict) -> str:
    provider = get_provider(provider_id) or {}
    if provider.get("transport") == "ssh":
        port = config.get("port") or 22
        return f"ssh://{config.get('username') or ''}@{config.get('host') or ''}:{port}"
    return (config.get("url") or "").strip()


def to_dict(server: RemoteServer, *, include_check: bool = True) -> dict:
    provider_id = server.provider or "mcp_code_endpoint"
    provider = get_provider(provider_id) or {}
    out = {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "description": server.description or "",
        "purpose": server.purpose or "tool",
        "provider": provider_id,
        "provider_label": provider.get("label", provider_id),
        "transport": provider.get("transport", "http"),
        "config": server_config(server),
        # Which secrets are stored — never their values.
        "secrets_set": sorted(server_secrets(server).keys()),
        "last_status": server.last_status,
        "last_checked_at": _iso(server.last_checked_at),
        "created_at": _iso(server.created_at),
        "updated_at": _iso(server.updated_at),
    }
    if include_check:
        out["last_check"] = _loads(server.last_check, None)
    return out


def deployment_to_dict(dep: RemoteDeployment, *, include_log: bool = True) -> dict:
    out = {
        "id": dep.id,
        "server_id": dep.server_id,
        "kind": dep.kind,
        "target": dep.target,
        "status": dep.status,
        "options": _loads(dep.options, {}),
        "error": dep.error,
        "created_at": _iso(dep.created_at),
        "finished_at": _iso(dep.finished_at),
    }
    if include_log:
        out["log"] = dep.log or ""
    return out


def _coerce(field: dict, value: Any) -> Any:
    if value is None:
        return None
    if field.get("type") == "number":
        if value == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValidationError(f"{field['label']} must be a number")
    return value.strip() if isinstance(value, str) and field.get("type") != "textarea" else value


def _visible(field: dict, values: dict) -> bool:
    cond = field.get("show_if")
    if not cond:
        return True
    for key, expected in cond.items():
        actual = values.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def normalise(provider_id: str, purpose: str, config: dict, secrets: dict, *, stored_secrets: dict | None = None) -> tuple[dict, dict]:
    """Validate a provider's config and merge secrets.

    ``secrets`` semantics: a non-empty value replaces, ``""`` keeps the stored
    value, ``None`` clears it. Returns (config, merged_secrets).
    """
    provider = get_provider(provider_id)
    if not provider:
        raise ValidationError(f"Unknown provider '{provider_id}'")
    if purpose not in PURPOSES:
        raise ValidationError(f"Unknown purpose '{purpose}'")
    if purpose not in provider["purposes"]:
        raise ValidationError(f"{provider['label']} cannot be used for {PURPOSES[purpose]['label'].lower()}")

    skeys = secret_keys(provider_id)
    merged_secrets = dict(stored_secrets or {})
    for key, value in (secrets or {}).items():
        if key not in skeys:
            continue
        if value is None:
            merged_secrets.pop(key, None)
        elif value != "":
            merged_secrets[key] = value
    merged_secrets = {k: v for k, v in merged_secrets.items() if k in skeys}

    clean: dict = {}
    for field in provider["fields"]:
        if field.get("secret"):
            continue
        raw = (config or {}).get(field["key"], field.get("default"))
        clean[field["key"]] = _coerce(field, raw)

    combined = {**clean, **merged_secrets}
    for field in provider["fields"]:
        if not _visible(field, combined):
            continue
        if field.get("required") and not combined.get(field["key"]):
            raise ValidationError(f"{field['label']} is required")

    if provider.get("provisioned"):
        pass  # host and key are filled in by provisioning, after the first save
    elif provider["transport"] == "ssh":
        method = clean.get("auth_method") or "private_key"
        if method == "password" and not merged_secrets.get("password"):
            raise ValidationError("Password is required for password authentication")
        if method == "private_key" and not merged_secrets.get("private_key"):
            raise ValidationError("Private key is required for key authentication")
    else:
        url = clean.get("url") or ""
        if not url.startswith(("http://", "https://")):
            raise ValidationError("URL must start with http:// or https://")

    return clean, merged_secrets


def update_brev_connection(instance: str, fresh: dict) -> None:
    """Save re-resolved SSH settings on every Brev server for ``instance``."""
    from app.database import SessionLocal

    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        for server in db.query(RemoteServer).filter(RemoteServer.provider == "brev").all():
            config = server_config(server)
            if (config.get("instance_name") or "").strip() != instance:
                continue
            config.update(fresh)
            config.pop("host_fingerprint", None)
            server.config = json.dumps(config)
            server.url = display_address(server.provider, config)
        db.commit()
    finally:
        db.close()


def parse_env_lines(text: str | None) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env
