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
    result = await _with_argument_shapes(definition, result)

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


#: The tool service's activity listing, reused briefly: live validation runs on
#: every builder change and must not fetch it each time.
_LISTING_TTL = 30.0
_listing: dict = {"at": 0.0, "catalog": {}}


async def _activity_catalog() -> dict:
    import time

    from app.services.workflow_engine.argument_shapes import catalog_from_listing
    from app.services.tool_resolver import tool_resolver

    now = time.monotonic()
    if now - _listing["at"] > _LISTING_TTL:
        # Bounded: validation must stay quick when the tool service is down,
        # and a failed lookup is remembered for the same TTL (then the check
        # falls back to the requirements the steps were planned with).
        _listing["at"] = now
        try:
            tools = await asyncio.wait_for(tool_resolver.list_tools(), timeout=3.0)
        except Exception as e:  # noqa: BLE001
            logger.debug("Activity listing unavailable for validation: %s", e)
            tools = []
        if tools:  # an empty listing means the service is unreachable, not "no activities"
            _listing["catalog"] = catalog_from_listing(tools)
    return _listing["catalog"]


async def _with_argument_shapes(definition: WorkflowDefinition, result: ValidationResponse) -> ValidationResponse:
    """Add argument-shape errors (activity steps fed values their input schema rejects)."""
    from app.services.workflow_engine.argument_shapes import check_argument_shapes
    from app.services.workflow_engine.models import ValidationIssue

    try:
        catalog = await _activity_catalog()
        found = check_argument_shapes(definition.model_dump(mode="json"), catalog)
    except Exception as e:  # noqa: BLE001 — never block validation on the listing
        logger.warning("Argument-shape check skipped: %s", e)
        return result
    known = {(i.code, i.step_id, i.field) for i in result.issues}
    extra = [ValidationIssue(**i) for i in found if (i["code"], i["step_id"], i["field"]) not in known]
    if not extra:
        return result
    issues = [*result.issues, *extra]
    return ValidationResponse(
        valid=not any(i.severity == "error" for i in issues),
        issues=issues,
        error_count=sum(1 for i in issues if i.severity == "error"),
        warning_count=sum(1 for i in issues if i.severity == "warning"),
    )
