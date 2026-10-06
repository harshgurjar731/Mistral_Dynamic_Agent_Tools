"""
_worker_inner.py — Inner worker process.

Spawned as a FRESH SUBPROCESS by mistral_worker.py (the supervisor) on every
hot-reload. Because this is a new process, the Mistral/Temporal SDK global
activity registry starts completely empty — no duplicates are possible.

═══════════════════════════════════════════════════════════════════════════════
ROOT CAUSE — why executions stayed RUNNING forever
═══════════════════════════════════════════════════════════════════════════════

The worker log showed:
    task_queue=default   ← worker polls this queue  ✓
    'temporal': {'task_queue': 'default'} ← SDK config says 'default' ✗

These two values must be the same. When they differ, the Mistral server
dispatches execution tasks to 'default' (because that's the
workflow's registered deployment name), but the underlying Temporal worker
polls 'default' — so the tasks are never picked up and every execution hangs
in RUNNING indefinitely.

WHY the mismatch happened
─────────────────────────
The SDK config is a nested Pydantic/dynaconf object with this layout:

    config
    ├── common.*
    ├── worker.*
    │   ├── deployment_name   = "default"  (set correctly)
    │   └── versioning.*
    └── temporal.*
        └── task_queue        = "default"  ← NOT populated by deployment_name

Setting MISTRAL_WORKER_TASK_QUEUE only writes to worker.task_queue (which the
SDK ignores for Temporal routing). The correct env var for temporal.task_queue
uses the __ double-underscore nesting convention:

    MISTRAL_WORKER__TEMPORAL__TASK_QUEUE = "default"

This must be set BEFORE the first `import mistralai.workflows` because the SDK
config singleton is frozen at import time.

═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys

# ── ALL deployment env vars MUST be set before any mistralai import ───────────
# The Mistral SDK config is a frozen singleton — mutating it after import has
# no effect. Every env var below must land before the first SDK import.

_deployment = os.environ.get("DEPLOYMENT_NAME", "default")

# 1. Worker identification / versioning
os.environ["MISTRAL_WORKER_DEPLOYMENT_NAME"] = _deployment

# 2. Temporal task queue — must match the deployment name so the worker
#    polls the same queue the Mistral server dispatches tasks to.
#    The SDK uses __ double-underscore nesting for nested config fields.
os.environ["MISTRAL_WORKER__TEMPORAL__TASK_QUEUE"] = _deployment

# 3. Disable remote config discovery.
#    config_discovery contacts wf-scheduler.mistral.ai and OVERWRITES
#    our task_queue setting with the server's default ("default").
#    Disabling it keeps our env-var config intact.
os.environ.setdefault("MISTRAL_WORKER__WORKER__ENABLE_CONFIG_DISCOVERY", "false")

# 4. Legacy flat vars (belt-and-suspenders)
os.environ["MISTRAL_WORKER_TASK_QUEUE"] = _deployment

import glob
import asyncio
import logging
import importlib
import importlib.util
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Path setup ────────────────────────────────────────────────────────────────
_this_file = os.path.realpath(__file__)
backend_dir = os.path.abspath(os.path.join(os.path.dirname(_this_file), "../../"))

if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    _dotenv_path = os.path.join(backend_dir, ".env")
    if os.path.exists(_dotenv_path):
        load_dotenv(_dotenv_path, override=False)  # env vars set above win
    else:
        log.warning(".env not found at %s — relying on inherited env vars.", _dotenv_path)
except ImportError:
    pass

# ── NOW import the SDK (frozen singleton builds here from env vars above) ─────
import mistralai.workflows as workflows


# ── Activity detection ────────────────────────────────────────────────────────

def _is_activity_fn(obj) -> bool:
    """
    Return True if obj is decorated with @workflows.activity().
    Uses temporalio's own registry lookup as the primary check (version-proof),
    falls back to attribute sniffing for older SDK builds.
    """
    if not callable(obj) or isinstance(obj, type):
        return False
    try:
        import temporalio.activity as _ta
        _ta._Definition.must_from_callable(obj)  # raises if not an activity
        return True
    except Exception:
        pass
    _markers = (
        "__temporal_activity_definition",
        "__mistral_activity_definition",
        "__activity_definition",
        "_is_activity",
    )
    return any(hasattr(obj, m) for m in _markers)


# ── Discovery ─────────────────────────────────────────────────────────────────

def discover_workflows_and_activities(workflows_dir: str):
    """
    Import every workflow_*.py and return (workflow_classes, activity_fns).
    """
    abs_dir = os.path.abspath(workflows_dir)
    if not os.path.exists(abs_dir):
        log.warning("Workflows directory '%s' does not exist.", abs_dir)
        return [], []

    if abs_dir not in sys.path:
        sys.path.insert(0, abs_dir)

    loaded_modules = []
    for py_file in sorted(glob.glob(os.path.join(abs_dir, "workflow_*.py"))):
        module_name = Path(py_file).stem
        try:
            spec = importlib.util.spec_from_file_location(module_name, py_file)
            if not spec or not spec.loader:
                log.warning("Could not create spec for %s — skipping.", py_file)
                continue
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            loaded_modules.append((module_name, module))
            log.info("Loaded module: %s", module_name)
        except Exception as e:
            log.error("Failed to load %s: %s", py_file, e, exc_info=True)

    workflow_classes: list = []
    activity_fns: list = []
    seen_classes: set = set()
    seen_fns: set = set()

    for module_name, module in loaded_modules:
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            try:
                obj = getattr(module, attr_name)
            except Exception:
                continue

            if isinstance(obj, type):
                if (
                    hasattr(obj, "__temporal_workflow_definition")
                    or hasattr(obj, "__mistral_workflow_definition")
                ):
                    if obj.__name__ not in seen_classes:
                        workflow_classes.append(obj)
                        seen_classes.add(obj.__name__)
                        log.info("  Workflow class : %s", obj.__name__)
                continue

            if callable(obj) and _is_activity_fn(obj):
                fn_name = getattr(obj, "__name__", attr_name)
                if fn_name not in seen_fns:
                    activity_fns.append(obj)
                    seen_fns.add(fn_name)
                    log.info("  Activity fn    : %s", fn_name)

    return workflow_classes, activity_fns


# ── Worker entrypoint ─────────────────────────────────────────────────────────

async def run() -> None:
    workflows_dir = os.environ.get("WORKFLOWS_DIR", "").strip()
    deployment = os.environ.get("DEPLOYMENT_NAME", "default")

    if not workflows_dir:
        log.error(
            "WORKFLOWS_DIR is not set. "
            "This script must be started by mistral_worker.py, not directly."
        )
        sys.exit(1)

    log.info("=" * 60)
    log.info("Inner worker starting")
    log.info("  deployment      : %s", deployment)
    log.info("  temporal queue  : %s", os.environ.get("MISTRAL_WORKER__TEMPORAL__TASK_QUEUE"))
    log.info("  workflows dir   : %s", workflows_dir)
    log.info("=" * 60)

    # Step spans, rule verdicts, tool calls and model calls made by this
    # worker's activities go to Mistral alongside the API's, grouped into the
    # execution's trace. Before the client, so the client is created traced.
    from app import observability
    observability.setup("worker")

    try:
        from app.dependencies import init_mistral_client
        init_mistral_client()
        log.info("Mistral client initialized for inner worker.")
    except Exception as e:
        log.error("Failed to initialize Mistral client: %s", e)
        sys.exit(1)

    workflow_classes, activity_fns = discover_workflows_and_activities(workflows_dir)

    log.info(
        "Discovery complete — %d workflow(s), %d activity fn(s)",
        len(workflow_classes), len(activity_fns),
    )

    if not activity_fns:
        log.warning(
            "No activity functions found — executions will stall. "
            "Check that workflow_*.py files contain @workflows.activity() functions."
        )

    # The Mistral SDK's run_worker() auto-registers all activities that were
    # decorated with @workflows.activity() at import time (they're in the SDK's
    # global registry). We don't need to pass them explicitly; what matters is
    # that the task_queue env var above is set correctly before this call.
    try:
        await workflows.run_worker(workflow_classes)
    except asyncio.CancelledError:
        log.info("Inner worker cancelled — exiting cleanly.")
    except Exception as e:
        log.error("Inner worker crashed: %s", e, exc_info=True)
        observability.shutdown()
        sys.exit(1)
    observability.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("Inner worker stopped.")