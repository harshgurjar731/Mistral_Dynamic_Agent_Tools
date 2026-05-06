"""
Mistral Workflows Worker — auto-start with hot-reload.

Loads all workflow Python files from the mistral_workflows/ directory,
runs a Mistral worker that connects to the Temporal scheduler, and
automatically reloads when new workflow files are added or changed.
"""

import os
import sys
import glob
import asyncio
import importlib
import importlib.util
import logging
from pathlib import Path
from typing import List, Any

# Ensure backend is in path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

logger = logging.getLogger(__name__)

# ── Worker state ──────────────────────────────────────────────────────────────
_worker_task: asyncio.Task | None = None
_worker_stop_event: asyncio.Event | None = None


def _discover_workflow_classes(workflows_dir: str) -> list:
    """
    Dynamically load all *.py files from workflows_dir and return
    all classes decorated with @workflows.workflow.define.
    """
    discovered: list = []
    abs_dir = os.path.abspath(workflows_dir)

    if not os.path.exists(abs_dir):
        logger.warning("Workflows directory '%s' does not exist.", abs_dir)
        return discovered

    # Ensure the dir is on sys.path so Temporal sandbox can re-import them
    if abs_dir not in sys.path:
        sys.path.insert(0, abs_dir)

    for py_file in sorted(glob.glob(os.path.join(abs_dir, "workflow_*.py"))):
        module_name = Path(py_file).stem
        try:
            # Force re-import if already loaded (hot-reload)
            if module_name in sys.modules:
                module = importlib.reload(sys.modules[module_name])
            else:
                spec = importlib.util.spec_from_file_location(module_name, py_file)
                if not spec or not spec.loader:
                    continue
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)  # type: ignore[union-attr]

            for attr_name in dir(module):
                if attr_name.startswith("_"):
                    continue
                obj = getattr(module, attr_name)
                if not isinstance(obj, type):
                    continue
                # Temporal/Mistral workflow classes have __temporal_workflow_definition
                if hasattr(obj, "__temporal_workflow_definition") or hasattr(obj, "__mistral_workflow_definition"):
                    if obj not in discovered:
                        discovered.append(obj)
                        logger.info("Discovered workflow class: %s from %s", attr_name, py_file)

        except Exception as e:
            logger.error("Failed to load workflow from '%s': %s", py_file, e)

    return discovered


async def start_mistral_worker(workflows_dir: str) -> None:
    """
    Run the Mistral worker once. This is awaited in a task, so it blocks
    until the worker stops or is cancelled.
    """
    try:
        from mistralai.workflows import run_worker  # type: ignore
    except ImportError:
        logger.info(
            "mistralai-workflows package not available in this environment. "
            "Durable Temporal worker is disabled — workflows will execute via the local DAG engine. "
            "To enable: pip install mistralai-workflows (resolve any platform dependency conflicts first)."
        )
        return

    # Set DEPLOYMENT_NAME in the environment (in case it wasn't already)
    from app.config import settings  # imported here to avoid circular import at module level
    if not os.environ.get("DEPLOYMENT_NAME"):
        os.environ["DEPLOYMENT_NAME"] = settings.DEPLOYMENT_NAME

    workflow_classes = _discover_workflow_classes(workflows_dir)
    if not workflow_classes:
        logger.warning(
            "No workflow classes found in '%s'. "
            "Worker will idle — it will reload when files are added.",
            workflows_dir,
        )
        # Still run the worker with an empty list so the Temporal connection is
        # established; new classes will appear on next hot-reload cycle.
        workflow_classes = []

    logger.info(
        "Starting Mistral Workflows worker (DEPLOYMENT_NAME=%s) with %d workflow(s)…",
        os.environ.get("DEPLOYMENT_NAME", settings.DEPLOYMENT_NAME),
        len(workflow_classes),
    )
    try:
        await run_worker(workflow_classes)
    except asyncio.CancelledError:
        logger.info("Mistral worker task cancelled — shutting down cleanly.")
    except Exception as e:
        logger.error("Mistral worker crashed: %s", e)


async def start_worker_with_hot_reload(workflows_dir: str) -> None:
    """
    Outer loop: watches the workflows_dir for file changes and restarts
    the worker whenever a *.py file is added, modified, or removed.
    Falls back gracefully if watchfiles is not installed.
    """
    from app.config import settings

    abs_dir = os.path.abspath(workflows_dir)
    os.makedirs(abs_dir, exist_ok=True)

    # ── Check once whether the Temporal worker package is available ───────
    # If not, log ONCE and return — never start the file watcher, so
    # file writes (compiled workflow .py files) don't trigger repeated spam.
    try:
        from mistralai.workflows import run_worker as _rw  # type: ignore  # noqa: F401
    except ImportError:
        logger.info(
            "mistralai-workflows not available — Temporal worker disabled. "
            "Workflows will run via the local DAG engine. "
            "File watcher will NOT start (no log spam on workflow compilation)."
        )
        return

    # ── Package is available — start watcher + worker ─────────────────────
    try:
        from watchfiles import awatch  # type: ignore

        logger.info("Hot-reload enabled — watching '%s' for workflow file changes.", abs_dir)

        current_worker: asyncio.Task | None = None

        async def _restart_worker():
            nonlocal current_worker
            if current_worker and not current_worker.done():
                current_worker.cancel()
                try:
                    await current_worker
                except (asyncio.CancelledError, Exception):
                    pass
            current_worker = asyncio.create_task(start_mistral_worker(abs_dir))

        # Initial start
        await _restart_worker()

        async for changes in awatch(abs_dir, stop_event=asyncio.Event()):
            py_changes = [c for _, path in changes for c in [path] if path.endswith(".py")]
            if py_changes:
                logger.info("Detected workflow file changes: %s — reloading worker.", py_changes)
                await _restart_worker()

    except ImportError:
        # watchfiles not available — run once without hot-reload
        logger.info("watchfiles not installed. Running worker without hot-reload.")
        await start_mistral_worker(abs_dir)
    except asyncio.CancelledError:
        logger.info("Hot-reload loop cancelled — worker shutdown complete.")



# ── Public API used by main.py lifespan ───────────────────────────────────────

async def launch_worker_background(workflows_dir: str) -> asyncio.Task:
    """
    Create and return a background asyncio.Task running the worker with hot-reload.
    Call task.cancel() to stop it gracefully on app shutdown.
    """
    task = asyncio.create_task(
        start_worker_with_hot_reload(workflows_dir),
        name="mistral-workflows-worker",
    )
    logger.info("Mistral Workflows worker background task launched.")
    return task


# ── Standalone CLI entrypoint ──────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run the Mistral Workflows worker.")
    parser.add_argument(
        "--dir",
        type=str,
        default="../mistral_workflows",
        help="Directory containing compiled Mistral workflow Python files",
    )
    parser.add_argument("--hot-reload", action="store_true", help="Enable file-watcher hot-reload")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if args.hot_reload:
        asyncio.run(start_worker_with_hot_reload(args.dir))
    else:
        asyncio.run(start_mistral_worker(args.dir))
