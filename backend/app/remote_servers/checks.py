"""
Server diagnostics — a step-by-step report of whether a server is usable.

Each check yields ``{id, label, status, detail}`` with status one of
pass | warn | fail | skip. Checks stop at the first connectivity failure
(no point probing HTTP when DNS fails). The overall status is:

- ``unreachable``: DNS, TCP or SSH authentication failed
- ``degraded``:    reachable, but something needed for deployment is off
- ``healthy``:     everything passed
"""

from __future__ import annotations

import asyncio
import socket
import ssl
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from app.remote_servers import ssh
from app.remote_servers.providers import get_provider
from app.remote_servers.edge import EDGE_BLOCK_ADVICE, edge_block

_CONNECTIVITY = {"dns", "tcp", "ssh_auth"}


class _Report:
    def __init__(self):
        self.checks: list[dict] = []
        self.system: dict = {}
        self.facts: dict = {}

    def add(self, id_: str, label: str, status: str, detail: str = "", **extra) -> str:
        self.checks.append({"id": id_, "label": label, "status": status, "detail": detail, **extra})
        return status

    def result(self, started: float) -> dict:
        statuses = {c["id"]: c["status"] for c in self.checks}
        if any(statuses.get(k) == "fail" for k in _CONNECTIVITY):
            overall = "unreachable"
        elif any(c["status"] in ("fail", "warn") for c in self.checks):
            overall = "degraded"
        else:
            overall = "healthy"
        return {
            "status": overall,
            "ok": overall == "healthy",
            "reachable": overall != "unreachable",
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": int((time.monotonic() - started) * 1000),
            "checks": self.checks,
            "system": self.system,
            **self.facts,
        }


def http_auth(config: dict, secrets: dict) -> tuple[dict, tuple | None]:
    """Headers and basic-auth tuple for an HTTP provider."""
    headers: dict = {}
    auth = None
    kind = config.get("auth_type") or "none"
    if kind == "bearer" and secrets.get("auth_token"):
        headers["Authorization"] = f"Bearer {secrets['auth_token']}"
    elif kind == "header" and secrets.get("auth_token"):
        headers[config.get("auth_header") or "X-API-Key"] = secrets["auth_token"]
    elif kind == "basic":
        auth = (config.get("basic_username") or "", secrets.get("basic_password") or "")
    return headers, auth


def _verify_tls(config: dict) -> bool:
    return str(config.get("verify_tls", "true")).lower() != "false"


async def _dns(report: _Report, host: str, port: int) -> bool:
    t0 = time.monotonic()
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    except socket.gaierror as e:
        report.add("dns", "DNS resolution", "fail", f"Cannot resolve '{host}': {e.strerror or e}")
        return False
    addrs = sorted({i[4][0] for i in infos})
    report.add("dns", "DNS resolution", "pass", ", ".join(addrs[:4]),
               latency_ms=int((time.monotonic() - t0) * 1000))
    return True


async def _port_open(host: str, port: int, timeout: float) -> bool:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
    except (asyncio.TimeoutError, OSError):
        return False
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass
    return True


def _private_address(host: str) -> str | None:
    """The address if ``host`` is (or resolves to) a private / non-routable IP."""
    import ipaddress
    try:
        addrs = {i[4][0] for i in socket.getaddrinfo(host, None)}
    except socket.gaierror:
        return None
    for a in addrs:
        ip = ipaddress.ip_address(a)
        if ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_link_local or ip in ipaddress.ip_network("100.64.0.0/10"):
            return a
    return None


async def _explain_unreachable(host: str, port: int, timed_out: bool) -> str:
    """Turn a failed connect into the most likely cause, by probing the host a bit more."""
    private = await asyncio.to_thread(_private_address, host)
    if private and not private.startswith("127."):
        return (
            f"{host} is a private/reserved address ({private}) and this backend can't reach it — it is only "
            "reachable from the same virtual network (or a peered one / VPN). Either run the backend inside "
            "that network, peer the networks, or use the server's public IP."
        )
    if not timed_out:
        return (
            f"Connection refused — the host is up but nothing listens on port {port}. "
            "Check the SSH service is running (sudo systemctl status ssh) and which port it uses."
        )
    # Timed out: is the machine up at all? Other common ports answering means
    # only this port is filtered.
    others = [p for p in (443, 80) if p != port]
    answering = [p for p, ok in zip(others, await asyncio.gather(*(_port_open(host, p, 3) for p in others))) if ok]
    if answering:
        return (
            f"Timed out: the host is up (port {answering[0]} answers) but port {port} is filtered. "
            f"Allow inbound TCP {port} from this backend's public IP — AWS security group, Azure NSG, "
            f"GCP firewall rule, or the VM's own firewall (sudo ufw allow {port}/tcp)."
        )
    return (
        f"Timed out: port {port} gets no reply, so packets are being dropped before they reach SSH. "
        f"Most often an inbound rule for TCP {port} is missing, or allows a different source IP than "
        "this backend's — then check the VM is running and this is its current public IP (it changes "
        "after stop/start unless static). Ports 443/80 didn't answer either, which is normal for a "
        "plain VM and doesn't mean it is down."
    )


