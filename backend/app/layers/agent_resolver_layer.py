"""
AgentResolverLayer — Analyses the query and creates a dynamic agent.

Extracted from orchestrator_service.py:406-438 (analysis) +
377-403 (creation).
"""

import asyncio
import json
import logging
from functools import partial

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


def _parse_agent_config(raw_text: str) -> dict:
    """Parse the LLM's JSON response into an agent config dict."""
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        config = json.loads(text)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse agent config JSON: %s\nRaw text: %s", e, text)
        config = {
            "agent_name": "General Assistant",
            "agent_instructions": "You are a helpful, knowledgeable assistant.",
            "model": "mistral-large-latest",
            "tools": [],
            "temperature": 0.5,
            "description": "General-purpose assistant",
            "tier": "foundation",
        }

    config.setdefault("agent_name", "Dynamic Agent")
    config.setdefault("model", "mistral-large-latest")
    config.setdefault("tools", [])
    config.setdefault("connectors", [])
    config.setdefault("temperature", 0.5)
    config.setdefault("description", "Dynamically created agent")
    config.setdefault("agent_instructions", "")
    config.setdefault("tier", "foundation")

    # Ensure agent_instructions is a proper string
    instr = config.get("agent_instructions") or ""
    if not isinstance(instr, str):
        instr = str(instr)
    instr = instr.strip()

    # If the LLM returned an empty/placeholder instruction (< 50 chars),
    # auto-generate a proper one from the agent's name, description, and tier.
    if len(instr) < 50:
        agent_name = config.get("agent_name", "Agent")
        description = config.get("description", "")
        tier = config.get("tier", "foundation")
        logger.warning(
            "agent_instructions too short (%d chars: %r), generating fallback from name/description.",
            len(instr), instr,
        )
        instr = (
            f"ROLE: You are {agent_name}, a specialised AI agent (tier: {tier}).\n"
            f"TASK: {description or 'Assist the user with their query.'}\n"
            f"REASONING APPROACH: Analyse the request step-by-step, consider all relevant factors, "
            f"and provide a thorough, well-structured response.\n"
            f"OUTPUT FORMAT: Provide a clear, structured response with headers and bullet points where appropriate. "
            f"Use markdown for formatting.\n"
            f"CONSTRAINTS: Stay within your area of expertise. Do not fabricate data or sources. "
            f"Be precise and factual.\n"
            f"FALLBACK: If information is uncertain or unavailable, state your assumption clearly "
            f"and continue. Never return an empty response."
        )
    config["agent_instructions"] = instr
    logger.info("Final agent_instructions length: %d", len(instr))
    return config


