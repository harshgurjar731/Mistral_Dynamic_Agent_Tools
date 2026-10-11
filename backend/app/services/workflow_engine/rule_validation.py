"""
Structural validation plus the workflow rules (see ``app.rules``).

The two are separate because they need different things: structural checks
read only the definition, while rules need live inventory to know what each
agent can actually reach. Inventory failures degrade to the structural result
rather than failing the caller — a validator that goes down when the
Connectors API hiccups would block saving.

Shared by the workflow routes (live validation, publish), the revision
pipeline and the planner's review step, so a workflow is judged the same way
wherever it is changed.
"""

from __future__ import annotations

import asyncio
import logging

from app.services.workflow_engine.models import ValidationResponse, WorkflowDefinition
from app.services.workflow_engine.validation import validate_workflow

logger = logging.getLogger(__name__)


async def validate_with_rules(definition: WorkflowDefinition, *, client=None,
                              record: bool = False) -> ValidationResponse:
    """``record`` stores each rule's outcome as a rule event.

    Only publish sets it: live validation runs on every builder keystroke, and
    recording those would bury the history people actually want to read.
    """
    result = validate_workflow(definition)

    try:
        from app.dependencies import get_mistral_client
        from app.rules import engine as rules_engine, runtime as rules_runtime, store as rules_store
        from app.services import agent_service, connector_service

        client = client or get_mistral_client()
        agents_resp, connectors_resp = await asyncio.gather(
            agent_service.list_agents(client, page=0, page_size=200),
            connector_service.list_connectors(),
            return_exceptions=True,
        )

        agents_by_id = (
            {a["id"]: a for a in agents_resp.get("items", []) if a.get("id")}
            if not isinstance(agents_resp, Exception) else {}
        )
        connectors_by_id = (
            {c["id"]: c for c in connectors_resp.get("items", []) if c.get("id")}
            if not isinstance(connectors_resp, Exception) else {}
        )

        rules = rules_store.effective_rules(
            "workflow", [r.rule_id for r in definition.rules], subject_id=definition.name
        )
        extra = rules_engine.check_workflow(definition, agents_by_id, connectors_by_id, rules)
        if record:
            rules_runtime.record(
                rules_engine.workflow_validation_outcomes(rules, extra),
                scope="workflow", subject_id=definition.name,
            )
        if extra:
            issues = [*result.issues, *extra]
            return ValidationResponse(
                valid=not any(i.severity == "error" for i in issues),
                issues=issues,
                error_count=sum(1 for i in issues if i.severity == "error"),
                warning_count=sum(1 for i in issues if i.severity == "warning"),
            )
    except Exception as e:
        logger.warning("Workflow rules skipped: %s", e)

    return result
