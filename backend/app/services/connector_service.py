"""
Connector Service — Mistral Beta Connectors API wrapper.

A connector is an MCP server registered *with Mistral*, so the platform owns the
credentials, the tool listing and the execution. That is the whole point of this
module: unlike the Docker Tool Service MCP registry (see ``tool_resolver``),
nothing here proxies through our own infrastructure, and no tool code is ever
deployed by us.

Two families of connector show up in ``list_connectors()``:

* **Directory connectors** — installed into the organisation from Studio by an
  admin. They come back with ``mistral: true`` and cannot be created or deleted
  through this API; we reference them by name or id and nothing more.
* **Custom connectors** — created here, pointing at any reachable MCP server URL.

Uses direct HTTP rather than the SDK, matching ``agent_service`` and
``conversation_service``: the beta surface moves faster than the pinned SDK and
several ``client.beta.connectors.*`` signatures do not match the documented
request bodies.
"""

import logging
from typing import Any, Literal

import httpx

from app.config import settings
from app.exceptions import MistralAPIError

logger = logging.getLogger(__name__)

Scope = Literal["organization", "workspace", "user"]

# Scopes a connector can be activated for / hold credentials at. Ordered from
# broadest to narrowest, which is also the order the platform resolves them in.
SCOPES: tuple[Scope, ...] = ("organization", "workspace", "user")

_http_client = httpx.AsyncClient(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
    timeout=60.0,
)


# ── Error handling ─────────────────────────────────────────────────────────


def _fail(action: str, exc: Exception) -> MistralAPIError:
    """Normalise an httpx failure into a MistralAPIError carrying the API's own message."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        try:
            body = exc.response.json()
            detail = body.get("detail") or body.get("message") or body
        except Exception:
            detail = exc.response.text[:500]
        logger.error("Connector %s failed (%d): %s", action, status, detail)
        # 4xx are the caller's problem and must survive as-is; anything else is
        # an upstream fault and gets reported as a bad gateway.
        return MistralAPIError(
            f"Failed to {action}: {detail}",
            status_code=status if 400 <= status < 500 else 502,
        )
    if isinstance(exc, httpx.ConnectError):
        logger.error("Connector %s failed: cannot reach api.mistral.ai", action)
        return MistralAPIError(f"Failed to {action}: cannot reach the Mistral API", status_code=503)
    logger.error("Connector %s failed: %s", action, exc)
    return MistralAPIError(f"Failed to {action}: {exc}")


async def _request(method: str, path: str, action: str, **kwargs) -> Any:
    """Issue a request and return the decoded body, or None for empty responses."""
    try:
        resp = await _http_client.request(method, path, **kwargs)
        resp.raise_for_status()
    except Exception as e:
        raise _fail(action, e) from e

    if resp.status_code == 204 or not resp.content:
        return None
    try:
        return resp.json()
    except ValueError:
        return resp.text


# ── Normalisation ──────────────────────────────────────────────────────────


def _normalise(raw: dict) -> dict:
    """Flatten a raw Connector object into the shape the frontend consumes.

    Every field the UI branches on is given a concrete default, so a partial
    response from the beta API cannot make a card render as "inactive" or
    "unauthenticated" purely because a key was absent.
    """
    if not isinstance(raw, dict):
        return {}

    tools = raw.get("tools")
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "title": raw.get("title") or raw.get("name"),
        "description": raw.get("description") or "",
        "server": raw.get("server"),
        "icon_url": raw.get("icon_url"),
        "system_prompt": raw.get("system_prompt"),
        "protocol": raw.get("protocol") or "mcp",
        "visibility": raw.get("visibility") or "shared_org",
        # `mistral: true` marks a directory connector — curated, installed from
        # Studio, and read-only from here.
        "is_directory": bool(raw.get("mistral")),
        "is_authenticated": bool(raw.get("is_authenticated")),
        "active": bool(raw.get("active")),
        "auth_type": raw.get("auth_type"),
        "supported_auth_methods": raw.get("supported_auth_methods") or [],
        "tool_count": len(tools) if isinstance(tools, list) else None,
        "created_at": str(raw.get("created_at") or ""),
        "modified_at": str(raw.get("modified_at") or ""),
    }


def _normalise_tool(raw: dict) -> dict:
    """Flatten an MCPTool into {name, description, parameters, required}."""
    if not isinstance(raw, dict):
        return {}
    schema = raw.get("inputSchema") or raw.get("input_schema") or raw.get("parameters") or {}
    if not isinstance(schema, dict):
        schema = {}
    return {
        "name": raw.get("name") or "",
        "description": raw.get("description") or "",
        "parameters": schema.get("properties", {}) or {},
        "required": schema.get("required", []) or [],
    }


def _unwrap_list(payload: Any) -> list[dict]:
    """Pull the item array out of a response that may or may not be paginated."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "items", "connectors", "tools"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


