"""
Thin, blocking SSH helpers over paramiko. Call them via ``asyncio.to_thread``.

Host keys are trust-on-first-use: the first successful connection records the
server's SHA256 fingerprint in its config, and every later connection refuses
to proceed if the fingerprint changed.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import shlex
import socket
import threading
import time
from typing import Callable


class SSHError(RuntimeError):
    pass


def _paramiko():
    try:
        import paramiko  # noqa: WPS433 — optional dependency, imported lazily
    except ImportError as e:  # pragma: no cover
        raise SSHError("SSH support needs the 'paramiko' package: pip install paramiko") from e
    # paramiko's transport thread logs every failed handshake as an ERROR
    # traceback; connect() already turns those failures into an SSHError.
    logging.getLogger("paramiko").setLevel(logging.CRITICAL)
    return paramiko


def _parse_with_paramiko(text: str, passphrase: str | None):
    paramiko = _paramiko()
    classes = [getattr(paramiko, n) for n in ("Ed25519Key", "ECDSAKey", "RSAKey", "DSSKey") if hasattr(paramiko, n)]
    last_error: Exception | None = None
    for cls in classes:
        try:
            return cls.from_private_key(io.StringIO(text), password=passphrase or None)
        except paramiko.PasswordRequiredException as e:
            raise SSHError("The private key is encrypted — enter its passphrase") from e
        except Exception as e:  # wrong key type; try the next one
            last_error = e
    raise SSHError(f"Could not parse the private key ({last_error})")


def _to_openssh(text: str, passphrase: str | None) -> str | None:
    """Re-encode a key paramiko cannot read (e.g. PKCS#8 "BEGIN PRIVATE KEY", as
    Brev's brev.pem is) into the OpenSSH format it can. None if not a key."""
    from cryptography.hazmat.primitives import serialization

    password = passphrase.encode() if passphrase else None
    attempts = [(serialization.load_pem_private_key, text.encode()),
                (serialization.load_ssh_private_key, text.encode())]
    # A key pasted without its -----BEGIN/END----- lines is still valid base64
    # DER (PKCS#1 or PKCS#8) underneath.
    if "-----" not in text:
        try:
            attempts.append((serialization.load_der_private_key,
                             base64.b64decode("".join(text.split()), validate=True)))
        except ValueError:
            pass
    for load, data in attempts:
        try:
            key = load(data, password=password)
        except Exception:
            continue
        return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH,
                                 serialization.NoEncryption()).decode()
    return None


def _load_key(text: str, passphrase: str | None):
    if not (text or "").strip():
        raise SSHError("No private key is stored for this server — re-provision it (Brev) "
                       "or paste the key under Edit")
    # Keys copied on Windows or read through WSL can carry CRLF line endings.
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"
    try:
        return _parse_with_paramiko(text, passphrase)
    except SSHError as e:
        if "passphrase" in str(e):
            raise
        converted = _to_openssh(text, passphrase)
        if converted is None:
            # Only the armor line is safe to echo — never key material.
            first = text.splitlines()[0]
            shape = f"its first line is '{first[:60]}'" if first.startswith("-----") \
                else "it has no -----BEGIN … PRIVATE KEY----- line"
            raise SSHError(f"Could not parse the private key ({shape}) — paste the whole key file, "
                           "from the -----BEGIN line to the -----END line") from e
        return _parse_with_paramiko(converted, None)


def fingerprint(key) -> str:
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


def connect(config: dict, secrets: dict, *, timeout: float = 12.0, expected_fingerprint: str | None = None):
    """Open an authenticated SSHClient. Raises SSHError with a readable message."""
    paramiko = _paramiko()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())  # verified manually below

    kwargs = {
        "hostname": config.get("host"),
        "port": int(config.get("port") or 22),
        "username": config.get("username"),
        "timeout": timeout,
        "banner_timeout": timeout,
        "auth_timeout": timeout,
        "allow_agent": False,
        "look_for_keys": False,
    }
    if config.get("brev_env"):
        # Brev accepts only short-lived certificates: mint one per connection.
        from app.remote_servers import brev

        try:
            key_text, cert = brev.mint_cert(config["brev_env"], config.get("brev_port_id") or "",
                                            config.get("brev_linux_user") or "")
        except brev.BrevError as e:
            raise SSHError(f"Could not mint a Brev SSH certificate: {e}") from e
        pkey = _load_key(key_text, None)
        pkey.load_certificate(cert)
        kwargs["pkey"] = pkey
    elif (config.get("auth_method") or "private_key") == "password":
        kwargs["password"] = secrets.get("password")
    else:
        kwargs["pkey"] = _load_key(secrets.get("private_key") or "", secrets.get("passphrase"))

    try:
        client.connect(**kwargs)
    except paramiko.AuthenticationException as e:
        raise SSHError(f"Authentication failed for user '{kwargs['username']}'") from e
    except (socket.timeout, TimeoutError) as e:
        raise SSHError("Timed out connecting over SSH") from e
    except paramiko.SSHException as e:
        if "banner" in str(e).lower():
            raise SSHError(
                f"Port {kwargs['port']} on {kwargs['hostname']} accepted the connection but no SSH server "
                "answered — wrong port, or a firewall/proxy in between is swallowing the traffic"
            ) from e
        raise SSHError(f"SSH negotiation failed: {e}") from e
    except OSError as e:
        raise SSHError(f"Cannot connect: {e}") from e

    actual = fingerprint(client.get_transport().get_remote_server_key())
    # Brev's ingress does not present a stable host key — its own ssh_config
    # disables host-key checking — so a pin would reject later connections.
    # Brev servers are authenticated by Brev-signed certificates instead.
    if config.get("brev_env"):
        expected_fingerprint = None
    if expected_fingerprint and actual != expected_fingerprint:
        client.close()
        raise SSHError(
            f"Host key changed (expected {expected_fingerprint}, got {actual}). "
            "If the server was rebuilt, clear the stored fingerprint in its settings."
        )
    client.host_fingerprint = actual  # type: ignore[attr-defined]
    return client


def run(client, command: str, *, timeout: float = 60.0,
        on_output: Callable[[str], None] | None = None,
        cancel: threading.Event | None = None) -> tuple[int, str]:
    """Run a command, stdout+stderr combined. Returns (exit_code, output).

    Setting ``cancel`` closes the channel, which ends the remote command.
    """
    transport = client.get_transport()
    channel = transport.open_session()
    channel.set_combine_stderr(True)
    channel.exec_command(command)

    chunks: list[str] = []
    deadline = time.monotonic() + timeout
    while True:
        if cancel is not None and cancel.is_set():
            channel.close()
            raise SSHError("Stopped")
        if channel.recv_ready():
            data = channel.recv(65536).decode(errors="replace")
            chunks.append(data)
            if on_output:
                on_output(data)
            continue
        if channel.exit_status_ready() and not channel.recv_ready():
            break
        if time.monotonic() > deadline:
            channel.close()
            raise SSHError(f"Command timed out after {int(timeout)}s")
        time.sleep(0.1)
    return channel.recv_exit_status(), "".join(chunks)


def shell_path(path: str) -> str:
    """Quote a remote path for sh, keeping a leading ~ expandable."""
    path = (path or "").strip() or "~"
    if path == "~":
        return '"$HOME"'
    if path.startswith("~/"):
        return '"$HOME"/' + shlex.quote(path[2:])
    return shlex.quote(path)
