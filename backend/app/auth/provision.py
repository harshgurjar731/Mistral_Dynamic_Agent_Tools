"""
The platform agents every Mistral workspace needs.

The RAG query optimiser and the ontology architect are Mistral agents, and an
agent exists only in the Mistral workspace that created it. So each workspace
gets its own, created with its own key and registered under its own name
(``app.rag.store`` namespaces the registration by workspace).
"""

from __future__ import annotations

import logging

from app.auth.context import use_workspace

logger = logging.getLogger(__name__)


async def provision_workspace(workspace_id: str) -> dict:
    """Best effort; a failure is logged and retried on the next start."""
    out: dict = {}
    with use_workspace(workspace_id):
        try:
            from app.dependencies import get_mistral_client
            from app.rag import ontology_agent
            from app.rag import optimizer as rag_optimizer

            client = get_mistral_client()
            out["query_optimizer"] = await rag_optimizer.ensure_system_agent(client)
            out["ontology_architect"] = await ontology_agent.ensure_agent(client)
        except Exception as e:  # noqa: BLE001
            logger.warning("Workspace %s: platform agents not ready: %s", workspace_id, e)
            out["error"] = str(e)
    logger.info("Workspace %s platform agents: %s", workspace_id, out)
    return out


async def provision_all() -> None:
    """At start-up: every active workspace except the Default one (which the
    boot sequence already provisions on the platform key)."""
    from app.auth import store

    try:
        workspaces = store.list_workspaces()
    except Exception as e:  # noqa: BLE001
        logger.warning("Workspace provisioning skipped: %s", e)
        return
    for ws in workspaces:
        if ws["is_default"] or ws["disabled"] or ws["key_status"] == "invalid":
            continue
        await provision_workspace(ws["id"])
