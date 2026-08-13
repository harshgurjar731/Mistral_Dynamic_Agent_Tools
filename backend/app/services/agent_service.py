"""
Agent Service — Mistral Agents API wrapper.
Uses direct HTTP for list operations (SDK sentinel bug workaround)
and SDK client for create/update/delete.
"""

import asyncio
import logging
from functools import partial

import httpx
from mistralai.client import Mistral
from mistralai.client.models.completionargs import CompletionArgs
from app.config import settings, map_model_name
from app.exceptions import MistralAPIError, AgentNotFoundError
from app.ontology import store as annotation_store
from app.ontology.vocab import DEFAULT_TIER, AgentTier, Predicate, SubjectType, coerce_tier

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


# ── Tier resolution ────────────────────────────────────────────────────────
#
# Order of authority:
#   1. an explicit annotation in the concept store  (authoritative)
#   2. `metadata.tier` on the Mistral agent          (authoritative)
#   3. the keyword heuristic below                   (last resort, lossy)
#
# The heuristic is kept only for agents created before annotation existed. It
# matches substrings, which is exactly why it mis-filed
# `foundation_final_response_generator` as a domain agent: the keyword reads
# "final_response_generation" and the name ends "generator". Anything it
# returns is a guess — annotate the agent to make it a fact.

_FOUNDATION_KEYWORDS = [
    "jailbreak", "moderation", "moderator", "guardrail", "topic_control",
    "reviewer", "review_agent", "output_moderation", "final_response_generation",
    "final_response_generator", "safety", "routing",
]
_USECASE_KEYWORDS = [
    "mortgage", "vehicle_finance", "vehicle_loan", "car_loan", "personal_loan",
    "insurance", "home_loan", "auto_loan", "credit_card",
]


def _infer_tier(name: str, instructions: str = "") -> str:
    """Guess the agent tier from its name and instructions. Fallback only."""
    name_lower = (name or "").lower().replace(" ", "_")
    instr_lower = (instructions or "").lower()

    for kw in _FOUNDATION_KEYWORDS:
        if kw in name_lower or kw in instr_lower:
            return AgentTier.FOUNDATION.value

    for kw in _USECASE_KEYWORDS:
        if kw in name_lower:
            return AgentTier.USE_CASE.value

    # Most workflow agents are domain-level, so that is the safer default.
    return DEFAULT_TIER.value


def record_agent_annotations(agent_id: str, data: dict, source: str = "user") -> None:
    """Mirror an agent's tier, domains and capabilities into the concept store.

    Best-effort by design. Annotation improves planning and validation; it is
    never what makes an agent work, so a store failure must not fail the create
    or update that triggered it.
    """
    if not agent_id:
        return

    try:
        # Only write a tier when one was actually supplied. Defaulting here
        # would let a rename that carries no tier silently re-file the agent.
        if data.get("tier"):
            tier = coerce_tier(data["tier"])
            annotation_store.set_annotations(
                SubjectType.AGENT.value, agent_id, Predicate.HAS_TIER.value,
                [f"agent_tier.{tier}"], source=source,
            )

        for key, predicate in (
            ("domains", Predicate.SERVES_DOMAIN.value),
            ("capabilities", Predicate.REQUIRES_CAPABILITY.value),
            ("data_classes", Predicate.HANDLES_DATA_CLASS.value),
        ):
            if key in data and data[key] is not None:
                annotation_store.set_annotations(
                    SubjectType.AGENT.value, agent_id, predicate,
                    data[key] or [], source=source,
                )
    except Exception as e:
        logger.warning("Could not record annotations for agent %s: %s", agent_id, e)


# Strong references to in-flight classification tasks.
#
# asyncio only holds a weak reference to a running task, so a fire-and-forget
# create_task can be garbage-collected mid-flight and silently never finish.
_classification_tasks: set = set()


