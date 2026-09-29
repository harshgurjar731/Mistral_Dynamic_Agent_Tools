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


def run(*args: str, input: str | None = None, check: bool = True, timeout: int = 900) -> str:
    """Run a command where the Brev CLI lives. Returns stdout+stderr, ANSI-stripped."""
    if args and args[0] == "brev":
        args = (_brev_binary(), *args[1:])
    try:
        r = subprocess.run([*cli_prefix(), *args], input=input, capture_output=True,
                           text=True, timeout=timeout, encoding="utf-8", errors="replace")
    except FileNotFoundError as e:
        where = " inside WSL" if cli_prefix() else ""
        raise BrevError(f"'{args[0]}' not found — install the Brev CLI{where} on the backend host") from e
    except subprocess.TimeoutExpired as e:
        raise BrevError(f"`{' '.join(args[:2])}` timed out after {timeout}s") from e
    out = ANSI.sub("", r.stdout + r.stderr)
    if check and r.returncode:
        raise BrevError(f"`{' '.join(args[:3])}` failed (exit {r.returncode}):\n{out.strip()}")
    return out


def login(token: str) -> None:
    run("brev", "login", "--token", token)


def instance_status(name: str) -> str | None:
    """STATUS column of `brev ls` for this instance, located by its header row."""
    status_col = None
    for line in run("brev", "ls").splitlines():
        cols = line.split()
        if "NAME" in cols and "STATUS" in cols:
            status_col = cols.index("STATUS")
        elif status_col is not None and cols and cols[0] == name and len(cols) > status_col:
            return cols[status_col].upper()
    return None


def require_running(name: str) -> None:
    status = instance_status(name)
    if status is None:
        raise BrevError(f"No Brev instance named '{name}' in `brev ls` — create it in the Brev "
                        "console, or log the backend host's CLI in to the right org")
    if status != "RUNNING":
        raise BrevError(f"Brev instance '{name}' is {status} — start it in the Brev console first")


def ssh_details(name: str) -> dict:
    """host / port / username / private_key for an instance, via `brev refresh` + `ssh -G`.

    ``proxied`` is True when Brev routes SSH through a ProxyCommand (e.g. its
    cloudflared tunnel): host/port are then unusable from paramiko, and the
    caller needs a public endpoint (Access tab → TCP/UDP ports) instead.
    """
    run("brev", "refresh")
    opts: dict[str, list[str]] = {}
    for line in run("ssh", "-G", name).splitlines():
        key, _, value = line.strip().partition(" ")
        opts.setdefault(key.lower(), []).append(value)

    host = opts.get("hostname", [name])[0]
    if host == name:
        raise BrevError(f"No SSH entry for '{name}' after `brev refresh`")
    proxied = (opts.get("proxycommand", ["none"])[0] != "none"
               or opts.get("proxyjump", ["none"])[0] != "none")

    home = run("sh", "-c", "echo $HOME").strip()
    candidates = sorted(opts.get("identityfile", []), key=lambda p: "brev" not in p)
    for path in candidates:
        key = run("cat", re.sub(r"^~", home, path), check=False)
        if "PRIVATE KEY" in key:
            return {"host": host, "port": int(opts.get("port", ["22"])[0]),
                    "username": opts.get("user", ["ubuntu"])[0], "private_key": key,
                    "proxied": proxied}
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
