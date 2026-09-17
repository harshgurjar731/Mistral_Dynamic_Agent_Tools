"""
Workflow Routes — CRUD and execution for dynamic workflows.

Execution routing strategy:
  1. If workflow is_deployed → try Mistral server execution first
  2. Gracefully fall back to local DAG engine if server is unreachable
  3. Source field in response tells the UI which path was taken
"""

import asyncio
import logging
import os
import time
from collections import Counter
import httpx
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.dependencies import get_mistral_client
from app.services.workflow_engine.models import (
    CreateWorkflowRequest, ExecuteWorkflowRequest,
    WorkflowExecutionResponse, WorkflowListResponse, WorkflowDefinition,
    UpdateWorkflowRequest, ValidateWorkflowRequest, ValidationResponse,
    ScriptResponse, BuilderCatalogResponse, CatalogAgent, CatalogTool,
    CatalogConnector, CatalogDomain,
)
from app.services.workflow_engine.engine import (
    save_workflow, get_workflow, list_workflows, execute_workflow,
)
from app.services.workflow_engine.validation import validate_workflow, format_errors
from app.services import workflow_planner
from app.services.mistral_workflows_compiler import compile_workflow_to_python

logger = logging.getLogger(__name__)

# ── Worker deployment name — must match what mistral_worker.py uses ───────────
# This is the task_queue your worker polls. Execution must target the same name.
WORKER_DEPLOYMENT = os.environ.get("DEPLOYMENT_NAME", "default")

router = APIRouter(tags=["Workflows"])


# ── Mistral API proxy helpers ─────────────────────────────────────────────────

def _mistral_headers() -> dict:
    return {"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"}


def _mistral_get(path: str, timeout: float = 8.0):
    try:
        return httpx.get(f"https://api.mistral.ai{path}", headers=_mistral_headers(), timeout=timeout)
    except Exception:
        return None


def _mistral_post(path: str, body: dict, timeout: float = 30.0):
    try:
        return httpx.post(
            f"https://api.mistral.ai{path}",
            headers={**_mistral_headers(), "Content-Type": "application/json"},
            json=body,
            timeout=timeout,
        )
    except Exception:
        return None


def _mistral_put(path: str, body: dict | None = None, timeout: float = 30.0):
    try:
        kwargs = {
            "headers": _mistral_headers(),
            "timeout": timeout,
        }
        if body is not None:
            kwargs["headers"]["Content-Type"] = "application/json"
            kwargs["json"] = body
            
        return httpx.put(f"https://api.mistral.ai{path}", **kwargs)
    except Exception:
        return None


def _get_mistral_workflow_id(workflow_name: str) -> str | None:
    """Fetch the Mistral server workflow ID for the given workflow name."""
    local = get_workflow(workflow_name)
    if local and local.id and local.is_deployed:
        return local.id  # fast-path from local cache

    resp = _mistral_get("/v1/workflows")
    if resp and resp.status_code == 200:
        for wf in resp.json().get("workflows", []):
            if wf.get("name") == workflow_name:
                return wf.get("id")
    return None


# ── Plan ──────────────────────────────────────────────────────────────────────

class PlanWorkflowRequest(BaseModel):
    goal: str


@router.post("/workflows/plan")
async def plan_workflow_endpoint(request: PlanWorkflowRequest):
    """
    Stream a multi-phase workflow planning process via SSE.
    Phases: Analyse → Synthesise tools → Create agents → Build DAG
            → Save → Compile → Register → le Chat
    """
    client = get_mistral_client()
    return StreamingResponse(
        workflow_planner.plan_workflow_stream(client=client, goal=request.goal),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("/workflows")
async def create_workflow(request: CreateWorkflowRequest):
    """Create a new workflow definition.

    Validates the DAG and refuses to overwrite an existing workflow — use
    ``PUT /workflows/{name}`` to update. Saving does **not** publish: the
    definition is stored as a draft until ``POST /workflows/{name}/publish``.
    """
    definition = request.definition

    if get_workflow(definition.name):
        raise HTTPException(
            status_code=409,
            detail=f"Workflow '{definition.name}' already exists. Use PUT to update it.",
        )

    result = validate_workflow(definition)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail=f"Workflow definition is invalid: {format_errors(result)}",
        )

    # A freshly created draft has never been published.
    definition.published_hash = None
    definition.is_deployed = False

    name = save_workflow(definition)

    # save_workflow already applies the lexical heuristics. This adds the
    # LLM pass, which is what a hand-built workflow needs: its steps were named
    # by a person and may describe the work without ever using a vocabulary term.
    from app.services.agent_service import schedule_classification
    from app.ontology.vocab import SubjectType

    schedule_classification(
        get_mistral_client(),
        subject_type=SubjectType.WORKFLOW.value,
        subject_id=name,
        name=name.replace("_", " "),
        description=definition.description or "",
        instructions=" ".join(
            f"{s.id}: {s.description or ''}" for s in definition.steps
        )[:2000],
    )

    return {
        "workflow_name": name,
        "message": "Workflow created",
        "steps": len(definition.steps),
        "warnings": [i.model_dump() for i in result.issues if i.severity == "warning"],
    }