# ── Connector CRUD ─────────────────────────────────────────────────────────


async def list_connectors(page_size: int = 200, cursor: str | None = None) -> dict:
    """List every connector visible to this API key, directory ones included."""
    params: dict[str, Any] = {"page_size": page_size}
    if cursor:
        params["cursor"] = cursor

    payload = await _request("GET", "/v1/connectors", "list connectors", params=params)
    items = [_normalise(c) for c in _unwrap_list(payload)]
    next_cursor = payload.get("next_cursor") if isinstance(payload, dict) else None

    return {
        "items": sorted(items, key=lambda c: (c.get("name") or "").lower()),
        "count": len(items),
        "next_cursor": next_cursor,
    }


async def get_connector(connector_id: str) -> dict:
    """Fetch a single connector by id or name."""
    payload = await _request("GET", f"/v1/connectors/{connector_id}", "get connector")
    return _normalise(payload or {})


def _annotate_connector(connector_id: str | None, domains: list[str] | None) -> None:
    """Record what a connector provides, and which domains it serves.

    Best-effort: annotation improves planning and validation but is never what
    makes a connector work, so a store failure must not fail the create.
    """
    if not connector_id:
        return
    try:
        from app.ontology import store as ontology_store
        from app.ontology.vocab import Predicate, SubjectType

        ontology_store.set_annotations(
            SubjectType.CONNECTOR.value, connector_id,
            Predicate.PROVIDES_CAPABILITY.value,
            ["capability.integration.read"], source="user",
        )
        if domains:
            ontology_store.set_annotations(
                SubjectType.CONNECTOR.value, connector_id,
                Predicate.SERVES_DOMAIN.value, domains, source="user",
            )
    except Exception as e:
        logger.warning("Could not annotate connector %s: %s", connector_id, e)


async def create_connector(data: dict) -> dict:
    """Register an MCP server URL as a custom connector.

    Only ``name``, ``description`` and ``server`` are required. ``auth_data``
    carries the OAuth2 client credentials when the target server needs them.
    """
    body: dict[str, Any] = {
        "name": data["name"],
        "description": data["description"],
        "server": data["server"],
    }
    for field in ("icon_url", "system_prompt", "visibility", "headers"):
        value = data.get(field)
        if value:
            body[field] = value

    auth = data.get("auth_data") or {}
    if auth.get("client_id") and auth.get("client_secret"):
        body["auth_data"] = {
            "client_id": auth["client_id"],
            "client_secret": auth["client_secret"],
        }

    payload = await _request("POST", "/v1/connectors", "create connector", json=body)
    connector = _normalise(payload or {})
    logger.info("Created connector '%s' (id=%s)", connector.get("name"), connector.get("id"))

    # Every connector reaches a system this platform does not control, so the
    # read capability is a fact rather than a guess. Domains, if the caller
    # supplied them, are recorded as stated.
    _annotate_connector(connector.get("id"), data.get("domains"))
    return connector


async def update_connector(connector_id: str, data: dict) -> dict:
    """Patch a custom connector. Directory connectors reject this upstream."""
    body = {
        field: data[field]
        for field in ("name", "description", "icon_url", "system_prompt", "connection_config")
        if field in data and data[field] is not None
    }
    if not body:
        return await get_connector(connector_id)

    payload = await _request(
        "PATCH", f"/v1/connectors/{connector_id}", "update connector", json=body
    )
    return _normalise(payload or {})


async def delete_connector(connector_id: str) -> dict:
    """Permanently remove a custom connector."""
    await _request("DELETE", f"/v1/connectors/{connector_id}", "delete connector")
    logger.info("Deleted connector %s", connector_id)
    return {"deleted": True, "connector_id": connector_id}


# ── Tools ──────────────────────────────────────────────────────────────────


async def list_connector_tools(connector_id: str) -> list[dict]:
    """List the tools a connector exposes.

    Returns an empty list rather than raising when the server is unreachable or
    unauthenticated: an un-connected connector having no listable tools is a
    normal state, and the palette and inspector both need to render anyway.
    """
    try:
        payload = await _request(
            "GET", f"/v1/connectors/{connector_id}/tools", "list connector tools"
        )
    except MistralAPIError as e:
        logger.warning("Could not list tools for connector %s: %s", connector_id, e.message)
        return []

    return [t for t in (_normalise_tool(raw) for raw in _unwrap_list(payload)) if t.get("name")]


