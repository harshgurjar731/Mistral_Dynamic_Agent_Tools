"""
Sandbox — runs candidate code in a separate, limited process.

The service never executes unverified code in its own interpreter. This module
stages the candidate in a private temp directory and launches
``sandbox_runner.py`` against it with a stripped environment, resource limits,
and — when the service runs as root, as it does in the container — as the
unprivileged ``sandboxuser``.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

RUNNER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sandbox_runner.py")
MARKER = "@@SANDBOX_RESULT@@"


@dataclass
class SandboxOptions:
    block_network: bool = True
    http_stub: bool = False
    fixtures: list = field(default_factory=list)
    secrets: Optional[dict] = None
    timeout_seconds: Optional[int] = None


@dataclass
class SandboxRun:
    """What happened when the candidate ran."""

    #: The runner itself broke — our fault, never the candidate's.
    harness_error: Optional[str] = None
    #: The module failed to load, or has no ``run`` — the candidate's fault.
    import_error: Optional[str] = None
    import_traceback: str = ""
    #: The process exceeded its time budget; ``hung_case`` is the case running then.
    timed_out: bool = False
    hung_case: Optional[str] = None
    results: list[dict] = field(default_factory=list)

    @property
    def by_id(self) -> dict[str, dict]:
        return {r["id"]: r for r in self.results}


def _sandbox_env() -> dict:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin"),
           "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONIOENCODING": "utf-8"}
    # Windows' interpreter cannot initialise without these.
    for key in ("SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "WINDIR"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def _demote_kwargs() -> dict:
    """Run as the sandbox user when we are root and that user exists (POSIX)."""
    if os.name != "posix" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        return {}
    try:
        import pwd

        pwd.getpwnam(settings.SANDBOX_USER)
    except (ImportError, KeyError):
        return {}
    return {"user": settings.SANDBOX_USER, "group": settings.SANDBOX_USER}


def run_in_sandbox(code: str, cases: list[dict], options: SandboxOptions) -> SandboxRun:
    """Execute ``code`` against ``cases`` (``[{"id", "kwargs", "repeat"}]``)."""
    workdir = tempfile.mkdtemp(prefix="synth_")
    try:
        module_path = os.path.join(workdir, "candidate.py")
        with open(module_path, "w", encoding="utf-8") as f:
            f.write(code)
        demote = _demote_kwargs()
        if demote:
            try:
                shutil.chown(workdir, user=settings.SANDBOX_USER)
                shutil.chown(module_path, user=settings.SANDBOX_USER)
            except (OSError, LookupError):
                demote = {}

        timeout = options.timeout_seconds or settings.SANDBOX_TIMEOUT_SECONDS
        payload = json.dumps({
            "module_path": module_path,
            "cases": cases,
            "block_network": options.block_network,
            "http_stub": options.http_stub,
            "fixtures": options.fixtures,
            "secrets": options.secrets,
            "memory_mb": settings.SANDBOX_MEMORY_MB,
            "cpu_seconds": timeout,
        }, default=str)

        try:
            proc = subprocess.run(
                [sys.executable, "-E", "-B", RUNNER_PATH],
                input=payload.encode("utf-8"),
                capture_output=True,
                timeout=timeout,
                env=_sandbox_env(),
                cwd=workdir,
                **demote,
            )
        except subprocess.TimeoutExpired as e:
            stderr = (e.stderr or b"").decode(errors="replace")
            hung = [ln.split(" ", 1)[1] for ln in stderr.splitlines() if ln.startswith("@@case ")]
            return SandboxRun(timed_out=True, hung_case=hung[-1] if hung else None)
        except (OSError, ValueError) as e:
            return SandboxRun(harness_error=f"Could not start the sandbox: {e}")

        return _parse(proc)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _parse(proc: subprocess.CompletedProcess) -> SandboxRun:
    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")
    line = next((ln for ln in reversed(stdout.splitlines()) if ln.startswith(MARKER)), None)

    if line is None:
        # No protocol line: the process died underneath the runner — a resource
        # limit, an interpreter crash — or the runner never started. When a case
        # was in progress, the candidate is the likelier cause (e.g. it blew the
        # memory limit), so it is attributed there; otherwise it is ours.
        cases = [ln.split(" ", 1)[1] for ln in stderr.splitlines() if ln.startswith("@@case ")]
        detail = (stderr.strip() or stdout.strip() or f"exit code {proc.returncode}")[-3000:]
        if cases:
            return SandboxRun(
                import_error=(f"The process died while running case '{cases[-1]}' "
                              f"(exit code {proc.returncode}) — often the memory or CPU "
                              f"limit. Output:\n{detail}"),
            )
        return SandboxRun(harness_error=f"Sandbox produced no result: {detail}")

    try:
        payload = json.loads(line[len(MARKER):])
    except ValueError as e:
        return SandboxRun(harness_error=f"Unreadable sandbox result: {e}")

    phase = payload.get("phase")
    if phase == "runner":
        return SandboxRun(harness_error=f"{payload.get('error')}\n{payload.get('traceback', '')}")
    if phase == "import":
        return SandboxRun(import_error=payload.get("error") or "import failed",
                          import_traceback=payload.get("traceback") or "")
    return SandboxRun(results=payload.get("results") or [])


def check_imports(code: str) -> Optional[str]:
    """Load ``code`` in the sandbox without calling it. None when it loads."""
    run = run_in_sandbox(code, [], SandboxOptions(block_network=False, http_stub=True))
    if run.harness_error:
        return f"sandbox failure: {run.harness_error}"
    if run.timed_out:
        return "module import timed out"
    if run.import_error:
        return f"{run.import_error}\n{run.import_traceback}".strip()
    return None
