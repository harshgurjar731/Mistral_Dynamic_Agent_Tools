"""
Tool Service — FastAPI Application Entry Point.
Handles the complete tool lifecycle: synthesis, execution, and management.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

    yield
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


@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy", "service": "tool-service"}