@router.put("/workflows/{workflow_name}")
async def update_workflow(workflow_name: str, request: UpdateWorkflowRequest):
    """Draft-save an existing workflow definition.

    Deployment bookkeeping (``id``, ``is_deployed``, ``published_hash``) is
    carried over from the stored record rather than trusted from the client, so
    a save can never silently claim a workflow is published. Whether the edit
    diverges from what is live is then derived by comparing hashes.
    """
    existing = get_workflow(workflow_name)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    definition = request.definition

    if definition.name != workflow_name:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Workflow name cannot be changed on update "
                f"('{workflow_name}' → '{definition.name}'). The name is baked into the "
                "compiled module and the Mistral registration."
            ),
        )

    result = validate_workflow(definition)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail=f"Workflow definition is invalid: {format_errors(result)}",
        )

    # Preserve server-owned fields.
    definition.id = existing.id
    definition.is_deployed = existing.is_deployed
    definition.published_hash = existing.published_hash
    definition.archived = existing.archived

    # Back-fill a baseline for workflows deployed before publish-hash tracking
    # existed: what is currently stored is, by definition, what is live. Without
    # this their first edit would compare against nothing and look already-published.
    if definition.is_deployed and not definition.published_hash:
        definition.published_hash = existing.semantic_hash()

    save_workflow(definition)

    return {
        "workflow_name": workflow_name,
        "message": "Workflow saved",
        "steps": len(definition.steps),
        "is_deployed": definition.is_deployed,
        "has_unpublished_changes": definition.has_unpublished_changes,
        "warnings": [i.model_dump() for i in result.issues if i.severity == "warning"],
    }


# ── Builder support ───────────────────────────────────────────────────────────

async def _validate_with_rules(definition, *, record: bool = False) -> ValidationResponse:
    """Structural validation plus the workflow rules (see ``app.rules``).

    The two are separate because they need different things: structural checks
    read only the definition, while rules need live inventory to know what each
    agent can actually reach. Inventory failures degrade to the structural
    result rather than failing the request — a validator that goes down when
    the Connectors API hiccups would block saving.

    ``record`` stores each rule's outcome as a rule event. Only publish sets it:
    live validation runs on every builder keystroke, and recording those would
    bury the history people actually want to read.
    """
    result = validate_workflow(definition)

    try:
        from app.rules import engine as rules_engine, runtime as rules_runtime, store as rules_store
        from app.services import agent_service, connector_service

        client = get_mistral_client()
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

        rules = rules_store.effective_rules("workflow", [r.rule_id for r in definition.rules])
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


@router.post("/workflows/validate", response_model=ValidationResponse)
async def validate_workflow_endpoint(request: ValidateWorkflowRequest):
    """Validate a definition without persisting it.

    Used for live feedback in the visual builder, so it always returns 200 —
    the issue list is the payload, not an error condition.
    """
    return await _validate_with_rules(request.definition)


@router.post("/workflows/script/preview", response_model=ScriptResponse)
async def preview_script(request: ValidateWorkflowRequest):
    """Compile an unsaved definition to Mistral Workflows SDK Python.

    Lets the builder show the generated script for a workflow that has not been
    saved yet. Nothing is written to disk.
    """
    definition = request.definition
    result = validate_workflow(definition)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot compile an invalid workflow: {format_errors(result)}",
        )

    code = compile_workflow_to_python(definition)
    return ScriptResponse(
        workflow_name=definition.name,
        code=code,
        line_count=code.count("\n") + 1,
        stale=True,  # never written to disk
    )


