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

Every user-authored value (names, descriptions, group ids, step ids) reaches
the module through ``_lit`` / ``_doc`` / ``_comment``, and the finished module
is syntax-checked before it is returned — so a quote, backslash or newline in
a description can never produce a module the worker fails to import.
"""

import json
import re
from app.services.workflow_engine.models import WorkflowDefinition, StepType


class WorkflowCompileError(ValueError):
    """The generated module is not valid Python — it must not be written or registered."""


# ── Literal helpers ─────────────────────────────────────────────────────────


def _lit(value) -> str:
    """A Python literal for a JSON-like value (str, list, None...)."""
    return repr(value)


def _doc(text) -> str:
    """Text safe to place inside a triple-quoted docstring."""
    one_line = " ".join(str(text).split())
    return one_line.replace("\\", "\\\\").replace('"""', "'''").rstrip('"')


def _comment(text) -> str:
    """Text safe to place after a ``#``."""
    return " ".join(str(text).split())


def _fn_name(workflow_name: str, step_id: str) -> str:
    """Activity function name for a step. Unchanged for already-valid step ids."""
    return re.sub(r"\W", "_", f"run_{workflow_name}_{step_id}")


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

    Raises WorkflowCompileError if the generated module is not valid Python.
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
                    f"{var} = connector({_lit(name)}, credentials_name={_lit(credentials_name)})"
                )
            else:
                lines.append(f"{var} = connector({_lit(name)})")
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
        fn = _fn_name(workflow_def.name, step.id)
        timeout_sec = 300  # 5 min default; condition/transform can be shorter
        if step.type in (StepType.CONDITION, StepType.TRANSFORM):
            timeout_sec = 30

        # The step travels as a JSON string parsed at runtime, so JSON
        # null/true/false become Python None/True/False (a raw dict literal
        # would raise NameError on 'null'). mode="json" keeps enums as values.
        step_json_repr = _lit(json.dumps(step.model_dump(mode="json")))

        slot_var = connector_slots.get(_connector_slot_key(step)) if step.type == StepType.CONNECTOR else None

        if slot_var:
            # Connector activities cannot delegate to run_step(): the SDK
            # injects the ToolCallClient through the activity signature, and
            # that client is what carries the caller's credentials. Only the
            # argument templating is shared with the local runner.
            tool_name = str((step.config or {}).get("tool_name", ""))
            lines += [
                "@workflows.activity(",
                f"    start_to_close_timeout=timedelta(seconds={timeout_sec}),",
                "    retry_policy_max_attempts=3,",
                ")",
                f"async def {fn}(",
                "    variables: Dict[str, Any],",
                f"    _client: ToolCallClient = Depends({slot_var}),",
                ") -> Any:",
                f"    \"\"\"Activity for step: {_doc(step.id)} (connector)\"\"\"",
                f"    step_def = WorkflowStep.model_validate(json.loads({step_json_repr}))",
                "    arguments = resolve_connector_arguments(step_def, variables)",
                "    result = await _client.call_tool(",
                f"        tool_name={_lit(tool_name)},",
                "        arguments=arguments,",
                "    )",
                "    return flatten_tool_result(result)",
                "",
            ]
            continue

        lines += [
            "@workflows.activity(",
            f"    start_to_close_timeout=timedelta(seconds={timeout_sec}),",
            "    retry_policy_max_attempts=3,",
            ")",
            f"async def {fn}(variables: Dict[str, Any]) -> Any:",
            f"    \"\"\"Activity for step: {_doc(step.id)} ({step.type.value})\"\"\"",
            f"    step_def = WorkflowStep.model_validate(json.loads({step_json_repr}))",
            "    result = await run_step(step_def, variables)",
            "    if result.status == \"failed\":",
            f"        raise Exception(result.error or {_lit(f'Step {step.id} failed')})",
            "    return result.output",
            "",
        ]

    # ── Pre-compute parallel groups ──────────────────────────────────────────
    parallel_groups: dict[str, list] = {}
    for step in workflow_def.steps:
        if step.parallel_group:
            parallel_groups.setdefault(step.parallel_group, []).append(step)

    # ── Workflow class ────────────────────────────────────────────────────────
    class_name = _to_class_name(workflow_def.name)
    display_name = workflow_def.name.replace("_", " ").title()
    description = workflow_def.description or display_name

    define_args = [
        f"    name={_lit(workflow_def.name)},",
        f"    workflow_display_name={_lit(display_name)},",
        f"    workflow_description={_lit(description)},",
        "    execution_timeout=timedelta(hours=24),",
    ]
    # on_behalf_of runs the workflow under the triggering user's identity, so a
    # connector resolves *their* credentials rather than the worker's. Only set
    # when connectors are involved — it changes who a deployment runs as.
    if connector_slots:
        define_args.append("    on_behalf_of=True,")

    lines += [
        "@workflows.workflow.define(",
        *define_args,
        ")",
    ]

    if connector_slots:
        lines.append(f"@uses_connectors({', '.join(connector_slots.values())})")

    lines += [
        f"class {class_name}:",
        f"    \"\"\"Durable workflow: {_doc(description)}\"\"\"",
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
        f"        \"\"\"Execute the {_doc(display_name)} workflow DAG.\"\"\"",
        "        # Use workflow.now() for determinism-safe timestamps",
        "        started_at = workflow.now()",
        "        variables = dict(input.variables)",
        f"        current_step: Optional[str] = {_lit(workflow_def.entry_step or None)}",
        "        visited: set = set()",
        "        outputs: Dict[str, Any] = {}",
        "",
        "        while current_step and len(visited) < 50:",
        "            if current_step in visited:",
        "                break  # cycle guard",
        "            visited.add(current_step)",
        "",
        # Every step branch below is an `elif`, so the chain is valid for any
        # number of steps — including none.
        "            if current_step is None:",
        "                break",
    ]

    # ── Step dispatcher inside entrypoint ─────────────────────────────────────
    emitted_parallel_groups: set[str] = set()

    for step in workflow_def.steps:
        # A parallel group is emitted once, as a single asyncio.gather() block,
        # matched by any of its members.
        if step.parallel_group and step.parallel_group in parallel_groups:
            if step.parallel_group in emitted_parallel_groups:
                continue
            emitted_parallel_groups.add(step.parallel_group)

            group_id = step.parallel_group
            group_steps = parallel_groups[group_id]
            condition_str = " or ".join(f"current_step == {_lit(gs.id)}" for gs in group_steps)

            lines += [
                f"            elif {condition_str}:",
                f"                # ── Parallel group: {_comment(group_id)} ──",
                f"                self._progress.append({_lit(f'__parallel_{group_id}:start')})",
                f"                # Fan-out: execute {len(group_steps)} steps concurrently",
                "                _parallel_results = await asyncio.gather(",
            ]
            for gs in group_steps:
                lines.append(
                    f"                    {_fn_name(workflow_def.name, gs.id)}(dict(variables)),"
                )
            lines += [
                "                )",
                "                # Fan-in: merge all parallel outputs",
                f"                _parallel_names = {_lit([gs.id for gs in group_steps])}",
                "                for _pname, _presult in zip(_parallel_names, _parallel_results):",
                "                    outputs[_pname] = _presult",
                "                    variables[f\"step_{_pname}_output\"] = _presult",
                "                    if isinstance(_presult, dict):",
                "                        variables.update(_presult)",
                "                    self._progress.append(_pname)",
                "                self._last_result = _parallel_results[-1]",
                "",
            ]

            # Advance to the shared join step
            if group_steps[0].next_steps:
                lines.append(f"                current_step = {_lit(group_steps[0].next_steps[0])}")
            else:
                lines.append("                current_step = None")
            lines.append("")
            continue

        # ── Sequential step ──────────────────────────────────────────────────
        lines += [
            f"            elif current_step == {_lit(step.id)}:",
            f"                self._progress.append({_lit(step.id)})",
            f"                output = await {_fn_name(workflow_def.name, step.id)}(variables)",
            f"                outputs[{_lit(step.id)}] = output",
            "                self._last_result = output",
            f"                variables[{_lit(f'step_{step.id}_output')}] = output",
            "                if isinstance(output, dict):",
            "                    variables.update(output)",
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
            lines.append(f"                current_step = {_lit(step.next_steps[0])}")
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

    code = "\n".join(lines)
    _assert_compiles(code, workflow_def.name)
    return code


def _assert_compiles(code: str, workflow_name: str) -> None:
    """Refuse to hand out a module the worker could not import."""
    try:
        compile(code, f"workflow_{workflow_name}.py", "exec")
    except SyntaxError as e:
        raise WorkflowCompileError(
            f"Generated module for '{workflow_name}' is not valid Python "
            f"(line {e.lineno}: {e.msg})."
        ) from e


def _to_class_name(workflow_name: str) -> str:
    """Convert snake_case workflow name to a PascalCase class name."""
    name = "".join(word.capitalize() for word in re.split(r"[\W_]+", workflow_name) if word)
    if not name or not name[0].isalpha():
        name = f"Workflow{name}"
    return name