async def _tcp(report: _Report, host: str, port: int) -> bool:
    t0 = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=8)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    except asyncio.TimeoutError:
        report.add("tcp", f"TCP port {port}", "fail", await _explain_unreachable(host, port, True))
        return False
    except OSError as e:
        timed_out = "timed out" in str(e).lower() or getattr(e, "winerror", None) == 10060
        report.add("tcp", f"TCP port {port}", "fail", await _explain_unreachable(host, port, timed_out))
        return False
    ms = int((time.monotonic() - t0) * 1000)
    report.facts["latency_ms"] = ms
    report.add("tcp", f"TCP port {port}", "pass", f"Open ({ms} ms)", latency_ms=ms)
    return True


def _cert_expiry(host: str, port: int) -> datetime:
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=6) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            cert = tls.getpeercert()
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), tz=timezone.utc)


async def _tls(report: _Report, host: str, port: int, verify: bool) -> None:
    try:
        expires = await asyncio.to_thread(_cert_expiry, host, port)
    except ssl.SSLCertVerificationError as e:
        status = "warn" if not verify else "fail"
        note = " (verification disabled for this server)" if not verify else ""
        report.add("tls", "TLS certificate", status, f"Certificate not trusted: {e.verify_message}{note}")
        return
    except Exception as e:
        report.add("tls", "TLS certificate", "fail", f"TLS handshake failed: {e}")
        return
    days = (expires - datetime.now(timezone.utc)).days
    status = "fail" if days < 0 else "warn" if days < 14 else "pass"
    report.add("tls", "TLS certificate", status, f"Valid, expires in {days} days ({expires.date()})")


