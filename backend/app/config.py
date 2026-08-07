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
    MISTRAL_CODING_MODEL: str = "codestral-latest"

    # Dynamic Tools
    AUTO_APPROVE_DYNAMIC_TOOLS: bool = True

    # Docker Tool Service
    TOOL_SERVICE_URL: str = "http://localhost:9000"

    # Database
    DATABASE_URL: str = f"sqlite:///{os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sql_app.db')}"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # API
    API_PREFIX: str = "/api"

    # Workflow engine (future)
    WORKFLOW_MAX_STEPS: int = 20
    WORKFLOW_STEP_TIMEOUT: int = 60

    # Mistral Workflows Worker
    DEPLOYMENT_NAME: str = "default"
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