class AgentResolverLayer(Layer):
    """Analyse the query via LLM and create a dynamic Mistral agent.

    * **Skips when**: ``ctx.agent_id`` is already set (user selected an agent)
      or ``ctx.conversation_id`` is set (follow-up).
    * **Writes**: ``ctx.agent_config``, ``ctx.created_agent_id``
    * **Emits**: ``agent_config`` and ``status`` events.
    """

    name = "agent_resolver"

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings, map_model_name
        from app.prompts import ORCHESTRATOR_SYSTEM_PROMPT, ORCHESTRATOR_USER_PROMPT
        from app.services.tool_registry import (
            get_tool_descriptions,
            get_tools,
            AVAILABLE_TOOL_KEYS,
        )
        from app.services import connector_service
        from app.ontology import autotag as ontology_autotag
        from app.ontology import matcher as ontology_matcher

        # ── Step 1: Analyse query ───────────────────────────────────────
        ctx.emit("status", "Analysing your query…")

        # Narrow the connector inventory to the query's domain. A single-agent
        # request needs one or two integrations at most; offering all 23 makes
        # the choice harder, not easier.
        scope = ontology_matcher.scope_for_goal(ctx.query)

        # Connectors and libraries are both "what can this agent reach" and are
        # fetched together — neither depends on the other, and each is a network
        # round trip the query would otherwise wait through in turn.
        from app.rag import inventory as library_inventory

        (
            (connector_descriptions, connector_ids),
            (library_descriptions, library_ids),
        ) = await asyncio.gather(
            connector_service.describe_for_prompt(scope),
            # Scoped to the query's domain, so a mortgage question is offered
            # the mortgage library rather than all eleven.
            library_inventory.describe_for_prompt(scope),
        )

        try:
            # Offloaded: the shared Mistral client is synchronous, so calling
            # it inline would block the event loop for the whole completion.
            result = await asyncio.to_thread(
                partial(
                    ctx.client.chat.complete,
                    model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                    messages=[
                        {"role": "system", "content": ORCHESTRATOR_SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": ORCHESTRATOR_USER_PROMPT.format(
                                tool_descriptions=get_tool_descriptions(),
                                tool_keys=json.dumps(AVAILABLE_TOOL_KEYS),
                                connector_descriptions=connector_descriptions,
                                connector_ids=json.dumps(connector_ids),
                                library_descriptions=library_descriptions,
                                library_ids=json.dumps(library_ids),
                                user_query=ctx.query,
                            ),
                        },
                    ],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )
            )

            raw = result.choices[0].message.content
            agent_config = _parse_agent_config(raw)
        except Exception as e:
            logger.error("Query analysis failed: %s", e)
            agent_config = {
                "agent_name": "General Assistant",
                "agent_instructions": "You are a helpful, knowledgeable assistant.",
                "model": "mistral-large-latest",
                "tools": [],
                "temperature": 0.5,
                "description": "General-purpose assistant (fallback)",
            }

        # Override tier if explicitly selected by the user
        if ctx.tier:
            agent_config["tier"] = ctx.tier

        ctx.agent_config = agent_config
        ctx.emit("agent_config", json.dumps({
            "agent_name": agent_config["agent_name"],
            "model": agent_config["model"],
            "tools": agent_config["tools"],
            "connectors": agent_config.get("connectors", []),
            "tier": agent_config.get("tier", "foundation"),
        }))

        logger.info(
            "Agent config: name=%s, model=%s, tools=%s",
            agent_config["agent_name"], agent_config["model"], agent_config["tools"],
        )

        # ── Step 2: Create the dynamic agent ────────────────────────────
        ctx.emit("status", f"Creating {agent_config['agent_name']}…")

        # Drop any connector the model invented or that is not currently
        # attachable — an unknown id would fail agent creation outright.
        chosen_connectors = [
            {"connector_id": cid}
            for cid in (agent_config.get("connectors") or [])
            if cid in connector_ids
        ]

        # Same treatment for libraries: an id the model invented would fail
        # agent creation outright, and silently dropping it leaves an agent
        # that simply has no documents rather than no agent at all.
        chosen_libraries = [
            lid for lid in (agent_config.get("document_library_ids") or [])
            if lid in library_ids
        ]
        if chosen_libraries:
            logger.info("Attaching %d document library/libraries to dynamic agent: %s",
                        len(chosen_libraries), chosen_libraries)
            agent_config["document_library_ids"] = chosen_libraries
        else:
            agent_config["document_library_ids"] = []
        if chosen_connectors:
            logger.info(
                "Attaching %d connector(s) to dynamic agent: %s",
                len(chosen_connectors), [c["connector_id"] for c in chosen_connectors],
            )

        # The dynamic agent answers a real user question, so it needs the same
        # domain grounding a hand-built agent gets.
        from app.rag.rag_tools import with_rag_tools

        # A dynamic agent answers a real user question, so it needs the same
        # grounding a hand-built one gets.
        dynamic_tools = with_rag_tools(
            agent_config["tools"],
            agent_config.get("document_library_ids"),
            bool(agent_config.get("knowledge_graph")),
        )
        tool_definitions = get_tools(
            dynamic_tools,
            document_library_ids=agent_config.get("document_library_ids"),
            connectors=chosen_connectors,
        )
        instructions_text = str(agent_config.get("agent_instructions", "") or "")
        logger.info("Creating agent with instructions (%d chars): %.300s", len(instructions_text), instructions_text)

        create_kwargs = {
            "model": map_model_name(agent_config["model"]),
            "name": agent_config["agent_name"],
            "instructions": instructions_text,
            "description": agent_config.get("description", "Dynamic agent"),
            "metadata": {
                "dynamic": "true",
                "source_query": ctx.query[:200],
                "tier": agent_config.get("tier", "foundation"),
            },
        }
        if tool_definitions:
            create_kwargs["tools"] = tool_definitions

        comp_args = {}
        temp = agent_config.get("temperature")
        if temp is not None:
            comp_args["temperature"] = temp
        if comp_args:
            create_kwargs["completion_args"] = comp_args

        agent = await asyncio.to_thread(
            partial(ctx.client.beta.agents.create, **create_kwargs)
        )
        ctx.created_agent_id = agent.id
        logger.info("Dynamic agent created: %s (%s)", agent.id, agent_config["agent_name"])

        # Classify it now. A dynamic agent is often deleted again by the cleanup
        # layer, but not always — when it survives it is indistinguishable from
        # any other agent to the planner, so it needs the same annotations.
        await asyncio.to_thread(
            partial(
                ontology_autotag.annotate_agent,
                agent.id,
                name=agent_config["agent_name"],
                description=agent_config.get("description", ""),
                instructions=instructions_text,
                tier=agent_config.get("tier"),
                goal=ctx.query,
            )
        )

        return await next(ctx)
