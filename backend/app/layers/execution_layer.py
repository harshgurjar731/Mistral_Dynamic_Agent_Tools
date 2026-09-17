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


#: Mistral refuses to stream a conversation for an agent that carries a
#: guardrail configuration (400, code 3001). The guardrail is a security
#: control and the streaming is a presentation choice, so the streaming is what
#: gives way — see ExecutionLayer._deliver_without_streaming.
_GUARDRAIL_STREAM_MARKERS = (
    "guardrails are not supported in streaming",
    "not supported in streaming mode",
)


def _is_guardrail_stream_refusal(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _GUARDRAIL_STREAM_MARKERS)


#: conversation id → agent id. A follow-up turn arrives with only a
#: conversation id, and the rules that apply belong to that conversation's
#: agent. Filled when a conversation starts; after a restart the agent is
#: looked up once from the conversation itself.
_CONVERSATION_AGENTS: dict[str, str] = {}
_CONVERSATION_AGENTS_MAX = 5000

#: Where the running turn's RuleContext is kept on the pipeline context.
_RULES_KEY = "_rule_context"
_TOOL_STATS_KEY = "_tool_stats"


def _remember_conversation(conversation_id: Optional[str], agent_id: Optional[str]) -> None:
    if not conversation_id or not agent_id:
        return
    if len(_CONVERSATION_AGENTS) >= _CONVERSATION_AGENTS_MAX:
        _CONVERSATION_AGENTS.pop(next(iter(_CONVERSATION_AGENTS)))
    _CONVERSATION_AGENTS[conversation_id] = agent_id


async def _agent_for_conversation(client, conversation_id: Optional[str]) -> Optional[str]:
    if not conversation_id:
        return None
    known = _CONVERSATION_AGENTS.get(conversation_id)
    if known:
        return known
    try:
        conv = await asyncio.to_thread(
            partial(client.beta.conversations.get, conversation_id=conversation_id)
        )
        agent_id = getattr(conv, "agent_id", None)
        _remember_conversation(conversation_id, agent_id)
        return agent_id
    except Exception as e:
        logger.debug("Could not resolve the agent of conversation %s: %s", conversation_id, e)
        return None


async def _process_tool_calls_parallel(
    client, conv_result, conversation_id: str, max_rounds: int = 5,
    stats: Optional[dict] = None,
):
    """Loop to process tool calls — executes all calls in a round concurrently.

    ``max_rounds`` comes from the agent's guardrail envelope. Bounding the loop
    is what makes that part of the envelope real: instructions can be ignored
    by the model, the loop bound cannot.
    """
    current_result = conv_result

    for _ in range(max(1, max_rounds)):
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

        if stats is not None:
            stats["rounds"] = stats.get("rounds", 0) + 1
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

    # Still asking for tools after the last allowed round: the budget ended the
    # loop, not the agent. Reported by the tool-call-limit rule.
    if stats is not None:
        outputs = (
            getattr(current_result, "outputs", None)
            or getattr(current_result, "entries", None)
            or []
        )
        last = list(outputs)[-1] if outputs else None
        last_type = last.get("type") if isinstance(last, dict) else getattr(last, "type", None)
        stats["hit_limit"] = last_type == "function.call"

    return current_result


