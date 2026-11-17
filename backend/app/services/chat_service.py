"""
Service layer for Chat Completion operations.
Uses async 3-tier tool execution (native → Docker → MCP).
"""

import asyncio
import json
import logging
import re
from functools import partial
from typing import AsyncGenerator
from mistralai.client import Mistral
from app.core.events import SSEEvent
from app.exceptions import MistralAPIError
from app.services.sdk_offload import iter_sync_stream
from app.services.tool_registry import execute_tool


def _choice_message(choice):
    """The assistant message on a choice, whatever shape it arrived in.

    An agent carrying a server-executed built-in tool — `document_library`
    above all — returns `messages` (plural), the transcript of what the server
    ran, with `message` left null. Every RAG agent has that tool, so reading
    `choice.message.role` directly crashed the whole chat path for them with
    "'NoneType' object has no attribute 'role'".
    """
    message = getattr(choice, "message", None)
    if message is not None:
        return message
    transcript = getattr(choice, "messages", None) or []
    return transcript[-1] if transcript else None


from app.config import map_model_name, settings


logger = logging.getLogger(__name__)


# ── Content: text, and the reasoning models' "thinking" ─────────────────────
#
# Reasoning models (mistral-large-latest / -4, magistral-*) send content as a
# list of chunks — {"type": "thinking", "thinking": [...]} then {"type": "text"}
# — in replies and in every stream delta, not as a string. The stream handler
# did `content += chunk` on that list, failed, and left the assistant's reply
# empty in the chat; the next turn sent that empty message back as history and
# Mistral refused the whole request: "Assistant message must have either
# content or tool_calls, but not none."


def _kind(chunk) -> str:
    return str(getattr(chunk, "type", None) or (chunk.get("type") if isinstance(chunk, dict) else "") or "")


def _text_of(chunk) -> str:
    text = getattr(chunk, "text", None)
    if text is None and isinstance(chunk, dict):
        text = chunk.get("text")
    return text if isinstance(text, str) else ""


def split_content(content) -> tuple[str, str]:
    """``(answer, thinking)`` from a message's or a delta's content, whatever its shape."""
    if content is None or type(content).__name__ == "Unset":
        return "", ""
    if isinstance(content, str):
        return content, ""
    if not isinstance(content, list):
        return str(content), ""
    answer, thinking = [], []
    for chunk in content:
        if _kind(chunk) == "thinking":
            inner = getattr(chunk, "thinking", None)
            if inner is None and isinstance(chunk, dict):
                inner = chunk.get("thinking")
            for part in inner if isinstance(inner, list) else [inner]:
                thinking.append(part if isinstance(part, str) else _text_of(part))
        else:
            answer.append(_text_of(chunk))
    return "".join(answer), "".join(thinking)


def _has_content(content) -> bool:
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        # A user message may carry an attachment and no text.
        return any(_kind(c) != "text" or _text_of(c).strip() for c in content)
    return content is not None


async def _prepared(client, kwargs: dict, force_text=()) -> dict:
    """``kwargs`` with every attachment turned into what the target model accepts."""
    from app.services import attachments

    if not attachments.has_attachments(kwargs["messages"]):
        return kwargs
    if "agent_id" in kwargs:
        from app.services.workflow_engine import agent_call

        profile = await asyncio.to_thread(agent_call.profile, kwargs["agent_id"])
        model, api = (profile or {}).get("model"), "agents"
    else:
        model, api = kwargs.get("model"), "chat"
    messages = await attachments.resolve_messages(client, kwargs["messages"], model, api, force_text)
    return {**kwargs, "messages": messages}


def _refusal(kwargs: dict, exc: BaseException) -> set:
    """The kinds the model refused in this call (remembered); empty for any other error."""
    from app.services import attachments

    kinds = attachments.refused_kinds(exc)
    if kinds:
        attachments.remember_refusal(kwargs.get("model") or kwargs.get("agent_id"), kinds)
    return kinds


