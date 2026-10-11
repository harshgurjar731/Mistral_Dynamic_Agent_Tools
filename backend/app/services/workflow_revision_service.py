"""
Workflow Revision Service — propose, apply and undo changes to a saved workflow.

The routes call this; this calls the revision pipeline (``app.layers``) and
the revision store (``app.workflow_revisions``). It owns the rules that make a
proposal safe to apply:

* a proposal is applied only onto the definition it was computed against —
  if the workflow changed since, the diff the user reviewed no longer
  describes what applying would do, so it is refused as stale;
* server-owned fields (``id``, ``is_deployed``, ``published_hash``) are kept
  from the stored record, exactly as a builder save keeps them, so applying a
  change can never make a workflow look published;
* every change records a version first, so it can be undone.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.specs import WorkflowRevisionSpec

logger = logging.getLogger(__name__)


class RevisionError(Exception):
    """Base for failures the routes turn into HTTP errors."""

    status_code = 400


class RevisionNotFound(RevisionError):
    status_code = 404


class RevisionConflict(RevisionError):
    status_code = 409


class RevisionInvalid(RevisionError):
    status_code = 422


def _get_workflow(name: str):
    from app.services.workflow_engine.engine import get_workflow

    definition = get_workflow(name)
    if definition is None:
        raise RevisionNotFound(f"Workflow '{name}' not found.")
    return definition


def _layer_trace(ctx: PipelineContext) -> list[dict]:
    """Each layer's final state and its own account of what it decided."""
    trace: dict[str, dict] = {}
    for event in ctx.events:
        if event.event == "layer" and isinstance(event.data, dict):
            name = event.data.get("name")
            if event.data.get("state") in ("completed", "skipped", "failed"):
                trace[name] = {k: event.data.get(k) for k in ("name", "state", "summary", "ms")}
    manifest = {layer["name"]: layer["label"] for layer in _manifest()}
    return [{**row, "label": manifest.get(row["name"], row["name"])} for row in trace.values()]


def _manifest() -> list[dict]:
    from app.layers import revision_pipeline

    return revision_pipeline.manifest()


# ── Propose ─────────────────────────────────────────────────────────────────


async def propose(client: Any, workflow_name: str, *, instruction: str = "",
                  focus_step_ids: Optional[list[str]] = None,
                  operations: Optional[list[dict]] = None,
                  origin: str = "editor") -> dict:
    """Run the revision pipeline and return the recorded revision.

    ``operations`` given directly (a remove or move chosen in the UI) skip the
    model; everything else — validation, diff, review — is the same.
    """
    from app.layers import revision_pipeline
    from app.workflow_revisions import store

    await asyncio.to_thread(_get_workflow, workflow_name)
    if not instruction.strip() and not operations:
        raise RevisionInvalid("Say what should change, or choose an edit.")

    spec = WorkflowRevisionSpec(
        workflow_name=workflow_name,
        instruction=instruction.strip() or _describe_operations(operations or []),
        focus_step_ids=list(focus_step_ids or []),
        origin=origin,
        operations=list(operations or []),
        operations_given=bool(operations),
    )
    ctx = PipelineContext(query=spec.instruction, client=client)
    ctx.revision_spec = spec
    await revision_pipeline.execute(ctx)

    if not spec.revision_id:
        raise RevisionError(ctx.error or "The change could not be prepared.")
    trace = _layer_trace(ctx)
    revision = await asyncio.to_thread(store.update_revision, spec.revision_id, trace=trace)
    return revision


def _describe_operations(operations: list[dict]) -> str:
    """What a direct edit asked for, in the words the conversation shows."""
    phrases = {
        "remove_step": lambda o: f"Remove step '{o.get('step_id')}'",
        "move_step": lambda o: f"Move '{o.get('step_id')}' "
                               + (f"after '{o['after']}'" if o.get("after") else f"before '{o.get('before')}'"),
        "set_entry_step": lambda o: f"Start the workflow at '{o.get('step_id')}'",
        "set_parallel_group": lambda o: (f"Run {', '.join(o.get('step_ids') or [])} in parallel"
                                         if o.get("group") else
                                         f"Stop running {', '.join(o.get('step_ids') or [])} in parallel"),
        "rename_step": lambda o: f"Rename '{o.get('step_id')}' to '{o.get('new_id')}'",
    }
    parts = [phrases.get(o.get("op"), lambda o: str(o.get("op")).replace("_", " ").capitalize())(o)
             for o in operations if isinstance(o, dict)]
    return "; ".join(parts) or "Edit the workflow"