class ExecutionLayer(Layer):
    """Run the agent conversation and handle the recursive tool-call loop.

    Supports both JSON mode (``ctx.stream == False``) and streaming mode
    (``ctx.stream == True``).  In JSON mode, the full response is stored
    in ``ctx.response_text`` and ``ctx.result``.  In streaming mode, SSE
    events are appended to ``ctx.events``.
    """

    name = "execution"
    label = "Run the agent"
    detail = "Holds the conversation and executes any tools the agent calls."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.rules import runtime as rules_runtime

        # Determine which agent to use
        agent_id = ctx.agent_id or ctx.created_agent_id
        client = ctx.client

        rule_ctx, rules_token = await self._activate_rules(ctx, client, agent_id)
        try:
            if self._screen_message(ctx, rule_ctx):
                if ctx.stream:
                    await self._handle_stream(ctx, client, agent_id)
                else:
                    await self._handle_json(ctx, client, agent_id)
                self._finish_rules(ctx, rule_ctx)
        finally:
            rules_runtime.reset(rules_token)

        return await next(ctx)

    # ── Rules ───────────────────────────────────────────────────────────

    async def _activate_rules(self, ctx: PipelineContext, client, agent_id: str | None):
        """Load the running agent's rules and make them visible to the tool gate."""
        from app.rules import runtime as rules_runtime, store as rules_store

        subject = agent_id or await _agent_for_conversation(client, ctx.conversation_id)
        try:
            if ctx.created_agent_id and ctx.metadata.get("agent_rules") is not None:
                # Just resolved by AgentAssemblyLayer for this very agent.
                rules = ctx.metadata["agent_rules"]
            elif subject:
                rules = await asyncio.to_thread(rules_store.rules_for_agent, subject)
            else:
                # Agent unknown: always-on rules still apply.
                rules = rules_store.effective_rules("agent")
        except Exception as e:
            logger.warning("Agent rules unavailable, continuing without them: %s", e)
            rules = []

        rule_ctx, token = rules_runtime.activate(rules, "agent", subject or "unknown", ctx.conversation_id)
        ctx.metadata[_RULES_KEY] = rule_ctx
        return rule_ctx, token

    def _max_rounds(self, ctx: PipelineContext) -> int:
        """The guardrail envelope's round budget, lowered by a tool-call-limit rule."""
        from app.layers.agent.assembly_layer import MAX_TOOL_ROUNDS_KEY
        from app.rules import engine as rules_engine

        base = ctx.metadata.get(MAX_TOOL_ROUNDS_KEY, 5)
        rule_ctx = ctx.metadata.get(_RULES_KEY)
        return rules_engine.tool_round_limit(rule_ctx.rules, base) if rule_ctx else base

    def _screen_message(self, ctx: PipelineContext, rule_ctx) -> bool:
        """Screen the user's message. False when a rule refused it.

        A refused message is answered with the refusal itself rather than an
        error, so the user sees why in the conversation, not in a toast.
        """
        from app.rules import engine as rules_engine, runtime as rules_runtime

        if not rule_ctx.rules:
            return True
        outcomes, refusal = rules_engine.check_message(ctx.query, rule_ctx.rules)
        rules_runtime.record(
            outcomes, scope="agent", subject_id=rule_ctx.subject_id,
            conversation_id=ctx.conversation_id, ctx=rule_ctx,
        )
        if not refusal:
            return True

        summary = rules_runtime.summarise(rule_ctx.outcomes)
        agent_config = ctx.agent_config or {}
        ctx.response_text = refusal
        ctx.result = {
            "response": refusal,
            "conversation_id": ctx.conversation_id,
            "agent_id": ctx.created_agent_id or ctx.agent_id,
            "agent_name": agent_config.get("agent_name"),
            "blocked_by_rule": True,
            "rule_outcomes": summary,
        }
        if ctx.stream:
            ctx.emit("text_chunk", refusal)
            ctx.emit("rule_outcomes", json.dumps(summary))
            ctx.emit("done", json.dumps({
                "agent_id": ctx.created_agent_id or ctx.agent_id,
                "agent_name": agent_config.get("agent_name"),
            }))
        return False

    def _apply_answer_rules(self, ctx: PipelineContext, text: str) -> str:
        """Check (and possibly redact or cut) the answer before anyone sees it."""
        from app.rules import engine as rules_engine, runtime as rules_runtime

        rule_ctx = ctx.metadata.get(_RULES_KEY)
        if not rule_ctx or not rules_engine.answer_rules(rule_ctx.rules):
            return text
        checked, outcomes, refusal = rules_engine.check_answer(text or "", rule_ctx.rules)
        rules_runtime.record(
            outcomes, scope="agent", subject_id=rule_ctx.subject_id,
            conversation_id=ctx.conversation_id, ctx=rule_ctx,
        )
        return refusal or checked

    def _finish_rules(self, ctx: PipelineContext, rule_ctx) -> None:
        """Record the tool budget's outcome and publish the turn's rule results."""
        from app.rules import engine as rules_engine, runtime as rules_runtime

        if not rule_ctx.rules:
            return
        stats = ctx.metadata.get(_TOOL_STATS_KEY) or {}
        rules_runtime.record(
            rules_engine.tool_limit_outcomes(
                rule_ctx.rules, stats.get("rounds", 0), bool(stats.get("hit_limit"))
            ),
            scope="agent", subject_id=rule_ctx.subject_id,
            conversation_id=ctx.conversation_id, ctx=rule_ctx,
        )
        summary = rules_runtime.summarise(rule_ctx.outcomes)
        ctx.emit("rule_outcomes", json.dumps(summary))
        if isinstance(ctx.result, dict) and ctx.result:
            ctx.result["rule_outcomes"] = summary

    # ── JSON mode ───────────────────────────────────────────────────────

    async def _handle_json(self, ctx: PipelineContext, client, agent_id: str | None) -> None:
        # Scope any industry-knowledge lookup to this agent's own domain.
        from app.services import tool_registry
        tool_registry.CURRENT_AGENT.set(agent_id or ctx.agent_id)

        # Set by GuardrailConfigLayer for a freshly designed agent. A follow-up
        # or a pre-selected agent has no envelope in this context, so the
        # engine default applies — unless a tool-call-limit rule lowers it.
        max_rounds = self._max_rounds(ctx)
        stats = ctx.metadata.setdefault(_TOOL_STATS_KEY, {})

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
            result = await _process_tool_calls_parallel(
                client, result, ctx.conversation_id, max_rounds, stats
            )
            ctx.response_text = self._apply_answer_rules(ctx, _extract_response(result))
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
        _remember_conversation(conversation_id, agent_id)
        conv_result = await _process_tool_calls_parallel(
            client, conv_result, conversation_id, max_rounds, stats
        )
        ctx.conversation_id = conversation_id
        ctx.response_text = self._apply_answer_rules(ctx, _extract_response(conv_result))

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

    async def _deliver_without_streaming(
        self, ctx: PipelineContext, client, agent_id: str | None, reason: str = "guardrails",
    ) -> None:
        """Answer through the non-streaming path, emitting SSE as if streamed.

        Used when the agent carries guardrails, or answer rules (redaction,
        JSON, length) that must see the whole answer before anyone does. The
        whole reply arrives at once instead of token by token — the tool loop,
        the conversation id and the final payload are otherwise identical,
        because this reuses the JSON path rather than reimplementing it.
        """
        ctx.emit(
            "status",
            "Answer rules are active on this agent, so the answer is checked and "
            "arrives complete rather than word by word."
            if reason == "rules"
            else "Guardrails are active on this agent, so the answer arrives complete "
            "rather than word by word.",
        )
        await self._handle_json(ctx, client, agent_id)

        if ctx.error:
            return

        text = ctx.response_text or ""
        if text:
            ctx.emit("text_chunk", text)
        if ctx.conversation_id:
            ctx.emit("conversation_id", ctx.conversation_id)

        agent_config = ctx.agent_config or {}
        ctx.emit("done", json.dumps({
            "agent_id": ctx.created_agent_id or ctx.agent_id,
            "agent_name": agent_config.get("agent_name"),
        }))

    async def _handle_stream(self, ctx: PipelineContext, client, agent_id: str | None) -> None:
        from app.rules import engine as rules_engine

        # Answer rules have to see the whole answer before the user does, and
        # a streamed answer is already on screen by the time it is complete.
        rule_ctx = ctx.metadata.get(_RULES_KEY)
        if rule_ctx and rules_engine.answer_rules(rule_ctx.rules):
            await self._deliver_without_streaming(ctx, client, agent_id, reason="rules")
            return

        # Known up front for an agent this run just created: no point spending a
        # round trip to be told no.
        spec_guardrails = ctx.agent_spec.guardrails if ctx.agent_spec else None
        if ctx.created_agent_id and spec_guardrails and spec_guardrails.enabled:
            logger.info(
                "Agent %s carries guardrails — answering without streaming",
                ctx.created_agent_id,
            )
            await self._deliver_without_streaming(ctx, client, agent_id)
            return

        try:
            await self._stream(ctx, client, agent_id)
        except Exception as e:
            # A pre-selected agent's guardrails are not visible from here, so
            # the refusal is the first time we learn of them.
            if not _is_guardrail_stream_refusal(e):
                raise
            logger.info("Stream refused for a guarded agent — falling back to a single reply")
            await self._deliver_without_streaming(ctx, client, agent_id)

    async def _stream(self, ctx: PipelineContext, client, agent_id: str | None) -> None:
        if ctx.conversation_id:
            # Follow-up stream
            inputs = _build_user_inputs(ctx.query, ctx.image)
            ctx.emit("status", "Continuing conversation…")

            async for evt_type, data in _consume_stream_and_tools(
                client, client.beta.conversations.append_stream,
                _max_depth=self._max_rounds(ctx),
                _stats=ctx.metadata.setdefault(_TOOL_STATS_KEY, {}),
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
                _max_depth=self._max_rounds(ctx),
                _stats=ctx.metadata.setdefault(_TOOL_STATS_KEY, {}),
                agent_id=ctx.agent_id, inputs=inputs,
            ):
                if evt_type == "conversation_id":
                    conversation_id_out = data
                else:
                    ctx.emit(evt_type, data)

            if conversation_id_out:
                _remember_conversation(conversation_id_out, ctx.agent_id)
                ctx.emit("conversation_id", conversation_id_out)
            ctx.emit("done", "done")
            return

        if not agent_id:
            ctx.set_error("No agent_id available for execution")
            return

        # New query stream (agent was created by AgentAssemblyLayer)
        ctx.emit("status", "Processing your query…")
        inputs = _build_user_inputs(ctx.query, ctx.image)

        conversation_id_out = None
        async for evt_type, data in _consume_stream_and_tools(
            client, client.beta.conversations.start_stream,
            _max_depth=self._max_rounds(ctx),
            _stats=ctx.metadata.setdefault(_TOOL_STATS_KEY, {}),
            agent_id=agent_id, inputs=inputs,
        ):
            if evt_type == "conversation_id":
                conversation_id_out = data
            else:
                ctx.emit(evt_type, data)

        ctx.conversation_id = conversation_id_out
        _remember_conversation(conversation_id_out, agent_id)

        agent_config = ctx.agent_config or {}
        if conversation_id_out:
            ctx.emit("conversation_id", conversation_id_out)
        ctx.emit("done", json.dumps({
            "agent_id": ctx.created_agent_id or ctx.agent_id,
            "agent_name": agent_config.get("agent_name"),
        }))


