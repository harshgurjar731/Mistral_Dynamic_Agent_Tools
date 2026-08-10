"""
Agent Service — Mistral Agents API wrapper.
Uses direct HTTP for list operations (SDK sentinel bug workaround)
and SDK client for create/update/delete.
"""

import logging
import httpx
from mistralai.client import Mistral
from mistralai.client.models.completionargs import CompletionArgs
from app.config import settings, map_model_name
from app.exceptions import MistralAPIError, AgentNotFoundError

logger = logging.getLogger(__name__)


def _connector_refs(tools) -> list[dict]:
    """Read the connector selections back off an agent's `tools` array."""
    from app.services.connector_service import extract_connector_refs

    return extract_connector_refs(tools if isinstance(tools, list) else [])


def _current_attachments(agent_id: str) -> dict:
    """Read an agent's live `tools` array back into the three inputs of get_tools().

    Reads the raw JSON rather than the SDK object: the parsing here matches
    plain dicts, and the SDK hands back typed models that would silently yield
    nothing. A failure degrades to "nothing attached" rather than raising —
    losing an attachment is bad, but blocking an unrelated rename is worse.
    """
    from app.services.connector_service import extract_connector_refs

    empty = {"tools": [], "document_library_ids": None, "connectors": []}
    try:
        raw = _http_client.get(f"/v1/agents/{agent_id}").json()
    except Exception as e:
        logger.warning("Could not read existing attachments for %s: %s", agent_id, e)
        return empty

    tools = raw.get("tools") or []
    if not isinstance(tools, list):
        return empty

    tool_keys: list[str] = []
    doc_lib_ids: list[str] | None = None

    for tool in tools:
        if isinstance(tool, str):
            tool_keys.append(tool)
            continue
        if not isinstance(tool, dict):
            continue

        tool_type = tool.get("type")
        if tool_type == "connector":
            continue  # handled by extract_connector_refs
        if tool_type == "document_library":
            ids = tool.get("library_ids")
            if isinstance(ids, list) and ids:
                doc_lib_ids = ids
                # Carried back as a tool key too, because that is how callers
                # express "the library is attached". Keeping the two in step
                # means an explicit `tools` list that drops the key detaches the
                # library, even though the ids are still carried over.
                tool_keys.append("document_library")
            continue
        if tool_type == "function":
            name = (tool.get("function") or {}).get("name")
            if name:
                tool_keys.append(name)
            continue
        if tool_type:
            tool_keys.append(tool_type)

    return {
        "tools": tool_keys,
        "document_library_ids": doc_lib_ids,
        "connectors": extract_connector_refs(tools),
    }


def _extract_completion_args(agent: dict) -> dict:
    """Extract completion_args from a raw Mistral agent dict into a flat dict."""
    ca = agent.get("completion_args") or {}
    return {
        "temperature": ca.get("temperature"),
        "top_p": ca.get("top_p"),
        "max_tokens": ca.get("max_tokens"),
        "random_seed": ca.get("random_seed"),
        "frequency_penalty": ca.get("frequency_penalty"),
        "presence_penalty": ca.get("presence_penalty"),
    }

# Direct HTTP client for endpoints where SDK has sentinel issues
_http_client = httpx.Client(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
    timeout=30.0,
)


# ── Tier inference heuristic (when metadata.tier is absent) ────────────────

_FOUNDATION_KEYWORDS = [
    "jailbreak", "moderation", "moderator", "guardrail", "topic_control",
    "reviewer", "review_agent", "output_moderation", "final_response_generation",
    "safety", "routing",
]
_USECASE_KEYWORDS = [
    "mortgage", "vehicle_finance", "vehicle_loan", "car_loan", "personal_loan",
    "insurance", "home_loan", "auto_loan", "credit_card",
]


def _infer_tier(name: str, instructions: str = "") -> str:
    """Infer the agent tier from its name and instructions when metadata is absent."""
    name_lower = (name or "").lower().replace(" ", "_")
    instr_lower = (instructions or "").lower()

    # Check foundation first
    for kw in _FOUNDATION_KEYWORDS:
        if kw in name_lower or kw in instr_lower:
            return "foundation"

    # Check use-case specific
    for kw in _USECASE_KEYWORDS:
        if kw in name_lower:
            return "use_case"

    # Default to domain (not foundation) — most workflow agents are domain-level
    return "domain"



