"""
Mistral Workflows Worker — Subprocess Restart Edition.

ROOT CAUSE OF THE CRASH:
    The @workflows.activity() decorator registers activity functions into a
    GLOBAL registry inside the Mistral/Temporal SDK at decoration time (the
    moment the module is imported). This global lives inside the SDK's internals
    and cannot be cleared from Python userland code.

    When a file changes and we reload the module in the SAME process:
      1. _unload_module() purges our module from sys.modules  ✓
      2. Re-importing re-executes all @workflows.activity() decorators
      3. Each decorator calls into the SDK global registry AGAIN
      4. Registry now has run_collect_inputs registered TWICE
      5. Temporal raises: ValueError: More than one activity named run_collect_inputs

    No amount of sys.modules manipulation or importlib tricks can fix this —
    the duplicate lives inside the SDK, not in Python's module cache.

CORRECT FIX:
    On file change, restart the ENTIRE Python subprocess. A fresh process has
    a completely clean SDK global registry. This is exactly how production
    hot-reload tools (uvicorn --reload, watchgod, nodemon) work — they restart
    the process, not reload the module.

ARCHITECTURE:
    mistral_worker.py  (THIS FILE — the SUPERVISOR)
        - Watches the workflows dir for .py changes via watchfiles
        - On change: terminates the child subprocess, spawns a new one

    _worker_inner.py   (the CHILD — one fresh process per reload)
        - Discovers and loads all workflow_*.py files
        - Calls workflows.run_worker() once and runs until terminated
        - Exits cleanly on SIGTERM (or Windows terminate())
"""

import os
import sys
import signal
import asyncio
import logging
from pathlib import Path
from dotenv import load_dotenv

# ── Path setup ────────────────────────────────────────────────────────────────
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

load_dotenv(os.path.join(backend_dir, ".env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# Inner worker script path — lives alongside this file
_WORKER_INNER = Path(__file__).parent / "_worker_inner.py"


# ── Windows-compatible shutdown ───────────────────────────────────────────────
def _register_shutdown(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_event_loop()
    if sys.platform == "win32":
        def _handler(signum, frame):
            log.info("Received signal %s — shutting down...", signum)
            loop.call_soon_threadsafe(stop_event.set)
        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)
    else:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop_event.set)


# ── Subprocess helpers ────────────────────────────────────────────────────────
async def _kill_process(proc: asyncio.subprocess.Process) -> None:
    """Gracefully terminate child, force-kill if it doesn't exit within 8s."""
    if proc.returncode is not None:
        return  # already dead
    try:
        if sys.platform == "win32":
            proc.terminate()
        else:
            proc.send_signal(signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), timeout=8.0)
            log.info("Worker subprocess exited (pid=%d).", proc.pid)
        except asyncio.TimeoutError:
            log.warning("Worker did not exit within 8s — killing forcefully.")
            proc.kill()
            await proc.wait()
    except ProcessLookupError:
        pass  # process already gone


async def _spawn_worker(
    workflows_dir: str,
    deployment: str,
) -> asyncio.subprocess.Process:
    """
    Spawn _worker_inner.py as a fresh subprocess.
    Fresh process = clean SDK global activity registry = no duplicates.
    """
    env = {
        **os.environ,
        "WORKFLOWS_DIR": workflows_dir,
        "DEPLOYMENT_NAME": deployment,
    }
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(_WORKER_INNER),
        env=env,
        stdout=None,   # inherit — logs appear in the same terminal
        stderr=None,
    )
    log.info("Worker subprocess started (pid=%d).", proc.pid)
    return proc


# ── Supervisor main loop ──────────────────────────────────────────────────────
async def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY")
    if not api_key:
        raise EnvironmentError("MISTRAL_API_KEY environment variable is not set.")

    deployment = os.environ.get("DEPLOYMENT_NAME", "default")
    os.environ["DEPLOYMENT_NAME"] = deployment
    log.info("Starting Mistral worker supervisor — deployment: '%s'", deployment)

    workflows_dir = os.path.abspath(
        os.environ.get(
            "WORKFLOWS_DIR",
            os.path.join(backend_dir, "../mistral_workflows"),
        )
    )
    os.makedirs(workflows_dir, exist_ok=True)
    # FIX: write resolved path back to os.environ so the subprocess
    # inherits the correct absolute value via {**os.environ} in _spawn_worker.
    os.environ["WORKFLOWS_DIR"] = workflows_dir
    log.info("Watching workflows directory: %s", workflows_dir)

    stop_event = asyncio.Event()
    _register_shutdown(stop_event)

    current_proc: asyncio.subprocess.Process | None = None

    async def restart_worker() -> None:
        nonlocal current_proc
        if current_proc is not None:
            log.info("Stopping old worker (pid=%d)...", current_proc.pid)
            await _kill_process(current_proc)
        current_proc = await _spawn_worker(workflows_dir, deployment)

    try:
        from watchfiles import awatch

        log.info("Hot-reload enabled — watching '%s' for .py changes.", workflows_dir)
        await restart_worker()

        async for changes in awatch(workflows_dir, stop_event=stop_event):
            py_changes = [path for _, path in changes if path.endswith(".py")]
            if py_changes:
                log.info(
                    "Detected changes: %s — restarting worker subprocess.", py_changes
                )
                await restart_worker()

        # stop_event was set — clean up
        if current_proc is not None:
            await _kill_process(current_proc)
        log.info("Supervisor shutdown complete.")

    except ImportError:
        log.warning(
            "watchfiles not installed — running without hot-reload. "
            "Install it with: pip install watchfiles"
        )
        await restart_worker()
        if current_proc:
            await current_proc.wait()

    except asyncio.CancelledError:
        if current_proc is not None:
            await _kill_process(current_proc)
        log.info("Supervisor cancelled.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Worker stopped by user.")