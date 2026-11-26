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
from app.dependencies import current_mistral_api_key
from app.layers.workflow.base import WorkflowStepLayer

logger = logging.getLogger(__name__)

#: Set when validation found blocking errors; read by the registration layer.
VALIDATION_FAILED_KEY = "workflow_validation_failed"
#: The user accepted the workflow at review (their decision, whatever the tests said).
ACCEPTED_KEY = "workflow_accepted_at_review"
#: Set (to the reason) when the workflow is kept as a draft because it has not
#: passed verification: saved, never registered, and reported as not verified.
DRAFT_KEY = "workflow_kept_as_draft"


def verification_state(ctx: PipelineContext) -> tuple[bool, str]:
    """``(verified, why not)`` — valid, and every dry-run scenario passed (when dry runs are on)."""
    from app.config import settings
    from app.layers.workflow.verify_layers import RESULT_KEY

    if ctx.metadata.get(VALIDATION_FAILED_KEY):
        return False, "it has validation errors"
    dry = ctx.metadata.get(RESULT_KEY)
    if settings.WORKFLOW_DRY_RUN and isinstance(dry, dict) and not dry.get("passed"):
        scenarios = dry.get("scenarios") or []
        good = sum(1 for o in scenarios if o.get("passed"))
        waiting = int(dry.get("inconclusive") or 0)
        return False, (f"{good} of {len(scenarios)} test scenario(s) pass"
                       + (f"; {waiting} could not be completed because the model service did not "
                          "answer — not a fault of the workflow" if waiting else ""))
    return True, ""


def retest_worthwhile(ctx: PipelineContext) -> bool:
    """Whether testing again, unasked, could give a different answer.

    Yes when the workflow was never dry-run, or when scenarios could not be
    completed because the model service did not answer. No when the scenarios
    ran, failed and were repaired as far as the repairs go: the same
    verification would run again for as long (25 minutes, on the plan this
    was measured on) and end the same way.
    """
    from app.config import settings
    from app.layers.workflow.verify_layers import RESULT_KEY

    if ctx.metadata.get(VALIDATION_FAILED_KEY):
        return False
    dry = ctx.metadata.get(RESULT_KEY)
    if not settings.WORKFLOW_DRY_RUN:
        return False
    return not isinstance(dry, dict) or bool(dry.get("inconclusive"))
#: The definition the review step last validated — changed by a revision or rebuild.
_REVIEWED_HASH_KEY = "workflow_reviewed_hash"

#: Warnings for a hand-built draft — a builder user may add a node before
#: wiring it — but defects in a finished plan: each one means a step, and the
#: business rule it carries, silently never runs.
_PLANNER_BLOCKING = {"step.unreachable", "step.multiple_next"}


def _process_coverage(ctx: PipelineContext, layer: str, step_ids: set[str]) -> list[dict]:
    """Warnings for mandatory process controls no workflow step covers.

    A control is covered when a step performs one of the stages it applies to
    (decomposition maps capabilities to stages, and capability ids become step
    ids). Records both outcomes as process-knowledge usage.
    """
    from app.process import pipeline as process_knowledge

    pc = process_knowledge.active(ctx)
    if not pc:
        return []
    stage_steps: dict[str, list[str]] = {}
    for cap in ctx.workflow_spec.capabilities:
        if cap.process_stage and cap.id in step_ids:
            stage_steps.setdefault(cap.process_stage, []).append(cap.id)

    from app.config import settings

    blocking = bool(settings.PROCESS_COVERAGE_BLOCKING)
    issues, used, trace = [], [], []
    for control in pc.get("controls") or []:
        if control.get("mandatory") is not True:
            continue
        stages = {str(s) for s in control.get("applies_to") or []}
        stages |= {str(st.get("id")) for st in pc.get("stages") or []
                   if control.get("id") in (st.get("controls") or [])}
        steps = sorted({step for st in stages for step in stage_steps.get(st, [])})
        trace.append({"control": control.get("id"), "description": control.get("description"),
                      "level": control.get("level"),
                      "stages": sorted(stages), "steps": steps, "covered": bool(steps)})
        if steps:
            used.append({"ref": control["_ref"],
                         "how": f"covered by step(s) {', '.join(steps)}"})
        else:
            used.append({"ref": control["_ref"], "how": "not covered by any step — "
                                                       + ("blocked" if blocking else "warned")})
            issues.append({
                "severity": "error" if blocking else "warning", "code": "process_control_uncovered",
                "message": (("Business control" if control.get("level") == "business"
                             else "Mandatory process control") + f" '{control.get('id')}' "
                            f"({control.get('description') or ''}) applies to stage(s) "
                            f"{', '.join(sorted(stages)) or '—'}, but no step performs them."),
                "step_id": None,
            })
    process_knowledge.record(ctx, layer, used)
    # Which step performs each mandatory control — shown in the timeline.
    ctx.emit("process_traceability", json.dumps({"controls": trace}, default=str))
    return issues