async def call_connector_tool(
    connector_id: str,
    tool_name: str,
    arguments: dict,
    credentials_name: str | None = None,
) -> dict:
    """Invoke a connector tool directly, outside any agent or conversation.

    This is what a workflow connector step uses on the local execution path, and
    what the UI's "test tool" button calls.
    """
    params = {"credentials_name": credentials_name} if credentials_name else None
    payload = await _request(
        "POST",
        f"/v1/connectors/{connector_id}/tools/{tool_name}/call",
        f"call tool '{tool_name}'",
        json={"arguments": arguments or {}},
        params=params,
    )
    return payload if isinstance(payload, dict) else {"content": payload}


def flatten_tool_result(result: dict) -> Any:
    """Reduce an MCP tool result to something a workflow variable can hold.

    MCP returns ``{"content": [{"type": "text", "text": ...}, ...]}``. Steps
    downstream interpolate ``{{step_x_output}}`` into prompts, so a single text
    block collapses to its string and everything else keeps its structure.
    """
    if not isinstance(result, dict):
        return result

    content = result.get("content")
    if not isinstance(content, list) or not content:
        return result

    texts = [
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    if len(texts) == len(content):
        return texts[0] if len(texts) == 1 else "\n".join(texts)
    return content


# ── Authentication ─────────────────────────────────────────────────────────


async def get_auth_methods(connector_id: str) -> dict:
    """Describe how a connector expects to be authenticated."""
    payload = await _request(
        "GET", f"/v1/connectors/{connector_id}/authentication", "get authentication methods"
    )
    return payload if isinstance(payload, dict) else {"methods": payload}


async def get_auth_url(connector_id: str, credentials_name: str | None = None) -> dict:
    """Start an OAuth2 flow and return the URL the user must visit.

    The URL is short-lived (``ttl`` seconds, ~10 minutes in practice), so it is
    fetched on demand when the user clicks Connect, never cached.
    """
    params = {"credentials_name": credentials_name} if credentials_name else None
    payload = await _request(
        "GET", f"/v1/connectors/{connector_id}/auth_url", "get auth url", params=params
    )
    payload = payload or {}
    return {"auth_url": payload.get("auth_url"), "ttl": payload.get("ttl")}


# ── Credentials ────────────────────────────────────────────────────────────


def _check_scope(scope: str) -> Scope:
    if scope not in SCOPES:
        raise MistralAPIError(
            f"Unknown connector scope '{scope}'. Expected one of: {', '.join(SCOPES)}.",
            status_code=400,
        )
    return scope  # type: ignore[return-value]


async def list_credentials(connector_id: str, scope: str = "user") -> list[dict]:
    """List stored credentials for a connector at one scope."""
    scope = _check_scope(scope)
    payload = await _request(
        "GET", f"/v1/connectors/{connector_id}/{scope}/credentials", "list credentials"
    )
    return _unwrap_list(payload)


async def set_credentials(
    connector_id: str,
    scope: str = "user",
    name: str = "default",
    credentials: dict | None = None,
    is_default: bool = True,
) -> dict:
    """Store a named credential (typically ``{"bearer_token": ...}``).

    Bearer-token connectors have no on-the-fly auth: the credential must exist
    before an agent or workflow calls the connector.
    """
    scope = _check_scope(scope)
    payload = await _request(
        "POST",
        f"/v1/connectors/{connector_id}/{scope}/credentials",
        "save credentials",
        json={"name": name, "credentials": credentials or {}, "is_default": is_default},
    )
    return payload if isinstance(payload, dict) else {"status": "saved"}


async def delete_credentials(
    connector_id: str, scope: str = "user", credentials_name: str | None = None
) -> dict:
    """Delete one named credential, or all of them at this scope."""
    scope = _check_scope(scope)
    params = {"credentials_name": credentials_name} if credentials_name else None
    await _request(
        "DELETE",
        f"/v1/connectors/{connector_id}/{scope}/credentials",
        "delete credentials",
        params=params,
    )
    return {"deleted": True, "connector_id": connector_id, "scope": scope}


# ── Activation ─────────────────────────────────────────────────────────────


async def set_activation(
    connector_id: str,
    scope: str = "organization",
    active: bool = True,
    tool_configuration: dict | None = None,
) -> dict:
    """Activate or deactivate a connector for a scope.

    ``tool_configuration`` narrows which of the connector's tools are exposed
    and which need confirmation: ``include`` / ``exclude`` /
    ``requires_confirmation`` / ``skip_confirmation``, each a list of tool names.
    """
    scope = _check_scope(scope)
    verb = "activate" if active else "deactivate"

    body = {
        key: value
        for key, value in (tool_configuration or {}).items()
        if key in ("include", "exclude", "requires_confirmation", "skip_confirmation") and value
    }

    payload = await _request(
        "POST",
        f"/v1/connectors/{connector_id}/{scope}/{verb}",
        f"{verb} connector",
        json=body or {},
    )
    logger.info("Connector %s %sd for %s", connector_id, verb, scope)
    return payload if isinstance(payload, dict) else {"status": f"{verb}d", "scope": scope}


# ── Agent / conversation tool specs ────────────────────────────────────────


def build_connector_tool_specs(connectors: list[dict] | None) -> list[dict]:
    """Turn UI connector selections into Mistral ``tools`` entries.

    A connector attaches to an agent as a tool of type ``connector`` — it is not
    a separate top-level field. Each entry accepts an optional
    ``tool_configuration`` restricting which of the connector's tools the model
    may call.

    Input entries look like::

        {"connector_id": "...", "include": [...], "exclude": [...],
         "requires_confirmation": [...]}
    """
    specs: list[dict] = []

    for entry in connectors or []:
        if isinstance(entry, str):
            entry = {"connector_id": entry}
        if not isinstance(entry, dict):
            continue

        connector_id = entry.get("connector_id") or entry.get("id")
        if not connector_id:
            continue

        spec: dict[str, Any] = {"type": "connector", "connector_id": connector_id}

        config = {
            key: entry[key]
            for key in ("include", "exclude", "requires_confirmation")
            if entry.get(key)
        }
        if config:
            spec["tool_configuration"] = config

        specs.append(spec)

    return specs


#: Connectors that duplicate a capability this platform already models better
#: as a tool. Excluded from the planner's connector inventory so no layer can
#: attach one by the wrong mechanism. Matched on connector name, lowercased.
_TOOL_EQUIVALENT_CONNECTORS = {"document_library"}


async def describe_for_prompt(scope: dict | None = None) -> tuple[str, list[str]]:
    """Render the connector inventory for an LLM prompt.

    Returns ``(description_block, valid_ids)``. Unauthenticated connectors are
    listed but flagged, so the planner can see they exist without picking one
    that would fail at call time. Never raises: a planner that cannot see the
    connector list must still be able to plan.

    ``scope`` narrows the list to connectors annotated within a domain subtree.
    Unannotated connectors are always kept — a half-finished backfill must not
    silently hide integrations from the planner.
    """
    try:
        payload = await list_connectors()
    except Exception as e:
        logger.warning("Could not load connectors for prompt: %s", e)
        return "(none available)", []

    items = payload.get("items", [])

    if scope and scope.get("scoped"):
        try:
            from app.ontology import matcher as ontology_matcher
            from app.ontology.vocab import Predicate, SubjectType

            keep = ontology_matcher.filter_subjects(
                SubjectType.CONNECTOR.value,
                [c.get("id") for c in items],
                scope,
                Predicate.SERVES_DOMAIN.value,
            )
            items = [c for c in items if c.get("id") in keep]
        except Exception as e:
            logger.warning("Connector scoping failed, using full list: %s", e)

    lines: list[str] = []
    ids: list[str] = []

    for connector in items:
        connector_id = connector.get("id")
        if not connector_id or not connector.get("active", True):
            continue

        # A document library is a first-class platform capability, not an
        # integration: it is attached by supplying `document_library_ids`,
        # which also carries the library's own domain scoping and lets an empty
        # one be provisioned on demand. Mistral additionally publishes it as a
        # connector, and offering it here is a category error — an agent that
        # picked the connector got a generic search surface instead of a bound
        # library, and the layer that owns library selection never saw it.
        if (connector.get("name") or "").strip().lower() in _TOOL_EQUIVALENT_CONNECTORS:
            continue

        ids.append(connector_id)
        flags = []
        if connector.get("is_directory"):
            flags.append("directory")
        if not connector.get("is_authenticated"):
            flags.append("NOT AUTHENTICATED — do not attach")
        suffix = f" [{'; '.join(flags)}]" if flags else ""
        lines.append(
            f"- **{connector.get('name')}** (id: {connector_id}): "
            f"{connector.get('description') or 'No description.'}{suffix}"
        )

    return ("\n".join(lines) if lines else "(none available)"), ids


def extract_connector_refs(tools: list | None) -> list[dict]:
    """Inverse of :func:`build_connector_tool_specs` — read selections back off an agent."""
    refs: list[dict] = []

    for tool in tools or []:
        if not isinstance(tool, dict) or tool.get("type") != "connector":
            continue
        ref: dict[str, Any] = {"connector_id": tool.get("connector_id")}
        config = tool.get("tool_configuration") or {}
        if isinstance(config, dict):
            for key in ("include", "exclude", "requires_confirmation"):
                if config.get(key):
                    ref[key] = config[key]
        if ref["connector_id"]:
            refs.append(ref)

    return refs