@router.get("/workflows/{workflow_name}/script", response_model=ScriptResponse)
async def get_workflow_script(workflow_name: str):
    """Return the compiled script for a saved workflow.

    ``stale`` reports whether the file currently on disk — the one the worker
    has loaded — differs from what the stored definition compiles to. That is
    the signal that the workflow needs publishing.
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    code = compile_workflow_to_python(workflow)

    stale = True
    file_path = os.path.join(
        os.path.abspath(os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)),
        f"workflow_{workflow_name}.py",
    )
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                stale = f.read() != code
        except OSError as e:
            logger.warning("Could not read compiled workflow at %s: %s", file_path, e)

    return ScriptResponse(
        workflow_name=workflow_name,
        code=code,
        line_count=code.count("\n") + 1,
        stale=stale,
    )


@router.post("/workflows/{workflow_name}/publish")
async def publish_workflow(workflow_name: str):
    """Compile, deploy and register a saved workflow on Mistral.

    This is the explicit promotion step: saving keeps edits local, publishing
    makes them live. On success the definition's ``published_hash`` is stamped
    so subsequent edits are detectable as unpublished.
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    # Publishing is the gate that matters — a workflow rule set to "block"
    # must not reach a deployed worker, even if it was saved as a draft while
    # it was still being built.
    result = await _validate_with_rules(workflow, record=True)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot publish an invalid workflow: {format_errors(result)}",
        )

    # Reuse the register path — it writes the compiled module the worker runs
    # and waits for the worker to register it with Mistral.
    registration = await register_workflow_on_mistral(workflow_name)
    action = registration.get("server_action")

    # Only a genuine failure is fatal. `pending_worker` means the module is on
    # disk and the worker simply has not finished reloading — the publish did
    # succeed, so failing here would be wrong (and was the cause of the 502).
    if action == "error":
        raise HTTPException(
            status_code=502,
            detail=(
                "Workflow compiled locally but could not be registered on Mistral: "
                f"{registration.get('detail', 'unknown error')}"
            ),
        )

    # Re-read: register_workflow_on_mistral() persists id / is_deployed / hash.
    published = get_workflow(workflow_name) or workflow
    pending = action == "pending_worker"

    logger.info(
        "Workflow '%s' published (action=%s, hash=%s)",
        workflow_name, action, (published.published_hash or "")[:12],
    )

    return {
        **registration,
        "message": (
            "Workflow published — waiting for the worker to finish registering it."
            if pending
            else "Workflow published"
        ),
        "registration_pending": pending,
        "published_hash": published.published_hash,
        "has_unpublished_changes": False,
        "warnings": [i.model_dump() for i in result.issues if i.severity == "warning"],
    }


