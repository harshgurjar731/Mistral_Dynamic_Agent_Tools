"""
Workflow Engine — DAG executor for multi-step agent pipelines.
Follows Mistral Beta Workflows API patterns.
Uses SQLite for workflow definition persistence.
Supports both sequential steps and parallel groups (asyncio.gather).
"""

import json
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, String, Text, DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings
from app.services.workflow_engine.models import (
    WorkflowDefinition, WorkflowRun, WorkflowStatus, StepResult, StepType,
)
from app.services.workflow_engine.step_runners import run_step
from app.services.workflow_engine import execution_logs

logger = logging.getLogger(__name__)

# ── SQLite persistence for workflow definitions ────────────────────────────

_Base = declarative_base()

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
_engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


class _WorkflowRecord(_Base):
    __tablename__ = "workflow_definitions"
    name = Column(String, primary_key=True, index=True)
    definition_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


# Create table if it doesn't exist
try:
    _Base.metadata.create_all(bind=_engine)
    logger.info("Workflow definitions table ready.")
except Exception as e:
    logger.error("Failed to create workflow_definitions table: %s", e)


# ── In-memory execution store (fast, ephemeral) ───────────────────────────
_execution_store: dict[str, WorkflowRun] = {}

# Stop requests for in-flight local runs, keyed by execution id.
# The value is the terminal status to settle on, which is what distinguishes a
# graceful cancel from a hard terminate: both stop the DAG walk at the next step
# boundary, but they are reported differently and a cancelled run keeps whatever
# partial output it had produced.
_stop_requests: dict[str, WorkflowStatus] = {}


def request_stop(execution_id: str, terminate: bool = False) -> bool:
    """Ask an in-flight local run to stop at the next step boundary.

    Returns False when there is nothing to stop. Steps are not interrupted
    mid-flight — an agent call already in progress runs to completion — because
    the step runners own external calls whose cancellation semantics we do not
    control.
    """
    run = _execution_store.get(execution_id)
    if not run or run.status not in (WorkflowStatus.PENDING, WorkflowStatus.RUNNING):
        return False
    _stop_requests[execution_id] = (
        WorkflowStatus.TERMINATED if terminate else WorkflowStatus.CANCELLED
    )
    logger.info(
        "Stop requested for local execution %s (%s)",
        execution_id, "terminate" if terminate else "cancel",
    )
    return True


def _consume_stop_request(execution_id: str) -> Optional[WorkflowStatus]:
    return _stop_requests.pop(execution_id, None)


def _running_result(step_id: str) -> StepResult:
    """A placeholder row published the moment a step starts.

    Overwritten in place by the real result when the step settles, so the list
    stays one row per step while still showing what is in flight.
    """
    return StepResult(
        step_id=step_id,
        status="running",
        started_at_ms=datetime.now(timezone.utc).timestamp() * 1000,
    )


# ── CRUD helpers ──────────────────────────────────────────────────────────

def save_workflow(definition: WorkflowDefinition) -> str:
    """Upsert a workflow definition to SQLite. Returns workflow name."""
    with _Session() as db:
        record = db.get(_WorkflowRecord, definition.name)
        if record:
            record.definition_json = definition.model_dump_json()
            record.updated_at = datetime.now(timezone.utc)
        else:
            record = _WorkflowRecord(
                name=definition.name,
                definition_json=definition.model_dump_json(),
            )
            db.add(record)
        db.commit()
    logger.info("Workflow '%s' saved to SQLite (%d steps)", definition.name, len(definition.steps))

    _annotate_workflow(definition)
    return definition.name


def _annotate_workflow(definition: WorkflowDefinition) -> None:
    """Classify the workflow against the ontology. Best effort.

    Done on save rather than publish so a draft is findable in the graph while
    it is still being built — and re-run on every save, because the steps are
    what the classification reads and those are exactly what editing changes.
    """
    try:
        from app.ontology import autotag

        # Step ids and their agent/tool references say what a workflow actually
        # does; its name is frequently generic ("demo1") and its description
        # optional.
        step_text = " ".join(
            " ".join(filter(None, [
                step.id.replace("_", " "),
                step.description or "",
                str(step.config.get("agent_id", "")),
                str(step.config.get("tool_name", "")),
                str(step.config.get("query_template", ""))[:200],
            ]))
            for step in definition.steps
        )
        autotag.annotate_workflow(
            definition.name,
            description=definition.description or "",
            step_text=step_text,
        )
    except Exception as e:
        logger.debug("Workflow annotation skipped for '%s': %s", definition.name, e)