def schedule_classification(
    client,
    *,
    subject_type: str,
    subject_id: str,
    name: str,
    description: str = "",
    instructions: str = "",
) -> None:
    """Classify a resource in the background. Never blocks, never raises.

    Deliberately not awaited: the resource already exists and is usable, and an
    annotation arriving two seconds later costs nothing. Blocking the create on
    an LLM round trip would make hand-made agents feel slower than generated
    ones, for a benefit the user never sees at that moment.
    """
    try:
        from app.ontology.classifier import classify_and_apply

        task = asyncio.create_task(
            classify_and_apply(
                client, subject_type=subject_type, subject_id=subject_id,
                name=name, description=description, instructions=instructions,
            )
        )
        _classification_tasks.add(task)
        task.add_done_callback(_classification_tasks.discard)
    except RuntimeError:
        # No running loop (a sync caller, or shutdown). Classification is an
        # enhancement — skipping it is fine.
        logger.debug("No event loop for classification of %s", subject_id)
    except Exception as e:
        logger.warning("Could not schedule classification for %s: %s", subject_id, e)


def _resolve_tier(agent_id: str | None, name: str, instructions: str, explicit: str | None) -> str:
    """Apply the authority order above to land on a single tier value."""
    if explicit:
        return coerce_tier(explicit)

    if agent_id:
        annotated = annotation_store.tier_for_agent(agent_id)
        if annotated:
            return coerce_tier(annotated)

    return _infer_tier(name, instructions)



async def list_agents(client: Mistral, page: int = 0, page_size: int = 20) -> dict:
    """List all agents via direct HTTP (bypasses SDK sentinel serialization)."""
    try:
        resp = _http_client.get("/v1/agents", params={"page": page, "page_size": page_size})
        resp.raise_for_status()
        data = resp.json()

        # API returns an array directly per OpenAPI spec
        agent_list = data if isinstance(data, list) else data.get("data", data)

        # One annotation query for the whole page. Resolving tiers one agent at
        # a time here would be 40 round trips on a list endpoint.
        agent_ids = [
            (a.get("id") if isinstance(a, dict) else getattr(a, "id", None)) or ""
            for a in agent_list
        ]
        annotated_tiers = annotation_store.tiers_for_agents(agent_ids)

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
                    "tier": coerce_tier(
                        explicit_tier
                        or annotated_tiers.get(agent.get("id") or "")
                        or _infer_tier(a_name, a_instr)
                    ),
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
                    "tier": coerce_tier(
                        explicit_tier
                        or annotated_tiers.get(getattr(agent, "id", "") or "")
                        or _infer_tier(a_name, a_instr)
                    ),
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
            "tier": _resolve_tier(agent.get("id"), a_name, a_instr, explicit_tier),
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
            create_kwargs["metadata"] = {"tier": coerce_tier(data["tier"])}
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

        agent = await asyncio.to_thread(partial(client.beta.agents.create, **create_kwargs))
        record_agent_annotations(agent.id, data, source="user")

        # A hand-made agent has no planner goal to infer a domain from, and the
        # lexical heuristics only fire on words that literally appear. When the
        # form left the classification blank, ask a model to fill it in — in the
        # background, because the agent already exists and the caller should not
        # wait several seconds for an annotation.
        if not data.get("domains"):
            schedule_classification(
                client,
                subject_type=SubjectType.AGENT.value,
                subject_id=agent.id,
                name=data.get("name") or "",
                description=data.get("description") or "",
                instructions=data.get("instructions") or "",
            )

        return {"id": agent.id, "name": getattr(agent, "name", None), "model": getattr(agent, "model", None)}
    except Exception as e:
        logger.error(f"Failed to create agent: {e}")
        raise MistralAPIError(f"Failed to create agent: {str(e)}")


async def update_agent(client: Mistral, agent_id: str, data: dict) -> dict:
    """Update an agent."""
    try:
        agent = await asyncio.to_thread(client.beta.agents.get, agent_id=agent_id)
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
            existing_metadata["tier"] = coerce_tier(data["tier"])
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

        agent = await asyncio.to_thread(partial(client.beta.agents.update, **update_kwargs))
        # Only the keys the caller actually sent are re-annotated; omitting
        # `tier` on a rename must not rewrite the agent's classification.
        annotatable = {k: data[k] for k in ("tier", "domains", "capabilities", "data_classes") if k in data}
        if annotatable:
            record_agent_annotations(agent_id, annotatable, source="user")
        return {"id": agent.id, "name": getattr(agent, "name", None)}
    except Exception as e:
        if "not found" in str(e).lower():
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to update agent: {str(e)}")


async def delete_agent(client: Mistral, agent_id: str) -> dict:
    """Delete an agent."""
    try:
        await asyncio.to_thread(client.beta.agents.delete, agent_id=agent_id)
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
