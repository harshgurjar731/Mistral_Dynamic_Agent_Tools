"""
Agent Routes — CRUD /api/agents
Aligned with Mistral OpenAPI spec endpoints.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, List

from app.dependencies import get_mistral_client
from app.services import agent_service

router = APIRouter(tags=["Agents"])


class ConnectorRef(BaseModel):
    """A connector attached to an agent, with an optional tool allow/deny list."""
    connector_id: str
    include: Optional[List[str]] = None
    exclude: Optional[List[str]] = None
    requires_confirmation: Optional[List[str]] = None


class GuardrailCategoryThresholdsRequest(BaseModel):
    """Per-category moderation thresholds (0-1). Unset categories use the model default.

    `dangerous_and_criminal_content` is the v1 moderation model's combined
    category; `dangerous`, `criminal` and `jailbreaking` only exist on v2.
    """
    sexual: Optional[float] = None
    hate_and_discrimination: Optional[float] = None
    violence_and_threats: Optional[float] = None
    dangerous: Optional[float] = None
    criminal: Optional[float] = None
    dangerous_and_criminal_content: Optional[float] = None
    selfharm: Optional[float] = None
    health: Optional[float] = None
    financial: Optional[float] = None
    law: Optional[float] = None
    pii: Optional[float] = None
    jailbreaking: Optional[float] = None


class GuardrailModerationConfigRequest(BaseModel):
    model_name: Optional[str] = None
    custom_category_thresholds: Optional[GuardrailCategoryThresholdsRequest] = None
    ignore_other_categories: Optional[bool] = None
    action: Optional[str] = None  # "none" | "block"


class GuardrailConfigRequest(BaseModel):
    block_on_error: Optional[bool] = None
    moderation_llm_v1: Optional[GuardrailModerationConfigRequest] = None
    moderation_llm_v2: Optional[GuardrailModerationConfigRequest] = None


class AgentRuleRef(BaseModel):
    """An optional agent rule selected at creation, and who chose it."""
    rule_id: str
    source: str = "user"      # ai | user
    reason: str = ""


class CreateAgentRequest(BaseModel):
    name: str
    model: str = "mistral-large-latest"
    instructions: str = "You are a helpful assistant."
    description: Optional[str] = None
    tier: Optional[str] = None
    tools: list = []
    document_library_ids: Optional[List[str]] = None
    connectors: Optional[List[ConnectorRef]] = None
    # Completion args — same set the update endpoint accepts. Unset leaves the
    # model's defaults.
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    random_seed: Optional[int] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None
    # Opt-in access to the knowledge graph and curated industry knowledge.
    # Off by default: an agent that holds a library to quote one clause does not
    # need a second retrieval tool competing for every turn.
    knowledge_graph: bool = False
    # At most one entry in practice — the array shape mirrors the Mistral API,
    # which allows several, but nothing scopes multiple entries differently.
    guardrails: Optional[List[GuardrailConfigRequest]] = None
    # Optional agent rules chosen in the create form. Always-on rules apply
    # without being listed.
    rules: Optional[List[AgentRuleRef]] = None


class UpdateAgentRequest(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    instructions: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    random_seed: Optional[int] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None
    tools: Optional[list] = None
    document_library_ids: Optional[List[str]] = None
    # Omitted (None) means "leave the attached connectors alone"; an explicit
    # empty list detaches all of them.
    connectors: Optional[List[ConnectorRef]] = None
    # Omitted means "leave it as it is"; False actively detaches the tool.
    knowledge_graph: Optional[bool] = None
    # Omitted means "leave guardrails alone"; an explicit empty list clears them.
    guardrails: Optional[List[GuardrailConfigRequest]] = None


_AGENT_SORTS = {"newest", "oldest", "name_asc", "name_desc"}


@router.get("/agents")
async def list_agents(
    page: int = 0,
    page_size: int = 20,
    sort: Optional[str] = None,
    client=Depends(get_mistral_client),
):
    """List saved agents.

    Without ``sort`` this is one page, in the order Mistral returns them. With
    ``sort`` the whole list is read and ordered first, so page 2 of "name A–Z"
    really continues page 1 — sorting a single page would not.
    """
    if sort not in _AGENT_SORTS:
        return await agent_service.list_agents(client, page=page, page_size=page_size)

    everything: list[dict] = []
    for p in range(20):  # up to 2,000 agents
        chunk = await agent_service.list_agents(client, page=p, page_size=100)
        everything.extend(chunk["items"])
        if len(chunk["items"]) < 100:
            break

    if sort in ("newest", "oldest"):
        everything.sort(key=lambda a: a.get("created_at") or "", reverse=sort == "newest")
    else:
        everything.sort(key=lambda a: (a.get("name") or "").lower(), reverse=sort == "name_desc")

    total = len(everything)
    start = max(page, 0) * page_size
    return {
        "items": everything[start:start + page_size],
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
        "count": total,
    }


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, client=Depends(get_mistral_client)):
    """Get a specific agent by ID."""
    return await agent_service.get_agent(client, agent_id)


@router.post("/agents")
async def create_agent(request: CreateAgentRequest, client=Depends(get_mistral_client)):
    """Create a permanent agent."""
    return await agent_service.create_agent(client, request.model_dump())


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, request: UpdateAgentRequest, client=Depends(get_mistral_client)):
    """Update agent config."""
    return await agent_service.update_agent(client, agent_id, request.model_dump(exclude_none=True))


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, client=Depends(get_mistral_client)):
    """Delete an agent.

    Only the agent goes: its tools, libraries and connectors are detached by
    the delete itself and are not deleted. Its annotations — its edges in the
    knowledge graph — are removed.
    """
    from app.services import delete_rules

    result = await agent_service.delete_agent(client, agent_id)
    result["graph"] = delete_rules.forget_in_graph("agent", agent_id)
    try:
        from app.rag import scope as rag_scope

        rag_scope.invalidate(agent_id)
    except Exception:  # noqa: BLE001 — a cache entry for a deleted agent is harmless
        pass
    return result
