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
    DATABASE_URL: str = "sqlite:///./tool_service.db"

    # MCP (future)
    MCP_SERVERS_ENABLED: bool = False
    MCP_REGISTRY_PATH: str = "mcp_servers/mcp_registry.json"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