class WorkflowValidationLayer(WorkflowStepLayer):
    """Check the assembled definition before anything is persisted."""

    name = "workflow_validation"
    label = "Validate"
    detail = "Checks the workflow is runnable before anything is published."

    async def process(self, ctx: PipelineContext, next):
        from app.services.workflow_engine.models import WorkflowDefinition, WorkflowSource
        from app.knowledge import pipeline as guidance
        from app.layers.workflow import governance_checks
        from app.services.workflow_engine.validation import validate_workflow

        spec = ctx.workflow_spec
        if not spec.dag:
            ctx.emit("fatal_error", json.dumps({"error": "No workflow was produced."}))
            ctx.set_error("No workflow definition to validate")
            return await next(ctx)

        ctx.emit("status", "Validating the workflow…")

        # Whatever the layers after the topology did to the graph, a step's
        # continuations must be ones the engine follows.
        from app.layers.workflow.topology_layer import normalise_graph

        fixed = normalise_graph(spec.dag.get("steps") or [],
                                {c.id: set(c.depends_on) for c in spec.capabilities})
        for change in fixed:
            logger.warning("Validation repaired the graph: %s", change)

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
            # Advisory only: a mandatory control of the run's process that no
            # step performs. Never blocks — the user's goal may rightly omit it.
            *_process_coverage(ctx, self.name, step_ids),
            # Governance (reflection and review where actions are costly) and
            # the must/avoid guidance the build applied.
            *governance_checks.governance_issues(spec, definition),
            *governance_checks.guidance_compliance(
                spec, guidance.items(ctx), ctx.metadata.get("archetype_conflicts") or []),
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
            # An earlier, side-effect-free layer made these: send the run back
            # to it with the problems listed, rather than save a broken plan.
            from app.core.stages import request_rewind
            from app.layers.workflow.issue_owners import by_owner

            owners = by_owner(blocking)
            if owners and request_rewind(ctx, from_layer=self.name, issues_by_layer=owners,
                                         reason=f"{len(blocking)} validation error(s)"):
                ctx.set_layer_summary(
                    self.name, f"{len(blocking)} error(s) — going back to "
                               + ", ".join(sorted(owners)) + " to fix them")
                return ctx
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

        # Each document input gets its library now, attached to the agents
        # that read it — the plan knows which those are. Best effort: the run
        # form's first upload does the same if this could not.
        from app.workflow_inputs import documents as input_documents, schema as input_schema

        if input_schema.file_fields(spec.definition):
            ctx.emit("status", "Preparing document inputs…")
            had = {lib["field"] for lib in await asyncio.to_thread(
                input_documents.libraries_of, workflow_name)}
            for lib in await input_documents.ensure_all(spec.definition):
                if lib.get("library_id") and lib["field"] not in had:
                    plan_control.record_created(ctx, "library", lib["library_id"],
                                                f"{lib['field']} inputs")
                ctx.emit("input_library", json.dumps(lib))

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
        ctx.emit("compiled", json.dumps(await compile_to_disk(spec.definition, spec.workflow_name)))
        return await next(ctx)


