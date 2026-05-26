"""
Service layer for Chat Completion operations.
Uses async 3-tier tool execution (native → Docker → MCP).
"""

import json
import logging
from typing import AsyncGenerator
from mistralai.client import Mistral
from app.exceptions import MistralAPIError
from app.services.tool_registry import execute_tool
from app.config import map_model_name


logger = logging.getLogger(__name__)


async def chat_completion(client: Mistral, data: dict) -> dict:
    """Perform a (non-streaming) chat completion with tool execution loop."""
    try:
        messages = []
        for msg in data["messages"]:
            m = {"role": msg["role"], "content": msg["content"]}
            if msg.get("name"):
                m["name"] = msg["name"]
            if msg.get("tool_call_id"):
                m["tool_call_id"] = msg["tool_call_id"]
            messages.append(m)

        kwargs = {"messages": messages}

        if data.get("agent_id"):
            kwargs["agent_id"] = data["agent_id"]
        if data.get("model"):
            kwargs["model"] = map_model_name(data["model"])
        elif not data.get("agent_id"):
            kwargs["model"] = "mistral-large-latest"

        if data.get("temperature") is not None:
            kwargs["temperature"] = data["temperature"]
        if data.get("max_tokens") is not None:
            kwargs["max_tokens"] = data["max_tokens"]
        if data.get("top_p") is not None:
            kwargs["top_p"] = data["top_p"]
        if data.get("tools"):
            kwargs["tools"] = data["tools"]
        if data.get("tool_choice") is not None:
            kwargs["tool_choice"] = data["tool_choice"]
        if data.get("response_format"):
            kwargs["response_format"] = data["response_format"]
        if data.get("random_seed") is not None:
            kwargs["random_seed"] = data["random_seed"]
        if data.get("safe_prompt"):
            kwargs["safe_prompt"] = data["safe_prompt"]
        if data.get("parallel_tool_calls") is not None:
            kwargs["parallel_tool_calls"] = data["parallel_tool_calls"]

        for _ in range(5):
            if "agent_id" in kwargs:
                result = client.agents.complete(**kwargs)
            else:
                result = client.chat.complete(**kwargs)

            choice = result.choices[0]
            tool_calls = getattr(choice.message, "tool_calls", None)

            if not tool_calls:
                break

            logger.info(f"Chat completion requested {len(tool_calls)} tool call(s)")

            assistant_msg = {"role": "assistant"}
            if getattr(choice.message, "content", None):
                assistant_msg["content"] = choice.message.content
            assistant_msg["tool_calls"] = [
                tc.model_dump() if hasattr(tc, "model_dump") else tc for tc in tool_calls
            ]
            kwargs["messages"].append(assistant_msg)

            for tc in tool_calls:
                try:
                    func_name = tc.function.name
                    args_str = tc.function.arguments
                    tc_id = tc.id

                    args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    if args is None:
                        args = {}

                    # Use async 3-tier executor
                    result_str = await execute_tool(func_name, args)
                except Exception as e:
                    logger.error(f"Error executing tool {tc.function.name}: {e}")
                    result_str = f"Error: {str(e)}"
                    tc_id = tc.id
                    func_name = tc.function.name

                kwargs["messages"].append({
                    "role": "tool",
                    "name": func_name,
                    "content": result_str,
                    "tool_call_id": tc_id,
                })

        # Serialize response
        choices = []
        for choice in result.choices:
            msg_data = {
                "role": choice.message.role,
                "content": getattr(choice.message, "content", None),
            }
            tool_calls = getattr(choice.message, "tool_calls", None)
            if tool_calls:
                msg_data["tool_calls"] = [
                    tc.model_dump() if hasattr(tc, "model_dump") else tc for tc in tool_calls
                ]
            choices.append({
                "index": choice.index,
                "message": msg_data,
                "finish_reason": getattr(choice, "finish_reason", None),
            })

        usage = None
        if result.usage:
            usage = {
                "prompt_tokens": getattr(result.usage, "prompt_tokens", 0),
                "completion_tokens": getattr(result.usage, "completion_tokens", 0),
                "total_tokens": getattr(result.usage, "total_tokens", 0),
            }

        return {
            "id": result.id,
            "object": "chat.completion",
            "model": result.model,
            "choices": choices,
            "created": getattr(result, "created", None),
            "usage": usage,
        }

    except Exception as e:
        logger.error(f"Chat completion failed: {e}")
        raise MistralAPIError(f"Chat completion failed: {str(e)}")


async def stream_chat_completion(client: Mistral, data: dict) -> AsyncGenerator[str, None]:
    """Perform a streaming chat completion. Yields SSE-formatted chunks."""
    try:
        messages = []
        for msg in data["messages"]:
            m = {"role": msg["role"], "content": msg["content"]}
            if msg.get("name"):
                m["name"] = msg["name"]
            messages.append(m)

        kwargs = {"messages": messages, "stream": True}

        if data.get("agent_id"):
            kwargs["agent_id"] = data["agent_id"]
        if data.get("model"):
            kwargs["model"] = map_model_name(data["model"])
        elif not data.get("agent_id"):
            kwargs["model"] = "mistral-large-latest"
        if data.get("temperature") is not None:
            kwargs["temperature"] = data["temperature"]
        if data.get("max_tokens") is not None:
            kwargs["max_tokens"] = data["max_tokens"]
        if data.get("tools"):
            kwargs["tools"] = data["tools"]

        if "agent_id" in kwargs:
            stream = client.agents.stream(**kwargs)
        else:
            stream = client.chat.stream(**kwargs)

        for event in stream:
            chunk_data = event.data
            content = ""
            
            if hasattr(chunk_data, "choices"):
                for choice in chunk_data.choices:
                    if hasattr(choice, "delta") and choice.delta:
                        c = getattr(choice.delta, "content", None)
                        if c and type(c).__name__ != "Unset":
                            content += c
            
            if content:
                # Replace newlines with a literal '\n' string to avoid breaking SSE 'data:' parsing
                content = content.replace("\n", "\\n")
                yield f"event: text_chunk\ndata: {content}\n\n"

        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        logger.error(f"Stream chat completion failed: {e}")
        yield f"event: error\ndata: {str(e)}\n\n"
