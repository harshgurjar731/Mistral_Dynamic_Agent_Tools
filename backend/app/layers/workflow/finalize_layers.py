"""
Finalisation layers — validate, save, compile, register.

Formerly Phase 5 of the monolithic planner, which saved, compiled and
registered in one block with no validation anywhere in it. Splitting them means
each can have its own failure policy, and validation now has somewhere to sit.

Order and policy:

    WorkflowValidationLayer   errors block registration, never block saving
    WorkflowPersistenceLayer  saves to SQLite and annotates the ontology
    WorkflowCompilationLayer  writes the Mistral SDK module; best effort
    WorkflowReviewLayer       the user tests it, then accepts or rolls it back
    WorkflowRegistrationLayer registers on Mistral; skipped if validation failed

The validation gate is the one behavioural change. Registering a workflow with
unreachable steps or an unbound agent used to succeed, and the workflow then
failed at run time somewhere far from the cause. It is still saved, so it opens
in the visual builder with its problems listed.
"""

import asyncio
import json
import logging
import os

import httpx

from app.core.context import PipelineContext
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: Set when validation found blocking errors; read by the registration layer.
VALIDATION_FAILED_KEY = "workflow_validation_failed"

#: Warnings for a hand-built draft — a builder user may add a node before
#: wiring it — but defects in a finished plan: each one means a step, and the
#: business rule it carries, silently never runs.
_PLANNER_BLOCKING = {"step.unreachable", "step.multiple_next"}


class WorkflowValidationLayer(WorkflowStepLayer):
    """Check the assembled definition before anything is persisted."""

    name = "workflow_validation"
    label = "Validate"
    detail = "Checks the workflow is runnable before anything is published."

    async def process(self, ctx: PipelineContext, next):
        from app.services.workflow_engine.models import WorkflowDefinition, WorkflowSource
        from app.services.workflow_engine.validation import validate_workflow

        spec = ctx.workflow_spec
        if not spec.dag:
            ctx.emit("fatal_error", json.dumps({"error": "No workflow was produced."}))
            ctx.set_error("No workflow definition to validate")
            return await next(ctx)

        ctx.emit("status", "Validating the workflow…")

        try:
            definition = WorkflowDefinition(
                **{**spec.dag, "source": WorkflowSource.PLANNER}
            )
        except Exception as e:
            logger.error("Workflow definition rejected by its own schema: %s", e)
            ctx.emit("fatal_error", json.dumps(
                {"error": f"The planned workflow is malformed: {e}"}
            ))
            ctx.set_error(f"Invalid workflow definition: {e}")
            return await next(ctx)

        spec.definition = definition
        result = validate_workflow(definition)

        # Workflow rules — always-on ones plus those WorkflowRuleSelectionLayer
        # chose. A rule set to "block" produces an error, which the blocking
        # logic below turns into "saved but not registered".
        try:
            from app.rules import engine as rules_engine, runtime as rules_runtime, store as rules_store

            rules = rules_store.effective_rules(
                "workflow", [r.rule_id for r in definition.rules], subject_id=definition.name
            )
            agents_by_id = {
                a["agent_id"]: {
                    "name": a.get("agent_name"),
                    "tools": a.get("tools") or [],
                    "connectors": a.get("connectors") or [],
                }
                for a in spec.provisioned_agents if a.get("agent_id")
            }
            rule_issues = rules_engine.check_workflow(definition, agents_by_id, {}, rules)
            rules_runtime.record(
                rules_engine.workflow_validation_outcomes(rules, rule_issues),
                scope="workflow", subject_id=definition.name,
            )
            if rule_issues:
                issues = [*result.issues, *rule_issues]
                result = result.model_copy(update={
                    "issues": issues,
                    "valid": not any(i.severity == "error" for i in issues),
                    "error_count": sum(1 for i in issues if i.severity == "error"),
                    "warning_count": sum(1 for i in issues if i.severity == "warning"),
                })
        except Exception as e:
            logger.warning("Workflow rules skipped during planning: %s", e)

        # Data-flow references to fields an activity does not return
        # (recorded by DataFlowLayer against each activity's output schema).
        # And activities or agents planning could not build: an error when the
        # step has nothing to run, a warning when it is rebuilt on first run.
        step_ids = {s.id for s in definition.steps}
        contract_issues = [
            *(ctx.metadata.get("contract_issues") or []),
            *(i for i in ctx.metadata.get("build_issues") or [] if i.get("step_id") in step_ids),
        ]
        if contract_issues:
            from app.services.workflow_engine.models import ValidationIssue

            issues = [*result.issues, *(ValidationIssue(**i) for i in contract_issues)]
            result = result.model_copy(update={
                "issues": issues,
                "valid": not any(i.severity == "error" for i in issues),
                "error_count": sum(1 for i in issues if i.severity == "error"),
                "warning_count": sum(1 for i in issues if i.severity == "warning"),
            })

        blocking = [
            i for i in result.issues
            if i.severity == "error" or i.code in _PLANNER_BLOCKING
        ]
        planner_valid = not blocking

        ctx.emit("validation", json.dumps({
            "valid": planner_valid,
            "error_count": len(blocking),
            "warning_count": len(result.issues) - len(blocking),
            "issues": [
                {
                    "severity": "error" if i in blocking else i.severity,
                    "code": i.code,
                    "message": i.message,
                    "step_id": i.step_id,
                }
                for i in result.issues
            ],
        }))

        if not planner_valid:
            # Saved but not registered — see the module docstring.
            ctx.metadata[VALIDATION_FAILED_KEY] = True
            logger.warning(
                "Workflow '%s' has %d validation error(s); it will be saved but not registered",
                definition.name, result.error_count,
            )
        else:
            logger.info(
                "Workflow '%s' validated clean (%d warnings)",
                definition.name, result.warning_count,
            )

        return await next(ctx)