async def list_agents(client: Mistral, page: int = 0, page_size: int = 20) -> dict:
    """List all agents via direct HTTP (bypasses SDK sentinel serialization)."""
    try:
        resp = _http_client.get("/v1/agents", params={"page": page, "page_size": page_size})
        resp.raise_for_status()
        data = resp.json()

        # API returns an array directly per OpenAPI spec
        agent_list = data if isinstance(data, list) else data.get("data", data)
        agents = []
        for agent in agent_list:
            if isinstance(agent, dict):
                meta = agent.get("metadata", {}) if isinstance(agent.get("metadata"), dict) else {}
                explicit_tier = meta.get("tier")
                a_name = agent.get("name", "")
                a_instr = agent.get("instructions", "")
                agents.append({
                    "id": agent.get("id"),
                    "name": a_name,
                    "model": agent.get("model"),
                    "description": agent.get("description"),
                    "instructions": a_instr,
                    "tools": agent.get("tools", []),
                    "connectors": _connector_refs(agent.get("tools")),
                    "created_at": str(agent.get("created_at", "")),
                    "tier": explicit_tier if explicit_tier else _infer_tier(a_name, a_instr),
                    **_extract_completion_args(agent),
                })
            else:
                meta = getattr(agent, "metadata", None)
                explicit_tier = meta.get("tier") if isinstance(meta, dict) else None
                a_name = getattr(agent, "name", "") or ""
                a_instr = getattr(agent, "instructions", "") or ""
                ca_obj = getattr(agent, "completion_args", None)
                ca_dict = ca_obj.model_dump() if ca_obj and hasattr(ca_obj, "model_dump") else {}
                agents.append({
                    "id": getattr(agent, "id", None),
                    "name": a_name,
                    "model": getattr(agent, "model", None),
                    "description": getattr(agent, "description", None),
                    "instructions": a_instr,
                    "tools": getattr(agent, "tools", []),
                    "connectors": _connector_refs(getattr(agent, "tools", None)),
                    "created_at": str(getattr(agent, "created_at", "")),
                    "tier": explicit_tier if explicit_tier else _infer_tier(a_name, a_instr),
                    "temperature": ca_dict.get("temperature"),
                    "top_p": ca_dict.get("top_p"),
                    "max_tokens": ca_dict.get("max_tokens"),
                    "random_seed": ca_dict.get("random_seed"),
                    "frequency_penalty": ca_dict.get("frequency_penalty"),
                    "presence_penalty": ca_dict.get("presence_penalty"),
                })
        # Paginated response format for frontend useInfiniteQuery
        total_pages = 1 if len(agents) < page_size else page + 2
        return {
            "items": agents,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "count": len(agents),
        }
    except httpx.HTTPStatusError as e:
        logger.error(f"Failed to list agents: {e.response.text}")
        raise MistralAPIError(f"Failed to list agents: {e.response.text}")
    except Exception as e:
        logger.error(f"Failed to list agents: {e}")
        raise MistralAPIError(f"Failed to list agents: {str(e)}")


