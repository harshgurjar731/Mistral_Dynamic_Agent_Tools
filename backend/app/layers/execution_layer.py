"""
ExecutionLayer — Runs the agent conversation and handles the tool-call loop.

Extracted from orchestrator_service.py:186-260 (tool call loop) +
479-574 (streaming).

**Enhanced with parallelism**: tool calls within a single round execute
concurrently via ``asyncio.gather`` instead of a sequential loop.
"""

import asyncio
import json
import logging
from functools import partial
from typing import Optional, AsyncGenerator

from app.core.context import PipelineContext, ImageData
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _build_user_inputs(
    query: str,
    image: Optional[ImageData] = None,
) -> list[dict]:
    """Build user input list, with optional multimodal image content."""
    if image:
        return [{
            "role": "user",
            "content": [
                {"type": "text", "text": query},
                {"type": "image_url", "image_url": {"url": f"data:{image.mime};base64,{image.base64}"}},
            ],
        }]
    return [{"role": "user", "content": query}]


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


def _extract_stream_chunk(event) -> Optional[str]:
    """Extract text content from a streaming event."""
    data = getattr(event, "data", event)

    data_type = getattr(data, "type", None)

    # Skip non-text chunk types
    _skip_types = {"tool_reference", "tool_reference.delta", "citation"}
    if data_type in _skip_types:
        return None

    if data_type == "message.output.delta":
        content = getattr(data, "content", None)
        if isinstance(content, str):
            return content
        if content is not None:
            text = getattr(content, "text", None)
            if isinstance(text, str):
                return text
        return None

    # Standard API format
    choices = getattr(data, "choices", None)
    if choices:
        for choice in choices:
            delta = getattr(choice, "delta", None)
            if delta:
                content = getattr(delta, "content", None)
                if isinstance(content, str):
                    return content
    content = getattr(data, "content", None)
    if isinstance(content, str):
        return content
    return None


async def _execute_tool_call(tc) -> dict:
    """Parse and execute a single tool call. Used for concurrent execution."""
    from app.services.tool_registry import execute_tool

    func_name = "unknown"
    tc_id = "unknown"
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

        result_str = await execute_tool(func_name, args)
    except Exception as e:
        logger.error("Error executing tool call: %s", e)
        result_str = f"Error: {str(e)}"

    return {
        "type": "function.result",
        "tool_call_id": tc_id,
        "name": func_name,
        "result": result_str,
    }


async def _process_tool_calls_parallel(client, conv_result, conversation_id: str):
    """Loop to process tool calls — executes all calls in a round concurrently."""
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

        logger.info("Agent requested %d tool call(s) — executing concurrently", len(tool_calls))

        # ── PARALLEL: execute all tool calls in this round concurrently ──
        tool_results = await asyncio.gather(*[_execute_tool_call(tc) for tc in tool_calls])
        tool_results = list(tool_results)

        logger.info("Submitting %d tool results", len(tool_results))
        current_result = await asyncio.to_thread(
            partial(
                client.beta.conversations.append,
                conversation_id=conversation_id,
                inputs=tool_results,
            )
        )

    return current_result