async def compile_to_disk(definition, workflow_name: str) -> dict:
    """Write the definition's SDK module where the worker loads it. Never raises.

    Returns the ``compiled`` event payload: the file path, or the error.
    """
    from app.config import settings
    from app.services.mistral_workflows_compiler import compile_workflow_to_python

    try:
        workflows_dir = os.path.abspath(os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR))
        os.makedirs(workflows_dir, exist_ok=True)
        python_code = compile_workflow_to_python(definition)
        file_path = os.path.join(workflows_dir, f"workflow_{workflow_name}.py")

        def _write():
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(python_code)

        await asyncio.to_thread(_write)
        logger.info("Compiled workflow '%s' → %s", workflow_name, file_path)
        return {"workflow_name": workflow_name, "file_path": file_path}
    except Exception as e:
        logger.error("Workflow compilation failed: %s", e)
        return {"workflow_name": workflow_name, "error": str(e)}


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
                "verified": False,
                "not_verified_reason": "it has validation errors",
            }))
            return await next(ctx)

        # Nobody reviewed it (no interactive run) and it has not passed its own
        # verification: it is a draft, exactly as an unanswered review leaves it.
        if not ctx.metadata.get(DRAFT_KEY) and not ctx.metadata.get(ACCEPTED_KEY):
            verified, why = verification_state(ctx)
            if not verified:
                ctx.metadata[DRAFT_KEY] = why
        if ctx.metadata.get(DRAFT_KEY):
            reason = str(ctx.metadata[DRAFT_KEY])
            ctx.emit("registered", json.dumps({
                "workflow_name": spec.workflow_name,
                "skipped": True,
                "error": f"Not registered — the workflow has not passed verification ({reason}). "
                         "It is saved as a draft: fix it with Refine with AI or in the builder, "
                         "then publish it.",
            }))
            ctx.emit("done", json.dumps({
                "workflow_name": spec.workflow_name,
                "mistral_workflow_id": None,
                "verified": False,
                "not_verified_reason": reason,
            }))
            return await next(ctx)

        ctx.emit("status", "Registering on the Mistral server…")
        # The task queue of this workspace's worker (app.auth.workers).
        from app.auth.workers import current_deployment_name

        worker_deployment = current_deployment_name()
        workflow_name = spec.workflow_name
        definition = spec.definition

        def _register() -> str | None:
            headers = {
                "Authorization": f"Bearer {current_mistral_api_key()}",
                "Content-Type": "application/json",
            }

            # By name, then across every page of the listing — the first page
            # alone holds only the 50 oldest workflows.
            from app.services.remote_workflows import find_remote_workflow

            existing = find_remote_workflow(workflow_name, api_key=current_mistral_api_key())
            existing_id = existing.get("id") if existing else None

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
                        headers={"Authorization": f"Bearer {current_mistral_api_key()}"},
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

        verified, why = verification_state(ctx)
        ctx.emit("done", json.dumps({
            "workflow_name": workflow_name,
            "mistral_workflow_id": mistral_workflow_id,
            "verified": verified,
            **({} if verified else {"not_verified_reason": why}),
        }))

        return await next(ctx)


