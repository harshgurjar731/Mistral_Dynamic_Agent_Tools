"""
Mistral Workflows Compiler.

Translates a WorkflowDefinition DAG into a Mistral Workflows SDK Python file.
The generated file:
  - Has @workflows.activity() for each step
  - Has a central @workflows.workflow.define class
  - Supports signals (user messages during execution)
  - Supports queries (progress polling)
  - Uses determinism-safe helpers (workflow.now(), workflow.uuid4())
  - Sets execution_timeout=timedelta(hours=24) for long-running workflows
"""

import json
from datetime import timedelta
from app.services.workflow_engine.models import WorkflowDefinition, StepType


def compile_workflow_to_python(workflow_def: WorkflowDefinition) -> str:
    """
    Generate a complete, deployable Mistral Workflows SDK Python module
    from a WorkflowDefinition object.
    """
    lines: list[str] = []

    # ── Imports ──────────────────────────────────────────────────────────────
    lines += [
        "import os",
        "import sys",
        "import json",
        "import asyncio",
        "from typing import Dict, Any, List, Optional",
        "from datetime import timedelta",
        "from pydantic import BaseModel",
        "import mistralai.workflows as workflows",
        "from mistralai.workflows import workflow",
        "",
        "# Ensure backend path is available for step_runners",
        "backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), \"../backend\"))",
        "if backend_dir not in sys.path:",
        "    sys.path.insert(0, backend_dir)",
        "",
        "from app.services.workflow_engine.step_runners import run_step",
        "from app.services.workflow_engine.models import WorkflowStep, StepType",
        "",
    ]

    # ── Input model ──────────────────────────────────────────────────────────
    lines += [
        "class DynamicInput(BaseModel):",
        "    \"\"\"Input model for the workflow. Pass user variables as a flat dict.\"\"\"",
        "    variables: Dict[str, Any] = {}",
        "",
    ]

    # ── Activities (one per DAG step) ────────────────────────────────────────
    for step in workflow_def.steps:
        step_json = json.dumps(step.model_dump())
        timeout_sec = 300  # 5 min default; condition/transform can be shorter
        if step.type in (StepType.CONDITION, StepType.TRANSFORM):
            timeout_sec = 30

        lines += [
            f"@workflows.activity(",
            f"    start_to_close_timeout=timedelta(seconds={timeout_sec}),",
            f"    retry_policy_max_attempts=3,",
            f")",
            f"async def run_{workflow_def.name}_{step.id}(variables: Dict[str, Any]) -> Any:",
            f"    \"\"\"Activity for step: {step.id} ({step.type})\"\"\"",
            f"    step_def = WorkflowStep.model_validate({step_json})",
            f"    result = await run_step(step_def, variables)",
            f"    if result.status == \"failed\":",
            f"        raise Exception(result.error or \"Step {step.id} failed\")",
            f"    return result.output",
            "",
        ]

    # ── Workflow class ────────────────────────────────────────────────────────
    class_name = _to_class_name(workflow_def.name)
    display_name = workflow_def.name.replace("_", " ").title()
    description = (workflow_def.description or display_name).replace('"', "'")

    lines += [
        f"@workflows.workflow.define(",
        f"    name=\"{workflow_def.name}\",",
        f"    workflow_display_name=\"{display_name}\",",
        f"    workflow_description=\"{description}\",",
        f"    execution_timeout=timedelta(hours=24),",
        f")",
        f"class {class_name}:",
        f"    \"\"\"Durable workflow: {description}\"\"\"",
        "",
        "    def __init__(self) -> None:",
        "        self._progress: List[str] = []",
        "        self._user_signals: List[str] = []",
        "        self._last_result: Any = None",
        "",
        "    # ── Signals (async fire-and-forget from UI / le Chat) ──────────",
        "    @workflows.workflow.signal",
        "    def user_message(self, message: str) -> None:",
        "        \"\"\"Receive a user message signal during execution.\"\"\"",
        "        self._user_signals.append(message)",
        "",
        "    # ── Queries (sync state reads for live progress polling) ────────",
        "    @workflows.workflow.query",
        "    def get_progress(self) -> List[str]:",
        "        \"\"\"Return the list of completed step IDs so far.\"\"\"",
        "        return self._progress",
        "",
        "    @workflows.workflow.query",
        "    def get_last_result(self) -> Any:",
        "        \"\"\"Return the output of the last completed step.\"\"\"",
        "        return self._last_result",
        "",
        "    # ── Entrypoint ──────────────────────────────────────────────────",
        "    @workflows.workflow.entrypoint",
        "    async def run(self, input: DynamicInput) -> Any:",
        f"        \"\"\"Execute the {display_name} workflow DAG.\"\"\"",
        "        # Use workflow.now() for determinism-safe timestamps",
        "        started_at = workflow.now()",
        "        variables = dict(input.variables)",
        f"        current_step: Optional[str] = \"{workflow_def.entry_step}\"",
        "        visited: set = set()",
        "        last_output: Any = None",
        "",
        "        while current_step and len(visited) < 50:",
        "            if current_step in visited:",
        "                break  # cycle guard",
        "            visited.add(current_step)",
        "",
    ]

    # ── Step dispatcher inside entrypoint ─────────────────────────────────────
    for i, step in enumerate(workflow_def.steps):
        prefix = "if" if i == 0 else "elif"
        lines += [
            f"            {prefix} current_step == \"{step.id}\":",
            f"                self._progress.append(\"{step.id}\")",
            f"                output = await run_{workflow_def.name}_{step.id}(variables)",
            f"                last_output = output",
            f"                self._last_result = output",
            f"                variables[\"step_{step.id}_output\"] = output",
            f"                if isinstance(output, dict):",
            f"                    variables.update(output)",
            "",
        ]

        if step.type == StepType.CONDITION:
            lines += [
                "                # Condition step: output contains {next_step: ...}",
                "                if isinstance(output, dict) and \"next_step\" in output:",
                "                    current_step = output[\"next_step\"]",
                "                else:",
                "                    current_step = None",
            ]
        elif step.next_steps:
            lines.append(f"                current_step = \"{step.next_steps[0]}\"")
        else:
            lines.append("                current_step = None")

        lines.append("")

    lines += [
        "            else:",
        "                current_step = None",
        "",
        "        return last_output",
        "",
    ]

    return "\n".join(lines)


def _to_class_name(workflow_name: str) -> str:
    """Convert snake_case workflow name to PascalCase class name."""
    return "".join(word.capitalize() for word in workflow_name.split("_"))
