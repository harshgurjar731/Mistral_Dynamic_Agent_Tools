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
        - Runs one child per platform workspace that has published workflows,
          each on that workspace's Mistral key and its own task queue
          (app.auth.workers). A process can only hold one key: the SDK reads
          the key and queue from process-wide env vars.
        - Re-checks the workspaces every RECONCILE_SECONDS: starts, stops or
          restarts children as workspaces are added, disabled, re-keyed or
          publish their first workflow.
        - Watches the workflows dir for .py changes via watchfiles and
          restarts only the children whose workflows changed.
        - Restarts a crashed child with backoff, and writes every child's
          state to <workflows dir>/.worker_status.json for the admin console.

    _worker_inner.py   (the CHILD — one fresh process per reload)
        - Loads only its workspace's workflow_*.py files
        - Calls workflows.run_worker() once and runs until terminated
        - Exits cleanly on SIGTERM (or Windows terminate())
"""

import os
import sys
import json
import time
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


RECONCILE_SECONDS = 30.0
_BACKOFF = (5.0, 15.0, 30.0, 60.0, 120.0, 300.0)


async def _spawn_worker(workflows_dir: str, spec, key: str) -> asyncio.subprocess.Process:
    """
    Spawn _worker_inner.py for one workspace.
    Fresh process = clean SDK global activity registry = no duplicates.
    """
    env = {
        **os.environ,
        "WORKFLOWS_DIR": workflows_dir,
        "DEPLOYMENT_NAME": spec.deployment,
        "MISTRAL_API_KEY": key,
        "APP_WORKSPACE_ID": spec.workspace_id,
        "WORKER_WORKFLOW_FILES": json.dumps(list(spec.files)),
    }
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(_WORKER_INNER),
        env=env,
        stdout=None,   # inherit — logs appear in the same terminal
        stderr=None,
    )
    log.info("Worker for workspace %r started (pid=%d, queue=%s, %d workflow file(s)).",
             spec.workspace_name, proc.pid, spec.deployment, len(spec.files))
    return proc


def _desired(workflows_dir: str):
    """What should run now, and each workspace's key."""
    from app.auth import store, workers

    workspaces = store.list_workspaces()
    keys = {ws["id"]: store.workspace_key(ws["id"]) for ws in workspaces
            if not ws["disabled"]}
    files = workers.files_by_workspace(workflows_dir)
    return workers.desired_workers(workspaces, keys, files), keys


class _Child:
    def __init__(self, spec, proc):
        self.spec = spec
        self.proc = proc
        self.started = time.time()


