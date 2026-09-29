"""
Tool Service — FastAPI Application Entry Point.
Handles the complete tool lifecycle: synthesis, execution, and management.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db, SessionLocal
from app.routes import synthesis, execution, management

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("🚀 Starting Tool Service …")
    init_db()
    logger.info("✅ Database initialized")

    # Ensure documents directory exists for generated files
    os.makedirs("/app/documents", exist_ok=True)
    logger.info("✅ Documents directory ready")

    # Warm execution cache with approved tools
    from app.services.execution_service import warm_cache
    from app.seed_native_tools import seed_native_tools
    db = SessionLocal()
    try:
        seed_native_tools(db)
        warm_cache(db)
    finally:
        db.close()
    logger.info("✅ Execution cache warmed")

    from app.synthesis.jobs import get_manager
    interrupted = get_manager().recover()
    if interrupted:
        logger.warning("Marked %d synthesis job(s) from the previous run as interrupted", interrupted)

    yield
    get_manager().shutdown()
    logger.info("🛑 Shutting down Tool Service …")


app = FastAPI(
    title="Mistral Dynamic Agent — Tool Service",
    description="Isolated microservice for dynamic tool lifecycle: synthesis, execution, and management.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ──────────────────────────────────────────────────────────────────

app.include_router(synthesis.router)
app.include_router(execution.router)
app.include_router(management.router)

# MCP routes (Phase 4)
try:
    from app.routes import mcp
    app.include_router(mcp.router)
    logger.info("MCP routes loaded")
except ImportError:
    pass

# ── Static file serving (document downloads) ────────────────────────────────
os.makedirs("/app/documents", exist_ok=True)
app.mount("/documents", StaticFiles(directory="/app/documents"), name="documents")


@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy", "service": "tool-service"}


@app.get("/metrics", tags=["Health"])
async def metrics_endpoint():
    """Synthesis and model-route counters: first-pass rate, faults, latency, tokens."""
    from app import metrics

    return metrics.snapshot()


@app.get("/models", tags=["Health"])
async def model_routes():
    """Which model does which job, after environment overrides."""
    from dataclasses import asdict

    from app.llm.routes import all_routes

    return {role: asdict(route) for role, route in all_routes().items()}