@router.get("/workflows/builder/catalog", response_model=BuilderCatalogResponse)
async def get_builder_catalog():
    """Everything the builder palette needs, in one round trip.

    Agents, tools and connectors are fetched concurrently; any of them failing
    degrades to an empty list rather than failing the whole palette, so the
    builder still opens when the Tool Service or the Connectors API is down.

    Connector *tools* are deliberately not expanded here — that would be one
    extra API call per connector on every builder open. The inspector fetches
    them for the selected connector instead.
    """
    from app.services import agent_service, connector_service
    from app.services.tool_resolver import tool_resolver
    from app.services.tool_registry import ALL_TOOLS, BUILTIN_TOOLS

    client = get_mistral_client()

    agents_resp, tool_records, connector_resp = await asyncio.gather(
        agent_service.list_agents(client, page=0, page_size=200),
        tool_resolver.list_tools(),
        connector_service.list_connectors(),
        return_exceptions=True,
    )

    agents: list[CatalogAgent] = []
    # Domain annotations for the whole page in one query, so faceting the
    # palette costs one round trip rather than one per agent.
    agent_domains: dict[str, list[str]] = {}
    if not isinstance(agents_resp, Exception):
        try:
            from app.ontology import store as ontology_store
            from app.ontology.vocab import Predicate, SubjectType

            ids = [a["id"] for a in agents_resp.get("items", []) if a.get("id")]
            bulk = ontology_store.annotations_for_many(SubjectType.AGENT.value, ids)
            agent_domains = {
                subject: annotations.get(Predicate.SERVES_DOMAIN.value, [])
                for subject, annotations in bulk.items()
            }
        except Exception as e:
            logger.warning("Builder catalog: could not load domain annotations: %s", e)

    if isinstance(agents_resp, Exception):
        logger.warning("Builder catalog: could not list agents: %s", agents_resp)
    else:
        for item in agents_resp.get("items", []):
            if not item.get("id"):
                continue
            raw_tools = item.get("tools") or []
            tool_names: list[str] = []
            for t in raw_tools:
                if isinstance(t, dict):
                    tool_names.append(
                        t.get("function", {}).get("name") or t.get("type") or ""
                    )
                elif isinstance(t, str):
                    tool_names.append(t)
            agents.append(CatalogAgent(
                id=item["id"],
                name=item.get("name") or item["id"],
                model=item.get("model") or "mistral-large-latest",
                description=item.get("description"),
                tier=item.get("tier"),
                tools=[t for t in tool_names if t],
                connectors=[
                    ref["connector_id"]
                    for ref in (item.get("connectors") or [])
                    if ref.get("connector_id")
                ],
                domains=agent_domains.get(item["id"], []),
            ))

    tools: list[CatalogTool] = []

    # Mistral-native capabilities — executed platform-side, always available.
    for key in BUILTIN_TOOLS:
        tools.append(CatalogTool(
            name=key,
            description=f"Mistral built-in capability: {key.replace('_', ' ')}",
            source="builtin",
        ))

    # Locally-executed function tools registered in the backend.
    for key, spec in ALL_TOOLS.items():
        if key in BUILTIN_TOOLS or spec.get("type") != "function":
            continue
        fn = spec.get("function", {})
        tools.append(CatalogTool(
            name=key,
            description=fn.get("description"),
            parameters=fn.get("parameters", {}).get("properties", {}),
            required=fn.get("parameters", {}).get("required", []),
            source="native",
        ))

    # Synthesised tools living in the Tool Service — split by purpose so the
    # builder never mixes an agent capability with a standalone workflow step.
    # A record with no "purpose" (pre-dating the field) counts as a tool.
    activities: list[CatalogTool] = []
    if isinstance(tool_records, Exception):
        logger.warning("Builder catalog: could not list tools: %s", tool_records)
    else:
        known = {t.name for t in tools}
        for record in tool_records:
            if record.get("status") != "approved":
                continue
            schema = record.get("schema", {}) or {}
            fn = schema.get("function", {}) or {}
            name = fn.get("name") or record.get("name")
            if not name or name in known:
                continue
            known.add(name)
            params = fn.get("parameters", {}) or {}
            catalog_tool = CatalogTool(
                name=name,
                description=fn.get("description"),
                parameters=params.get("properties", {}),
                required=params.get("required", []),
                status=record.get("status", "approved"),
                source="dynamic",
            )
            if record.get("purpose") == "activity":
                activities.append(catalog_tool)
            else:
                tools.append(catalog_tool)

    # Mistral Connectors — MCP servers the platform hosts credentials for.
    connectors: list[CatalogConnector] = []
    if isinstance(connector_resp, Exception):
        logger.warning("Builder catalog: could not list connectors: %s", connector_resp)
    else:
        for record in connector_resp.get("items", []):
            if not record.get("id"):
                continue
            connectors.append(CatalogConnector(
                id=record["id"],
                name=record.get("name") or record["id"],
                description=record.get("description"),
                icon_url=record.get("icon_url"),
                is_directory=record.get("is_directory", False),
                is_authenticated=record.get("is_authenticated", False),
                active=record.get("active", True),
            ))

    # Only domains that actually have agents — an empty facet is noise.
    domains: list[CatalogDomain] = []
    try:
        from app.ontology import store as ontology_store
        from app.ontology.vocab import Scheme

        used = Counter(d for ds in agent_domains.values() for d in ds)
        for concept in ontology_store.list_concepts(Scheme.DOMAIN.value):
            if used.get(concept["id"]):
                domains.append(CatalogDomain(
                    id=concept["id"],
                    label=concept["label"],
                    parent_id=concept["parent_id"],
                    agent_count=used[concept["id"]],
                ))
    except Exception as e:
        logger.warning("Builder catalog: could not build domain facets: %s", e)

    return BuilderCatalogResponse(
        agents=sorted(agents, key=lambda a: a.name.lower()),
        tools=sorted(tools, key=lambda t: t.name.lower()),
        activities=sorted(activities, key=lambda t: t.name.lower()),
        connectors=sorted(connectors, key=lambda c: c.name.lower()),
        domains=sorted(domains, key=lambda d: d.label.lower()),
        models=[
            "mistral-large-latest",
            "mistral-medium-latest",
            "mistral-small-latest",
            "open-mistral-nemo",
            "codestral-latest",
        ],
        tiers=["foundation", "domain", "use_case"],
    )


