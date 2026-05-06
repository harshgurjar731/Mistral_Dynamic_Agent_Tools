"""
Workflow Models — Pydantic schemas and definitions for workflow engine.
Aligned with Mistral Beta Workflows API (v1/workflows).
"""

from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime
from enum import Enum


class StepType(str, Enum):
    AGENT = "agent"
    TOOL = "tool"
    CONDITION = "condition"
    TRANSFORM = "transform"


class WorkflowStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class WorkflowStep(BaseModel):
    """A single step in the workflow DAG."""
    id: str
    type: StepType
    config: dict = Field(default_factory=dict)
    # For agent steps: {"agent_id": "...", "query_template": "..."} or {"model": "...", "instructions": "..."}
    # For tool steps: {"tool_name": "...", "arguments_template": {}}
    # For condition steps: {"expression": "...", "true_step": "...", "false_step": "..."}
    # For transform steps: {"transform_code": "..."}
    next_steps: list[str] = Field(default_factory=list)
    description: Optional[str] = None


class WorkflowDefinition(BaseModel):
    """Full workflow definition — a DAG of steps."""
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    steps: list[WorkflowStep]
    entry_step: str
    input_schema: list[dict] = Field(default_factory=list)
    variables: dict = Field(default_factory=dict)
    is_deployed: bool = False
    archived: bool = False


class StepResult(BaseModel):
    """Result of executing a single step."""
    step_id: str
    status: str
    output: Any = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None


class WorkflowRun(BaseModel):
    """State of a workflow execution."""
    execution_id: str
    workflow_name: str
    status: WorkflowStatus = WorkflowStatus.PENDING
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    result: Any = None
    step_results: list[StepResult] = Field(default_factory=list)
    variables: dict = Field(default_factory=dict)


# ── Request / Response schemas ────────────────────────────────────────────

class CreateWorkflowRequest(BaseModel):
    """Request to create a new workflow."""
    definition: WorkflowDefinition


class ExecuteWorkflowRequest(BaseModel):
    """Request to execute a workflow. Follows Mistral API pattern."""
    input: dict = Field(default_factory=dict)
    wait_for_result: bool = False
    timeout_seconds: Optional[int] = None
    execution_id: Optional[str] = None


class WorkflowExecutionResponse(BaseModel):
    """Response from workflow execution — matches Mistral API pattern."""
    execution_id: str
    workflow_name: str
    status: WorkflowStatus
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    result: Any = None
    root_execution_id: Optional[str] = None


class WorkflowListResponse(BaseModel):
    """List of workflows."""
    workflows: list[WorkflowDefinition]
    count: int