async def get_agent(client: Mistral, agent_id: str) -> dict:
    """Get a single agent by ID (uses direct HTTP for reliable field access)."""
    try:
        # Use direct HTTP — the SDK's beta.agents.get() may omit instructions
        resp = _http_client.get(f"/v1/agents/{agent_id}")
        resp.raise_for_status()
        agent = resp.json()

        logger.info("RAW Mistral agent keys: %s", list(agent.keys()))
        logger.info("RAW instructions field: %r", agent.get("instructions"))

        meta = agent.get("metadata", {}) if isinstance(agent.get("metadata"), dict) else {}
        explicit_tier = meta.get("tier")
        a_name = agent.get("name", "") or ""
        a_instr = agent.get("instructions", "") or ""
        return {
            "id": agent.get("id"),
            "name": a_name,
            "model": agent.get("model"),
            "description": agent.get("description"),
            "instructions": a_instr,
            "tools": agent.get("tools", []),
            "connectors": _connector_refs(agent.get("tools")),
            "created_at": str(agent.get("created_at", "")),
            "tier": explicit_tier if explicit_tier else _infer_tier(a_name, a_instr),
            **_extract_completion_args(agent),
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to get agent: {e.response.text}")
    except Exception as e:
        if "not found" in str(e).lower() or "404" in str(e):
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to get agent: {str(e)}")


async def create_agent(client: Mistral, data: dict) -> dict:
    """Create a new agent."""
    try:
        create_kwargs = {
            "model": map_model_name(data["model"]),
            "name": data["name"],
            "instructions": data.get("instructions", "You are a helpful assistant."),
        }
        if data.get("description"):
            create_kwargs["description"] = data["description"]
        if data.get("tier"):
            create_kwargs["metadata"] = {"tier": data["tier"]}
        # Tools, libraries and connectors all live in the same `tools` array —
        # connectors are entries of type "connector", not a separate field — so
        # they are resolved together and assigned once.
        from app.services.tool_registry import get_tools

        tool_keys = data.get("tools") or []
        doc_lib_ids = data.get("document_library_ids")
        if not tool_keys and doc_lib_ids:
            tool_keys = ["document_library"]

        tool_specs = get_tools(
            tool_keys,
            document_library_ids=doc_lib_ids,
            connectors=data.get("connectors"),
        )
        if tool_specs:
            create_kwargs["tools"] = tool_specs

        agent = client.beta.agents.create(**create_kwargs)
        return {"id": agent.id, "name": getattr(agent, "name", None), "model": getattr(agent, "model", None)}
    except Exception as e:
        logger.error(f"Failed to create agent: {e}")
        raise MistralAPIError(f"Failed to create agent: {str(e)}")


async def update_agent(client: Mistral, agent_id: str, data: dict) -> dict:
    """Update an agent."""
    try:
        agent = client.beta.agents.get(agent_id=agent_id)
        update_kwargs = {"agent_id": agent_id}
        if "name" in data:
            update_kwargs["name"] = data["name"]
        if "instructions" in data:
            update_kwargs["instructions"] = data["instructions"]
        if "description" in data:
            update_kwargs["description"] = data["description"]
        if "model" in data:
            update_kwargs["model"] = map_model_name(data["model"])
        if "tier" in data:
            existing_metadata = getattr(agent, "metadata", {}) or {}
            existing_metadata["tier"] = data["tier"]
            update_kwargs["metadata"] = existing_metadata

        # Build CompletionArgs if any completion parameter is provided
        completion_fields = ["temperature", "top_p", "max_tokens", "random_seed", "frequency_penalty", "presence_penalty"]
        ca_data = {k: data[k] for k in completion_fields if k in data}
        if ca_data:
            update_kwargs["completion_args"] = CompletionArgs(**ca_data)

        # Handle tools update (named tools, document_library and connectors).
        #
        # All three share one `tools` array on the agent, and the array is
        # rebuilt wholesale on every update. So each of the three has to be
        # supplied on every write, even when the caller only meant to change
        # one of them. Anything the caller omits is carried over from the live
        # agent; only an explicit value replaces it.
        #
        # This distinction matters both ways: omitting `tools` while attaching a
        # connector must not strip the agent's tools, and passing `tools: []`
        # must still remove them all — a silent no-op there would leave the
        # agent able to call a tool the UI says it lost.
        if "tools" in data or "document_library_ids" in data or "connectors" in data:
            from app.services.tool_registry import get_tools

            current = _current_attachments(agent_id)

            tool_keys = data["tools"] if "tools" in data else current["tools"]
            doc_lib_ids = (
                data["document_library_ids"]
                if "document_library_ids" in data
                else current["document_library_ids"]
            )
            connectors = data["connectors"] if "connectors" in data else current["connectors"]

            update_kwargs["tools"] = get_tools(
                tool_keys,
                document_library_ids=doc_lib_ids,
                connectors=connectors,
            )

        agent = client.beta.agents.update(**update_kwargs)
        return {"id": agent.id, "name": getattr(agent, "name", None)}
    except Exception as e:
        if "not found" in str(e).lower():
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to update agent: {str(e)}")


async def delete_agent(client: Mistral, agent_id: str) -> dict:
    """Delete an agent."""
    try:
        client.beta.agents.delete(agent_id=agent_id)
        return {"deleted": True, "agent_id": agent_id}
    except Exception as e:
        err_str = str(e).lower()
        if "not found" in err_str or "404" in err_str:
            raise AgentNotFoundError(agent_id)
        if "permission" in err_str or "403" in err_str:
            raise MistralAPIError(
                "Permission denied: You cannot delete this agent. It may be a system or built-in agent.", 
                status_code=403
            )
        raise MistralAPIError(f"Failed to delete agent: {str(e)}")
