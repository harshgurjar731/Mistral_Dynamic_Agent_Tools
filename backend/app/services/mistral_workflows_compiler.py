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
  - Supports parallel execution groups via asyncio.gather()
  - Declares a connector slot per referenced Mistral Connector, so connector
    calls resolve credentials through the platform instead of this backend
"""

import json
import re
from datetime import timedelta
from app.services.workflow_engine.models import WorkflowDefinition, StepType


# ── Connector slots ─────────────────────────────────────────────────────────


def _connector_slot_key(step) -> tuple[str, str]:
    """Identify the connector slot a step needs: (connector name, credentials name).

    Credentials are part of the key because two steps hitting the same
    connector with different named credentials are two distinct slots as far as
    the Workflows SDK is concerned.
    """
    cfg = step.config or {}
    name = cfg.get("connector_name") or cfg.get("connector_id") or ""
    return str(name), str(cfg.get("credentials_name") or "")


def _slot_var(name: str, credentials_name: str) -> str:
    """Python identifier for a connector slot."""
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", f"{name}_{credentials_name}".strip("_")).strip("_").lower()
    return f"_connector_{slug or 'default'}"


def _collect_connector_slots(workflow_def: WorkflowDefinition) -> dict[tuple[str, str], str]:
    """Map every distinct connector slot in the DAG to its generated variable name."""
    slots: dict[tuple[str, str], str] = {}
    for step in workflow_def.steps:
        if step.type != StepType.CONNECTOR:
            continue
        key = _connector_slot_key(step)
        if key[0] and key not in slots:
            slots[key] = _slot_var(*key)
    return slots


def compile_workflow_to_python(workflow_def: WorkflowDefinition) -> str:
    """
    Generate a complete, deployable Mistral Workflows SDK Python module
    from a WorkflowDefinition object.

    Supports both sequential steps and parallel groups. Steps sharing the
    same `parallel_group` value are executed concurrently via asyncio.gather().
    """
    lines: list[str] = []
    connector_slots = _collect_connector_slots(workflow_def)

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
    ]

    if connector_slots:
        lines += [
            "from mistralai.workflows import Depends",
            "from mistralai.workflows.plugins.mistralai.connectors import (",
            "    ToolCallClient,",
            "    connector,",
            "    uses_connectors,",
            ")",
        ]

    lines += [
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

    # ── Connector slots ──────────────────────────────────────────────────────
    # Declared at module scope so the SDK can discover them when the worker
    # imports this file, before any workflow is instantiated.
    if connector_slots:
        lines += [
            "from app.services.workflow_engine.step_runners import resolve_connector_arguments",
            "from app.services.connector_service import flatten_tool_result",
            "",
            "# ── Connector slots (credentials resolved by the platform) ──────────",
        ]
        for (name, credentials_name), var in connector_slots.items():
            if credentials_name:
                lines.append(
                    f"{var} = connector({json.dumps(name)}, credentials_name={json.dumps(credentials_name)})"
                )
            else:
                lines.append(f"{var} = connector({json.dumps(name)})")
        lines.append("")

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

        # Use json.loads() at runtime so JSON null/true/false are correctly
        # converted to Python None/True/False (embedding raw JSON as a Python
        # dict literal would cause NameError on 'null').
        step_json_repr = repr(step_json)  # safely quoted string for embedding

        slot_var = connector_slots.get(_connector_slot_key(step)) if step.type == StepType.CONNECTOR else None

        if slot_var:
            # Connector activities cannot delegate to run_step(): the SDK
            # injects the ToolCallClient through the activity signature, and
            # that client is what carries the caller's credentials. Only the
            # argument templating is shared with the local runner.
            tool_name = (step.config or {}).get("tool_name", "")
            lines += [
                f"@workflows.activity(",
                f"    start_to_close_timeout=timedelta(seconds={timeout_sec}),",
                f"    retry_policy_max_attempts=3,",
                f")",
                f"async def run_{workflow_def.name}_{step.id}(",
                f"    variables: Dict[str, Any],",
                f"    _client: ToolCallClient = Depends({slot_var}),",
                f") -> Any:",
                f"    \"\"\"Activity for step: {step.id} (connector)\"\"\"",
                f"    step_def = WorkflowStep.model_validate(json.loads({step_json_repr}))",
                f"    arguments = resolve_connector_arguments(step_def, variables)",
                f"    result = await _client.call_tool(",
                f"        tool_name={json.dumps(tool_name)},",
                f"        arguments=arguments,",
                f"    )",
                f"    return flatten_tool_result(result)",
                "",
            ]
            continue

        lines += [
            f"@workflows.activity(",
            f"    start_to_close_timeout=timedelta(seconds={timeout_sec}),",
            f"    retry_policy_max_attempts=3,",
            f")",
            f"async def run_{workflow_def.name}_{step.id}(variables: Dict[str, Any]) -> Any:",
            f"    \"\"\"Activity for step: {step.id} ({step.type})\"\"\"",
            f"    step_def = WorkflowStep.model_validate(json.loads({step_json_repr}))",
            f"    result = await run_step(step_def, variables)",
            f"    if result.status == \"failed\":",
            f"        raise Exception(result.error or \"Step {step.id} failed\")",
            f"    return result.output",
            "",
        ]

    # ── Pre-compute parallel groups ──────────────────────────────────────────
    parallel_groups: dict[str, list] = {}
    for step in workflow_def.steps:
        if step.parallel_group:
            parallel_groups.setdefault(step.parallel_group, []).append(step)

    # Track which steps belong to a parallel group (to skip individual dispatch)
    parallel_step_ids = {s.id for steps in parallel_groups.values() for s in steps}

    # ── Workflow class ────────────────────────────────────────────────────────
    class_name = _to_class_name(workflow_def.name)
    display_name = workflow_def.name.replace("_", " ").title()
    description = (workflow_def.description or display_name).replace('"', "'")

    define_args = [
        f"    name=\"{workflow_def.name}\",",
        f"    workflow_display_name=\"{display_name}\",",
        f"    workflow_description=\"{description}\",",
        f"    execution_timeout=timedelta(hours=24),",
    ]
    # on_behalf_of runs the workflow under the triggering user's identity, so a
    # connector resolves *their* credentials rather than the worker's. Only set
    # when connectors are involved — it changes who a deployment runs as.
    if connector_slots:
        define_args.append("    on_behalf_of=True,")

    lines += [
        f"@workflows.workflow.define(",
        *define_args,
        f")",
    ]

    if connector_slots:
        lines.append(f"@uses_connectors({', '.join(connector_slots.values())})")

    lines += [
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
        "        outputs: Dict[str, Any] = {}",
        "",
        "        while current_step and len(visited) < 50:",
        "            if current_step in visited:",
        "                break  # cycle guard",
        "            visited.add(current_step)",
        "",
    ]

    # ── Step dispatcher inside entrypoint ─────────────────────────────────────
    # Track which parallel groups we've already emitted code for
    emitted_parallel_groups: set[str] = set()

    for i, step in enumerate(workflow_def.steps):
        # If this step is part of a parallel group, emit the entire group
        # as a single asyncio.gather() block (only once per group)
        if step.parallel_group and step.parallel_group in parallel_groups:
            if step.parallel_group in emitted_parallel_groups:
                continue  # Already emitted this group
            emitted_parallel_groups.add(step.parallel_group)

            group_id = step.parallel_group
            group_steps = parallel_groups[group_id]

            # The dispatcher routes to the FIRST step in the group;
            # all group steps are executed together
            first_step_id = group_steps[0].id

            prefix = "if" if i == 0 or not any(
                s.parallel_group is None or s.parallel_group in emitted_parallel_groups
                for s in workflow_def.steps[:i]
            ) else "elif"

            # Use first step ID as the entry trigger for the parallel group
            # Also match any step in the group (in case routing lands on a different member)
            conditions = [f"current_step == \"{s.id}\"" for s in group_steps]
            condition_str = " or ".join(conditions)

            lines += [
                f"            {prefix} {condition_str}:",
                f"                # ── Parallel group: {group_id} ──",
                f"                self._progress.append(\"__parallel_{group_id}:start\")",
                f"                # Fan-out: execute {len(group_steps)} steps concurrently",
                f"                _parallel_results = await asyncio.gather(",
            ]

            for gs in group_steps:
                lines.append(
                    f"                    run_{workflow_def.name}_{gs.id}(dict(variables)),"
                )

            lines += [
                f"                )",
                f"                # Fan-in: merge all parallel outputs",
                f"                _parallel_names = {json.dumps([gs.id for gs in group_steps])}",
                f"                for _pname, _presult in zip(_parallel_names, _parallel_results):",
                f"                    outputs[_pname] = _presult",
                f"                    variables[f\"step_{{_pname}}_output\"] = _presult",
                f"                    if isinstance(_presult, dict):",
                f"                        variables.update(_presult)",
                f"                    self._progress.append(_pname)",
                f"                self._last_result = _parallel_results[-1]",
                "",
            ]

            # Advance to the shared join step
            if group_steps[0].next_steps:
                lines.append(f"                current_step = \"{group_steps[0].next_steps[0]}\"")
            else:
                lines.append("                current_step = None")

            lines.append("")

        else:
            # ── Sequential step (unchanged from original) ─────────────────
            # Determine the correct if/elif prefix
            is_first_dispatch = (i == 0) and not emitted_parallel_groups
            prefix = "if" if is_first_dispatch else "elif"

            lines += [
                f"            {prefix} current_step == \"{step.id}\":",
                f"                self._progress.append(\"{step.id}\")",
                f"                output = await run_{workflow_def.name}_{step.id}(variables)",
                f"                outputs[\"{step.id}\"] = output",
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
        "        return outputs",
        "",
    ]

    return "\n".join(lines)


def _to_class_name(workflow_name: str) -> str:
    """Convert snake_case workflow name to PascalCase class name."""
    return "".join(word.capitalize() for word in workflow_name.split("_"))
