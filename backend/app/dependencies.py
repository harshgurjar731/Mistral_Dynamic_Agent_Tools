"""
Shared dependencies for FastAPI dependency injection.

The Mistral client and key follow the request's workspace
(``app.auth.context``): a user's calls go to their active workspace's Mistral
key, so what they create lands in that Mistral workspace. Code running outside
a request — boot tasks, the worker — gets the platform client, whose key is
the Default workspace's.
"""

import threading
from typing import Optional

import httpx
from mistralai.client import Mistral

from app.config import settings

# Module-level Mistral client — initialized once
_mistral_client: Mistral | None = None

#: workspace id → (key, client). A key change replaces the client.
_workspace_clients: dict[str, tuple[str, Mistral]] = {}
_lock = threading.Lock()


def init_mistral_client() -> Mistral:
    """Initialize the Mistral client. Called at app startup."""
    global _mistral_client
    if not settings.MISTRAL_API_KEY or settings.MISTRAL_API_KEY == "your_mistral_api_key_here":
        raise ValueError(
            "MISTRAL_API_KEY is not set. Please set it in your .env file."
        )
    _mistral_client = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=120000)
    # Every model call made through the shared client becomes a span on
    # Mistral (no-op when observability is off or not yet set up).
    from app.observability import instrument_client

    instrument_client(_mistral_client)
    return _mistral_client


class WorkspaceKeyMissing(RuntimeError):
    """The current workspace has no usable Mistral key (disabled or not set)."""


def _workspace_key(workspace_id: str) -> Optional[str]:
    from app.auth import store

    return store.workspace_key(workspace_id)


def current_mistral_api_key() -> str:
    """The Mistral key for whoever is calling: their workspace's, else the platform's."""
    from app.auth.context import current_workspace_id

    ws = current_workspace_id()
    if ws:
        key = _workspace_key(ws)
        if not key:
            raise WorkspaceKeyMissing(
                "This workspace has no working Mistral API key. Ask a platform admin to check it.")
        return key
    return settings.MISTRAL_API_KEY


def mistral_auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {current_mistral_api_key()}"}


class MistralKeyAuth(httpx.Auth):
    """httpx auth that sends the calling workspace's key on every request.

    For module-level ``httpx.Client``s, which are created once at import but
    serve requests from every workspace.
    """

    def auth_flow(self, request):
        request.headers["Authorization"] = f"Bearer {current_mistral_api_key()}"
        yield request


def forget_workspace_client(workspace_id: str) -> None:
    with _lock:
        _workspace_clients.pop(workspace_id, None)


def get_mistral_client() -> Mistral:
    """FastAPI dependency that returns the Mistral client of the caller's workspace."""
    if _mistral_client is None:
        raise RuntimeError(
            "Mistral client not initialized. Ensure the app startup completed."
        )
    from app.auth.context import current_workspace_id

    ws = current_workspace_id()
    if not ws:
        return _mistral_client
    key = current_mistral_api_key()
    if key == settings.MISTRAL_API_KEY:
        return _mistral_client
    with _lock:
        hit = _workspace_clients.get(ws)
        if hit and hit[0] == key:
            return hit[1]
    client = Mistral(api_key=key, timeout_ms=120000)
    from app.observability import instrument_client

    instrument_client(client)
    with _lock:
        _workspace_clients[ws] = (key, client)
    return client