@router.get("/workflows", response_model=WorkflowListResponse)
async def list_all_workflows():
    """List all workflow definitions, merged with Mistral server status."""
    local_workflows = list_workflows()
    local_dict = {wf.name: wf for wf in local_workflows}

    try:
        resp = _mistral_get("/v1/workflows")
        if resp and resp.status_code == 200:
            for rw in resp.json().get("workflows", []):
                name = rw.get("name")
                if not name:
                    continue
                if name in local_dict:
                    local_dict[name].is_deployed = True
                    local_dict[name].id = rw.get("id")
                    local_dict[name].archived = rw.get("archived", False)
                else:
                    local_dict[name] = WorkflowDefinition(
                        id=rw.get("id"),
                        name=name,
                        description=rw.get("description", ""),
                        steps=[],
                        entry_step="",
                        is_deployed=True,
                        archived=rw.get("archived", False),
                    )
    except Exception as e:
        logger.warning("Failed to fetch remote workflows: %s", e)

    merged = list(local_dict.values())
    return WorkflowListResponse(workflows=merged, count=len(merged))


@router.get("/workflows/{workflow_name}")
async def get_workflow_detail(workflow_name: str):
    """Get a workflow definition, merged with Mistral server data."""
    workflow = get_workflow(workflow_name)

    # Also fetch remote info
    resp = _mistral_get("/v1/workflows")
    if resp and resp.status_code == 200:
        for rw in resp.json().get("workflows", []):
            if rw.get("name") == workflow_name:
                if workflow:
                    workflow.is_deployed = True
                    workflow.id = rw.get("id")
                    workflow.archived = rw.get("archived", False)
                else:
                    workflow = WorkflowDefinition(
                        id=rw.get("id"),
                        name=workflow_name,
                        description=rw.get("description", ""),
                        steps=[],
                        entry_step="",
                        is_deployed=True,
                        archived=rw.get("archived", False),
                    )
                break

    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"workflow": workflow.model_dump()}


def _delayed_mistral_archive(remote_id: str):
    import time
    time.sleep(5)
    _mistral_put(f"/v1/workflows/{remote_id}/archive")

