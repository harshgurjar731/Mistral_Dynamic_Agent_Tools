"""
LibraryProvisioningLayer — Creates the document library an agent was designed
around, when none of the existing ones fit.

No LLM call: the decision was made by LibrarySelectionLayer, which returns a
``create_library`` request when the requirement calls for the user's own
documents and nothing in the inventory covers the subject.

Without this, that case had two bad outcomes and no good one. Attaching an
unrelated library grounds the agent in material that does not answer the
question; attaching nothing produces an agent designed around documents it
cannot reach, whose instructions tell it to cite sources it does not have. An
empty library is the honest third option — the agent is correctly wired, and
the user fills it afterwards.

Runs before the guardrail layer, so the envelope is decided against the
libraries the agent will actually hold rather than the ones that existed when
planning started.
"""

import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn
from app.layers.agent.inventory_layer import INVENTORY_KEY

logger = logging.getLogger(__name__)


class LibraryProvisioningLayer(Layer):
    """Create and attach a requested document library."""

    name = "library_provisioning"
    label = "Provision documents"
    detail = "Creates the document library this agent needs, if it does not exist yet."

    def should_run(self, ctx: PipelineContext) -> bool:
        return (
            self.enabled
            and not ctx.agent_id
            and not ctx.conversation_id
            and bool(ctx.agent_spec.requested_library)
        )

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.services import library_service

        request = ctx.agent_spec.requested_library or {}
        name = str(request.get("name") or "").strip()
        description = str(request.get("description") or "").strip()

        if not name:
            return await next(ctx)

        ctx.emit("status", f"Creating document library “{name}”…")

        try:
            library = await library_service.create_library(name=name, description=description)
        except Exception as e:
            # Non-fatal. The agent loses its grounding but still answers, which
            # beats failing the whole request over a library the user can also
            # create by hand.
            logger.error("Could not create library '%s': %s", name, e)
            ctx.emit("library_provisioned", {
                "created": False, "name": name, "error": str(e),
            })
            return await next(ctx)

        library_id = library.get("id")
        if not library_id:
            logger.error("Library creation for '%s' returned no id", name)
            return await next(ctx)

        attached = list(ctx.agent_spec.document_library_ids or [])
        attached.append(library_id)
        ctx.agent_spec.document_library_ids = attached

        # Keep the inventory honest for any layer after this one that validates
        # library ids against it — the new library is real now.
        inventory = ctx.metadata.get(INVENTORY_KEY)
        if inventory is not None:
            inventory.setdefault("library_ids", []).append(library_id)
            inventory.setdefault("library_names", {})[library_id] = (
                library.get("name") or name
            )
        # Marks it as new rather than pre-existing when the agent card is built.
        ctx.metadata.setdefault("created_library_ids", []).append(library_id)

        ctx.agent_spec.rationale["library_provisioning"] = (
            f"No existing library covered this subject, so “{name}” was created empty "
            f"and attached. Add documents to it and the agent will use them."
        )
        ctx.set_layer_summary(self.name, ctx.agent_spec.rationale["library_provisioning"])

        logger.info("Created document library '%s' (%s) for the new agent", name, library_id)
        ctx.emit("library_provisioned", {
            "created": True,
            "library_id": library_id,
            "name": library.get("name") or name,
            "description": library.get("description") or description,
            "empty": True,
        })

        return await next(ctx)
