"""
Application settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application configuration loaded from .env file."""

    # Mistral AI
    MISTRAL_API_KEY: str = ""
    MISTRAL_ORCHESTRATOR_MODEL: str = "mistral-large-latest"
    MISTRAL_CODING_MODEL: str = "codestral-latest"

    # Dynamic Tools
    AUTO_APPROVE_DYNAMIC_TOOLS: bool = True

    # Docker Tool Service
    TOOL_SERVICE_URL: str = "http://localhost:9000"

    # Database
    DATABASE_URL: str = "sqlite:///./sql_app.db"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # API
    API_PREFIX: str = "/api"

    # Workflow engine (future)
    WORKFLOW_MAX_STEPS: int = 20
    WORKFLOW_STEP_TIMEOUT: int = 60

    # Mistral Workflows Worker
    DEPLOYMENT_NAME: str = "dynamic-workflows-worker"
    MISTRAL_WORKER_ENABLED: bool = True
    MISTRAL_WORKFLOWS_DIR: str = "../mistral_workflows"


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
