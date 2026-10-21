"""
RevisionContextLayer — everything an instruction is interpreted against.

No LLM call. Loads the stored definition (the base every later layer diffs
against), what is wrong with it now, the earlier turns of the conversation,
and — only when there is an instruction to interpret — the agents, activities
and connectors a new or changed step may bind to.
"""

import asyncio
import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

#: Earlier turns shown to the intent layer — enough for "undo that" and for an
#: answer to its own question, not a transcript.
_HISTORY_TURNS = 8


def definition_payload(definition) -> dict:
    """A definition as the revision layers handle it: plain JSON, no record columns."""
    data = definition.model_dump(mode="json", exclude={"created_at", "updated_at"})
    data.pop("has_unpublished_changes", None)
    return data


class RevisionContextLayer(Layer):
    """Load the workflow, its issues, the conversation and the bindable catalogue."""

    name = "revision_context"
    label = "Read the workflow"
    detail = "Loads the saved workflow, what is wrong with it, and what its steps can use."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.services.workflow_engine.engine import get_workflow
        from app.services.workflow_engine.validation import validate_workflow
        from app.workflow_revisions import store

        spec = ctx.revision_spec
        definition = await asyncio.to_thread(get_workflow, spec.workflow_name)
        if definition is None:
            ctx.set_error(f"Workflow '{spec.workflow_name}' not found.")
            return await next(ctx)
        if not definition.steps:
            ctx.set_error("This workflow exists only on the Mistral server — there is no "
                          "local definition to revise.")
            return await next(ctx)

        spec.base = definition_payload(definition)
        spec.base_hash = definition.semantic_hash()
        spec.base_issues = [i.model_dump() for i in validate_workflow(definition).issues]

        history = await asyncio.to_thread(
            store.list_revisions, spec.workflow_name, limit=_HISTORY_TURNS)
        spec.history = [
            {k: r.get(k) for k in ("instruction", "status", "summary", "clarification")}
            for r in history
        ]

        # The id given for a focus step must exist; a stale selection is dropped
        # rather than fed to the model as if it were real.
        known = {s["id"] for s in spec.base["steps"]}
        spec.focus_step_ids = [i for i in spec.focus_step_ids if i in known]

        if not spec.operations_given:
            spec.catalog = await _catalog(ctx)
            await _load_process_knowledge(ctx, spec.workflow_name)

        ctx.set_layer_summary(
            self.name,
            f"{len(spec.base['steps'])} steps, {len(spec.base_issues)} open issue(s)"
            + (f", focused on {', '.join(spec.focus_step_ids)}" if spec.focus_step_ids else ""),
        )
        return await next(ctx)


async def _load_process_knowledge(ctx: PipelineContext, workflow_name: str) -> None:
    """Ground a revision in the process the workflow was built for, if any.

    Only workflows built with process knowledge carry an ``implements_process``
    annotation, so every other workflow revises exactly as before.
    """
    from app.process_knowledge import context as pk_context, pipeline as pk, resolver

    try:
        docs = await asyncio.to_thread(resolver.documents_for_subject, "workflow", workflow_name)
    except Exception as e:
        logger.debug("No process knowledge for revision of %s: %s", workflow_name, e)
        return
    if docs:
        ctx.metadata[pk.CONTEXT_KEY] = pk_context.build(docs, mode="workflow")
        ctx.metadata[pk.USAGE_KEY] = {}


async def _catalog(ctx: PipelineContext) -> dict:
    """Agents, activities and connectors a step may bind to. Never raises."""
    from app.layers.workflow.inventory_layer import summarise_instructions
    from app.services import agent_service, connector_service
    from app.services.tool_resolver import tool_resolver

    tools, agents_resp, connectors = await asyncio.gather(
        tool_resolver.list_tools(),
        agent_service.list_agents(ctx.client, page=0, page_size=100),
        connector_service.describe_for_prompt(None),
        return_exceptions=True,
    )

    activities = []
    for t in tools if isinstance(tools, list) else []:
        if t.get("purpose") != "activity":
            continue
        schema = t.get("schema") or {}
        fn = schema.get("function", {}) if isinstance(schema, dict) else {}
        name = fn.get("name") or t.get("name")
        if not name:
            continue
        params = fn.get("parameters", {}) or {}
        activities.append({
            "name": name,
            "description": fn.get("description") or "",
            "parameters": params.get("properties", {}),
            "required": params.get("required", []),
            "output_schema": t.get("output_schema"),
        })

    agents = [
        {
            "id": a.get("id"),
            "name": a.get("name"),
            "description": a.get("description") or "",
            "instructions": summarise_instructions(a.get("instructions", "")),
        }
        for a in (agents_resp.get("items", []) if isinstance(agents_resp, dict) else [])
        if a.get("id")
    ]

    if isinstance(connectors, Exception):
        logger.warning("Connectors unavailable for revision: %s", connectors)
        connector_text = "(none available)"
    else:
        connector_text = connectors[0]

    return {"agents": agents, "activities": activities, "connectors": connector_text}