class WorkflowPersistenceLayer(WorkflowStepLayer):
    """Save the definition to SQLite and classify it against the ontology."""

    name = "workflow_persistence"
    label = "Save"
    detail = "Stores the definition and files it in the ontology."

    async def process(self, ctx: PipelineContext, next):
        from app.services.workflow_engine.engine import save_workflow

        spec = ctx.workflow_spec
        if not spec.definition:
            return await next(ctx)

        ctx.emit("status", "Saving the workflow…")

        from app.layers.workflow import plan_control
        from app.services.workflow_engine.engine import get_workflow

        # A plan may reuse an existing workflow's name; a rollback restores
        # what was there rather than deleting it.
        previous = await asyncio.to_thread(get_workflow, spec.definition.name)

        # save_workflow does synchronous database work and an ontology
        # annotation pass; off the loop so it does not stall the SSE stream.
        workflow_name = await asyncio.to_thread(save_workflow, spec.definition)
        spec.workflow_name = workflow_name
        plan_control.record_created(
            ctx, "workflow", workflow_name, workflow_name,
            previous=previous.model_dump(mode="json") if previous else None,
        )

        ctx.emit("workflow_ready", json.dumps({
            "workflow_name": workflow_name,
            "description": spec.definition.description or spec.goal,
            "step_count": len(spec.definition.steps),
            "entry_step": spec.definition.entry_step,
            "agents": [a["agent_name"] for a in spec.provisioned_agents],
            "guardrails": spec.guardrails,
            "rationale": spec.rationale,
            "dag": spec.dag,
        }))

        logger.info("Workflow '%s' saved (%d steps)", workflow_name, len(spec.definition.steps))
        return await next(ctx)


