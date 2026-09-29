"""
Pydantic schemas for Tool Service API requests and responses.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Synthesis ───────────────────────────────────────────────────────────────

class SynthesizeRequest(BaseModel):
    """SynthesisSpec v2 — what to build, for whom, and how to tell it works.

    v1 callers (``parameters`` + ``required`` + prose ``expected_output_shape``)
    are still accepted; ``input_schema`` takes precedence when both are sent.
    """
    name: str
    description: str
    purpose: str = "tool"                       # "tool" | "activity"
    kind: Optional[str] = None                  # "pure" | "http"; inferred from api_details
    parameters: dict = Field(default_factory=dict)
    input_schema: Optional[dict] = None
    required: list[str] = Field(default_factory=list)
    output_schema: Optional[dict] = None
    # [{"input": {...}, "output": {...}, "note": "how the output follows"}]
    examples: list[dict] = Field(default_factory=list)
    api_details: str = "No external API. This is a pure computation using the standard library."
    expected_output_shape: str = ""
    secrets: list[str] = Field(default_factory=list)
    side_effects: str = "none"                  # none | read-only | write | delete
    http_fixtures: list[dict] = Field(default_factory=list)
    origin: str = "explicit"                    # chat | workflow | explicit | runtime | import


class SynthesizeResponse(BaseModel):
    """Outcome of a synthesis job (or its state while it runs)."""
    # approved | pending_approval | failed | spec_invalid | running | queued | interrupted
    status: str
    tool_name: str
    message: str = ""
    purpose: Optional[str] = None
    tool_id: Optional[int] = None
    version: Optional[int] = None
    job_id: Optional[str] = None
    issues: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    review_required: bool = False
    fault: Optional[str] = None
    input_schema: Optional[dict] = None
    output_schema: Optional[dict] = None
    report: Optional[dict] = None


class JobResponse(BaseModel):
    job_id: str
    status: str
    tool_name: str
    purpose: Optional[str] = None
    joined_existing: bool = False
    result: Optional[dict] = None
    events: int = 0


# ── Execution ──────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    """Request to execute a stored tool. ``version`` pins an exact version."""
    arguments: dict = Field(default_factory=dict)
    version: Optional[int] = None


class ExecuteResponse(BaseModel):
    result: Any
    tool_name: str
    version: Optional[int] = None


# ── Tool Management ───────────────────────────────────────────────────────

class ToolResponse(BaseModel):
    """One tool version."""
    id: int
    name: str
    hash: str
    version: str
    version_no: int = 1
    is_active: bool = False
    schema: dict
    output_schema: Optional[dict] = None
    status: str
    source_code: Optional[str] = None
    sandbox_output: Optional[str] = None
    created_at: Optional[datetime] = None
    mcp_published: bool = False
    mcp_server_name: Optional[str] = None
    purpose: str = "tool"
    kind: str = "pure"
    side_effects: str = "none"
    review_required: bool = False
    spec: Optional[dict] = None
    report: Optional[dict] = None

    class Config:
        from_attributes = True


class ToolListResponse(BaseModel):
    tools: list[ToolResponse]
    count: int


class ApproveRejectResponse(BaseModel):
    status: str
    message: str
    tool_name: str


class ToolUpdateRequest(BaseModel):
    """Request to update a tool's code and description (saved as a new version)."""
    source_code: str
    description: str
    # Omitted (None) leaves the existing purpose unchanged.
    purpose: Optional[str] = None


class ToolImportRequest(BaseModel):
    """Install a tool from known-good source, bypassing synthesis (deployment packages)."""
    name: str
    schema: dict
    source_code: str
    hash: str
    version: str = "1.0.0"
    purpose: str = "tool"
    #: Keep this version number when the name has no version with it yet, so a
    #: workflow's pinned steps resolve on this instance too.
    version_no: Optional[int] = None