class WorkflowReviewLayer(WorkflowStepLayer):
    """Hand the built workflow to the user: test it, refine it, accept it, or roll it back.

    Nothing is tested or rolled back without being asked. Accepting goes on to
    registration; rolling back removes everything the plan created. While this
    waits, the user may also rebuild a failed activity
    (``POST /workflows/{name}/steps/{step}/rebuild-activity``) or apply a
    revision (``POST /workflows/{name}/revisions/{id}/apply``) and test again,
    so the definition is re-read from storage each time — and, when it has
    changed, validated and compiled again, so what gets registered is what the
    user last saw rather than what the planner first built.

    Without an interactive run there is nobody to ask, and the plan is
    accepted as before.
    """

    name = "workflow_review"
    label = "Review"
    detail = ("You test and refine the built workflow, then accept it or roll back "
              "everything the plan created.")

    async def process(self, ctx: PipelineContext, next):
        from app.layers.workflow import plan_control
        from app.services.workflow_engine.plan_test import test_workflow

        spec = ctx.workflow_spec
        if not spec.definition or not plan_control.can_ask(ctx):
            return await next(ctx)

        # Per run, not per layer: one layer instance serves every concurrent plan.
        ctx.metadata[_REVIEWED_HASH_KEY] = spec.definition.semantic_hash()
        from app.config import settings as _settings

        last_test = None
        auto_tests = 0
        while True:
            await self._sync(ctx)
            # The recommended choice is what an unanswered question takes. A
            # workflow that has not passed is never accepted that way: it is
            # tested (and repaired) again while that is allowed, then kept as a
            # draft. "Accept" used to be the default whatever the tests said —
            # a workflow failing 0 of 3 scenarios was registered as complete.
            verified, why = verification_state(ctx)
            if verified:
                default, title = "accept", ("The workflow is built and verified — accept it, "
                                            "or test and refine it further")
            else:
                more = (auto_tests < max(0, int(_settings.WORKFLOW_REVIEW_AUTO_TESTS))
                        and retest_worthwhile(ctx))
                default = "test" if more else "draft"
                title = f"The workflow is built but not verified ({why}) — test and fix it before accepting"
            choice = await plan_control.ask_user(ctx, "review_workflow", {
                "title": title,
                "workflow_name": spec.workflow_name,
                "valid": not ctx.metadata.get(VALIDATION_FAILED_KEY),
                "verified": verified,
                "not_verified_reason": why,
                "revisable": True,
                "last_test": last_test and {"passed": last_test["passed"],
                                            "summary": last_test["summary"]},
            }, options=["test", "accept", "rollback"] if verified
               else ["test", "draft", "accept", "rollback"], default=default)

            await self._sync(ctx)
            if choice == "test" and default == "test":
                auto_tests += 1
            if choice == "draft":
                _, why = verification_state(ctx)
                ctx.metadata[DRAFT_KEY] = why or "kept as a draft at review"
                ctx.emit("workflow_draft", json.dumps({
                    "workflow_name": spec.workflow_name, "reason": ctx.metadata[DRAFT_KEY]}))
                return await next(ctx)

            if choice == "test":
                ctx.emit("status", "Testing the workflow…")
                last_test = await test_workflow(spec.definition, ctx.client)
                # Then the scenarios, end to end — repairing what fails, code
                # included — exactly as the Verify stage did.
                from app.config import settings

                if settings.WORKFLOW_DRY_RUN:
                    from app.layers.workflow.verify_layers import run_verification

                    await self._sync(ctx)
                    dry = await run_verification(ctx, self.name)
                    last_test["dry_run"] = dry
                    last_test["passed"] = bool(last_test.get("passed")) and dry["passed"]
                    good = sum(1 for o in dry["scenarios"] if o["passed"])
                    last_test["summary"] = (f"{last_test.get('summary', '')}; "
                                            f"{good} of {len(dry['scenarios'])} scenario(s) pass").strip("; ")
                ctx.emit("workflow_test", json.dumps(last_test, default=str))
                continue
            if choice == "rollback":
                await plan_control.roll_back_plan(ctx, "rolled back after review")
                return await next(ctx)
            ctx.metadata[ACCEPTED_KEY] = True
            ctx.emit("workflow_accepted", json.dumps({
                "workflow_name": spec.workflow_name,
                "tested": last_test is not None,
                "passed": bool(last_test and last_test["passed"]),
                "verified": verification_state(ctx)[0],
            }))
            return await next(ctx)

    async def _sync(self, ctx: PipelineContext) -> None:
        """Adopt the stored definition; re-check and recompile it if it changed."""
        from app.services.workflow_engine.engine import get_workflow
        from app.services.workflow_engine.models import ValidationIssue
        from app.services.workflow_engine.rule_validation import validate_with_rules

        spec = ctx.workflow_spec
        stored = await asyncio.to_thread(get_workflow, spec.workflow_name)
        if stored is None:
            return
        spec.definition = stored
        digest = stored.semantic_hash()
        if digest == ctx.metadata.get(_REVIEWED_HASH_KEY):
            return
        ctx.metadata[_REVIEWED_HASH_KEY] = digest

        result = await validate_with_rules(stored, client=ctx.client)
        # An activity planning could not build is still missing, whatever else changed.
        step_ids = {s.id for s in stored.steps}
        issues = [*result.issues, *(
            ValidationIssue(**i) for i in ctx.metadata.get("build_issues") or []
            if i.get("step_id") in step_ids
        )]
        blocking = [i for i in issues if i.severity == "error" or i.code in _PLANNER_BLOCKING]
        if blocking:
            ctx.metadata[VALIDATION_FAILED_KEY] = True
        else:
            ctx.metadata.pop(VALIDATION_FAILED_KEY, None)

        ctx.emit("validation", json.dumps({
            "valid": not blocking,
            "error_count": len(blocking),
            "warning_count": len(issues) - len(blocking),
            "issues": [{"severity": "error" if i in blocking else i.severity, "code": i.code,
                        "message": i.message, "step_id": i.step_id} for i in issues],
        }))
        ctx.emit("workflow_revised", json.dumps({
            "workflow_name": spec.workflow_name,
            "step_count": len(stored.steps),
            "valid": not blocking,
        }))
        if not blocking:
            ctx.emit("compiled", json.dumps(await compile_to_disk(stored, spec.workflow_name)))
