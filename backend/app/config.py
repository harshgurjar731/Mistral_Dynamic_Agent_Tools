"""
Application settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    """Application configuration loaded from .env file."""

    # Mistral AI
    MISTRAL_API_KEY: str = ""
    MISTRAL_ORCHESTRATOR_MODEL: str = "mistral-large-latest"
    # Retired: code-related decisions now use model routes (app/llm_routes.py,
    # override with ROUTE_<ROLE>_MODEL). Kept so an existing .env still loads.
    MISTRAL_CODING_MODEL: str = "codestral-latest"

    # Dynamic Tools
    AUTO_APPROVE_DYNAMIC_TOOLS: bool = True

    # Docker Tool Service
    TOOL_SERVICE_URL: str = "http://localhost:9000"
    # How long a call waits for the Tool Service to come back when its
    # connection is refused — a container restart takes 15-30s, and a workflow
    # step that fails on the first refusal fails the whole run.
    TOOL_SERVICE_WAIT_SECONDS: float = 90.0

    # Database
    DATABASE_URL: str = f"sqlite:///{os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sql_app.db')}"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # API
    API_PREFIX: str = "/api"

    # Workflow engine (future)
    # ── Decision-call pacing ────────────────────────────────────────────
    # The orchestrators ask many small questions instead of one large one, and
    # the agent pipeline's facet layers ask five of them at once. That is fine
    # against a generous quota and a 429 storm against a modest one, so the
    # concurrency is capped and every call retries on a rate limit.
    DECISION_CONCURRENCY: int = 2
    DECISION_MAX_RETRIES: int = 4
    DECISION_RETRY_BASE_SECONDS: float = 2.0

    WORKFLOW_MAX_STEPS: int = 20
    WORKFLOW_STEP_TIMEOUT: int = 60

    # Mistral Workflows Worker
    DEPLOYMENT_NAME: str = "default"
    MISTRAL_WORKER_ENABLED: bool = True
    MISTRAL_WORKFLOWS_DIR: str = "../mistral_workflows"


    # ── Knowledge graph (Neo4j) ────────────────────────────────────────
    # The graph store for document RAG. Started by docker-compose.yml at the
    # repository root; the backend runs on the host and speaks Bolt to it.
    # Every call is guarded — an unreachable graph degrades RAG to the
    # document_library tool alone, it never fails a request.
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "mistral-graph-rag"
    NEO4J_DATABASE: str = "neo4j"

    # ── Graph RAG ingestion ────────────────────────────────────────────
    # Entity/relation extraction is one LLM call per chunk, so these knobs are
    # the cost control. RAG_MAX_CHUNKS_PER_DOC is a hard ceiling: a 400-page
    # PDF would otherwise quietly spend a hundred calls on one upload.
    RAG_EXTRACTION_MODEL: str = "mistral-large-latest"
    RAG_CHUNK_CHARS: int = 6000
    RAG_CHUNK_OVERLAP: int = 400
    RAG_MAX_CHUNKS_PER_DOC: int = 40
    RAG_EXTRACTION_CONCURRENCY: int = 4
    # Mistral extracts library text asynchronously. Poll rather than block, and
    # give up rather than leave a document "extracting" forever.
    RAG_TEXT_POLL_SECONDS: int = 5
    RAG_TEXT_POLL_ATTEMPTS: int = 60

    # ── Observability (traces on Mistral) ──────────────────────────────
    # Every API action, workflow run, step, rule verdict, tool call, pipeline
    # layer and model call is exported as an OpenTelemetry span to Mistral's
    # telemetry endpoint, and read back by the Logs page. See
    # app/observability/tracing.py.
    OBSERVABILITY_ENABLED: bool = True
    OBSERVABILITY_SERVICE_NAME: str = "mistral-dynamic-agent-tools"
    OBSERVABILITY_ENVIRONMENT: str = "development"
    # Empty = Mistral's endpoint (https://api.mistral.ai/telemetry/v1/traces).
    OBSERVABILITY_ENDPOINT: str = ""
    # Mask secrets and PII in span attributes before they leave the process,
    # with the Mistral SDK's default policy. Turn off only if the workspace is
    # allowed to hold raw customer data.
    OBSERVABILITY_REDACT: bool = True
    # Large inputs/outputs are clipped so one span stays well under the
    # exporter's payload limits.
    OBSERVABILITY_MAX_ATTR_CHARS: int = 16000
    OBSERVABILITY_MAX_LOG_LINES: int = 200
    # Where the "Open in Mistral" links on the Logs page point.
    OBSERVABILITY_CONSOLE_URL: str = "https://console.mistral.ai/observability/traces"

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins into a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


# Singleton settings instance
settings = Settings()


def map_model_name(model_name: str) -> str:
    """Map frontend/alias model names to official Mistral model names."""
    if not model_name or not isinstance(model_name, str):
        return model_name
    mapping = {
        "default-large-latest": "mistral-large-latest",
        "default-medium-latest": "mistral-medium-latest",
        "default-small-latest": "mistral-small-latest",
        "open-default-nemo": "open-mistral-nemo",
    }
    return mapping.get(model_name, model_name)