class ExecutionLayer(Layer):
    """Run the agent conversation and handle the recursive tool-call loop.

    Supports both JSON mode (``ctx.stream == False``) and streaming mode
    (``ctx.stream == True``).  In JSON mode, the full response is stored
    in ``ctx.response_text`` and ``ctx.result``.  In streaming mode, SSE
    events are appended to ``ctx.events``.
    """

    name = "execution"

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        # Determine which agent to use
        agent_id = ctx.agent_id or ctx.created_agent_id
        client = ctx.client

        if ctx.stream:
            await self._handle_stream(ctx, client, agent_id)
        else:
            await self._handle_json(ctx, client, agent_id)

        return await next(ctx)

    # ── JSON mode ───────────────────────────────────────────────────────

    async def _handle_json(self, ctx: PipelineContext, client, agent_id: str | None) -> None:
        inputs = _build_user_inputs(ctx.query, ctx.image)

        if ctx.conversation_id:
            # Follow-up
            result = await asyncio.to_thread(
                partial(
                    client.beta.conversations.append,
                    conversation_id=ctx.conversation_id,
                    inputs=inputs,
                )
            )
            result = await _process_tool_calls_parallel(client, result, ctx.conversation_id)
            ctx.response_text = _extract_response(result)
            ctx.result = {
                "response": ctx.response_text,
                "conversation_id": ctx.conversation_id,
                "agent_id": getattr(result, "agent_id", None),
                "agent_name": None,
                "model": getattr(result, "model", None),
                "tools_used": None,
                "is_followup": True,
            }
            return

        if not agent_id:
            ctx.set_error("No agent_id available for execution")
            return

        # New conversation
        conv_result = await asyncio.to_thread(
            partial(client.beta.conversations.start, agent_id=agent_id, inputs=inputs)
        )

        conversation_id = (
            getattr(conv_result, "conversation_id", None)
            or getattr(conv_result, "id", None)
        )
        conv_result = await _process_tool_calls_parallel(client, conv_result, conversation_id)
        ctx.response_text = _extract_response(conv_result)
        ctx.conversation_id = conversation_id

        agent_config = ctx.agent_config or {}
        ctx.result = {
            "response": ctx.response_text,
            "conversation_id": conversation_id,
            "agent_id": ctx.created_agent_id or ctx.agent_id,
            "agent_name": agent_config.get("agent_name"),
            "agent_description": agent_config.get("description"),
            "model": agent_config.get("model"),
            "tools_used": agent_config.get("tools"),
            "temperature": agent_config.get("temperature"),
            "is_followup": False,
        }

    # ── Streaming mode ──────────────────────────────────────────────────

    async def _handle_stream(self, ctx: PipelineContext, client, agent_id: str | None) -> None:
        if ctx.conversation_id:
            # Follow-up stream
            inputs = _build_user_inputs(ctx.query, ctx.image)
            ctx.emit("status", "Continuing conversation…")

            async for evt_type, data in _consume_stream_and_tools(
                client, client.beta.conversations.append_stream,
                conversation_id=ctx.conversation_id, inputs=inputs,
            ):
                if evt_type != "conversation_id":
                    ctx.emit(evt_type, data)

            ctx.emit("conversation_id", ctx.conversation_id)
            ctx.emit("done", "done")
            return

        if ctx.agent_id and not ctx.created_agent_id:
            # Pre-selected agent stream (no analysis needed)
            inputs = _build_user_inputs(ctx.query, ctx.image)
            ctx.emit("status", "Processing with selected agent…")

            conversation_id_out = None
            async for evt_type, data in _consume_stream_and_tools(
                client, client.beta.conversations.start_stream,
                agent_id=ctx.agent_id, inputs=inputs,
            ):
                if evt_type == "conversation_id":
                    conversation_id_out = data
                else:
                    ctx.emit(evt_type, data)

            if conversation_id_out:
                ctx.emit("conversation_id", conversation_id_out)
            ctx.emit("done", "done")
            return

        if not agent_id:
            ctx.set_error("No agent_id available for execution")
            return

        # New query stream (agent was created by AgentResolverLayer)
        ctx.emit("status", "Processing your query…")
        inputs = _build_user_inputs(ctx.query, ctx.image)

        conversation_id_out = None
        async for evt_type, data in _consume_stream_and_tools(
            client, client.beta.conversations.start_stream,
            agent_id=agent_id, inputs=inputs,
        ):
            if evt_type == "conversation_id":
                conversation_id_out = data
            else:
                ctx.emit(evt_type, data)

        ctx.conversation_id = conversation_id_out

        agent_config = ctx.agent_config or {}
        if conversation_id_out:
            ctx.emit("conversation_id", conversation_id_out)
        ctx.emit("done", json.dumps({
            "agent_id": ctx.created_agent_id or ctx.agent_id,
            "agent_name": agent_config.get("agent_name"),
        }))


# ── Streaming tool-call consumer ────────────────────────────────────────────

async def _consume_stream_and_tools(client, stream_method, **stream_kwargs) -> AsyncGenerator[tuple[str, str], None]:
    """Consume a Mistral stream, handle tool calls with parallel execution."""
    from app.services.tool_registry import execute_tool

    tool_calls_buffer = {}
    conversation_id_out = None

    logger.info("Started consuming Mistral stream…")
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
                    "arguments": getattr(data, "arguments", "") or "",
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
                                "arguments": getattr(func, "arguments", "") if func else "",
                            }
                        else:
                            func = getattr(tc, "function", None)
                            args = getattr(func, "arguments", "") if func else ""
                            if args:
                                tool_calls_buffer[idx]["arguments"] += args

    logger.info("Stream ended. Accumulated %d tool calls.", len(tool_calls_buffer))

    if tool_calls_buffer and conversation_id_out:
        yield ("status", "Executing tools…")

        # ── PARALLEL: execute all accumulated tool calls concurrently ──
        async def _exec_one(tc: dict) -> dict:
            func_name = tc["name"]
            args_str = tc["arguments"]
            tc_id = tc["id"]
            try:
                args = json.loads(args_str) if args_str else {}
                result_str = await execute_tool(func_name, args)
            except Exception as e:
                logger.error("Error executing stream tool: %s", e)
                result_str = f"Error: {e}"
            return {
                "type": "function.result",
                "tool_call_id": tc_id,
                "name": func_name,
                "result": result_str,
            }

        tool_results = await asyncio.gather(*[_exec_one(tc) for tc in tool_calls_buffer.values()])
        tool_results = list(tool_results)

        yield ("status", "Processing tool results…")

        async for event_type, evt_data in _consume_stream_and_tools(
            client,
            client.beta.conversations.append_stream,
            conversation_id=conversation_id_out,
            inputs=tool_results,
        ):
            yield event_type, evt_data
