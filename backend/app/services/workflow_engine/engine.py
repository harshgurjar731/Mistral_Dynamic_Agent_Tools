"""
Workflow Engine — DAG executor for multi-step agent pipelines.
Follows Mistral Beta Workflows API patterns.
Uses SQLite for workflow definition persistence.
"""

import json
import uuid
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
    return definition.name


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


# ── DAG Execution ─────────────────────────────────────────────────────────

async def execute_workflow(
    workflow_name: str,
    input_vars: dict,
    execution_id: Optional[str] = None,
    wait_for_result: bool = False,
) -> WorkflowRun:
    """
    Execute a workflow by processing its DAG in topological order.
    Follows Mistral Workflows API response structure.
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

    logger.info("Starting workflow '%s' (execution_id=%s)", workflow_name, exec_id)

    step_map = {step.id: step for step in workflow.steps}
    current_step_id = workflow.entry_step
    visited = set()
    max_steps = 50  # safety cap

    try:
        while current_step_id and len(visited) < max_steps:
            if current_step_id in visited:
                logger.warning("Cycle detected at step '%s', breaking", current_step_id)
                break

            visited.add(current_step_id)
            step = step_map.get(current_step_id)

            if not step:
                raise ValueError(f"Step '{current_step_id}' not found in workflow")

            logger.info("Executing step '%s' (type=%s)", step.id, step.type)

            result = await run_step(step, run.variables)
            run.step_results.append(result)

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

    return run