def get_workflow(name: str) -> Optional[WorkflowDefinition]:
    """Fetch a workflow definition from SQLite by name."""
    with _Session() as db:
        record = db.get(_WorkflowRecord, name)
        if not record:
            return None
        try:
            return WorkflowDefinition(**json.loads(record.definition_json))
        except Exception as e:
            logger.error("Failed to deserialise workflow '%s': %s", name, e)
            return None


def list_workflows() -> list[WorkflowDefinition]:
    """List all workflow definitions from SQLite."""
    with _Session() as db:
        records = db.query(_WorkflowRecord).all()
        workflows = []
        for r in records:
            try:
                workflows.append(WorkflowDefinition(**json.loads(r.definition_json)))
            except Exception as e:
                logger.warning("Skipping malformed workflow record '%s': %s", r.name, e)
        return workflows


def delete_workflow(name: str) -> bool:
    """Delete a workflow definition from SQLite."""
    with _Session() as db:
        record = db.get(_WorkflowRecord, name)
        if not record:
            return False
        db.delete(record)
        db.commit()
        return True


def get_execution(execution_id: str) -> Optional[WorkflowRun]:
    """Get execution status by ID (in-memory)."""
    return _execution_store.get(execution_id)


def list_executions() -> list[WorkflowRun]:
    """List all in-memory workflow executions."""
    return list(_execution_store.values())