# ── Apply / discard ─────────────────────────────────────────────────────────


#: Why a revision that is no longer open cannot be applied.
_NOT_APPLICABLE = {
    "applied": "This change has already been applied.",
    "discarded": "This change was discarded.",
    "superseded": "This change is out of date — the workflow changed after it was proposed.",
}


def _owned_revision(workflow_name: str, revision_id: str) -> dict:
    from app.workflow_revisions import store

    revision = store.get_revision(revision_id)
    if revision is None or revision["workflow_name"] != workflow_name:
        raise RevisionNotFound(f"Revision '{revision_id}' not found for '{workflow_name}'.")
    return revision


def _keep_server_fields(definition, current) -> None:
    """Carry deployment bookkeeping over from the stored record."""
    definition.name = current.name
    definition.id = current.id
    definition.is_deployed = current.is_deployed
    definition.published_hash = current.published_hash
    definition.archived = current.archived
    # Back-fill a baseline for workflows deployed before publish-hash tracking
    # existed — what is stored now is, by definition, what is live.
    if definition.is_deployed and not definition.published_hash:
        definition.published_hash = current.semantic_hash()


def _apply_sync(workflow_name: str, revision_id: str, allow_errors: bool) -> dict:
    from app.services.workflow_engine.engine import get_workflow, save_workflow
    from app.services.workflow_engine.models import WorkflowDefinition
    from app.services.workflow_engine.validation import validate_workflow
    from app.workflow_revisions import store

    revision = _owned_revision(workflow_name, revision_id)
    if revision["status"] != "proposed":
        raise RevisionConflict(_NOT_APPLICABLE.get(revision["status"],
                                                   "There is no change to apply here."))
    current = _get_workflow(workflow_name)

    if revision["base_hash"] and current.semantic_hash() != revision["base_hash"]:
        store.update_revision(revision_id, status="superseded")
        raise RevisionConflict(
            "The workflow has changed since this was proposed, so the changes shown are no "
            "longer accurate. Ask again to get a fresh proposal."
        )

    proposed = WorkflowDefinition(**(revision["proposed_definition"] or {}))
    result = validate_workflow(proposed)
    if not result.valid and not allow_errors:
        raise RevisionInvalid(
            f"Applying this would leave {result.error_count} error(s) in the workflow. "
            "Apply anyway to keep working on it, or ask for a different change."
        )

    _keep_server_fields(proposed, current)
    diff = revision.get("diff") or {}
    if diff.get("steps_added") or diff.get("steps_removed"):
        # Saved canvas positions no longer fit the graph; let the builder lay it out.
        proposed.ui_layout = {}

    store.ensure_baseline(workflow_name, current)
    save_workflow(proposed)
    version = store.record_version(
        workflow_name, proposed, source="revision",
        label=revision.get("summary") or revision.get("instruction") or "Revision",
        revision_id=revision_id,
    )
    updated = store.update_revision(revision_id, status="applied", applied_version=version)
    store.supersede_open(workflow_name, except_id=revision_id)

    saved = get_workflow(workflow_name)
    return {
        "revision": updated,
        "version_no": version,
        "workflow": saved.model_dump(mode="json") if saved else None,
        "valid": result.valid,
    }


async def apply(workflow_name: str, revision_id: str, *, allow_errors: bool = False) -> dict:
    return await asyncio.to_thread(_apply_sync, workflow_name, revision_id, allow_errors)


async def discard(workflow_name: str, revision_id: str) -> dict:
    from app.workflow_revisions import store

    def _go():
        revision = _owned_revision(workflow_name, revision_id)
        if revision["status"] not in ("proposed", "needs_clarification"):
            return revision
        return store.update_revision(revision_id, status="discarded")

    return await asyncio.to_thread(_go)


async def list_revisions(workflow_name: str, *, limit: int = 50) -> list[dict]:
    from app.workflow_revisions import store

    return await asyncio.to_thread(store.list_revisions, workflow_name,
                                   limit=limit, with_definition=True)


