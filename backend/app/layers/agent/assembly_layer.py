"""
AgentAssemblyLayer — Turns the accumulated spec into a live Mistral agent.

No LLM call: every decision was made upstream. This layer validates that the
decisions are mutually coherent, creates the agent, classifies it against the
ontology, and publishes the flat ``agent_config`` the routes and the SSE
payloads were written against.

It is the only layer that talks to the agent-creation API, which means it is
also the only place where an invalid combination of decisions can be caught
before it becomes an API error.
"""

import asyncio
import json
import logging
from functools import partial

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

#: Where ExecutionLayer reads the agent's tool-round budget from.
MAX_TOOL_ROUNDS_KEY = "max_tool_rounds"


class AgentAssemblyLayer(Layer):
    """Create the dynamic agent from ``ctx.agent_spec``."""

    name = "agent_assembly"
    label = "Assemble the agent"
    detail = "Validates the decisions together and creates the agent."

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import map_model_name
        from app.ontology import autotag as ontology_autotag
        from app.rag.rag_tools import with_rag_tools
        from app.services.agent_service import build_guardrails
        from app.services.tool_registry import get_tools

        spec = ctx.agent_spec
        config = spec.to_config()

        # Resolve ids to names, and say which one this run created. A card
        # listing bare uuids cannot answer "what will my agent actually read?".
        inventory = ctx.metadata.get("inventory") or {}
        names = inventory.get("library_names") or {}
        created = set(ctx.metadata.get("created_library_ids") or [])
        libraries = [
            {
                "id": library_id,
                "name": names.get(library_id, library_id),
                "created": library_id in created,
            }
            for library_id in config["document_library_ids"]
        ]

        # Publish the configuration before creating anything, so the UI can
        # show what was decided even if creation then fails.
        ctx.agent_config = config
        ctx.emit("agent_config", json.dumps({
            "agent_name": config["agent_name"],
            "description": config["description"],
            "model": config["model"],
            "temperature": config["temperature"],
            "tools": config["tools"],
            "connectors": config["connectors"],
            "document_library_ids": config["document_library_ids"],
            "libraries": libraries,
            "knowledge_graph": config["knowledge_graph"],
            "tier": config["tier"],
            "guardrails": spec.guardrails.describe() if spec.guardrails else None,
            "rationale": config["rationale"],
        }))

        # The envelope's tool budget is enforced by the execution loop, not by
        # the instructions alone — a model can ignore prose, it cannot ignore
        # the loop bound.
        if spec.guardrails:
            ctx.metadata[MAX_TOOL_ROUNDS_KEY] = spec.guardrails.max_tool_rounds

        ctx.emit("status", f"Creating {config['agent_name']}…")

        instructions = config["agent_instructions"]
        if not instructions:
            # Every path into this layer should have set instructions; if none
            # did, refuse rather than create an agent with an empty system
            # prompt, which fails in a way that is hard to trace back here.
            ctx.set_error("Agent instructions were never authored — cannot create agent")
            return await next(ctx)

        # The creation gate, in pipeline mode: rules the orchestrator's design
        # broke are corrected rather than failing a run the user never set up
        # rules for (see app.rules.apply). Applied before the tool definitions
        # are built, so a stripped tool never reaches the create call.
        from app.rules import apply as rules_apply

        prepared = rules_apply.prepare_agent(
            model=config["model"],
            instructions=instructions,
            tool_keys=config["tools"],
            connector_ids=config["connectors"],
            guardrails=[config["guardrails"]] if config.get("guardrails") else [],
            selection=config.get("rules") or [],
            mode="pipeline",
        )
        config["model"] = prepared.model
        config["tools"] = prepared.tool_keys
        config["connectors"] = prepared.connector_ids

        dynamic_tools = with_rag_tools(
            config["tools"],
            config["document_library_ids"],
            config["knowledge_graph"],
        )
        tool_definitions = get_tools(
            dynamic_tools,
            document_library_ids=config["document_library_ids"] or None,
            connectors=[{"connector_id": cid} for cid in config["connectors"]],
        )

        create_kwargs = {
            "model": map_model_name(config["model"]),
            "name": config["agent_name"],
            "instructions": instructions,
            "description": config["description"],
            "metadata": {
                "dynamic": "true",
                "source_query": ctx.query[:200],
                "tier": config["tier"],
            },
        }
        if tool_definitions:
            create_kwargs["tools"] = tool_definitions
        if config["temperature"] is not None:
            create_kwargs["completion_args"] = {"temperature": config["temperature"]}

        # The platform's own guardrail mechanism, built by the same helper the
        # agents API uses so the two cannot drift. Never rendered into the
        # instructions: moderation runs outside the model, which is the whole
        # reason it holds when the model is talked around.
        # ``prepared.guardrails`` is the decided guardrail with any rule-driven
        # moderation merged in (stricter wins).
        if prepared.guardrails:
            guardrails = build_guardrails(prepared.guardrails)
            if guardrails:
                create_kwargs["guardrails"] = guardrails

        logger.info(
            "Creating agent '%s' (tier=%s, model=%s, %d tool defs, %d libraries, "
            "%d chars of instructions, guardrails=%s)",
            config["agent_name"], config["tier"], config["model"],
            len(tool_definitions or []), len(config["document_library_ids"]),
            len(instructions), bool(create_kwargs.get("guardrails")),
        )

        agent = await asyncio.to_thread(partial(ctx.client.beta.agents.create, **create_kwargs))
        ctx.created_agent_id = agent.id
        spec.agent_id = agent.id
        logger.info("Dynamic agent created: %s (%s)", agent.id, config["agent_name"])

        rule_summary = rules_apply.finish_agent(
            agent.id, prepared, config.get("rules") or [], default_source="ai"
        )
        # ExecutionLayer reads this to know the agent carries answer rules
        # before its first turn, without a second lookup.
        ctx.metadata["agent_rules"] = prepared.rules
        ctx.emit("rules_applied", json.dumps({
            "scope": "agent",
            "agent_id": agent.id,
            "outcomes": rule_summary,
        }))

        # Classify it now. A dynamic agent is often deleted again by the cleanup
        # layer, but not always — when it survives it is indistinguishable from
        # any other agent to the planner, so it needs the same annotations.
        await asyncio.to_thread(
            partial(
                ontology_autotag.annotate_agent,
                agent.id,
                name=config["agent_name"],
                description=config["description"],
                instructions=instructions,
                tier=config["tier"],
                goal=ctx.query,
            )
        )

        return await next(ctx)
