"""
Provider accounts — one login shared by every server of a provider.

Providers that need one declare an ``account`` block in the catalog
(providers.py). Two kinds:

- ``cli``: a CLI on the backend host holds the login (Brev). The token is
  stored (encrypted) only when the user asks, so provisioning can log in
  again by itself after the CLI's session expires.
- ``api``: cloud APIs (AWS, GCP, Azure, DigitalOcean). There is no other place
  for the login, so the credentials are always stored, encrypted.

Both report the same status, including the provider's instances, which the
UI offers to fill a server's host and identifiers from. Blocking — call via
``asyncio.to_thread``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.database import SessionLocal
from app.remote_server_model import ProviderAccount
from app.remote_servers import brev, cloud
from app.remote_servers import secrets as secret_box
from app.remote_servers.providers import PROVIDERS, get_provider


class AccountError(ValueError):
    pass


def account_providers() -> list[dict]:
    return [p for p in PROVIDERS if p.get("account")]


def _require(provider_id: str) -> dict:
    provider = get_provider(provider_id)
    if not provider or not provider.get("account"):
        raise AccountError(f"'{provider_id}' has no provider account")
    return provider


# ── Stored credentials ───────────────────────────────────────────────────

def _stored(provider_id: str) -> dict:
    if SessionLocal is None:
        return {}
    db = SessionLocal()
    try:
        row = db.get(ProviderAccount, provider_id)
        return secret_box.decrypt(row.secrets) if row else {}
    finally:
        db.close()


def _store(provider_id: str, values: dict | None) -> None:
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        row = db.get(ProviderAccount, provider_id)
        if values:
            row = row or ProviderAccount(provider=provider_id)
            row.secrets = secret_box.encrypt(values)
            db.add(row)
        elif row:
            db.delete(row)
        db.commit()
    finally:
        db.close()


def remembered_token(provider_id: str) -> str | None:
    return _stored(provider_id).get("token")


# ── Brev (CLI) ───────────────────────────────────────────────────────────

def _brev_status() -> dict:
    try:
        instances = brev.list_instances()
    except brev.BrevNotInstalled as e:
        return {"state": "not_installed", "detail": str(e)}
    except brev.BrevLoginRequired:
        return {"state": "logged_out", "detail": "The Brev CLI on the backend host is not logged in."}
    except brev.BrevError as e:
        return {"state": "error", "detail": str(e)}
    try:
        orgs = brev.orgs()
    except brev.BrevError:
        orgs = []  # older CLIs; the login still works
    active = next((o["name"] for o in orgs if o["active"]), None)
    return {"state": "logged_in", "detail": "", "org": active, "orgs": orgs,
            "instances": [{"ref": i["name"], "name": i["name"], "state": i["status"], "public_ip": "",
                           "private_ip": "", "location": "", "config": {"instance_name": i["name"]}}
                          for i in instances]}


def _brev_login(values: dict, remember: bool) -> None:
    token = brev.clean_token(values.get("token") or "")
    if not token:
        raise AccountError("Token is required")
    try:
        brev.login(token)
        if (values.get("org") or "").strip():
            brev.set_org(values["org"].strip())
    except brev.BrevError as e:
        raise AccountError(str(e)) from e
    _store("brev", {"token": token} if remember else None)


# ── Cloud APIs ───────────────────────────────────────────────────────────

def _cloud_status(provider_id: str) -> dict:
    creds = _stored(provider_id)
    if not creds:
        return {"state": "logged_out", "detail": "Not connected — add credentials to list and start VMs."}
    adapter = cloud.ADAPTERS[provider_id]
    try:
        return {"state": "logged_in", "detail": "", "identity": adapter.identity(creds),
                "instances": adapter.instances(creds)}
    except cloud.CloudError as e:
        return {"state": "error", "detail": str(e)}


def _settings(provider: dict, values: dict) -> dict:
    """Non-secret account values, safe to send back (e.g. AWS regions)."""
    return {f["key"]: values[f["key"]] for f in provider["account"]["fields"]
            if not f.get("secret") and values.get(f["key"])}


# ── Public API ───────────────────────────────────────────────────────────

def status(provider_id: str) -> dict:
    provider = _require(provider_id)
    kind = provider["account"]["kind"]
    stored = _stored(provider_id)
    out = {"provider": provider_id, "label": provider["account"]["label"], "kind": kind,
           "identity": None, "org": None, "orgs": [], "instances": [],
           "settings": _settings(provider, stored)}
    out.update(_brev_status() if kind == "cli" else _cloud_status(provider_id))
    out["token_saved"] = bool(stored)
    out["checked_at"] = datetime.now(timezone.utc).isoformat()
    return out


def login(provider_id: str, values: dict, *, remember: bool = False) -> dict:
    """Log in (CLI) or verify and store credentials (API); returns the new status."""
    provider = _require(provider_id)
    values = {k: v for k, v in (values or {}).items() if isinstance(v, str)}
    if provider["account"]["kind"] == "cli":
        _brev_login(values, remember)
    else:
        adapter = cloud.ADAPTERS[provider_id]
        try:
            creds = adapter.creds(values)
            adapter.identity(creds)  # proves the credentials before they are saved
        except cloud.CloudError as e:
            raise AccountError(str(e)) from e
        _store(provider_id, creds)
    result = status(provider_id)
    if result["state"] != "logged_in":
        raise AccountError(f"Logged in, but the account still reports: {result['detail']}")
    return result


def set_org(provider_id: str, org: str) -> dict:
    provider = _require(provider_id)
    if provider["account"]["kind"] != "cli":
        raise AccountError(f"{provider['account']['label']} has no organizations")
    if not org.strip():
        raise AccountError("Choose an organization")
    try:
        brev.set_org(org.strip())
    except brev.BrevError as e:
        raise AccountError(str(e)) from e
    return status(provider_id)


def logout(provider_id: str) -> dict:
    """Log out and forget stored credentials — for Brev, otherwise
    provisioning would quietly log back in."""
    provider = _require(provider_id)
    if provider["account"]["kind"] == "cli":
        try:
            brev.logout()
        except brev.BrevNotInstalled:
            pass
    _store(provider_id, None)
    return status(provider_id)


def start_instance(provider_id: str, ref: str) -> dict:
    provider = _require(provider_id)
    if provider["account"]["kind"] != "api":
        raise AccountError(f"Start {provider['account']['label']} instances from its own console")
    creds = _stored(provider_id)
    if not creds:
        raise AccountError(f"Connect the {provider['account']['label']} account first")
    try:
        cloud.ADAPTERS[provider_id].start(creds, ref)
    except (cloud.CloudError, ValueError) as e:
        raise AccountError(str(e)) from e
    return status(provider_id)