async def get_revision(workflow_name: str, revision_id: str) -> dict:
    return await asyncio.to_thread(_owned_revision, workflow_name, revision_id)


# ── Versions ────────────────────────────────────────────────────────────────


async def list_versions(workflow_name: str) -> dict:
    from app.workflow_revisions import store

    def _go():
        current = _get_workflow(workflow_name)
        current_hash = current.semantic_hash()
        versions = store.list_versions(workflow_name)
        for v in versions:
            v["is_current"] = v["semantic_hash"] == current_hash
            v["is_published"] = bool(current.published_hash) and \
                v["semantic_hash"] == current.published_hash
        return {
            "workflow_name": workflow_name,
            "current_hash": current_hash,
            "versions": versions,
            # Undo is possible when some recorded state differs from now.
            "can_undo": any(not v["is_current"] for v in versions),
        }

    return await asyncio.to_thread(_go)


async def get_version(workflow_name: str, version_no: int) -> dict:
    from app.workflow_revisions import store

    version = await asyncio.to_thread(store.get_version, workflow_name, version_no)
    if version is None:
        raise RevisionNotFound(f"Version {version_no} of '{workflow_name}' not found.")
    return version


def _restore_sync(workflow_name: str, version_no: int, label: str) -> dict:
    from app.services.workflow_engine.engine import get_workflow, save_workflow
    from app.services.workflow_engine.models import WorkflowDefinition
    from app.workflow_revisions import store

    version = store.get_version(workflow_name, version_no)
    if version is None:
        raise RevisionNotFound(f"Version {version_no} of '{workflow_name}' not found.")
    current = _get_workflow(workflow_name)
    definition = WorkflowDefinition(**version["definition"])
    _keep_server_fields(definition, current)

    store.ensure_baseline(workflow_name, current)
    save_workflow(definition)
    new_version = store.record_version(workflow_name, definition, source="restore", label=label)
    store.supersede_open(workflow_name)
    saved = get_workflow(workflow_name)
    return {
        "restored_version": version_no,
        "version_no": new_version,
        "workflow": saved.model_dump(mode="json") if saved else None,
    }


async def restore_version(workflow_name: str, version_no: int) -> dict:
    return await asyncio.to_thread(_restore_sync, workflow_name, version_no,
                                   f"Restored version {version_no}")


async def undo(workflow_name: str) -> dict:
    """Go back to the most recent recorded state that differs from now."""
    from app.workflow_revisions import store

    def _go():
        current_hash = _get_workflow(workflow_name).semantic_hash()
        target = next((v for v in store.list_versions(workflow_name)
                       if v["semantic_hash"] != current_hash), None)
        if target is None:
            raise RevisionConflict("There is no earlier version to go back to.")
        return _restore_sync(workflow_name, target["version_no"],
                             f"Undo — back to version {target['version_no']}")

    return await asyncio.to_thread(_go)


# ── Suggestions ─────────────────────────────────────────────────────────────


async def suggestions(workflow_name: str, *, client: Any = None) -> dict:
    from app.services.workflow_engine.rule_validation import validate_with_rules
    from app.workflow_revisions.suggestions import suggestions_for

    definition = await asyncio.to_thread(_get_workflow, workflow_name)
    result = await validate_with_rules(definition, client=client)
    return {
        "workflow_name": workflow_name,
        "valid": result.valid,
        "suggestions": suggestions_for([i.model_dump() for i in result.issues]),
    }


# ── Hooks for other ways of changing a workflow ─────────────────────────────


def record_external_change(workflow_name: str, previous, saved, *, source: str, label: str) -> None:
    """Version a change made outside revisions (the visual builder). Best effort."""
    from app.workflow_revisions import store

    try:
        store.ensure_baseline(workflow_name, previous)
        before = store.list_versions(workflow_name)
        number = store.record_version(workflow_name, saved, source=source, label=label)
        if not before or number != before[0]["version_no"]:
            # The definition really changed; open proposals were based on the old one.
            store.supersede_open(workflow_name)
    except Exception as e:  # noqa: BLE001 — history never blocks a save
        logger.warning("Could not record a version for '%s': %s", workflow_name, e)
