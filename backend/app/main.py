"""
Mistral Dynamic Agent Backend — FastAPI Application Entry Point.
"""

import asyncio
import logging
from contextlib import asynccontextmanager


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.dependencies import init_mistral_client
from app.exceptions import (
    MistralAPIError, AgentNotFoundError, ConversationNotFoundError,
    ToolServiceError, WorkflowError,
    mistral_api_error_handler, agent_not_found_handler,
    conversation_not_found_handler, tool_service_error_handler,
    workflow_error_handler, generic_error_handler,
)
from app.routes import agents, conversations, chat, orchestrator, tools

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("🚀 Starting Mistral Dynamic Agent Backend …")
    init_mistral_client()
    logger.info("✅ Mistral client initialized")

    # Refresh dynamic tools from Docker Tool Service
    from app.services.tool_registry import refresh_dynamic_tools
    try:
        await refresh_dynamic_tools()
        logger.info("✅ Dynamic tools refreshed from Tool Service")
    except Exception as e:
        logger.warning("⚠️ Could not refresh dynamic tools: %s (Tool Service may not be running)", e)

    # Auto-start Mistral Workflows worker with hot-reload
    _worker_task = None
    if settings.MISTRAL_WORKER_ENABLED:
        try:
            from app.services.mistral_worker import launch_worker_background
            import os
            workflows_dir = os.path.abspath(
                os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
            )
            _worker_task = await launch_worker_background(workflows_dir)
            logger.info("✅ Mistral Workflows worker started (DEPLOYMENT_NAME=%s, dir=%s)", settings.DEPLOYMENT_NAME, workflows_dir)
        except Exception as e:
            logger.warning("⚠️ Mistral Workflows worker failed to start: %s (workflows will use local DAG engine)", e)
    else:
        logger.info("ℹ️ Mistral Workflows worker disabled (MISTRAL_WORKER_ENABLED=false)")

    yield

    # Graceful shutdown
    if _worker_task and not _worker_task.done():
        logger.info("🛑 Stopping Mistral Workflows worker …")
        _worker_task.cancel()
        try:
            await asyncio.wait_for(_worker_task, timeout=5.0)
        except Exception:
            pass

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