def clean_history(raw: list[dict]) -> list[dict]:
    """The conversation as Mistral accepts it.

    * an assistant message is sent as its answer text only (never its thinking);
    * an assistant message with neither text nor tool calls — a reply that
      failed or was stopped before its first word — is left out, as is an
      empty user message;
    * a tool message keeps its tool_call_id.
    """
    out: list[dict] = []
    for msg in raw or []:
        role = msg.get("role")
        content = msg.get("content")
        if role == "assistant":
            text, _ = split_content(content)
            m: dict = {"role": "assistant"}
            if text.strip():
                m["content"] = text
            if msg.get("tool_calls"):
                m["tool_calls"] = msg["tool_calls"]
            if len(m) == 1:
                continue
        else:
            if role in ("user", "system") and not _has_content(content):
                continue
            m = {"role": role, "content": content if content is not None else ""}
        if msg.get("name"):
            m["name"] = msg["name"]
        if msg.get("tool_call_id"):
            m["tool_call_id"] = msg["tool_call_id"]
        out.append(m)
    return out


def _sampling(data: dict, kwargs: dict) -> None:
    """Temperature and top_p as every model accepts them.

    Greedy decoding (temperature 0) with top_p below 1 is refused by some
    models ("top_p must be 1 when using greedy sampling"); top_p is then left out.
    """
    temperature, top_p = data.get("temperature"), data.get("top_p")
    if temperature is not None:
        kwargs["temperature"] = temperature
    if top_p is not None and not (temperature == 0 and top_p < 1):
        kwargs["top_p"] = top_p


