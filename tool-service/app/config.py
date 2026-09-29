"""
Tool Service Configuration — loaded from environment variables.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Tool Service configuration."""

    # Mistral Platform
    MISTRAL_API_KEY: str = ""

    # Retired for synthesis — models are chosen per job in app/llm/routes.py
    # (override with ROUTE_<ROLE>_MODEL). Kept so an existing .env still loads.
    MISTRAL_CODING_MODEL: str = "codestral-latest"

    # ── Code synthesis ──────────────────────────────────────────────────
    # Transport retries per model call, before the route's fallback model.
    TOOL_MODEL_MAX_ATTEMPTS: int = 3
    # Generate/repair passes per job.
    TOOL_SYNTHESIS_MAX_ATTEMPTS: int = 4
    # Hard wall-clock budget per job, across every attempt. Reasoning calls are
    # slow; an attempt budget alone let one job hold a worker for many minutes.
    SYNTHESIS_WALL_CLOCK_SECONDS: int = 900
    # Concurrent synthesis jobs. Each holds a model call and a sandbox process.
    SYNTHESIS_WORKERS: int = 3
    # How long the legacy blocking POST /synthesize waits before answering 202
    # with a job id. Below the backend's 180s HTTP timeout on purpose.
    SYNTHESIZE_WAIT_SECONDS: int = 150

    # Activities must carry output_schema and worked examples. Off only while
    # callers that predate SynthesisSpec v2 are migrated.
    STRICT_ACTIVITY_SPEC: bool = True
    # G7: when an activity disagrees with one of its own examples, run an
    # independently written reference implementation to decide which is wrong.
    ORACLE_ARBITRATION: bool = True
    # When the reference implementation and the generated code agree against
    # an example, correct the example (and report it) instead of sending the
    # spec back. Worked examples are hand arithmetic by a model; code is not.
    ORACLE_AUTOCORRECT: bool = True

    # Tool synthesis safety
    AUTO_APPROVE_DYNAMIC_TOOLS: bool = False

    # ── Runtime ─────────────────────────────────────────────────────────
    # A labelled, LLM-written "degraded" answer when an *agent tool* fails.
    # Never applies to activities: a workflow step must fail, not be invented.
    TOOL_RUNTIME_FALLBACK: bool = False
    # Environment variables a tool may receive through ``_secrets``, and only
    # when its spec names them. Comma-separated.
    SECRETS_ALLOWLIST: str = ""

    # ── Sandbox ─────────────────────────────────────────────────────────
    SANDBOX_TIMEOUT_SECONDS: int = 20
    SANDBOX_MEMORY_MB: int = 512
    # Unprivileged user the sandbox runs as when the service runs as root
    # (the Dockerfile creates it). Ignored where not applicable.
    SANDBOX_USER: str = "sandboxuser"
    DYNAMIC_TOOLS_DIR: str = "dynamic_tools"

    # Database
    DATABASE_URL: str = "sqlite:////app/db/tool_service.db"

    # MCP
    MCP_SERVERS_ENABLED: bool = False
    MCP_REGISTRY_PATH: str = "db/mcp_registry.json"

    # Mistral Connector (auto-populated after first MCP connector registration)
    MISTRAL_CONNECTOR_ID: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def secrets_allowlist(self) -> set[str]:
        return {s.strip() for s in self.SECRETS_ALLOWLIST.split(",") if s.strip()}


settings = Settings()