async def _check_http(provider: dict, config: dict, secrets: dict, report: _Report) -> None:
    url = (config.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        report.add("config", "Configuration", "fail", "URL must be an absolute http(s) URL")
        return
    report.add("config", "Configuration", "pass", url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    if not await _dns(report, host, port) or not await _tcp(report, host, port):
        return
    if parsed.scheme == "https":
        await _tls(report, host, port, _verify_tls(config))
    else:
        report.add("tls", "TLS certificate", "warn", "Plain HTTP — credentials and code travel unencrypted")

    headers, auth = http_auth(config, secrets)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    health_path = config.get("health_path") or "/health"
    async with httpx.AsyncClient(timeout=8.0, verify=_verify_tls(config), follow_redirects=True) as client:
        t0 = time.monotonic()
        try:
            resp = await client.get(origin + health_path, headers=headers, auth=auth)
            ms = int((time.monotonic() - t0) * 1000)
            if resp.status_code < 300:
                body = None
                if resp.headers.get("content-type", "").startswith("application/json"):
                    try:
                        body = resp.json()
                    except ValueError:
                        body = None
                report.facts["health"] = body
                report.add("health", f"Health endpoint {health_path}", "pass", f"HTTP {resp.status_code} in {ms} ms")
            elif edge_block(resp):
                report.add("health", f"Health endpoint {health_path}", "fail",
                           f"{edge_block(resp)}. {EDGE_BLOCK_ADVICE}")
            elif resp.status_code in (401, 403):
                report.add("health", f"Health endpoint {health_path}", "fail",
                           f"HTTP {resp.status_code} — credentials rejected")
            else:
                report.add("health", f"Health endpoint {health_path}", "warn",
                           f"HTTP {resp.status_code} — server is up but has no healthy {health_path}")
        except httpx.HTTPError as e:
            report.add("health", f"Health endpoint {health_path}", "fail", f"Request failed: {e}")
            return

        # The deploy endpoint itself: 404 means the path is wrong; 405 on a
        # GET is the normal answer from a POST-only route.
        try:
            resp = await client.get(url, headers=headers, auth=auth)
            if resp.status_code == 404:
                report.add("endpoint", "Deploy endpoint", "fail", f"{parsed.path or '/'} returned 404 — check the URL path")
            elif edge_block(resp):
                report.add("endpoint", "Deploy endpoint", "fail", f"{edge_block(resp)}.")
            elif resp.status_code in (401, 403):
                report.add("endpoint", "Deploy endpoint", "fail", f"HTTP {resp.status_code} — credentials rejected")
            else:
                report.add("endpoint", "Deploy endpoint", "pass", f"Route exists (GET → HTTP {resp.status_code})")
        except httpx.HTTPError as e:
            report.add("endpoint", "Deploy endpoint", "warn", f"Could not probe: {e}")


_FACTS_SCRIPT = r"""
P={path}
mkdir -p "$P" 2>/dev/null
echo "os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s)"
echo "kernel=$(uname -sr 2>/dev/null)"
echo "arch=$(uname -m 2>/dev/null)"
echo "cpus=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"
echo "mem_total_mb=$(awk '/MemTotal/ {{print int($2/1024)}}' /proc/meminfo 2>/dev/null)"
echo "mem_avail_mb=$(awk '/MemAvailable/ {{print int($2/1024)}}' /proc/meminfo 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "uptime=$(uptime -p 2>/dev/null)"
if command -v python3 >/dev/null 2>&1; then
  echo "python=$(python3 --version 2>&1)"
  python3 -c 'import venv, ensurepip' >/dev/null 2>&1 && echo "python_venv=yes" || echo "python_venv=no"
fi
if command -v docker >/dev/null 2>&1; then
  echo "docker=$(docker --version 2>/dev/null)"
  echo "compose=$(docker compose version --short 2>/dev/null || docker-compose version --short 2>/dev/null)"
  docker info >/dev/null 2>&1 && echo "docker_access=yes" || echo "docker_access=no"
fi
[ -w "$P" ] && echo "deploy_writable=yes" || echo "deploy_writable=no"
echo "deploy_path=$(cd "$P" 2>/dev/null && pwd)"
echo "disk_free_mb=$(df -Pm "$P" 2>/dev/null | awk 'NR==2 {{print $4}}')"
"""


def _parse_facts(text: str) -> dict:
    facts = {}
    for line in text.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            facts[k.strip()] = v.strip()
    return facts


def _int(v) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _evaluate_host(report: _Report, f: dict) -> None:
    report.system = f
    if f.get("python"):
        report.add("python", "Python 3", "pass", f["python"])
        if f.get("python_venv") == "no":
            report.add("python_venv", "Python venv", "warn",
                       "venv/ensurepip missing — the bootstrap action needs it (e.g. apt install python3-venv)")
        else:
            report.add("python_venv", "Python venv", "pass", "Available")
    else:
        report.add("python", "Python 3", "fail", "python3 not found — required to extract and bootstrap packages")

    if f.get("docker"):
        report.add("docker", "Docker", "pass", f["docker"])
        if f.get("docker_access") == "no":
            report.add("docker_access", "Docker access", "warn",
                       "This user cannot reach the Docker daemon (add it to the 'docker' group)")
        if f.get("compose"):
            report.add("compose", "Docker Compose", "pass", f"v{f['compose'].lstrip('v')}")
        else:
            report.add("compose", "Docker Compose", "warn", "Not installed — the docker compose action will fail")
    else:
        report.add("docker", "Docker", "warn", "Not installed — needed only for the docker compose action")

    if f.get("deploy_writable") == "yes":
        report.add("deploy_path", "Deploy directory", "pass", f.get("deploy_path") or "writable")
    else:
        report.add("deploy_path", "Deploy directory", "fail", "Cannot create or write the deploy directory")

    disk = _int(f.get("disk_free_mb"))
    if disk is not None:
        status = "fail" if disk < 500 else "warn" if disk < 2048 else "pass"
        report.add("disk", "Free disk", status, f"{disk / 1024:.1f} GB free at deploy directory")

    mem = _int(f.get("mem_total_mb"))
    if mem is not None:
        avail = _int(f.get("mem_avail_mb"))
        detail = f"{mem / 1024:.1f} GB total" + (f", {avail / 1024:.1f} GB available" if avail is not None else "")
        report.add("memory", "Memory", "warn" if mem < 1024 else "pass", detail)


async def _check_ssh(config: dict, secrets: dict, report: _Report) -> None:
    host = (config.get("host") or "").strip()
    port = int(config.get("port") or 22)
    if not host or not config.get("username"):
        report.add("config", "Configuration", "fail", "Host and username are required")
        return
    report.add("config", "Configuration", "pass", f"{config.get('username')}@{host}:{port}")

    if not await _dns(report, host, port) or not await _tcp(report, host, port):
        return

    expected = config.get("host_fingerprint") or None
    t0 = time.monotonic()
    try:
        client = await asyncio.to_thread(ssh.connect, config, secrets, expected_fingerprint=expected)
    except ssh.SSHError as e:
        report.add("ssh_auth", "SSH login", "fail", str(e))
        return
    fp = client.host_fingerprint
    report.facts["host_fingerprint"] = fp
    report.add("ssh_auth", "SSH login", "pass",
               f"Authenticated in {int((time.monotonic() - t0) * 1000)} ms",)
    report.add("host_key", "Host key", "pass",
               f"{fp} (matches stored key)" if expected else f"{fp} (recorded on first use)")

    try:
        script = _FACTS_SCRIPT.format(path=ssh.shell_path(config.get("deploy_path") or "~/workflow-deployments"))
        _, out = await asyncio.to_thread(ssh.run, client, script, timeout=30)
        _evaluate_host(report, _parse_facts(out))
    except ssh.SSHError as e:
        report.add("host_facts", "Host inspection", "fail", str(e))
    finally:
        client.close()


async def run_checks(provider_id: str, config: dict, secrets: dict) -> dict:
    started = time.monotonic()
    report = _Report()
    provider = get_provider(provider_id)
    if not provider:
        report.add("config", "Configuration", "fail", f"Unknown provider '{provider_id}'")
        return report.result(started)
    try:
        if provider["transport"] == "ssh":
            await _check_ssh(config, secrets, report)
        else:
            await _check_http(provider, config, secrets, report)
    except Exception as e:  # a check must never 500 the request
        report.add("internal", "Diagnostics", "fail", f"Unexpected error: {e}")
    return report.result(started)
