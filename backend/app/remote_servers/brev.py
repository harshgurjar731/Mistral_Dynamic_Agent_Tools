"""
NVIDIA Brev CLI helpers — blocking; call them via ``asyncio.to_thread``.

A Brev server is an ordinary SSH server whose connection details come from
the Brev CLI instead of the user: ``brev refresh`` writes an SSH config entry
per instance, ``ssh -G <instance>`` resolves it (Include directives and all),
and the IdentityFile it names is the private key.

The CLI runs on the backend host. On Windows it lives in WSL, so every call
goes through ``wsl -e`` and the SSH config and key are the WSL user's.
Set ``BREV_WSL_DISTRO`` to pick a distro, or ``BREV_NATIVE=1`` to call the
CLI directly.

No app imports: scripts/brev_deploy.py uses this module standalone.
"""

from __future__ import annotations

import functools
import os
import re
import shlex
import subprocess
import sys

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

# Idempotent: installs only what is missing. The workflow deploy needs
# python3-venv (bootstrap venv), unzip or python3 (extraction) and Docker
# usable without sudo (compose actions).
PREP_SCRIPT = r"""
set -e
need=""
command -v python3 >/dev/null 2>&1 || need="$need python3"
python3 -c 'import ensurepip' >/dev/null 2>&1 || need="$need python3-venv"
command -v unzip >/dev/null 2>&1 || need="$need unzip"
if [ -n "$need" ]; then
  echo "installing:$need"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $need
fi
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "installing docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
if [ "$(id -u)" != "0" ] && ! id -nG | grep -qw docker; then
  echo "adding $USER to the docker group"
  sudo usermod -aG docker "$USER"
fi
echo "prep ok"
"""


class BrevError(RuntimeError):
    pass


class BrevNotInstalled(BrevError):
    pass


class BrevLoginRequired(BrevError):
    pass


# Different CLI versions word it differently; `ssh -G` also surfaces it from
# the `brev mint-cert` that Brev's ssh_config runs.
_LOGGED_OUT = re.compile(r"currently logged out|not logged in|please log ?in", re.I)
LOGIN_ADVICE = ("The Brev CLI on the backend host is not logged in — log in under Remote servers → "
                "Provider accounts (or run `brev login` there; Docker: "
                "docker compose exec -it backend brev login)")


def cli_prefix() -> list[str]:
    if sys.platform != "win32" or os.environ.get("BREV_NATIVE") == "1":
        return []
    distro = os.environ.get("BREV_WSL_DISTRO")
    return ["wsl", *(["-d", distro] if distro else []), "-e"]


@functools.lru_cache(maxsize=1)
def _brev_binary() -> str:
    """Path to the CLI. Its installer puts it in ~/.local/bin, which is not on
    PATH for a non-login `wsl -e` / subprocess call. BREV_CLI overrides."""
    if os.environ.get("BREV_CLI"):
        return os.environ["BREV_CLI"]
    r = subprocess.run(
        [*cli_prefix(), "sh", "-c",
         'command -v brev || { [ -x "$HOME/.local/bin/brev" ] && echo "$HOME/.local/bin/brev"; }'],
        capture_output=True, text=True, timeout=30, encoding="utf-8", errors="replace",
    )
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "brev"