# ── Streaming tool-call consumer ────────────────────────────────────────────

async def _consume_stream_and_tools(
    client, stream_method, *,
    _depth: int = 0,
    _max_depth: int = 5,
    _stats: Optional[dict] = None,
    **stream_kwargs,
) -> AsyncGenerator[tuple[str, str], None]:
    """Consume a Mistral stream, handle tool calls with parallel execution.

    Each round of tool calls recurses once. ``_max_depth`` bounds that the
    same way ``max_rounds`` bounds the non-streaming loop: at the limit the
    model is told the budget is spent and gets one last turn to answer, and
    anything it asks for after that is not executed. Before this bound the
    recursion had none, so a confused agent could call tools indefinitely.
    """
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
        if _depth > _max_depth:
            # The model was already told the budget is spent and asked again.
            logger.warning("Tool call limit (%d rounds) reached — not executing more tools", _max_depth)
            if _stats is not None:
                _stats["hit_limit"] = True
            return

        over_budget = _depth >= _max_depth
        if over_budget:
            if _stats is not None:
                _stats["hit_limit"] = True
            yield ("status", "Tool call limit reached — finishing the answer…")
        else:
            if _stats is not None:
                _stats["rounds"] = _stats.get("rounds", 0) + 1
            yield ("status", "Executing tools…")

        # ── PARALLEL: execute all accumulated tool calls concurrently ──
        async def _exec_one(tc: dict) -> dict:
            func_name = tc["name"]
            args_str = tc["arguments"]
            tc_id = tc["id"]
            try:
                if over_budget:
                    result_str = (
                        "Tool call limit reached — do not call more tools. "
                        "Answer now with what you have."
                    )
                else:
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
            _depth=_depth + 1,
            _max_depth=_max_depth,
            _stats=_stats,
            conversation_id=conversation_id_out,
            inputs=tool_results,
        ):
            yield event_type, evt_data
