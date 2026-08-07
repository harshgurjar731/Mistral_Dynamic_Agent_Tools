"""
Tool Service Configuration — loaded from environment variables.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Tool Service configuration."""

    # Mistral Platform (for Codestral code generation)
    MISTRAL_API_KEY: str = ""
    MISTRAL_CODING_MODEL: str = "codestral-latest"

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
