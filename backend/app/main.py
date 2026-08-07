"""
Mistral Dynamic Agent Backend — FastAPI Application Entry Point.
"""

import asyncio
import logging
from contextlib import asynccontextmanager


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.dependencies import init_mistral_client
from app.exceptions import (
    MistralAPIError, AgentNotFoundError, ConversationNotFoundError,
    ToolServiceError, WorkflowError,
    mistral_api_error_handler, agent_not_found_handler,
    conversation_not_found_handler, tool_service_error_handler,
    workflow_error_handler, generic_error_handler,
)
from app.routes import agents, conversations, chat, orchestrator, tools, uploads, libraries, remote_servers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# Show WARNING+ from worker SDK (catches registration failures).
# Suppress verbose config/temporal tracebacks that are self-recovering.
logging.getLogger("mistralai.workflows.core.worker").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.config").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.config.config_discovery").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.temporal").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.temporal.temporal_client").setLevel(logging.WARNING)
# Suppress stale Temporal workflow activation replay errors (not actionable)
logging.getLogger("temporalio.worker._workflow").setLevel(logging.CRITICAL)



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle.

    Starts the Mistral Workflows worker supervisor as a background subprocess
    so you only need ``uvicorn app.main:app --reload`` to run everything.
    """
    import os
    import sys
    import subprocess

    logger.info("🚀 Starting Mistral Dynamic Agent Backend …")
    init_mistral_client()
    logger.info("✅ Mistral client initialized")

    # Create ORM tables (remote_servers, etc.)
    from app.database import create_tables
    import app.remote_server_model  # noqa: F401 — register model with Base
    create_tables()

    # Refresh dynamic tools from Docker Tool Service
    from app.services.tool_registry import refresh_dynamic_tools
    try:
        await refresh_dynamic_tools()
        logger.info("✅ Dynamic tools refreshed from Tool Service")
    except Exception as e:
        logger.warning("⚠️ Could not refresh dynamic tools: %s (Tool Service may not be running)", e)

    # ── Start Mistral Workflows worker as a managed subprocess ──────────
    worker_proc = None
    if settings.MISTRAL_WORKER_ENABLED:
        try:
            backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            worker_script = os.path.join(backend_dir, "app", "services", "mistral_worker.py")

            # Note: We use subprocess.Popen instead of asyncio.create_subprocess_exec
            # because uvicorn sets the event loop to SelectorEventLoop on Windows,
            # which raises NotImplementedError for async subprocesses.
            worker_proc = subprocess.Popen(
                [sys.executable, worker_script],
                cwd=backend_dir,
                env={**os.environ},
                stdout=None,
                stderr=None,
            )
            logger.info("✅ Mistral worker supervisor started (pid=%d)", worker_proc.pid)
        except Exception as e:
            logger.error("⚠️ Could not start Mistral worker:", exc_info=True)
            worker_proc = None
    else:
        logger.info("ℹ️ Mistral worker disabled (MISTRAL_WORKER_ENABLED=false)")

    yield

    # ── Shutdown: stop the worker subprocess ────────────────────────────
    if worker_proc and worker_proc.poll() is None:
        logger.info("🛑 Stopping Mistral worker supervisor (pid=%d)…", worker_proc.pid)
        try:
            worker_proc.terminate()
            try:
                # wait() on Windows Popen takes timeout in seconds and raises TimeoutExpired
                worker_proc.wait(timeout=8.0)
            except subprocess.TimeoutExpired:
                logger.warning("Worker did not exit in 8s — killing forcefully.")
                worker_proc.kill()
                worker_proc.wait()
            logger.info("✅ Worker stopped.")
        except Exception as e:
            logger.warning("Error stopping worker: %s", e)

    logger.info("🛑 Shutting down …")



app = FastAPI(
    title="Mistral Dynamic Agent API",
    description="Backend service for creating and managing Mistral AI agents, conversations, and chat completions.",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Exception Handlers ─────────────────────────────────────────────────────

app.add_exception_handler(MistralAPIError, mistral_api_error_handler)
app.add_exception_handler(AgentNotFoundError, agent_not_found_handler)
app.add_exception_handler(ConversationNotFoundError, conversation_not_found_handler)
app.add_exception_handler(ToolServiceError, tool_service_error_handler)
app.add_exception_handler(WorkflowError, workflow_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

# ── Routes ──────────────────────────────────────────────────────────────────

app.include_router(agents.router, prefix=settings.API_PREFIX)
app.include_router(conversations.router, prefix=settings.API_PREFIX)
app.include_router(chat.router, prefix=settings.API_PREFIX)
app.include_router(orchestrator.router, prefix=settings.API_PREFIX)
app.include_router(tools.router, prefix=settings.API_PREFIX)
app.include_router(uploads.router, prefix=settings.API_PREFIX)
app.include_router(libraries.router, prefix=settings.API_PREFIX)
app.include_router(remote_servers.router, prefix=settings.API_PREFIX)

# ── Static file serving for uploads ─────────────────────────────────────────
import os
_uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# Workflow routes (Phase 3)
try:
    from app.routes import workflows
    app.include_router(workflows.router, prefix=settings.API_PREFIX)
    logger.info("Workflow routes loaded")
except ImportError:
    pass


@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint."""
    from app.services.tool_resolver import tool_resolver
    tool_service_ok = await tool_resolver.health_check()
    return {
        "status": "healthy",
        "service": "mistral-dynamic-agent",
        "version": "2.0.0",
        "docker_tool_service": "reachable" if tool_service_ok else "unreachable",
    }

