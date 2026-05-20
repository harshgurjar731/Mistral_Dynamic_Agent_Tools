"""
Orchestrator Service — Core of the Dynamic Agent System.
Analyzes user queries, creates specialized agents on-the-fly,
processes queries through them, and returns results.
Uses tool_resolver for Docker Tool Service integration.
"""

import json
import logging
from typing import Optional, AsyncGenerator

from mistralai.client import Mistral
from app.exceptions import MistralAPIError
from app.services.tool_registry import get_tools, get_tool_descriptions, AVAILABLE_TOOL_KEYS, execute_tool, refresh_dynamic_tools
from app.prompts import ORCHESTRATOR_SYSTEM_PROMPT, ORCHESTRATOR_USER_PROMPT, SYNTHESIS_CHECK_SYSTEM_PROMPT, SYNTHESIS_CHECK_USER_PROMPT

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
        logger.error(f"Failed to parse agent config JSON: {e}\nRaw text: {text}")
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
            len(instr), instr
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


def _sse(data, event: str = "message") -> str:
    """Format as a typed SSE event line."""
    payload = json.dumps(data) if not isinstance(data, str) else data
    if isinstance(payload, str):
        payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


# ── Tool Synthesis Check ──────────────────────────────────────────────────

async def _check_synthesis_needed(client: Mistral, query: str) -> dict | bool:
    """Check if a new tool is needed and trigger synthesis via Docker Tool Service."""
    from app.config import settings

    try:
        result = client.chat.complete(
            model=settings.MISTRAL_CODING_MODEL,
            messages=[
                {"role": "system", "content": SYNTHESIS_CHECK_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": SYNTHESIS_CHECK_USER_PROMPT.format(
                        tool_descriptions=get_tool_descriptions(),
                        user_query=query
                    )
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        raw = result.choices[0].message.content
        data = json.loads(raw)

        if not data.get("needs_new_tool", False):
            logger.info("No new tools needed for query")
            return False

        # Trigger synthesis on Docker Tool Service
        from app.services.tool_resolver import tool_resolver
        synthesis_result = await tool_resolver.trigger_synthesis(
            name=data.get("tool_name", "unknown"),
            description=data.get("tool_description", ""),
            parameters=data.get("parameters", {}),
            required=data.get("required", []),
        )

        logger.info("Synthesis result: %s", synthesis_result)

        if synthesis_result.get("status") in ("failed", "error"):
            msg = synthesis_result.get("message", "Unknown synthesis error")
            logger.warning("Tool synthesis failed (non-fatal, continuing with existing tools): %s", msg)
            return False

        # Refresh dynamic tools cache
        await refresh_dynamic_tools()
        return synthesis_result.get("status") == "approved"

    except Exception as e:
        logger.error("Synthesis check failed: %s", e)
        return False


# ── Core Orchestration ─────────────────────────────────────────────────────

async def orchestrate(
    client: Mistral,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    cleanup_agent: bool = False,
    tier: Optional[str] = None,
) -> dict:
    """Main orchestration flow."""
    if conversation_id:
        return await _handle_followup(client, query, conversation_id)
    if agent_id:
        return await _handle_existing_agent(client, query, agent_id)
    return await _handle_new_query(client, query, cleanup_agent, tier=tier)


async def _process_tool_calls(client: Mistral, conv_result, conversation_id: str):
    """Loop to process tool calls if the assistant returns any."""
    current_result = conv_result

    for _ in range(5):
        outputs = (
            getattr(current_result, "outputs", None)
            or getattr(current_result, "entries", None)
            or getattr(current_result, "messages", None)
        )
        if not outputs:
            break

        last_entry = list(outputs)[-1]
        last_type = getattr(last_entry, "type", None)
        if isinstance(last_entry, dict):
            last_type = last_entry.get("type", last_type)

        if last_type != "function.call":
            break

        tool_calls = []
        for entry in outputs:
            entry_type = getattr(entry, "type", None)
            if isinstance(entry, dict):
                entry_type = entry.get("type", entry_type)
            if entry_type == "function.call":
                tool_calls.append(entry)

        if not tool_calls:
            break

        logger.info(f"Agent requested {len(tool_calls)} tool call(s)")

        tool_results = []
        for tc in tool_calls:
            try:
                if isinstance(tc, dict):
                    func_name = tc.get("name")
                    args_str = tc.get("arguments")
                    tc_id = tc.get("tool_call_id")
                else:
                    func_name = getattr(tc, "name", None)
                    args_str = getattr(tc, "arguments", None)
                    tc_id = getattr(tc, "tool_call_id", None)

                args = json.loads(args_str) if isinstance(args_str, str) else args_str
                if args is None:
                    args = {}

                # Use async 3-tier executor
                result_str = await execute_tool(func_name, args)

            except Exception as e:
                logger.error(f"Error executing tool call: {e}")
                result_str = f"Error: {str(e)}"
                if "tc_id" not in locals():
                    tc_id = "unknown"
                if "func_name" not in locals():
                    func_name = "unknown"

            tool_results.append({
                "type": "function.result",
                "tool_call_id": tc_id,
                "name": func_name,
                "result": result_str,
            })

        logger.info(f"Submitting tool results: {tool_results}")
        current_result = client.beta.conversations.append(
            conversation_id=conversation_id,
            inputs=tool_results,
        )

    return current_result


async def _handle_followup(client: Mistral, query: str, conversation_id: str) -> dict:
    """Handle a follow-up query by appending to an existing conversation."""
    try:
        inputs = [{"role": "user", "content": query}]
        result = client.beta.conversations.append(
            conversation_id=conversation_id,
            inputs=inputs,
        )

        result = await _process_tool_calls(client, result, conversation_id)
        response_text = _extract_response(result)

        return {
            "response": response_text,
            "conversation_id": conversation_id,
            "agent_id": getattr(result, "agent_id", None),
            "agent_name": None,
            "model": getattr(result, "model", None),
            "tools_used": None,
            "is_followup": True,
        }
    except Exception as e:
        logger.error(f"Follow-up failed: {e}")
        raise MistralAPIError(f"Follow-up query failed: {str(e)}")


async def _handle_existing_agent(client: Mistral, query: str, agent_id: str) -> dict:
    """Handle a query using a pre-existing agent (selected via AgentSelector in frontend)."""
    try:
        inputs = [{"role": "user", "content": query}]
        conv_result = client.beta.conversations.start(
            agent_id=agent_id, inputs=inputs,
        )

        conversation_id = getattr(conv_result, "conversation_id", None) or getattr(conv_result, "id", None)
        conv_result = await _process_tool_calls(client, conv_result, conversation_id)
        response_text = _extract_response(conv_result)

        return {
            "response": response_text,
            "conversation_id": conversation_id,
            "agent_id": agent_id,
            "agent_name": None,
            "model": None,
            "tools_used": None,
            "is_followup": False,
        }
    except Exception as e:
        logger.error(f"Existing agent query failed: {e}")
        raise MistralAPIError(f"Agent query failed: {str(e)}")


async def _handle_new_query(client: Mistral, query: str, cleanup_agent: bool, tier: Optional[str] = None) -> dict:
    """Handle a brand new query with full orchestration."""
    agent_id = None
    try:
        logger.info("Orchestrating query: %s...", query[:100])

        # Step 1: Check synthesis and analyze query
        await _check_synthesis_needed(client, query)
        agent_config = await _analyze_query(client, query)

        # Override tier if explicitly selected by the user
        if tier:
            agent_config["tier"] = tier

        logger.info("Agent config: name=%s, model=%s, tools=%s",
                     agent_config["agent_name"], agent_config["model"], agent_config["tools"])

        # Step 2: Create the specialized agent
        agent_id = _create_dynamic_agent(client, agent_config, query)

        # Step 3: Start conversation
        inputs = [{"role": "user", "content": query}]
        conv_result = client.beta.conversations.start(
            agent_id=agent_id, inputs=inputs,
        )

        conversation_id = getattr(conv_result, "conversation_id", None) or getattr(conv_result, "id", None)
        conv_result = await _process_tool_calls(client, conv_result, conversation_id)
        response_text = _extract_response(conv_result)

        logger.info("Conversation %s started with dynamic agent %s", conversation_id, agent_id)

        if cleanup_agent and agent_id:
            try:
                client.beta.agents.delete(agent_id=agent_id)
                agent_id = None
            except Exception as cleanup_err:
                logger.warning("Failed to cleanup agent: %s", cleanup_err)

        return {
            "response": response_text,
            "conversation_id": conversation_id,
            "agent_id": agent_id,
            "agent_name": agent_config["agent_name"],
            "agent_description": agent_config.get("description"),
            "model": agent_config["model"],
            "tools_used": agent_config["tools"],
            "temperature": agent_config.get("temperature"),
            "is_followup": False,
        }
    except MistralAPIError:
        raise
    except Exception as e:
        if agent_id and cleanup_agent:
            try:
                client.beta.agents.delete(agent_id=agent_id)
            except Exception:
                pass
        logger.error("Orchestration failed: %s", e)
        raise MistralAPIError(f"Orchestration failed: {str(e)}")


def _create_dynamic_agent(client: Mistral, agent_config: dict, query: str) -> str:
    """Create a dynamic agent from the analyzed config."""
    tool_definitions = get_tools(agent_config["tools"])

    instructions_text = str(agent_config.get("agent_instructions", "") or "")
    logger.info("Creating agent with instructions (%d chars): %.300s", len(instructions_text), instructions_text)

    create_kwargs = {
        "model": agent_config["model"],
        "name": agent_config["agent_name"],
        "instructions": instructions_text,
        "description": agent_config.get("description", "Dynamic agent"),
        "metadata": {"dynamic": "true", "source_query": query[:200], "tier": agent_config.get("tier", "foundation")},
    }
    if tool_definitions:
        create_kwargs["tools"] = tool_definitions

    comp_args = {}
    temp = agent_config.get("temperature")
    if temp is not None:
        comp_args["temperature"] = temp
    if comp_args:
        create_kwargs["completion_args"] = comp_args

    agent = client.beta.agents.create(**create_kwargs)
    logger.info("Dynamic agent created: %s (%s)", agent.id, agent_config["agent_name"])
    return agent.id


async def _analyze_query(client: Mistral, query: str) -> dict:
    """Use Mistral to analyze the query and determine optimal agent config."""
    try:
        from app.config import settings
        result = client.chat.complete(
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[
                {"role": "system", "content": ORCHESTRATOR_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": ORCHESTRATOR_USER_PROMPT.format(
                        tool_descriptions=get_tool_descriptions(),
                        tool_keys=json.dumps(AVAILABLE_TOOL_KEYS),
                        user_query=query
                    )
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        raw = result.choices[0].message.content
        return _parse_agent_config(raw)
    except Exception as e:
        logger.error("Query analysis failed: %s", e)
        return {
            "agent_name": "General Assistant",
            "agent_instructions": "You are a helpful, knowledgeable assistant.",
            "model": "mistral-large-latest",
            "tools": [],
            "temperature": 0.5,
            "description": "General-purpose assistant (fallback)",
        }


def _extract_response(conv_result) -> str:
    """Extract the assistant's text response from a conversation result."""
    outputs = (
        getattr(conv_result, "outputs", None)
        or getattr(conv_result, "entries", None)
        or getattr(conv_result, "messages", None)
    )
    if not outputs:
        return ""

    for entry in reversed(list(outputs)):
        role = None
        content = None
        if hasattr(entry, "role"):
            role = entry.role
            content = getattr(entry, "content", None)
        elif isinstance(entry, dict):
            role = entry.get("role")
            content = entry.get("content")

        if role == "assistant" and content:
            if isinstance(content, str):
                return content
            elif isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and part.get("text"):
                        parts.append(part["text"])
                return "\n".join(parts) if parts else ""
    return ""


# ── Streaming Orchestration ────────────────────────────────────────────────

async def _consume_stream_and_tools(client: Mistral, stream_method, **stream_kwargs) -> AsyncGenerator[tuple[str, str], None]:
    """
    Consumes a stream from start_stream or append_stream.
    Yields ('text_chunk', text) and ('conversation_id', id).
    If tool calls are encountered, accumulates them, executes them via execute_tool,
    and recursively calls append_stream to continue the conversation.
    """
    tool_calls_buffer = {}
    conversation_id_out = None

    logger.info("Started consuming Mistral stream...")
    stream = stream_method(**stream_kwargs)
    
    for event in stream:
        data = getattr(event, "data", event)
        if not conversation_id_out:
            conversation_id_out = getattr(data, "conversation_id", None) or getattr(data, "id", None)
            if conversation_id_out:
                logger.info("Found conversation ID in stream: %s", conversation_id_out)
                yield ("conversation_id", conversation_id_out)
        
        chunk = _extract_stream_chunk(event)
        if chunk:
            yield ("text_chunk", chunk)
            
        data_type = getattr(data, "type", None)
        
        # Handle Beta API Tool Calls
        if data_type == "function.call.delta":
            logger.info("Received tool_calls chunk (Beta API): %s", getattr(data, "model_dump_json", lambda: str(data))())
            buffer_key = getattr(data, "id", "")
            if buffer_key not in tool_calls_buffer:
                tool_calls_buffer[buffer_key] = {
                    "id": getattr(data, "tool_call_id", ""),
                    "name": getattr(data, "name", ""),
                    "arguments": getattr(data, "arguments", "") or ""
                }
            else:
                args = getattr(data, "arguments", "") or ""
                tool_calls_buffer[buffer_key]["arguments"] += args
                
        # Handle Standard API Tool Calls (fallback)
        choices = getattr(data, "choices", [])
        for choice in choices:
            delta = getattr(choice, "delta", None)
            if delta:
                tool_calls = getattr(delta, "tool_calls", None)
                if tool_calls:
                    logger.info("Received tool_calls chunk: %s", tool_calls)
                    for tc in tool_calls:
                        idx = getattr(tc, "index", 0)
                        if idx not in tool_calls_buffer:
                            func = getattr(tc, "function", None)
                            tool_calls_buffer[idx] = {
                                "id": getattr(tc, "id", ""),
                                "name": getattr(func, "name", "") if func else "",
                                "arguments": getattr(func, "arguments", "") if func else ""
                            }
                        else:
                            func = getattr(tc, "function", None)
                            args = getattr(func, "arguments", "") if func else ""
                            if args:
                                tool_calls_buffer[idx]["arguments"] += args

    logger.info("Stream ended. Accumulated %d tool calls.", len(tool_calls_buffer))

    if tool_calls_buffer and conversation_id_out:
        yield ("status", "Executing tools...")
        tool_results = []
        for idx, tc in tool_calls_buffer.items():
            func_name = tc["name"]
            args_str = tc["arguments"]
            tc_id = tc["id"]
            try:
                args = json.loads(args_str) if args_str else {}
                result_str = await execute_tool(func_name, args)
            except Exception as e:
                logger.error("Error executing stream tool: %s", e)
                result_str = f"Error: {e}"

            tool_results.append({
                "type": "function.result",
                "tool_call_id": tc_id,
                "name": func_name,
                "result": result_str
            })
            
        yield ("status", "Processing tool results...")
        
        async for event_type, evt_data in _consume_stream_and_tools(
            client, 
            client.beta.conversations.append_stream, 
            conversation_id=conversation_id_out, 
            inputs=tool_results
        ):
            yield event_type, evt_data

async def orchestrate_stream(
    client: Mistral,
    query: str,
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    cleanup_agent: bool = False,
    tier: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    try:
        if conversation_id:
            inputs = [{"role": "user", "content": query}]
            yield _sse("Continuing conversation...", "status")

            async for evt_type, data in _consume_stream_and_tools(
                client, client.beta.conversations.append_stream,
                conversation_id=conversation_id, inputs=inputs
            ):
                if evt_type != "conversation_id":
                    yield _sse(data, evt_type)

            yield _sse(conversation_id, "conversation_id")
            yield _sse("done", "done")
            return

        # If a specific agent is provided, skip analysis
        if agent_id:
            yield _sse("Processing with selected agent...", "status")
            inputs = [{"role": "user", "content": query}]
            
            conversation_id_out = None
            async for evt_type, data in _consume_stream_and_tools(
                client, client.beta.conversations.start_stream,
                agent_id=agent_id, inputs=inputs
            ):
                if evt_type == "conversation_id":
                    conversation_id_out = data
                else:
                    yield _sse(data, evt_type)

            if conversation_id_out:
                yield _sse(conversation_id_out, "conversation_id")
            yield _sse("done", "done")
            return

        yield _sse("Analyzing your query...", "status")
        synthesis_check = await _check_synthesis_needed(client, query)
            
        agent_config = await _analyze_query(client, query)

        # Override tier if explicitly selected by the user
        if tier:
            agent_config["tier"] = tier

        yield _sse(json.dumps({
            "agent_name": agent_config["agent_name"],
            "model": agent_config["model"],
            "tools": agent_config["tools"],
            "tier": agent_config.get("tier", "foundation"),
        }), "agent_config")

        yield _sse(f"Creating {agent_config['agent_name']}...", "status")
        agent_id = _create_dynamic_agent(client, agent_config, query)

        yield _sse("Processing your query...", "status")
        inputs = [{"role": "user", "content": query}]
        
        conversation_id_out = None
        async for evt_type, data in _consume_stream_and_tools(
            client, client.beta.conversations.start_stream,
            agent_id=agent_id, inputs=inputs
        ):
            if evt_type == "conversation_id":
                conversation_id_out = data
            else:
                yield _sse(data, evt_type)

        if cleanup_agent and agent_id:
            try:
                client.beta.agents.delete(agent_id=agent_id)
                agent_id = None
            except Exception:
                pass

        if conversation_id_out:
            yield _sse(conversation_id_out, "conversation_id")
        yield _sse(json.dumps({
            "agent_id": agent_id,
            "agent_name": agent_config["agent_name"],
        }), "done")

    except Exception as e:
        if agent_id and cleanup_agent:
            try:
                client.beta.agents.delete(agent_id=agent_id)
            except Exception:
                pass
        logger.error("Stream orchestration failed: %s", e)
        yield _sse(str(e), "error")


def _extract_stream_chunk(event) -> Optional[str]:
    """Extract text content from a streaming event."""
    data = getattr(event, "data", event)
    
    # Mistral Beta API format
    data_type = getattr(data, "type", None)
    if data_type == "message.output.delta":
        content = getattr(data, "content", None)
        if content:
            return content

    # Standard API format
    choices = getattr(data, "choices", None)
    if choices:
        for choice in choices:
            delta = getattr(choice, "delta", None)
            if delta:
                content = getattr(delta, "content", None)
                if content:
                    return content
    content = getattr(data, "content", None)
    if isinstance(content, str):
        return content
    return None
