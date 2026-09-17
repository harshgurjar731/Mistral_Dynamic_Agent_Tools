"""
Rules Routes — /api/rules

* **Catalog** — the rule types the Rules page offers, with their forms.
* **Rules CRUD** — the configured rules, per scope (agent | workflow).
* **Agent selections** — which rules apply to an agent, and changing them.
* **Activity** — what every rule decided, per agent, per workflow, or overall.
* **Suggest** — an LLM pick of optional rules, for manual creation.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dependencies import get_mistral_client
from app.rules import apply, catalog, runtime, seed, select, store
from app.rules.store import RuleError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Rules"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except RuleError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Request bodies ─────────────────────────────────────────────────────────


class RuleCreate(BaseModel):
    type: str
    name: str
    description: str = ""
    params: dict = Field(default_factory=dict)
    enforcement: Optional[str] = None
    always_on: bool = False
    enabled: bool = True


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    params: Optional[dict] = None
    enforcement: Optional[str] = None
    always_on: Optional[bool] = None
    enabled: Optional[bool] = None


class RuleRefBody(BaseModel):
    rule_id: str
    source: str = "user"
    reason: str = ""


class AgentRulesBody(BaseModel):
    rules: list[RuleRefBody] = Field(default_factory=list)


class SuggestBody(BaseModel):
    scope: str = "agent"
    name: str = ""
    description: str = ""
    instructions: str = ""
    tier: str = ""
    model: str = ""
    tools: list = Field(default_factory=list)
    connectors: list = Field(default_factory=list)
    #: For workflows: the (possibly unsaved) definition.
    definition: Optional[dict] = None


# ── Catalog ────────────────────────────────────────────────────────────────


@router.get("/rules/types")
async def list_rule_types(scope: Optional[str] = Query(None, description="agent | workflow")):
    return {
        "types": [t.to_dict() for t in catalog.types_for(scope)],
        "checkpoints": catalog.CHECKPOINTS,
    }


# ── Rules CRUD ─────────────────────────────────────────────────────────────


@router.get("/rules")
async def list_rules(scope: Optional[str] = Query(None, description="agent | workflow")):
    usage = store.rule_usage()
    rules = [
        {**r, "usage": usage.get(r["id"], {"agents": 0})}
        for r in store.list_rules(scope)
    ]
    return {"rules": rules, "count": len(rules)}


@router.post("/rules", status_code=201)
async def create_rule(body: RuleCreate):
    return _guard(
        store.create_rule,
        type=body.type, name=body.name, description=body.description, params=body.params,
        enforcement=body.enforcement, always_on=body.always_on, enabled=body.enabled,
    )


@router.patch("/rules/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate):
    return _guard(store.update_rule, rule_id, body.model_dump(exclude_none=True))


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str):
    return _guard(store.delete_rule, rule_id)


@router.post("/rules/{rule_id}/restore")
async def restore_rule(rule_id: str):
    defaults = seed.defaults_for(rule_id)
    if not defaults:
        raise HTTPException(status_code=404, detail="Only recommended rules have a default to restore.")
    return _guard(store.replace_rule, rule_id, defaults)


# ── Agent selections ───────────────────────────────────────────────────────


@router.get("/rules/agents/{agent_id}")
async def get_agent_rules(agent_id: str):
    return {
        "rules": store.agent_rule_entries(agent_id),
        "selectable": store.selectable_rules("agent"),
    }


@router.put("/rules/agents/{agent_id}")
async def set_agent_rules(agent_id: str, body: AgentRulesBody, client=Depends(get_mistral_client)):
    """Replace an agent's rule selection, then apply creation-time rules to it.

    Fix-type rules (moderation, stripping blocked tools or connectors) are
    applied to the live agent. Block-type rules are reported, not enforced by
    rewriting the agent — changing a person's model choice behind their back
    would be worse than telling them.
    """
    from app.services import agent_service

    selection = [r.model_dump() for r in body.rules]
    store.set_agent_rules(agent_id, selection)

    outcomes: list[dict] = []
    try:
        live = await agent_service.get_agent(client, agent_id)
        current = agent_service.current_attachments(agent_id)
        connector_ids = [c.get("connector_id") for c in current["connectors"] if c.get("connector_id")]
        prepared = apply.prepare_agent(
            model=live.get("model") or "", instructions=live.get("instructions") or "",
            tool_keys=current["tools"], connector_ids=connector_ids,
            guardrails=live.get("guardrails") or [], selection=selection, mode="manual",
        )
        outcomes = prepared.outcomes

        patch: dict = {}
        if prepared.tool_keys != current["tools"]:
            patch["tools"] = prepared.tool_keys
        if prepared.connector_ids != connector_ids:
            patch["connectors"] = prepared.filter_connector_refs(current["connectors"])
        if prepared.guardrails != (live.get("guardrails") or []):
            patch["guardrails"] = prepared.guardrails
        if patch:
            await agent_service.update_agent(client, agent_id, patch, skip_rules=True)

        runtime.record(outcomes, scope="agent", subject_id=agent_id)
    except Exception as e:
        logger.warning("Rules saved for %s, but applying them to the agent failed: %s", agent_id, e)

    return {
        "rules": store.agent_rule_entries(agent_id),
        "outcomes": runtime.summarise(outcomes),
    }


@router.get("/rules/agents/{agent_id}/activity")
async def get_agent_activity(agent_id: str):
    activity = store.agent_activity(agent_id)
    recent_blocks = store.list_events(scope="agent", subject_id=agent_id, outcome="blocked", limit=50)
    return {"activity": activity, "recent_blocks": recent_blocks}


# ── Workflow rules ─────────────────────────────────────────────────────────


@router.get("/rules/workflows/{workflow_name}")
async def get_workflow_rules(workflow_name: str):
    from app.services.workflow_engine.engine import get_workflow

    definition = get_workflow(workflow_name)
    refs = {r.rule_id: r for r in (definition.rules if definition else [])}
    rules = [
        {
            **r,
            "applied_by": "always" if r["always_on"] else (refs[r["id"]].source if r["id"] in refs else "user"),
            "reason": refs[r["id"]].reason if r["id"] in refs else "",
        }
        for r in store.effective_rules("workflow", refs.keys())
    ]
    return {
        "rules": rules,
        "events": store.list_events(scope="workflow", subject_id=workflow_name, limit=100),
    }


# ── Activity ───────────────────────────────────────────────────────────────


@router.get("/rules/events")
async def list_events(
    scope: Optional[str] = None,
    subject_id: Optional[str] = None,
    rule_id: Optional[str] = None,
    outcome: Optional[str] = None,
    include_passed: bool = False,
    limit: int = 100,
):
    events = store.list_events(
        scope=scope, subject_id=subject_id, rule_id=rule_id, outcome=outcome,
        include_passed=include_passed, limit=limit,
    )
    return {"events": events, "count": len(events)}


# ── Suggest ────────────────────────────────────────────────────────────────


@router.post("/rules/suggest")
async def suggest_rules(body: SuggestBody, client=Depends(get_mistral_client)):
    if body.scope not in catalog.SCOPES:
        raise HTTPException(status_code=400, detail="scope must be 'agent' or 'workflow'.")
    if body.scope == "agent":
        subject = select.agent_subject(
            name=body.name, description=body.description, instructions=body.instructions,
            tier=body.tier, model=body.model, tools=body.tools, connectors=body.connectors,
        )
    else:
        subject = select.workflow_subject(body.definition or {"name": body.name, "description": body.description})
    return await select.select_rules(client, body.scope, subject, phase=f"rule suggestion ({body.scope})")