class WorkflowCompilationLayer(WorkflowStepLayer):
    """Compile the definition to a Mistral Workflows SDK module.

    Best effort. The compiled file is a build artefact derived from the
    definition, never the source of truth, so a failure here costs a
    convenience rather than the workflow.
    """

    name = "workflow_compilation"
    label = "Compile"
    detail = "Generates the Mistral Workflows SDK module."

    async def process(self, ctx: PipelineContext, next):
        from app.config import settings
        from app.services.mistral_workflows_compiler import compile_workflow_to_python

        spec = ctx.workflow_spec
        if not spec.definition:
            return await next(ctx)

        # A compiled module is picked up and run by the local worker, so an
        # invalid plan must not get one — it would fail mid-run (e.g. a
        # connector step with no connector) instead of being fixed first.
        if ctx.metadata.get(VALIDATION_FAILED_KEY):
            ctx.emit("compiled", json.dumps({
                "workflow_name": spec.workflow_name,
                "skipped": True,
                "error": "Not compiled — the workflow has validation errors.",
            }))
            return await next(ctx)

        ctx.emit("status", "Compiling to the Mistral SDK…")

        try:
            workflows_dir = os.path.abspath(
                os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
            )
            os.makedirs(workflows_dir, exist_ok=True)

            python_code = compile_workflow_to_python(spec.definition)
            file_path = os.path.join(workflows_dir, f"workflow_{spec.workflow_name}.py")

            await asyncio.to_thread(
                lambda: open(file_path, "w", encoding="utf-8").write(python_code)
            )

            logger.info("Compiled workflow '%s' → %s", spec.workflow_name, file_path)
            ctx.emit("compiled", json.dumps({
                "workflow_name": spec.workflow_name,
                "file_path": file_path,
            }))
        except Exception as e:
            logger.error("Workflow compilation failed: %s", e)
            ctx.emit("compiled", json.dumps({
                "workflow_name": spec.workflow_name,
                "error": str(e),
            }))

        return await next(ctx)


class WorkflowRegistrationLayer(WorkflowStepLayer):
    """Register the workflow on the Mistral server so it can be executed there."""

    name = "workflow_registration"
    label = "Register"
    detail = "Publishes the workflow so the Mistral server can run it."

    async def process(self, ctx: PipelineContext, next):
        from app.config import settings
        from app.services.workflow_engine.engine import save_workflow

        spec = ctx.workflow_spec
        if not spec.definition:
            return await next(ctx)

        if ctx.metadata.get(VALIDATION_FAILED_KEY):
            ctx.emit("registered", json.dumps({
                "workflow_name": spec.workflow_name,
                "skipped": True,
                "error": "Not registered — the workflow has validation errors. "
                         "It is saved and can be fixed in the builder.",
            }))
            ctx.emit("done", json.dumps({
                "workflow_name": spec.workflow_name,
                "mistral_workflow_id": None,
            }))
            return await next(ctx)

        ctx.emit("status", "Registering on the Mistral server…")
        worker_deployment = os.environ.get("DEPLOYMENT_NAME", "default")
        workflow_name = spec.workflow_name
        definition = spec.definition

        def _register() -> str | None:
            headers = {
                "Authorization": f"Bearer {settings.MISTRAL_API_KEY}",
                "Content-Type": "application/json",
            }

            existing_id = None
            try:
                r = httpx.get(
                    "https://api.mistral.ai/v1/workflows",
                    headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                    timeout=8.0,
                )
                if r.status_code == 200:
                    for wf in r.json().get("workflows", []):
                        if wf.get("name") == workflow_name:
                            existing_id = wf.get("id")
                            break
            except Exception as e:
                logger.warning("Failed to list existing workflows: %s", e)

            # worker_deployment is what makes the Mistral server route execution
            # tasks to our worker's queue.
            body = {
                "name": workflow_name,
                "worker_deployment": worker_deployment,
                "worker_identifier": worker_deployment,
            }
            if definition.description:
                body["description"] = definition.description

            if existing_id:
                for method, fn in (("PUT", httpx.put), ("PATCH", httpx.patch)):
                    try:
                        resp = fn(
                            f"https://api.mistral.ai/v1/workflows/{existing_id}",
                            headers=headers, json=body, timeout=15.0,
                        )
                        if resp.status_code in (200, 201, 204):
                            logger.info("%s /v1/workflows/%s → %d", method, existing_id, resp.status_code)
                            return existing_id
                        logger.warning("%s returned %d: %s", method, resp.status_code, resp.text[:100])
                    except Exception as e:
                        logger.warning("%s failed: %s", method, e)

                # Last resort: delete and recreate.
                try:
                    httpx.delete(
                        f"https://api.mistral.ai/v1/workflows/{existing_id}",
                        headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                        timeout=15.0,
                    )
                except Exception:
                    pass

            resp = httpx.post(
                "https://api.mistral.ai/v1/workflows",
                headers=headers, json=body, timeout=15.0,
            )
            if resp.status_code in (200, 201):
                return resp.json().get("id")
            logger.warning(
                "POST /v1/workflows returned %d: %s", resp.status_code, resp.text[:200]
            )
            return None

        mistral_workflow_id = None
        try:
            mistral_workflow_id = await asyncio.to_thread(_register)
        except Exception as e:
            logger.error("Workflow registration failed: %s", e)

        if mistral_workflow_id:
            definition.is_deployed = True
            definition.id = mistral_workflow_id
            # Baseline for change tracking: a planner-authored workflow that is
            # live must compare as clean until someone edits it in the builder.
            definition.published_hash = definition.semantic_hash()
            await asyncio.to_thread(save_workflow, definition)

            spec.mistral_workflow_id = mistral_workflow_id
            logger.info(
                "Workflow '%s' registered on Mistral (id=%s, worker_deployment='%s')",
                workflow_name, mistral_workflow_id, worker_deployment,
            )
            ctx.emit("registered", json.dumps({
                "workflow_name": workflow_name,
                "mistral_workflow_id": mistral_workflow_id,
                "worker_deployment": worker_deployment,
            }))
        else:
            logger.warning(
                "Could not register workflow '%s' on Mistral. It is saved locally "
                "and will run via the local DAG engine.",
                workflow_name,
            )
            ctx.emit("registered", json.dumps({
                "workflow_name": workflow_name,
                "error": "Server registration failed. Workflow saved locally — "
                         "it will run via the local DAG engine.",
            }))

        ctx.emit("done", json.dumps({
            "workflow_name": workflow_name,
            "mistral_workflow_id": mistral_workflow_id,
        }))

        return await next(ctx)