def list_executions_for_workflow(workflow_name: str) -> list[WorkflowRun]:
    """List executions for a specific workflow, sorted by start_time descending."""
    executions = [r for r in _execution_store.values() if r.workflow_name == workflow_name]
    return sorted(executions, key=lambda x: x.start_time or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


# ── DAG Execution (hybrid sequential + parallel) ─────────────────────────

async def execute_workflow(
    workflow_name: str,
    input_vars: dict,
    execution_id: Optional[str] = None,
    wait_for_result: bool = False,
) -> WorkflowRun:
    """
    Execute a workflow by processing its DAG.
    Supports both sequential steps and parallel groups (asyncio.gather).

    Parallel groups: steps sharing the same `parallel_group` value are
    executed concurrently. Each parallel branch receives a snapshot copy
    of variables to prevent race conditions. After all branches complete,
    their outputs are merged back into the shared variable store.
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise ValueError(f"Workflow '{workflow_name}' not found")

    exec_id = execution_id or str(uuid.uuid4())

    run = WorkflowRun(
        execution_id=exec_id,
        workflow_name=workflow_name,
        status=WorkflowStatus.RUNNING,
        start_time=datetime.now(timezone.utc),
        variables={**workflow.variables, **input_vars},
    )
    _execution_store[exec_id] = run
    # Clear any stop request left over from a previous run under this id, so a
    # replay is never killed by a stale flag.
    _stop_requests.pop(exec_id, None)

    # Everything logged from here on — including from the step runners and the
    # worker threads they offload to — is attributed to this execution and
    # tailed by the UI. The token is reset in the finally block below.
    execution_logs.install()
    exec_token = execution_logs.CURRENT_EXECUTION.set(exec_id)

    logger.info("Starting workflow '%s' (execution_id=%s)", workflow_name, exec_id)

    step_map = {step.id: step for step in workflow.steps}

    # Pre-compute parallel groups: {group_id: [step, step, ...]}
    parallel_groups: dict[str, list] = {}
    for step in workflow.steps:
        if step.parallel_group:
            parallel_groups.setdefault(step.parallel_group, []).append(step)

    current_step_id = workflow.entry_step
    visited: set[str] = set()

    # Workflow rules: always-on plus those selected for this workflow. Held in
    # a context var so the step runners — and the tool router beneath them —
    # see them without every signature having to carry them.
    from app.rules import engine as rules_engine, runtime as rules_runtime, store as rules_store

    wf_rules = rules_store.effective_rules("workflow", [r.rule_id for r in workflow.rules])
    wf_ctx, wf_token = rules_runtime.activate_workflow(wf_rules, workflow_name)
    # 50 is the engine's own safety cap; a step-limit rule can only lower it.
    max_steps = rules_engine.step_limit(wf_rules, 50)

    try:
        outcomes, refusal = rules_engine.check_workflow_input(input_vars, wf_rules)
        rules_runtime.record(outcomes, scope="workflow", subject_id=workflow_name, ctx=wf_ctx)
        if refusal:
            run.status = WorkflowStatus.FAILED
            run.result = {"error": refusal, "blocked_by_rule": True}
            run.end_time = datetime.now(timezone.utc)
            _execution_store[exec_id] = run
            logger.info("Workflow '%s' refused before its first step: %s", workflow_name, refusal)
            return run

        while current_step_id and len(visited) < max_steps:
            # Honour a cancel/terminate between steps. Checked here rather than
            # inside run_step so a stop can never leave a half-applied step.
            stop_status = _consume_stop_request(exec_id)
            if stop_status:
                run.status = stop_status
                run.end_time = datetime.now(timezone.utc)
                run.result = {
                    "stopped_at": current_step_id,
                    "reason": (
                        "Terminated by user"
                        if stop_status is WorkflowStatus.TERMINATED
                        else "Cancelled by user"
                    ),
                    "completed_steps": [r.step_id for r in run.step_results],
                }
                _execution_store[exec_id] = run
                logger.info(
                    "Workflow '%s' %s at step '%s' (execution_id=%s)",
                    workflow_name, stop_status.value.lower(), current_step_id, exec_id,
                )
                return run

            if current_step_id in visited:
                logger.warning("Cycle detected at step '%s', breaking", current_step_id)
                break

            step = step_map.get(current_step_id)
            if not step:
                raise ValueError(f"Step '{current_step_id}' not found in workflow")

            # ── Check if this step belongs to a parallel group ────────────
            if step.parallel_group and step.parallel_group in parallel_groups:
                group_id = step.parallel_group
                group_steps = parallel_groups[group_id]

                # Skip if we already executed this parallel group
                if all(s.id in visited for s in group_steps):
                    if group_steps[0].next_steps:
                        current_step_id = group_steps[0].next_steps[0]
                    else:
                        current_step_id = None
                    continue

                logger.info(
                    "Executing parallel group '%s' — %d steps: %s",
                    group_id, len(group_steps),
                    [s.id for s in group_steps],
                )

                # Publish a running marker for every branch up front so the UI
                # shows the whole group as in-flight, not a gap until the first
                # branch returns.
                slots: dict[str, int] = {}
                for s in group_steps:
                    slots[s.id] = len(run.step_results)
                    run.step_results.append(_running_result(s.id))

                # Each parallel branch gets a snapshot copy of variables
                # to prevent race conditions between concurrent steps
                async def _run_parallel_step(s, vars_snapshot):
                    # Each gather task gets its own context copy, so tagging the
                    # step here keeps concurrent branches' logs distinguishable.
                    execution_logs.CURRENT_STEP.set(s.id)
                    return s, await run_step(s, vars_snapshot)

                tasks = [
                    _run_parallel_step(s, dict(run.variables))
                    for s in group_steps
                ]

                results = await asyncio.gather(*tasks, return_exceptions=True)

                # Process parallel results
                group_failed = False
                for item in results:
                    if isinstance(item, Exception):
                        run.status = WorkflowStatus.FAILED
                        run.result = {"error": str(item), "failed_step": f"parallel_group:{group_id}"}
                        run.end_time = datetime.now(timezone.utc)
                        _execution_store[exec_id] = run
                        logger.error("Parallel group '%s' failed: %s", group_id, item)
                        group_failed = True
                        break

                    s, result = item
                    # Overwrite the running marker published before the gather,
                    # so the step keeps one row for its whole lifecycle.
                    result.started_at_ms = run.step_results[slots[s.id]].started_at_ms
                    run.step_results[slots[s.id]] = result
                    visited.add(s.id)

                    if result.status == "failed":
                        run.status = WorkflowStatus.FAILED
                        run.result = {"error": result.error, "failed_step": s.id}
                        run.end_time = datetime.now(timezone.utc)
                        _execution_store[exec_id] = run
                        logger.error(
                            "Workflow '%s' failed at parallel step '%s': %s",
                            workflow_name, s.id, result.error,
                        )
                        group_failed = True
                        break

                    # Store step output
                    if result.output is not None:
                        run.variables[f"step_{s.id}_output"] = (
                            json.dumps(result.output)
                            if isinstance(result.output, dict)
                            else result.output
                        )
                        if isinstance(result.output, dict):
                            run.variables.update(result.output)

                if group_failed:
                    return run

                # Advance to the shared join step (all parallel steps share next_steps)
                if group_steps[0].next_steps:
                    current_step_id = group_steps[0].next_steps[0]
                else:
                    current_step_id = None

                logger.info(
                    "Parallel group '%s' completed — advancing to '%s'",
                    group_id, current_step_id,
                )

            else:
                # ── Sequential execution (unchanged from original) ────────
                visited.add(current_step_id)
                logger.info("Executing step '%s' (type=%s)", step.id, step.type)

                slot = len(run.step_results)
                run.step_results.append(_running_result(step.id))

                step_token = execution_logs.CURRENT_STEP.set(step.id)
                try:
                    result = await run_step(step, run.variables)
                finally:
                    execution_logs.CURRENT_STEP.reset(step_token)

                result.started_at_ms = run.step_results[slot].started_at_ms
                run.step_results[slot] = result

                if result.status == "failed":
                    run.status = WorkflowStatus.FAILED
                    run.result = {"error": result.error, "failed_step": step.id}
                    run.end_time = datetime.now(timezone.utc)
                    _execution_store[exec_id] = run
                    logger.error("Workflow '%s' failed at step '%s': %s", workflow_name, step.id, result.error)
                    return run

                if result.output is not None:
                    # Always store under the canonical step output key
                    run.variables[f"step_{step.id}_output"] = (
                        json.dumps(result.output) if isinstance(result.output, dict) else result.output
                    )
                    # Also spread dict keys for direct variable access
                    if isinstance(result.output, dict):
                        run.variables.update(result.output)

                if step.type == StepType.CONDITION and isinstance(result.output, dict):
                    current_step_id = result.output.get("next_step")
                elif step.next_steps:
                    current_step_id = step.next_steps[0]
                else:
                    current_step_id = None

        # Stopped by a step-limit rule rather than by reaching the end. Without
        # such a rule, hitting the engine's own cap keeps its old behaviour.
        limit_rules = [r for r in wf_rules if r["type"] == "step_limit"]
        if current_step_id and len(visited) >= max_steps and limit_rules:
            message = f"Blocked by rule '{limit_rules[0]['name']}': stopped after {max_steps} steps."
            rules_runtime.record(
                [
                    {"rule_id": r["id"], "rule_name": r["name"], "checkpoint": "run_start",
                     "outcome": "blocked", "message": f"Stopped after {max_steps} steps.", "detail": None}
                    for r in limit_rules
                ],
                scope="workflow", subject_id=workflow_name, ctx=wf_ctx,
            )
            run.status = WorkflowStatus.FAILED
            run.result = {"error": message, "stopped_at": current_step_id, "blocked_by_rule": True}
            run.end_time = datetime.now(timezone.utc)
            _execution_store[exec_id] = run
            logger.warning("Workflow '%s' %s", workflow_name, message)
            return run

        run.status = WorkflowStatus.COMPLETED
        run.end_time = datetime.now(timezone.utc)

        if run.step_results:
            run.result = run.step_results[-1].output

        _execution_store[exec_id] = run
        logger.info("Workflow '%s' completed (execution_id=%s)", workflow_name, exec_id)

    except Exception as e:
        run.status = WorkflowStatus.FAILED
        run.result = {"error": str(e)}
        run.end_time = datetime.now(timezone.utc)
        _execution_store[exec_id] = run
        logger.error("Workflow '%s' failed: %s", workflow_name, e)

    finally:
        # Stop attributing this task's logging to the run. Without the reset a
        # long-lived task could keep writing into a finished execution's buffer.
        execution_logs.CURRENT_EXECUTION.reset(exec_token)
        rules_runtime.reset_workflow(wf_token)

    return run
