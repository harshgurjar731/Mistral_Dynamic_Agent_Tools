"""
Tool Service Configuration — loaded from environment variables.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Tool Service configuration."""

    # Mistral Platform
    MISTRAL_API_KEY: str = ""

    # Kept for anything still reading it; synthesis uses the two below.
    MISTRAL_CODING_MODEL: str = "codestral-latest"

    # ── Code synthesis ──────────────────────────────────────────────────
    # Codestral is a code *completion* model, tuned for filling in code given
    # surrounding context. Writing a whole correct function from a JSON schema
    # — with the error handling, the optional-argument guards and the return
    # contract this service requires — is a reasoning task, and the flagship
    # holds a long specification in mind noticeably better while doing it.
    TOOL_CODEGEN_MODEL: str = "mistral-large-latest"
    # Repair reads a traceback and works out which line caused it, which is
    # reasoning rather than completion, so it uses the same model.
    TOOL_REPAIR_MODEL: str = "mistral-large-latest"
    TOOL_CODEGEN_TEMPERATURE: float = 0.1
    # Per attempt. Several tools synthesise at once, and a long single timeout
    # meant one slow call held the request open until the client gave up.
    TOOL_MODEL_TIMEOUT_MS: int = 90_000
    TOOL_MODEL_MAX_ATTEMPTS: int = 3
    TOOL_SYNTHESIS_MAX_ATTEMPTS: int = 3

    # Tool synthesis safety
    AUTO_APPROVE_DYNAMIC_TOOLS: bool = False

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


settings = Settings()
