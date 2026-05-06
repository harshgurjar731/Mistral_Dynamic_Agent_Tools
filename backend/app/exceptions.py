"""
Custom exceptions and global error handlers.
"""

from fastapi import Request
from fastapi.responses import JSONResponse
import logging

logger = logging.getLogger(__name__)


class MistralAPIError(Exception):
    """Wraps errors returned by the Mistral API."""

    def __init__(self, message: str, status_code: int = 502, details: dict | None = None):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class AgentNotFoundError(Exception):
    """Raised when an agent is not found."""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.message = f"Agent '{agent_id}' not found"
        super().__init__(self.message)


class ConversationNotFoundError(Exception):
    """Raised when a conversation is not found."""

    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.message = f"Conversation '{conversation_id}' not found"
        super().__init__(self.message)


class ToolServiceError(Exception):
    """Raised when the Docker Tool Service is unreachable or returns an error."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(self.message)


class WorkflowError(Exception):
    """Raised when a workflow execution fails."""

    def __init__(self, message: str, workflow_id: str = ""):
        self.message = message
        self.workflow_id = workflow_id
        super().__init__(self.message)


# ── Global Exception Handlers ──────────────────────────────────────────────

async def mistral_api_error_handler(request: Request, exc: MistralAPIError) -> JSONResponse:
    logger.error(f"Mistral API Error: {exc.message}", extra={"details": exc.details})
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "mistral_api_error", "message": exc.message, "details": exc.details},
    )


async def agent_not_found_handler(request: Request, exc: AgentNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "not_found", "message": exc.message})


async def conversation_not_found_handler(request: Request, exc: ConversationNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "not_found", "message": exc.message})


async def tool_service_error_handler(request: Request, exc: ToolServiceError) -> JSONResponse:
    logger.error(f"Tool Service Error: {exc.message}")
    return JSONResponse(status_code=503, content={"error": "tool_service_error", "message": exc.message})


async def workflow_error_handler(request: Request, exc: WorkflowError) -> JSONResponse:
    logger.error(f"Workflow Error: {exc.message}")
    return JSONResponse(status_code=500, content={"error": "workflow_error", "message": exc.message})


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "message": "An unexpected error occurred. Please try again later."},
    )