def run(*args: str, input: str | None = None, check: bool = True, timeout: int = 900,
        login_check: bool = True) -> str:
    """Run a command where the Brev CLI lives. Returns stdout+stderr, ANSI-stripped.

    stdin is closed unless ``input`` is given: a CLI that wants to prompt
    (login, org choice) then fails at once instead of waiting for a terminal
    that is not there until the timeout.
    """
    is_brev = bool(args) and args[0] == "brev"
    if is_brev:
        args = (_brev_binary(), *args[1:])
    where = " inside WSL" if cli_prefix() else ""
    stdin = {"input": input} if input is not None else {"stdin": subprocess.DEVNULL}
    try:
        r = subprocess.run([*cli_prefix(), *args], capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace", **stdin)
    except FileNotFoundError as e:
        raise BrevNotInstalled(f"'{args[0]}' not found — install the Brev CLI{where} on the backend host") from e
    except subprocess.TimeoutExpired as e:
        raise BrevError(f"`{' '.join(args[:2])}` timed out after {timeout}s") from e
    out = ANSI.sub("", r.stdout + r.stderr)
    # 127 from a shell, "execvpe" from `wsl -e`: the binary is not there.
    if is_brev and r.returncode and (r.returncode == 127 or "execvpe" in out):
        raise BrevNotInstalled(f"The Brev CLI is not installed{where} on the backend host")
    if login_check and _LOGGED_OUT.search(out):
        raise BrevLoginRequired(LOGIN_ADVICE)
    if check and r.returncode:
        raise BrevError(f"`{' '.join(args[:3])}` failed (exit {r.returncode}):\n{out.strip()}")
    return out


def clean_token(token: str) -> str:
    """Accept the bare token or the whole `brev login --token …` command the console shows."""
    token = token.strip()
    m = re.search(r"--token[=\s]+(\S+)", token)
    return m.group(1) if m else token


def login(token: str) -> None:
    run("brev", "login", "--token", clean_token(token), timeout=120, login_check=False)


def logout() -> None:
    run("brev", "logout", check=False, timeout=60, login_check=False)


def set_org(org: str) -> None:
    run("brev", "set", org, timeout=60)


def orgs() -> list[dict]:
    """Organizations from `brev org ls`; the active one is marked with '*'."""
    rows, header = [], False
    for line in run("brev", "org", "ls", timeout=60).splitlines():
        text = line.strip()
        if not text:
            continue
        cols = text.lstrip("* ").split()
        if cols and cols[0] == "NAME":
            header = True
        elif header and cols:
            rows.append({"name": cols[0], "active": text.startswith("*")})
    return rows


def list_instances() -> list[dict]:
    """[{name, status}] from `brev ls`, columns located by its header row."""
    rows, status_col = [], None
    for line in run("brev", "ls", timeout=90).splitlines():
        cols = line.split()
        if "NAME" in cols and "STATUS" in cols:
            status_col = cols.index("STATUS")
        elif status_col is not None and not cols and rows:
            break  # the table ends at a blank line; hints follow it
        elif status_col is not None and len(cols) > status_col:
            rows.append({"name": cols[0], "status": cols[status_col].upper()})
    return rows


def instance_status(name: str) -> str | None:
    """STATUS column of `brev ls` for this instance."""
    return next((i["status"] for i in list_instances() if i["name"] == name), None)


def require_running(name: str) -> None:
    status = instance_status(name)
    if status is None:
        raise BrevError(f"No Brev instance named '{name}' in `brev ls` — create it in the Brev "
                        "console, or log the backend host's CLI in to the right org")
    if status != "RUNNING":
        raise BrevError(f"Brev instance '{name}' is {status} — start it in the Brev console first")


def _fix_ssh_permissions() -> None:
    """ssh refuses a group/world-writable ~/.ssh/config ("Bad owner or
    permissions"), which `brev refresh` can leave behind. Tighten what we own;
    report what we cannot (e.g. files created by root in a container)."""
    out = run("sh", "-c",
              'd="$HOME/.ssh"; [ -d "$d" ] || exit 0; chmod 700 "$d" 2>/dev/null; '
              'for f in "$d/config" "$HOME/.brev/ssh_config"; do [ -e "$f" ] || continue; '
              'chmod go-w "$f" 2>/dev/null; [ -O "$f" ] || echo "not-owned: $f"; done', check=False)
    bad = [line.split(": ", 1)[1] for line in out.splitlines() if line.startswith("not-owned: ")]
    if bad:
        raise BrevError(f"{', '.join(bad)} is owned by another user, so ssh will refuse it. In Docker: "
                        "docker compose exec -u root backend chown -R app:app /home/app/.ssh /home/app/.brev")


def ssh_details(name: str) -> dict:
    """host / port / username / private_key for an instance, via `brev refresh` + `ssh -G`.

    ``proxied`` is True when Brev routes SSH through a ProxyCommand (e.g. its
    cloudflared tunnel): host/port are then unusable from paramiko, and the
    caller needs a public endpoint (Access tab → TCP/UDP ports) instead.
    """
    run("brev", "refresh")
    _fix_ssh_permissions()
    opts: dict[str, list[str]] = {}
    for line in run("ssh", "-G", name).splitlines():
        key, _, value = line.strip().partition(" ")
        opts.setdefault(key.lower(), []).append(value)

    host = opts.get("hostname", [name])[0]
    if host == name:
        raise BrevError(f"No SSH entry for '{name}' after `brev refresh`")
    proxied = (opts.get("proxycommand", ["none"])[0] != "none"
               or opts.get("proxyjump", ["none"])[0] != "none")

    details = {"host": host, "port": int(opts.get("port", ["22"])[0]),
               "username": opts.get("user", ["ubuntu"])[0], "proxied": proxied}
    home = run("sh", "-c", "echo $HOME").strip()
    candidates = sorted(opts.get("identityfile", []), key=lambda p: "brev" not in p)
    for path in candidates:
        key = run("cat", re.sub(r"^~", home, path), check=False)
        if "PRIVATE KEY" in key:
            return {**details, "private_key": key}
    # Certificate logins need no key file on disk (a fresh host has none until
    # the first `brev mint-cert`): mint one so there is a key to store.
    cert = cert_params(name)
    if cert:
        key, _ = mint_cert(cert["brev_env"], cert["brev_port_id"], cert["brev_linux_user"])
        return {**details, "private_key": key}
    raise BrevError(f"Could not read a private key for '{name}' (tried: {', '.join(candidates) or 'none'})")


def cert_params(name: str) -> dict | None:
    """The `brev mint-cert` arguments Brev's SSH config uses for this instance.

    Brev instances accept short-lived certificates (about five minutes), not a
    static key: its ssh_config runs `brev mint-cert` in a `Match ... exec`
    before every connection. We read those arguments so the backend can mint
    its own certificate per connection. None if the instance uses plain keys.
    """
    text = run("sh", "-c", 'cat "$HOME/.brev/ssh_config" 2>/dev/null', check=False)
    for line in text.splitlines():
        m = re.match(r'\s*Match\s+host\s+(\S+)\s+exec\s+"(.*)"\s*$', line)
        if not m or m.group(1) != name:
            continue
        argv = shlex.split(m.group(2))
        flags = {argv[i]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
        if "--env" in flags:
            return {"brev_env": flags["--env"], "brev_port_id": flags.get("--port", ""),
                    "brev_linux_user": flags.get("--linux-user", "")}
    return None


def override_port(details: dict, public_host: str, public_port: int | None) -> int:
    """Port for a public-host override. Left empty, it is Brev's own port when
    the override names the host Brev already reports (e.g. its endpoint on
    :51322) — not 22, which there reaches something that rejects the login."""
    if public_port:
        return int(public_port)
    return int(details["port"]) if public_host == details["host"] else 22


def resolve_connection(name: str, public_host: str | None = None,
                       public_port: int | None = None) -> dict:
    """The instance's current SSH settings — after a stop/start Brev can hand
    out a new endpoint port or port ID. Keys match the server config:
    host, port, username, brev_env, brev_port_id, brev_linux_user."""
    require_running(name)
    details = ssh_details(name)
    if public_host:
        details.update(host=public_host, port=override_port(details, public_host, public_port))
    elif details["proxied"]:
        raise BrevError(f"Brev reaches '{name}' through an SSH proxy — set a public IP override")
    fresh = {k: details[k] for k in ("host", "port", "username")}
    fresh.update(cert_params(name) or {"brev_env": "", "brev_port_id": "", "brev_linux_user": ""})
    return fresh


def mint_cert(env: str, port_id: str = "", linux_user: str = "") -> tuple[str, str]:
    """A fresh (private key, certificate) pair for one SSH connection."""
    home = run("sh", "-c", "echo $HOME").strip()
    out = f"{home}/.brev/ssh-certs/app-{env}"
    run("brev", "mint-cert", "--env", env, *(["--port", port_id] if port_id else []),
        *(["--linux-user", linux_user] if linux_user else []), "--out-key", out, timeout=60)
    key, cert = run("cat", out), run("cat", f"{out}-cert.pub")
    if "PRIVATE KEY" not in key or "cert" not in cert:
        raise BrevError("`brev mint-cert` did not produce a key and certificate")
    return key, cert.strip()
