"""
Shared dependencies for FastAPI dependency injection.
"""

from mistralai.client import Mistral
from app.config import settings

# Module-level Mistral client — initialized once
_mistral_client: Mistral | None = None


def init_mistral_client() -> Mistral:
    """Initialize the Mistral client. Called at app startup."""
    global _mistral_client
    if not settings.MISTRAL_API_KEY or settings.MISTRAL_API_KEY == "your_mistral_api_key_here":
        raise ValueError(
            "MISTRAL_API_KEY is not set. Please set it in your .env file."
        )
    _mistral_client = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=120000)
    return _mistral_client


def get_mistral_client() -> Mistral:
    """FastAPI dependency that returns the shared Mistral client."""
    if _mistral_client is None:
        raise RuntimeError(
            "Mistral client not initialized. Ensure the app startup completed."
        )
    return _mistral_client
