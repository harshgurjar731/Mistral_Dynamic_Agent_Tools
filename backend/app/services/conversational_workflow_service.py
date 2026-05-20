"""
Conversational Workflow Service.

Bridges Mistral Workflows with le Chat by creating a dedicated 'gateway'
Mistral agent that:
  - Has deployment_chat=True  →  appears as an assistant in le Chat
  - Knows the workflow's input_schema
  - Collects inputs conversationally
  - Triggers the workflow execution via an API tool call
  - Streams progress back to the user in the chat

All methods in this service are async and safe to call inside FastAPI request handlers.
"""

import json
import logging
from typing import Any

from mistralai.client import Mistral
from app.config import settings
from app.prompts import CONVERSATIONAL_GATEWAY_SYSTEM_PROMPT, CONVERSATIONAL_GATEWAY_USER_PROMPT

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool definition injected into the gateway agent
# ---------------------------------------------------------------------------

_TRIGGER_TOOL = {
    "type": "function",
    "function": {
        "name": "trigger_workflow_execution",
        "description": (
            "Triggers the workflow execution with the collected user inputs. "
            "Call this once all required inputs have been gathered."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "inputs": {
                    "type": "object",
                    "description": "JSON object containing all required workflow input variables.",
                }
            },
            "required": ["inputs"],
        },
    },
}


def _build_input_schema_desc(input_schema: list[dict]) -> str:
    """Format the workflow input_schema as a human-readable bullet list."""
    if not input_schema:
        return "*(No inputs required — the workflow can run immediately.)*"
    lines = []
    for field in input_schema:
        name = field.get("name", "?")
        ftype = field.get("type", "string")
        desc = field.get("description", "")
        lines.append(f"- **{name}** ({ftype}): {desc}" if desc else f"- **{name}** ({ftype})")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def create_conversational_agent(
    client: Mistral,
    workflow_name: str,
    workflow_description: str,
    input_schema: list[dict],
) -> dict:
    """
    Create (or return an existing) Mistral agent configured as a conversational
    le Chat assistant for the given workflow.

    Returns:
        {
          "agent_id": str,
          "agent_name": str,
          "le_chat_url": str,
          "is_new": bool,
        }
    """
    agent_name = f"[Workflow] {workflow_name.replace('_', ' ').title()}"

    # Check if agent already exists with this name
    try:
        existing_resp = client.beta.agents.list(page=0, page_size=200)
        existing_items = getattr(existing_resp, "data", None) or getattr(existing_resp, "items", []) or []
        for agent in existing_items:
            a_name = getattr(agent, "name", "") or (agent.get("name", "") if isinstance(agent, dict) else "")
            if a_name == agent_name:
                agent_id = getattr(agent, "id", None) or (agent.get("id") if isinstance(agent, dict) else None)
                if agent_id:
                    logger.info("Reusing existing le Chat gateway agent '%s' (%s)", agent_name, agent_id)
                    return {
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "le_chat_url": f"https://chat.mistral.ai/chat?agent={agent_id}",
                        "is_new": False,
                    }
    except Exception as e:
        logger.warning("Could not list existing agents for le Chat check: %s", e)

    # Build system prompt (combining both for le Chat compatibility)
    display_name = workflow_name.replace("_", " ").title()
    system_prompt_base = CONVERSATIONAL_GATEWAY_SYSTEM_PROMPT
    user_context = CONVERSATIONAL_GATEWAY_USER_PROMPT.format(
        workflow_name=workflow_name,
        workflow_display_name=display_name,
        workflow_description=workflow_description or f"A multi-step automated pipeline: {display_name}",
        input_schema_desc=_build_input_schema_desc(input_schema),
    )
    system_prompt = f"{system_prompt_base}\n\n{user_context}"

    # Create the agent
    try:
        create_kwargs: dict[str, Any] = {
            "model": settings.MISTRAL_ORCHESTRATOR_MODEL,
            "name": agent_name,
            "instructions": system_prompt,
            "description": f"Conversational le Chat assistant for the '{workflow_name}' workflow.",
            "tools": [_TRIGGER_TOOL],
            "metadata": {
                "workflow_name": workflow_name,
                "source": "conversational_workflow_service",
                "type": "workflow_gateway",
            },
        }

        # Enable le Chat deployment
        try:
            create_kwargs["deployment_chat"] = True
        except Exception:
            pass  # Some SDK versions may not support this kwarg directly

        agent_obj = client.beta.agents.create(**create_kwargs)
        agent_id = agent_obj.id

        logger.info("Created le Chat gateway agent '%s' (%s) for workflow '%s'", agent_name, agent_id, workflow_name)

        return {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "le_chat_url": f"https://chat.mistral.ai/chat?agent={agent_id}",
            "is_new": True,
        }

    except Exception as e:
        logger.error("Failed to create le Chat gateway agent for '%s': %s", workflow_name, e)
        raise


async def publish_as_le_chat(
    client: Mistral,
    workflow_name: str,
    workflow_description: str,
    input_schema: list[dict],
    existing_agent_id: str | None = None,
) -> dict:
    """
    High-level function: ensures the workflow has a conversational le Chat agent.
    If existing_agent_id is provided, tries to patch it with deployment_chat=True first.
    Falls back to creating a new agent.

    Returns the same dict as create_conversational_agent.
    """
    if existing_agent_id:
        try:
            client.beta.agents.update(
                agent_id=existing_agent_id,
                deployment_chat=True,
            )
            logger.info("Patched agent '%s' with deployment_chat=True", existing_agent_id)
            return {
                "agent_id": existing_agent_id,
                "agent_name": f"[Workflow] {workflow_name.replace('_', ' ').title()}",
                "le_chat_url": f"https://chat.mistral.ai/chat?agent={existing_agent_id}",
                "is_new": False,
            }
        except Exception as e:
            logger.warning("Could not patch existing agent %s: %s — creating new gateway.", existing_agent_id, e)

    return await create_conversational_agent(client, workflow_name, workflow_description, input_schema)


async def get_le_chat_url(agent_id: str) -> str:
    """Returns the le Chat URL for a workflow's gateway agent."""
    return f"https://chat.mistral.ai/chat?agent={agent_id}"
