import os
import sys
import json
import asyncio
from typing import Dict, Any, List, Optional
from datetime import timedelta
from pydantic import BaseModel
import mistralai.workflows as workflows
from mistralai.workflows import workflow

# Ensure backend path is available for step_runners
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.workflow_engine.step_runners import run_step
from app.services.workflow_engine.models import WorkflowStep, StepType

class DynamicInput(BaseModel):
    """Input model for the workflow. Pass user variables as a flat dict."""
    variables: Dict[str, Any] = {}

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_demo1_input_agent(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_agent (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_agent", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019fd5fb15f872ed8d2677eb95cf6f38", "agent_name": "Input agent", "model": "mistral-small-latest", "query_template": "{{input}}"}, "next_steps": ["rejection_email_drafter"], "description": "Input agent", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step input_agent failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_demo1_rejection_email_drafter(variables: Dict[str, Any]) -> Any:
    """Activity for step: rejection_email_drafter (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "rejection_email_drafter", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019efd48abfc74f5b60b71cfe21e3d23", "agent_name": "Rejection Email Drafter", "model": "mistral-medium-latest", "query_template": "{{input}}"}, "next_steps": ["foundation_output_moderator"], "description": "Rejection Email Drafter", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step rejection_email_drafter failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_demo1_foundation_output_moderator(variables: Dict[str, Any]) -> Any:
    """Activity for step: foundation_output_moderator (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "foundation_output_moderator", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "agent_name": "foundation_output_moderator", "model": "mistral-large-latest", "query_template": "{{input}}"}, "next_steps": [], "description": "foundation_output_moderator", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step foundation_output_moderator failed")
    return result.output

@workflows.workflow.define(
    name="demo1",
    workflow_display_name="Demo1",
    workflow_description="For demo purpose.",
    execution_timeout=timedelta(hours=24),
)
class Demo1:
    """Durable workflow: For demo purpose."""

    def __init__(self) -> None:
        self._progress: List[str] = []
        self._user_signals: List[str] = []
        self._last_result: Any = None

    # ── Signals (async fire-and-forget from UI / le Chat) ──────────
    @workflows.workflow.signal
    def user_message(self, message: str) -> None:
        """Receive a user message signal during execution."""
        self._user_signals.append(message)

    # ── Queries (sync state reads for live progress polling) ────────
    @workflows.workflow.query
    def get_progress(self) -> List[str]:
        """Return the list of completed step IDs so far."""
        return self._progress

    @workflows.workflow.query
    def get_last_result(self) -> Any:
        """Return the output of the last completed step."""
        return self._last_result

    # ── Entrypoint ──────────────────────────────────────────────────
    @workflows.workflow.entrypoint
    async def run(self, input: DynamicInput) -> Any:
        """Execute the Demo1 workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "input_agent"
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "input_agent":
                self._progress.append("input_agent")
                output = await run_demo1_input_agent(variables)
                outputs["input_agent"] = output
                self._last_result = output
                variables["step_input_agent_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "rejection_email_drafter"

            elif current_step == "rejection_email_drafter":
                self._progress.append("rejection_email_drafter")
                output = await run_demo1_rejection_email_drafter(variables)
                outputs["rejection_email_drafter"] = output
                self._last_result = output
                variables["step_rejection_email_drafter_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "foundation_output_moderator"

            elif current_step == "foundation_output_moderator":
                self._progress.append("foundation_output_moderator")
                output = await run_demo1_foundation_output_moderator(variables)
                outputs["foundation_output_moderator"] = output
                self._last_result = output
                variables["step_foundation_output_moderator_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
