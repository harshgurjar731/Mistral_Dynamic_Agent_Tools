"""
MCP Publisher — Deploys tool code to remote MCP servers and registers Mistral Connectors.
"""

import logging
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def deploy_to_mcp_server(
    server_url: str, tool_name: str, source_code: str, schema: dict
) -> dict:
    """
    POST the tool's code and schema to the remote MCP server's deploy endpoint.
    Convention: the deploy API lives at {server_url}/deploy.
    """
    deploy_url = f"{server_url.rstrip('/')}/deploy"
    logger.info("Deploying tool '%s' to %s", tool_name, deploy_url)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            deploy_url,
            json={
                "name": tool_name,
                "source_code": source_code,
                "schema": schema,
            },
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info("Tool '%s' deployed successfully to %s", tool_name, deploy_url)
        return result


async def ensure_connector_registered(server_url: str, server_name: str) -> str:
    """
    Register a remote MCP server as a Mistral Connector (idempotent).
    Uses the official Mistral Beta Connectors API:
      POST /v1/connectors
      POST /v1/connectors/{id}/organization/activate
    Returns the connector_id.
    """
    if not settings.MISTRAL_API_KEY:
        logger.warning("No MISTRAL_API_KEY — skipping connector registration")
        return ""

    from mistralai.client import Mistral

    client = Mistral(api_key=settings.MISTRAL_API_KEY)

    # Check if connector already exists by listing
    try:
        existing = client.beta.connectors.list()
        for conn in existing.data:
            if getattr(conn, "name", "") == server_name:
                logger.info(
                    "Connector '%s' already registered (id=%s)", server_name, conn.id
                )
                return conn.id
    except Exception as e:
        logger.warning("Could not list connectors: %s", e)

    # Create new connector
    try:
        connector = client.beta.connectors.create(
            name=server_name,
            type="mcp",
            config={"url": server_url},
        )
        connector_id = connector.id
        logger.info(
            "Created Mistral Connector '%s' (id=%s)", server_name, connector_id
        )

        # Activate for organization — auto-approve all tool calls
        client.beta.connectors.activate_for_organization(
            connector_id=connector_id,
            tool_configuration={"skip_confirmation": ["*"]},
        )
        logger.info("Activated connector '%s' for organization", server_name)

        return connector_id

    except Exception as e:
        logger.error("Failed to register Mistral Connector: %s", e)
        raise