# ── Supervisor main loop ──────────────────────────────────────────────────────
async def main() -> None:
    from app.auth import workers

    workflows_dir = os.path.abspath(
        os.environ.get(
            "WORKFLOWS_DIR",
            os.path.join(backend_dir, "../mistral_workflows"),
        )
    )
    os.makedirs(workflows_dir, exist_ok=True)
    # Write the resolved path back so every child inherits the absolute value.
    os.environ["WORKFLOWS_DIR"] = workflows_dir
    log.info("Starting Mistral worker supervisor — base queue: '%s'", workers.base_deployment())
    log.info("Watching workflows directory: %s", workflows_dir)

    # The workspaces live in the backend's database.
    from app.db_setup import prepare_database

    prepare_database(seed_rules=False)

    stop_event = asyncio.Event()
    wake = asyncio.Event()
    _register_shutdown(stop_event)

    children: dict[str, _Child] = {}
    statuses: dict[str, workers.WorkerStatus] = {}
    failures: dict[str, int] = {}
    retry_at: dict[str, float] = {}
    to_restart: set[str] = set()

    async def stop(ws_id: str, reason: str) -> None:
        child = children.pop(ws_id, None)
        if child is not None:
            log.info("Stopping worker for %r (%s).", child.spec.workspace_name, reason)
            await _kill_process(child.proc)

    async def reconcile() -> None:
        try:
            desired, keys = await asyncio.to_thread(_desired, workflows_dir)
        except Exception as e:  # noqa: BLE001 — keep what runs; try again later
            log.error("Could not read workspaces: %s", e)
            return
        # Gone, disabled, re-keyed or with different workflows: stop.
        for ws_id in list(children):
            spec = desired.get(ws_id)
            if spec is None:
                await stop(ws_id, "no longer needed")
            elif not spec.same_process(children[ws_id].spec) or ws_id in to_restart:
                await stop(ws_id, "workflows or key changed")
        to_restart.clear()
        # Crashed children.
        now = time.time()
        for ws_id, child in list(children.items()):
            if child.proc.returncode is not None:
                code = child.proc.returncode
                children.pop(ws_id)
                n = failures[ws_id] = failures.get(ws_id, 0) + 1
                # A worker that ran a good while before dying starts the count over.
                if now - child.started > 600:
                    failures[ws_id] = n = 1
                delay = _BACKOFF[min(n - 1, len(_BACKOFF) - 1)]
                retry_at[ws_id] = now + delay
                st = statuses.setdefault(ws_id, workers.WorkerStatus(ws_id))
                st.state, st.pid, st.last_exit_code = "crashed", None, code
                st.last_error = f"Exited with code {code}; retrying in {int(delay)}s."
                log.warning("Worker for %r exited (%s); retrying in %ds.",
                            child.spec.workspace_name, code, delay)
        # Start what should run and isn't.
        for ws_id, spec in desired.items():
            if ws_id in children or retry_at.get(ws_id, 0) > now:
                continue
            st = statuses.setdefault(ws_id, workers.WorkerStatus(ws_id))
            try:
                proc = await _spawn_worker(workflows_dir, spec, keys.get(ws_id) or "")
            except Exception as e:  # noqa: BLE001
                st.state, st.last_error = "crashed", f"Could not start: {e}"
                retry_at[ws_id] = now + _BACKOFF[-1]
                continue
            children[ws_id] = _Child(spec, proc)
            if st.started_at:
                st.restarts += 1
            st.state, st.pid, st.started_at = "running", proc.pid, time.time()
            st.last_error = None
        # Report.
        for ws_id in list(statuses):
            st = statuses[ws_id]
            spec = desired.get(ws_id) or (children[ws_id].spec if ws_id in children else None)
            if spec is not None:
                st.workspace_name, st.deployment, st.workflows = (
                    spec.workspace_name, spec.deployment, len(spec.files))
            if ws_id not in desired and ws_id not in children:
                st.state, st.pid = "stopped", None
                failures.pop(ws_id, None)
                retry_at.pop(ws_id, None)
        workers.write_status(statuses, directory=workflows_dir)

    async def periodic() -> None:
        while not stop_event.is_set():
            await reconcile()
            wake.clear()
            try:
                await asyncio.wait_for(wake.wait(), timeout=RECONCILE_SECONDS)
            except asyncio.TimeoutError:
                pass

    async def watch() -> None:
        try:
            from watchfiles import awatch
        except ImportError:
            log.warning("watchfiles not installed — running without hot-reload. "
                        "Install it with: pip install watchfiles")
            return
        log.info("Hot-reload enabled — watching '%s' for .py changes.", workflows_dir)
        async for changes in awatch(workflows_dir, stop_event=stop_event):
            names = {os.path.basename(path) for _, path in changes if path.endswith(".py")}
            if not names:
                continue
            log.info("Detected changes: %s", sorted(names))
            for ws_id, child in children.items():
                if names & set(child.spec.files):
                    to_restart.add(ws_id)
            wake.set()

    tasks = [asyncio.create_task(periodic()), asyncio.create_task(watch())]
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        for t in tasks:
            t.cancel()
        for ws_id in list(children):
            await stop(ws_id, "supervisor shutting down")
        for st in statuses.values():
            st.state, st.pid = "stopped", None
        workers.write_status(statuses, directory=workflows_dir)
        log.info("Supervisor shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Worker stopped by user.")