@router.put("/workflows/{workflow_name}/archive")
async def archive_workflow_endpoint(workflow_name: str, background_tasks: BackgroundTasks):
    """Archive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if workflow:
        workflow.archived = True
        save_workflow(workflow)
        # Delete file so worker unregisters it
        py_file = os.path.join(settings.MISTRAL_WORKFLOWS_DIR, f"workflow_{workflow_name}.py")
        if os.path.exists(py_file):
            try:
                os.remove(py_file)
            except Exception:
                pass

    if remote_id:
        background_tasks.add_task(_delayed_mistral_archive, remote_id)

    if not workflow and not remote_id:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"archived": True, "workflow_name": workflow_name}


@router.put("/workflows/{workflow_name}/unarchive")
async def unarchive_workflow_endpoint(workflow_name: str):
    """Unarchive a workflow (locally + on Mistral server)."""
    workflow = get_workflow(workflow_name)
    remote_id = _get_mistral_workflow_id(workflow_name)

    if remote_id:
        _mistral_put(f"/v1/workflows/{remote_id}/unarchive")

    if workflow:
        workflow.archived = False
        save_workflow(workflow)
        # Recreate file so worker registers it
        try:
            from app.services.mistral_workflows_compiler import compile_workflow_to_python
            code = compile_workflow_to_python(workflow)
            py_file = os.path.join(settings.MISTRAL_WORKFLOWS_DIR, f"workflow_{workflow_name}.py")
            with open(py_file, "w", encoding="utf-8") as f:
                f.write(code)
        except Exception as e:
            logging.error(f"Failed to recompile workflow on unarchive: {e}")

    if not workflow and not remote_id:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    return {"unarchived": True, "workflow_name": workflow_name}


# ── Execute ───────────────────────────────────────────────────────────────────

@router.post("/workflows/{workflow_name}/execute", response_model=WorkflowExecutionResponse)
async def execute_workflow_endpoint(workflow_name: str, request: ExecuteWorkflowRequest):
    """
    Execute a workflow.

    Strategy:
      1. If is_deployed → call Mistral server (POST /v1/workflows/{name}/execute)
         with worker_identifier so Temporal routes the task to our worker's
         task queue (WORKER_DEPLOYMENT = 'default').
      2. On server failure or if not deployed → fall back to local DAG engine.
    """
    workflow = get_workflow(workflow_name)
    # Note: workflow may be None for Mistral-only (remotely registered) workflows.
    # We still attempt Mistral server execution before raising 404.

    # ── Always try Mistral server first via direct HTTP ──────────────────
    # We use httpx directly so we can pass worker routing fields that the
    # SDK wrapper does not expose. We send all known field-name variants
    # for the worker routing hint — the server ignores unknown fields.
    try:
        body: dict = {
            "input": {"variables": request.input or {}},
            # Send all known field-name variants for worker task-queue routing.
            # The Mistral API field name has changed across versions; sending
            # all three is safe (unknown fields are silently ignored server-side).
            "worker_deployment": WORKER_DEPLOYMENT,   # current API field name
            "worker_identifier": WORKER_DEPLOYMENT,   # older API field name
            "deployment_name":   WORKER_DEPLOYMENT,   # alias in some versions
        }
        if request.execution_id:
            body["execution_id"] = request.execution_id

        logger.info(
            "Executing '%s' on Mistral server — worker_deployment='%s'",
            workflow_name, WORKER_DEPLOYMENT,
        )

        resp = await asyncio.to_thread(
            lambda: httpx.post(
                f"https://api.mistral.ai/v1/workflows/{workflow_name}/execute",
                headers={**_mistral_headers(), "Content-Type": "application/json"},
                json=body,
                timeout=30.0,
            )
        )

        logger.info(
            "Mistral execute response: status=%d body=%.300s",
            resp.status_code, resp.text,
        )

        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Mistral API returned {resp.status_code}: {resp.text}")

        data = resp.json()
        exec_id = data.get("execution_id", data.get("id", ""))
        status_raw = str(data.get("status", "RUNNING")).upper()

        from app.services.workflow_engine.models import WorkflowStatus
        try:
            status = WorkflowStatus(status_raw)
        except ValueError:
            status = WorkflowStatus.RUNNING

        logger.info(
            "Workflow '%s' executing on Mistral server (exec_id=%s, worker=%s)",
            workflow_name, exec_id[:20], WORKER_DEPLOYMENT,
        )
        return WorkflowExecutionResponse(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=status,
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            result=data.get("output"),
            root_execution_id=data.get("root_execution_id", exec_id),
            source="mistral",
        )
    except Exception as e:
        logger.info(
            "Mistral server execution failed or unreachable for '%s' (%s) — using local DAG engine.",
            workflow_name, e,
        )

    # ── Local DAG engine fallback ─────────────────────────────────────────
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow '{workflow_name}' not found locally and Mistral server execution failed.",
        )

    try:
        import uuid as _uuid
        exec_id = request.execution_id or str(_uuid.uuid4())

        from app.services.workflow_engine.models import WorkflowRun, WorkflowStatus as WfSt
        from datetime import datetime, timezone

        stub_run = WorkflowRun(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=WfSt.RUNNING,
            start_time=datetime.now(timezone.utc),
            variables={**(workflow.variables or {}), **(request.input or {})},
        )
        from app.services.workflow_engine.engine import _execution_store
        _execution_store[exec_id] = stub_run

        async def _run_in_background():
            try:
                await execute_workflow(
                    workflow_name=workflow_name,
                    input_vars=request.input or {},
                    execution_id=exec_id,
                )
            except Exception as bg_err:
                logger.error("Background workflow execution failed: %s", bg_err)
                run = _execution_store.get(exec_id)
                if run:
                    run.status = WfSt.FAILED
                    run.result = {"error": str(bg_err)}
                    run.end_time = datetime.now(timezone.utc)

        asyncio.create_task(_run_in_background())

        return WorkflowExecutionResponse(
            execution_id=exec_id,
            workflow_name=workflow_name,
            status=WfSt.RUNNING,
            start_time=stub_run.start_time,
            root_execution_id=exec_id,
            source="local",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Executions for one workflow ───────────────────────────────────────────────
#
# Everything else about executions — detail, history, traces, streaming and the
# control operations — lives in ``routes/executions.py``, which mirrors the
# Mistral Workflow Executions API. Only the per-workflow listing stays here
# because it hangs off the workflow resource.

@router.get("/workflows/{workflow_name}/executions")
async def get_workflow_executions(
    workflow_name: str,
    status: str | None = None,
    search: str | None = None,
    page_size: int = 50,
    next_page_token: str | None = None,
):
    """List this workflow's executions (Mistral runs merged with local runs)."""
    from app.services.workflow_engine import executions as exec_service

    return await exec_service.list_runs(
        workflow_identifier=workflow_name,
        status=status,
        search=search,
        page_size=page_size,
        next_page_token=next_page_token,
    )