class WorkflowReviewLayer(WorkflowStepLayer):
    """Hand the built workflow to the user: test it, accept it, or roll it back.

    Nothing is tested or rolled back without being asked. Accepting goes on to
    registration; rolling back removes everything the plan created. While this
    waits, the user may also rebuild a failed activity
    (``POST /workflows/{name}/steps/{step}/rebuild-activity``) and test again,
    so the definition is re-read from storage each time.

    Without an interactive run there is nobody to ask, and the plan is
    accepted as before.
    """

    name = "workflow_review"
    label = "Review"
    detail = "You test the built workflow, then accept it or roll back everything the plan created."

    async def process(self, ctx: PipelineContext, next):
        from app.layers.workflow import plan_control
        from app.services.workflow_engine.engine import get_workflow
        from app.services.workflow_engine.plan_test import test_workflow

        spec = ctx.workflow_spec
        if not spec.definition or not plan_control.can_ask(ctx):
            return await next(ctx)

        last_test = None
        while True:
            choice = await plan_control.ask_user(ctx, "review_workflow", {
                "title": "The workflow is built — test it, accept it, or roll it back",
                "workflow_name": spec.workflow_name,
                "valid": not ctx.metadata.get(VALIDATION_FAILED_KEY),
                "last_test": last_test and {"passed": last_test["passed"],
                                            "summary": last_test["summary"]},
            }, options=["test", "accept", "rollback"], default="accept")

            stored = await asyncio.to_thread(get_workflow, spec.workflow_name)
            if stored is not None:
                spec.definition = stored

            if choice == "test":
                ctx.emit("status", "Testing the workflow…")
                last_test = await test_workflow(spec.definition, ctx.client)
                ctx.emit("workflow_test", json.dumps(last_test, default=str))
                continue
            if choice == "rollback":
                await plan_control.roll_back_plan(ctx, "rolled back after review")
                return await next(ctx)
            ctx.emit("workflow_accepted", json.dumps({
                "workflow_name": spec.workflow_name,
                "tested": last_test is not None,
                "passed": bool(last_test and last_test["passed"]),
            }))
            return await next(ctx)
