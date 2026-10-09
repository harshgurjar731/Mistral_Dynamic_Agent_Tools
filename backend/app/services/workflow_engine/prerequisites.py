"""
Run prerequisites — what must be true before a workflow can run successfully.

Checked after a workflow is created and before every run. A run is refused
while any *blocking* item is unmet (``POST /workflows/{name}/execute`` answers
409 with this report), so a workflow never starts only to fail on a step whose
activity was never built, whose agent was deleted, or whose connector was
never connected.

Each item says what is wrong, how to fix it (``instructions``), and where to
do it (``action``):

    {"type": "link",    "to": "/connectors/abc", "label": "Connect"}
    {"type": "rebuild", "step_id": "gst",       "label": "Build it now"}
    {"type": "approve", "tool_id": 12,          "label": "Approve version 3"}

Statuses: ``met`` · ``unmet`` (blocks the run) · ``warning`` (the run can start,
but may not do what is expected) · ``info``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep

logger = logging.getLogger(__name__)


def _item(key: str, category: str, title: str, status: str, *, detail: str = "",
          step_id: Optional[str] = None, instructions: Optional[list[str]] = None,
          action: Optional[dict] = None) -> dict:
    return {"id": key, "category": category, "title": title, "status": status,
            "blocking": status == "unmet", "detail": detail, "step_id": step_id,
            "instructions": instructions or [], "action": action}


def _link(to: str, label: str) -> dict:
    return {"type": "link", "to": to, "label": label}


async def check_prerequisites(definition: WorkflowDefinition, client: Any) -> dict:
    """The prerequisite report for ``definition``. Never raises."""
    name = definition.name
    builder = _link(f"/workflows/{name}/edit", "Open in the builder")
    items: list[dict] = []

    items.extend(_validation_items(definition, builder))

    tool_steps = [s for s in definition.steps if s.type == StepType.TOOL]
    agent_steps = [s for s in definition.steps if s.type == StepType.AGENT]
    connector_steps = [s for s in definition.steps if s.type == StepType.CONNECTOR]

    tool_service_up = True
    if tool_steps:
        from app.services.tool_resolver import tool_resolver

        tool_service_up = await tool_resolver.health_check()
        items.append(_item(
            "service.tools", "service", "Tool service is running",
            "met" if tool_service_up else "unmet",
            detail="" if tool_service_up else
            f"The tool service at {tool_resolver.base_url} is not answering; every activity step "
            f"runs there.",
            instructions=[] if tool_service_up else [
                "Start the tool service (for example `docker compose up -d tool-service`).",
                "Check that the backend's TOOL_SERVICE_URL points at it.",
                "Then check the prerequisites again.",
            ],
            action=None if tool_service_up else _link("/health", "Open system health"),
        ))

    checks = [*(_activity_items(s) for s in tool_steps if tool_service_up),
              *(_agent_items(s, client, builder) for s in agent_steps),
              *(_connector_items(s, builder) for s in connector_steps)]
    for result in await asyncio.gather(*checks, return_exceptions=True):
        if isinstance(result, Exception):
            logger.warning("Prerequisite check raised: %s", result)
            items.append(_item("check.error", "service", "A prerequisite could not be checked",
                               "warning", detail=f"{type(result).__name__}: {result}"))
        else:
            items.extend(result)

    items.extend(_input_items(definition))
    if not definition.is_deployed:
        items.append(_item(
            "deploy.registered", "deployment", "Registered on the Mistral server", "warning",
            detail="Not registered: runs use the local engine instead of the Mistral worker.",
            instructions=["Register (publish) the workflow from its page once every "
                          "prerequisite above is met."],
            action=_link(f"/workflows/{name}", "Open the workflow"),
        ))

    blocking = [i for i in items if i["blocking"]]
    return {
        "workflow_name": name,
        "ready": not blocking,
        "blocking_count": len(blocking),
        "warning_count": sum(1 for i in items if i["status"] == "warning"),
        "items": items,
    }


# ── Definition ──────────────────────────────────────────────────────────────


def _validation_items(definition: WorkflowDefinition, builder: dict) -> list[dict]:
    from app.services.workflow_engine.validation import validate_workflow

    result = validate_workflow(definition)
    errors = [i for i in result.issues if i.severity == "error"]
    if not errors:
        return [_item("definition.valid", "definition", "Workflow definition is valid", "met")]
    return [
        _item(f"definition.{i.code}.{i.step_id or n}", "definition", i.message, "unmet",
              step_id=i.step_id,
              instructions=[f"Open the workflow in the builder"
                            f"{f' and select step {i.step_id!r}' if i.step_id else ''}, "
                            f"fix it, and save."],
              action=builder)
        for n, i in enumerate(errors)
    ]


def _input_items(definition: WorkflowDefinition) -> list[dict]:
    fields = [f for f in (definition.input_schema or []) if isinstance(f, dict) and f.get("name")]
    required = [f["name"] for f in fields if f.get("required", True) is not False]
    if not required:
        return []
    return [_item("inputs.required", "inputs", "Inputs to provide when running", "info",
                  detail=", ".join(required),
                  instructions=["You will be asked for these when you start the run; "
                                "a run without them is refused."])]


# ── Activity steps ─────────────────────────────────────────────────────────


async def _activity_items(step: WorkflowStep) -> list[dict]:
    from app.services.tool_resolver import tool_resolver

    config = step.config or {}
    name = str(config.get("tool_name") or "").strip()
    title = f"Activity for step '{step.id}' is built"
    key = f"activity.{step.id}"
    requirement = config.get("code_requirement") if isinstance(config.get("code_requirement"), dict) else None
    rebuild = {"type": "rebuild", "step_id": step.id, "label": "Build it now"}

    if not name:
        return [_item(key, "activity", title, "unmet", step_id=step.id,
                      detail="No activity is bound to this step.",
                      instructions=["Build one from the step description with 'Build it now', or",
                                    "bind an existing activity to the step in the builder."],
                      action=rebuild)]

    versions = await tool_resolver.get_tool_versions(name)
    pinned = config.get("tool_version")
    approved = [v for v in versions if v.get("status") == "approved"]
    usable = [v for v in approved
              if (v.get("version_no") == pinned if pinned is not None else v.get("is_active"))]
    items: list[dict] = []

    if usable:
        version = usable[0]
        items.append(_item(key, "activity", title, "met", step_id=step.id,
                           detail=f"'{name}' version {version.get('version_no')} is approved.",
                           action=_link(f"/workflows/activities/{version.get('id')}",
                                        "View activity")))
    else:
        pending = [v for v in versions if v.get("status") == "pending_approval"]
        if pending:
            v = pending[0]
            items.append(_item(
                key, "activity", title, "unmet", step_id=step.id,
                detail=f"'{name}' version {v.get('version_no')} was built but is waiting for "
                       f"approval{' (it declares side effects, so a person must review it)' if v.get('review_required') else ''}.",
                instructions=["Review its code and test results on the activity page.",
                              "Approve it there, or use 'Approve' here if you have reviewed it."],
                action={"type": "approve", "tool_id": v.get("id"),
                        "label": f"Approve version {v.get('version_no')}",
                        "to": f"/workflows/activities/{v.get('id')}"}))
        elif pinned is not None and approved:
            items.append(_item(
                key, "activity", title, "unmet", step_id=step.id,
                detail=f"The step is pinned to version {pinned} of '{name}', which is not approved.",
                instructions=["Rebuild it from the step's stored specification with "
                              "'Build it now', or re-pin the step in the builder."],
                action=rebuild))
        else:
            items.append(_item(
                key, "activity", title, "unmet", step_id=step.id,
                detail=f"Activity '{name}' does not exist on the tool service"
                       + (" — it was deferred or could not be built during planning."
                          if requirement else "."),
                instructions=(["Build it from the specification planning checked, with "
                               "'Build it now'."] if requirement else
                              ["Build it from the step description with 'Build it now', or",
                               "write the code by hand on the Activities page under the "
                               f"name '{name}', then check again."]),
                action=rebuild))

    secrets = [s for s in (requirement or {}).get("secrets") or [] if s]
    if secrets:
        status = await tool_resolver.secrets_status(secrets)
        if status is None:
            # An older tool service without /secrets/status: say so, do not block.
            return [*items, _item(
                f"secret.{step.id}", "secret", f"Secrets for '{name}' are configured", "warning",
                step_id=step.id, detail=f"Could not check {', '.join(secrets)} on the tool service.",
                instructions=[f"Make sure {', '.join(secrets)} are listed in the tool service's "
                              f"SECRETS_ALLOWLIST and set in its environment.",
                              "Rebuild the tool service to enable this check."])]
        for secret in secrets:
            info = status.get(secret) or {}
            ok = info.get("allowed") and info.get("set")
            items.append(_item(
                f"secret.{step.id}.{secret}", "secret", f"Secret {secret} is available to '{name}'",
                "met" if ok else "unmet", step_id=step.id,
                detail="" if ok else
                ("It is not in the tool service's SECRETS_ALLOWLIST. " if not info.get("allowed") else "")
                + ("It is not set in the tool service's environment." if not info.get("set") else ""),
                instructions=[] if ok else [
                    f"Add {secret} to SECRETS_ALLOWLIST in the tool service's .env "
                    f"(comma-separated).",
                    f"Set {secret}=<value> in the same .env (or the container environment).",
                    "Restart the tool service, then check again.",
                ]))
    return items


# ── Agent steps ─────────────────────────────────────────────────────────────


async def _agent_items(step: WorkflowStep, client: Any, builder: dict) -> list[dict]:
    config = step.config or {}
    agent_id = str(config.get("agent_id") or "").strip()
    key, title = f"agent.{step.id}", f"Agent for step '{step.id}' exists"
    if not agent_id:
        if config.get("model"):
            return [_item(key, "agent", f"Step '{step.id}' uses an inline model", "met",
                          step_id=step.id, detail=str(config.get("model")))]
        return [_item(key, "agent", title, "unmet", step_id=step.id,
                      detail="No agent is bound to this step.",
                      instructions=["Create an agent for this step on the Agents page, or pick "
                                    "an existing one,", "then bind it to the step in the builder."],
                      action=builder)]
    try:
        agent = await asyncio.to_thread(client.beta.agents.get, agent_id=agent_id)
    except Exception as e:  # noqa: BLE001
        missing = "404" in str(e) or "not found" in str(e).lower()
        return [_item(key, "agent", title, "unmet", step_id=step.id,
                      detail=(f"Agent {agent_id} no longer exists." if missing
                              else f"Could not reach the agent: {e}"),
                      instructions=["Create a replacement on the Agents page (or pick another),",
                                    "then bind it to this step in the builder."],
                      action=builder if missing else _link(f"/agents/{agent_id}", "Open agent"))]

    agent_name = getattr(agent, "name", agent_id)
    items = [_item(key, "agent", title, "met", step_id=step.id, detail=str(agent_name),
                   action=_link(f"/agents/{agent_id}", "View agent"))]
    items.extend(await _agent_attachment_items(step, agent_id, str(agent_name)))
    return items


async def _agent_attachment_items(step: WorkflowStep, agent_id: str, agent_name: str) -> list[dict]:
    """Connectors the agent cannot use yet, and libraries it searches that are empty."""
    from app.services import connector_service, library_service
    from app.services.agent_service import current_attachments

    attached = await asyncio.to_thread(current_attachments, agent_id)
    items: list[dict] = []
    for ref in attached.get("connectors") or []:
        cid = ref.get("connector_id")
        try:
            connector = await connector_service.get_connector(cid)
        except Exception:  # noqa: BLE001
            connector = None
        if connector and connector.get("is_authenticated"):
            continue
        label = (connector or {}).get("title") or cid
        items.append(_item(
            f"agent.{step.id}.connector.{cid}", "connector",
            f"Connector '{label}' used by {agent_name} is connected", "warning", step_id=step.id,
            detail=("It is not authenticated, so the agent's calls to it will fail."
                    if connector else "It no longer exists."),
            instructions=["Open the connector and connect it (sign in or add credentials).",
                          "The run can start without it, but this agent cannot use it."],
            action=_link(f"/connectors/{cid}", "Connect")))

    library_ids = attached.get("document_library_ids") or []
    if library_ids:
        try:
            libraries = {lib["id"]: lib for lib in await library_service.list_libraries()}
        except Exception:  # noqa: BLE001
            libraries = {}
        for lid in library_ids:
            lib = libraries.get(lid)
            if lib and lib.get("document_count"):
                continue
            items.append(_item(
                f"agent.{step.id}.library.{lid}", "library",
                f"Library '{(lib or {}).get('name') or lid}' searched by {agent_name} has documents",
                "warning", step_id=step.id,
                detail=("It is empty, so the agent will find nothing in it." if lib
                        else "It no longer exists."),
                instructions=["Open the library and upload the documents this agent should use.",
                              "The run can start without them, but answers will not be grounded."],
                action=_link(f"/libraries/{lid}", "Upload documents")))
    return items


# ── Connector steps ─────────────────────────────────────────────────────────


async def _connector_items(step: WorkflowStep, builder: dict) -> list[dict]:
    from app.services import connector_service

    config = step.config or {}
    cid = str(config.get("connector_id") or config.get("connector_name") or "").strip()
    key, title = f"connector.{step.id}", f"Connector for step '{step.id}' is connected"
    if not cid or not config.get("tool_name"):
        return [_item(key, "connector", title, "unmet", step_id=step.id,
                      detail="The step has no connector or connector tool chosen.",
                      instructions=["Choose the connector and its tool for this step in the builder."],
                      action=builder)]
    try:
        connector = await connector_service.get_connector(cid)
    except Exception as e:  # noqa: BLE001
        return [_item(key, "connector", title, "unmet", step_id=step.id,
                      detail=f"Connector {cid} could not be found: {e}",
                      instructions=["Pick an existing connector for this step in the builder, or "
                                    "add the connector on the Connectors page."],
                      action=builder)]
    label = connector.get("title") or cid
    items = []
    if not connector.get("active"):
        # A warning, not a block: the connector record reports a missing
        # "active" flag as false, so this cannot be trusted to stop a run.
        items.append(_item(f"{key}.active", "connector", f"Connector '{label}' is active",
                           "warning", step_id=step.id,
                           detail="It is reported as turned off; calls to it may be refused.",
                           instructions=["Open the connector and activate it if it is off."],
                           action=_link(f"/connectors/{cid}", "Open connector")))
    if not connector.get("is_authenticated") and connector.get("auth_type") not in (None, "", "none"):
        return [*items, _item(
            key, "connector", title, "unmet", step_id=step.id,
            detail=f"Connector '{label}' is not connected"
                   + (f" (credentials '{config['credentials_name']}')"
                      if config.get("credentials_name") else "") + ".",
            instructions=["Open the connector and click Connect to sign in, or add "
                          "credentials at the scope this workflow runs under.",
                          "Come back and check again."],
            action=_link(f"/connectors/{cid}", "Connect"))]
    return [*items, _item(key, "connector", title, "met", step_id=step.id, detail=str(label),
                          action=_link(f"/connectors/{cid}", "View connector"))]