async def chat_completion(client: Mistral, data: dict) -> dict:
    """Perform a (non-streaming) chat completion with tool execution loop."""
    try:
        kwargs = {"messages": clean_history(data["messages"])}

        # An agent already pins its own model, and `agents.complete()` rejects
        # the argument outright — so the two are mutually exclusive rather than
        # merely redundant. The request model defaults `model`, which made every
        # agent-targeted chat fail with "unexpected keyword argument 'model'".
        if data.get("agent_id"):
            kwargs["agent_id"] = data["agent_id"]
        elif data.get("model"):
            kwargs["model"] = map_model_name(data["model"])
        else:
            kwargs["model"] = settings.CHAT_DEFAULT_MODEL

        _sampling(data, kwargs)
        if data.get("max_tokens") is not None:
            kwargs["max_tokens"] = data["max_tokens"]
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

        # A direct chat against an agent should get that agent's domain
        # knowledge too, not just the workflow and orchestrator paths.
        from app.services import tool_registry
        tool_registry.CURRENT_AGENT.set(kwargs.get("agent_id"))

        original = kwargs
        kwargs = await _prepared(client, kwargs)
        for _ in range(5):
            # Offloaded: the shared client is synchronous, so calling it inline
            # here would block the event loop for the whole completion — every
            # other request in the process stalls behind it.
            complete = client.agents.complete if "agent_id" in kwargs else client.chat.complete
            try:
                result = await asyncio.to_thread(partial(complete, **kwargs))
            except Exception as e:
                refused = _refusal(kwargs, e)
                if not refused:
                    raise
                # The model does not take that kind of input: send it as text.
                kwargs = await _prepared(client, original, refused)
                result = await asyncio.to_thread(partial(complete, **kwargs))

            choice = result.choices[0]
            message = _choice_message(choice)
            tool_calls = getattr(message, "tool_calls", None)

            if not tool_calls:
                break

            logger.info(f"Chat completion requested {len(tool_calls)} tool call(s)")

            assistant_msg = {"role": "assistant"}
            text, _ = split_content(getattr(message, "content", None))
            if text:
                assistant_msg["content"] = text
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
            message = _choice_message(choice)
            text, thinking = split_content(getattr(message, "content", None))
            msg_data = {
                "role": getattr(message, "role", "assistant"),
                "content": text,
            }
            if thinking:
                msg_data["thinking"] = thinking
            tool_calls = getattr(message, "tool_calls", None)
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
    """Perform a streaming chat completion. Yields SSE-formatted chunks.

    ``text_chunk`` carries the answer; ``thinking_chunk`` a reasoning model's
    thinking (shown apart, never sent back as history). A stream that ends
    with no answer at all is reported as an error rather than an empty reply.
    """
    try:
        kwargs = {"messages": clean_history(data["messages"]), "stream": True}
        if not any(m["role"] == "user" for m in kwargs["messages"]):
            yield SSEEvent("error", "There is no message to answer.").serialize()
            return

        # An agent pins its own model; agents.stream() takes no model argument.
        if data.get("agent_id"):
            kwargs["agent_id"] = data["agent_id"]
        elif data.get("model"):
            kwargs["model"] = map_model_name(data["model"])
        else:
            kwargs["model"] = settings.CHAT_DEFAULT_MODEL
        if "agent_id" not in kwargs:
            _sampling(data, kwargs)
        if data.get("max_tokens") is not None:
            kwargs["max_tokens"] = data["max_tokens"]
        if data.get("tools"):
            kwargs["tools"] = data["tools"]
        # Agents carry their own system prompt, so safe_prompt is chat-only.
        if data.get("safe_prompt") and "agent_id" not in kwargs:
            kwargs["safe_prompt"] = True

        # Both opening the stream and pulling each chunk block. Iterating the
        # SDK stream directly stalled the event loop once per token, which is
        # what made concurrent streams serialise behind each other.
        open_stream = client.agents.stream if "agent_id" in kwargs else client.chat.stream

        answered = thought = False
        finish = None
        original, force = kwargs, set()
        for attempt in range(2):
            if attempt == 0 or force:
                kwargs = await _prepared(client, original, force)
            try:
                async for event in iter_sync_stream(partial(open_stream, **kwargs)):
                    chunk_data = event.data
                    text = thinking = ""
                    for choice in getattr(chunk_data, "choices", None) or []:
                        delta = getattr(choice, "delta", None)
                        if delta is not None:
                            t, th = split_content(getattr(delta, "content", None))
                            text += t
                            thinking += th
                        finish = getattr(choice, "finish_reason", None) or finish
                    if thinking:
                        thought = True
                        yield SSEEvent("thinking_chunk", thinking).serialize()
                    if text:
                        answered = True
                        # Multi-line `data:` frames, which the client joins back with
                        # "\n". Escaping newlines to a literal "\n" instead left the
                        # Markdown on one line, and mangled any "\n" the model wrote.
                        yield SSEEvent("text_chunk", text).serialize()
                break
            except Exception as e:
                refused = _refusal(kwargs, e)
                if attempt or answered or thought or not refused:
                    raise
                # The model does not take that kind of input: send it as text.
                force = refused
                yield SSEEvent("status", f"This model does not take {', '.join(sorted(refused))} "
                                         "input — sending it as text instead").serialize()

        if not answered:
            reason = str(getattr(finish, "value", finish) or "")
            yield SSEEvent("error", (
                "The model used its whole token budget thinking and gave no answer. Raise "
                "Max tokens or ask a shorter question." if thought and reason == "length"
                else "The model returned no answer. Try again, or pick another model.")).serialize()
            return
        yield SSEEvent("done", {}).serialize()

    except Exception as e:
        logger.error(f"Stream chat completion failed: {e}")
        yield SSEEvent("error", _readable(e)).serialize()


def _readable(exc: Exception) -> str:
    """Mistral's own message out of an SDK error, without the HTTP body around it."""
    text = str(exc)
    match = re.search(r'"message"\s*:\s*"([^"]+)"', text)
    if match:
        status = re.search(r"Status (\d{3})", text)
        return f"{match.group(1)}" + (f" ({status.group(1)})" if status else "")
    return text[:400]