# ── Register (manual trigger) ─────────────────────────────────────────────────
#
# How a code workflow actually reaches Mistral
# --------------------------------------------
# It is registered by the *worker*, not over REST. When a ``workflow_<name>.py``
# file lands in MISTRAL_WORKFLOWS_DIR, the supervisor restarts the inner worker,
# which imports the module and registers the workflow class with the Mistral
# scheduler on connect.
#
# ``POST /v1/workflows`` does exist, but it is the worker SDK's own
# self-registration contract: it requires ``definitions``, ``deployment_name``
# and ``worker_name`` — the worker process's identity, which this service cannot
# invent. Calling it by hand returns 422, which is what previously made publish
# fail for a brand-new workflow even though the worker went on to register it
# seconds later.
#
# The rest of the surface is narrow: there is no DELETE, PATCH returns 405, and
# ``PUT /v1/workflows/{id}`` accepts metadata only (display_name, description,
# available_in_chat_assistant).
#
# So: write the file, then wait for the worker to do the registration.

# How long to wait for the worker to restart and register a new workflow.
# A cold restart is ~10-15s (watchfiles debounce + SDK import + Temporal connect).
REGISTRATION_WAIT_SECONDS = float(os.environ.get("WORKFLOW_REGISTRATION_WAIT", "30"))
REGISTRATION_POLL_SECONDS = 1.5


def _find_remote_workflow(workflow_name: str) -> dict | None:
    """Look a workflow up on Mistral by name. Returns the record or None."""
    resp = _mistral_get("/v1/workflows")
    if resp and resp.status_code == 200:
        try:
            for wf in resp.json().get("workflows", []):
                if wf.get("name") == workflow_name:
                    return wf
        except Exception as e:
            logger.warning("Could not parse /v1/workflows response: %s", e)
    return None


def _sync_remote_metadata(remote_id: str, workflow: WorkflowDefinition) -> None:
    """Push description to Mistral. Best effort — never fatal.

    WorkflowUpdateRequest accepts only display_name, description and
    available_in_chat_assistant; routing hints sent here would be ignored.
    """
    if not workflow.description:
        return

    resp = _mistral_put(f"/v1/workflows/{remote_id}", {"description": workflow.description})
    if resp is None or resp.status_code not in (200, 201, 204):
        status = resp.status_code if resp else "no response"
        detail = resp.text[:200] if resp else ""
        logger.warning("Metadata sync for '%s' returned %s: %s", workflow.name, status, detail)
    else:
        logger.info("Synced metadata for workflow '%s'", workflow.name)


