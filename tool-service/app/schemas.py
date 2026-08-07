"""
Pydantic schemas for Tool Service API requests and responses.
"""

from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


# ── Synthesis ───────────────────────────────────────────────────────────────

class SynthesizeRequest(BaseModel):
    """Request to synthesize a new tool from a schema."""
    name: str
    description: str
    parameters: dict
    required: list[str] = []
    api_details: str = "No external API. This is a pure computation using standard library."
    expected_output_shape: str = "A dictionary containing the result."


class SynthesizeResponse(BaseModel):
    """Response from synthesis pipeline."""
    status: str  # "approved" | "pending_approval" | "failed"
    tool_name: str
    message: str
    tool_id: Optional[int] = None


# ── Execution ──────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    """Request to execute a stored tool."""
    arguments: dict = {}


class ExecuteResponse(BaseModel):
    """Response from tool execution."""
    result: Any
    tool_name: str


# ── Tool Management ───────────────────────────────────────────────────────

class ToolResponse(BaseModel):
    """Tool record response."""
    id: int
    name: str
    hash: str
    version: str
    schema: dict
    status: str
    source_code: Optional[str] = None
    sandbox_output: Optional[str] = None
    created_at: Optional[datetime] = None
    mcp_published: bool = False
    mcp_server_name: Optional[str] = None

    class Config:
        from_attributes = True


class ToolListResponse(BaseModel):
    """List of tools response."""
    tools: list[ToolResponse]
    count: int


class ApproveRejectResponse(BaseModel):
    """Response for approve/reject actions."""
    status: str
    message: str
    tool_name: str

class ToolUpdateRequest(BaseModel):
    """Request to update a tool's code and description."""
    source_code: str
    description: str