async def _await_worker_registration(workflow_name: str, timeout_s: float) -> dict | None:
    """Poll until the worker has registered the workflow, or the wait runs out."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        await asyncio.sleep(REGISTRATION_POLL_SECONDS)
        remote = await asyncio.to_thread(_find_remote_workflow, workflow_name)
        if remote:
            return remote
    return None


@router.post("/workflows/{workflow_name}/register")
async def register_workflow_on_mistral(workflow_name: str, wait_seconds: float | None = None):
    """Compile the workflow and get it onto Mistral.

    Writes ``workflow_<name>.py`` for the worker to pick up, then waits for the
    worker to register it. ``server_action`` reports what happened:

    - ``updated`` — already registered; metadata refreshed
    - ``registered`` — the worker registered it within the wait window
    - ``pending_worker`` — file written, registration still in flight (not an error)
    - ``error`` — compilation or an unexpected failure
    """
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    # ── Step 1: write compiled file for local worker hot-reload ──────────
    code = compile_workflow_to_python(workflow)
    workflows_dir = os.path.abspath(
        os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
    )
    os.makedirs(workflows_dir, exist_ok=True)
    file_path = os.path.join(workflows_dir, f"workflow_{workflow_name}.py")

    previous_code: str | None = None
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                previous_code = f.read()
        except OSError:
            pass

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(code)
    logger.info("Wrote compiled workflow to %s", file_path)

    # An unchanged module does not retrigger the file watcher, so the worker
    # will not restart and there is no registration to wait for.
    code_changed = previous_code != code

    # ── Step 2: let the worker register it ───────────────────────────────
    server_result: dict = {}
    try:
        remote = await asyncio.to_thread(_find_remote_workflow, workflow_name)

        if remote:
            await asyncio.to_thread(_sync_remote_metadata, remote["id"], workflow)
            server_result = {"server_action": "updated", "remote_id": remote["id"]}
        elif not settings.MISTRAL_WORKER_ENABLED:
            server_result = {
                "server_action": "pending_worker",
                "detail": (
                    "Compiled and written to disk. MISTRAL_WORKER_ENABLED is false, so no "
                    "worker is running to register it — executions will fall back to the "
                    "local DAG engine."
                ),
            }
        else:
            wait = REGISTRATION_WAIT_SECONDS if wait_seconds is None else wait_seconds
            logger.info(
                "Waiting up to %.0fs for the worker to register '%s'%s",
                wait, workflow_name, "" if code_changed else " (module unchanged)",
            )
            remote = await _await_worker_registration(workflow_name, wait)

            if remote:
                await asyncio.to_thread(_sync_remote_metadata, remote["id"], workflow)
                server_result = {"server_action": "registered", "remote_id": remote["id"]}
            else:
                server_result = {
                    "server_action": "pending_worker",
                    "detail": (
                        f"Compiled and written to disk, but the worker had not registered it "
                        f"within {wait:.0f}s. It normally appears a few seconds after the "
                        f"worker reloads."
                    ),
                }

        if remote:
            workflow.is_deployed = True
            workflow.id = remote["id"]
            logger.info(
                "Workflow '%s' %s on Mistral (id=%s, deployment='%s')",
                workflow_name, server_result["server_action"], remote["id"], WORKER_DEPLOYMENT,
            )

        # The compiled module on disk is what the worker runs, so the definition
        # counts as published once it is written — whether or not the remote
        # registration has caught up yet.
        workflow.published_hash = workflow.semantic_hash()
        save_workflow(workflow)

    except Exception as e:
        logger.error("Registration failed for '%s': %s", workflow_name, e, exc_info=True)
        server_result = {"server_action": "error", "detail": str(e)}

    return {
        "message": "Workflow compiled and registered.",
        "workflow_name": workflow_name,
        "file_path": file_path,
        "worker_deployment": WORKER_DEPLOYMENT,
        **server_result,
    }


# ── Export (legacy — kept for backward compat) ───────────────────────────────

@router.post("/workflows/{workflow_name}/export")
async def export_to_mistral(workflow_name: str):
    """Compile to Mistral Workflows SDK Python code and write to disk (worker auto-reloads)."""
    result = await register_workflow_on_mistral(workflow_name)
    workflow = get_workflow(workflow_name)
    code = compile_workflow_to_python(workflow) if workflow else ""
    return {**result, "code": code}