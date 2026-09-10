"""
Step Runners — execute individual workflow steps.
Each step type has its own runner function.
"""

import asyncio
import json
import time
import logging
import re
import base64

from typing import Any
from app.services.workflow_engine.models import WorkflowStep, StepResult, StepType

# NOTE: every other import in this module is deliberately deferred into the
# function that needs it.
#
# The compiled workflow modules do `from ...step_runners import run_step` at
# module level, and Temporal executes that import inside its determinism
# sandbox. Anything reached from here that touches the filesystem, the clock or
# the environment at import time fails the whole worker — `app.config` builds a
# pydantic-settings object that calls `Path.expanduser()` on the dotenv path,
# which is exactly the restriction that trips.
#
# The function bodies run in *activities*, which execute outside the sandbox, so
# a local import there is both safe and free after the first call.

logger = logging.getLogger(__name__)

# ── Agent name → ID cache (lives for the process lifetime) ────────────────
_agent_name_to_id_cache: dict[str, str] = {}


def _domain_search_spec() -> dict:
    """The grounded-knowledge tool spec, imported lazily (see the note above)."""
    from app.services.tool_registry import ALL_TOOLS, DOMAIN_SEARCH_TOOL

    return ALL_TOOLS[DOMAIN_SEARCH_TOOL]


def _is_agent_uuid(agent_id: str) -> bool:
    """Check if the agent_id looks like a real Mistral agent UUID (not a human name)."""
    if not agent_id:
        return False
    # Mistral agent IDs are typically 'ag:', 'ag_', or plain UUIDs
    if agent_id.startswith("ag:") or agent_id.startswith("ag_"):
        return True
    # UUID-like pattern (hex with dashes)
    if re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', agent_id, re.IGNORECASE):
        return True
    # Pure hex (some APIs return these)
    if re.match(r'^[0-9a-f]{24,}$', agent_id, re.IGNORECASE):
        return True
    return False


def _resolve_agent_id(client: Any, agent_id: str) -> str:
    """
    Resolve an agent identifier to a real Mistral agent UUID.

    If agent_id already looks like a UUID, return it as-is.
    Otherwise, treat it as a human-readable name:
      1. Check the in-memory cache.
      2. Query the Mistral API for existing agents with that name.
      3. If not found, auto-create a lightweight agent with that name.
    """
    if _is_agent_uuid(agent_id):
        return agent_id

    # Check cache
    if agent_id in _agent_name_to_id_cache:
        cached_id = _agent_name_to_id_cache[agent_id]
        logger.info("Agent '%s' resolved from cache → %s", agent_id, cached_id)
        return cached_id

    # Query Mistral API by listing agents and matching by name
    import httpx
    from app.config import settings

    try:
        http_client = httpx.Client(
            base_url="https://api.mistral.ai",
            headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
            timeout=15.0,
        )
        resp = http_client.get("/v1/agents", params={"page": 0, "page_size": 100})
        if resp.status_code == 200:
            data = resp.json()
            agent_list = data if isinstance(data, list) else data.get("data", data)
            for agent in agent_list:
                name = agent.get("name") if isinstance(agent, dict) else getattr(agent, "name", None)
                aid = agent.get("id") if isinstance(agent, dict) else getattr(agent, "id", None)
                if name == agent_id and aid:
                    _agent_name_to_id_cache[agent_id] = aid
                    logger.info("Agent '%s' resolved by name → %s", agent_id, aid)
                    return aid
    except Exception as e:
        logger.warning("Failed to query agents for name resolution: %s", e)

    # Auto-create a new agent with this name
    logger.info("Agent '%s' not found on server — auto-creating…", agent_id)
    try:
        agent_obj = client.beta.agents.create(
            model="mistral-large-latest",
            name=agent_id,
            instructions=(
                f"You are '{agent_id}', a specialist workflow agent. "
                "Analyze the input carefully and provide a thorough, structured response. "
                "If the task involves JSON output, return valid JSON. "
                "Always provide a complete response — never return empty."
            ),
            description=f"Auto-created workflow agent: {agent_id}",
            # No retrieval tools. This agent was invented from a step name, so
            # nothing is known about what it should search — and knowledge-graph
            # access is a deliberate choice, not a default. Turn it on from the
            # agent's own page once its job is clear.
            tools=[],
        )
        real_id = agent_obj.id
        _agent_name_to_id_cache[agent_id] = real_id

        # Classify the stand-in too. It is created by name from a workflow step,
        # so the step's own name is the only signal available — thin, but it
        # beats leaving the agent invisible to scoping entirely.
        from app.ontology import autotag
        autotag.annotate_agent(
            real_id,
            name=agent_id,
            description=f"Auto-created workflow agent: {agent_id}",
            goal=agent_id.replace("_", " "),
        )

        logger.info("Auto-created agent '%s' → %s", agent_id, real_id)
        return real_id
    except Exception as e:
        logger.error("Failed to auto-create agent '%s': %s", agent_id, e)
        raise RuntimeError(f"Cannot resolve agent '{agent_id}': not found and auto-creation failed: {e}")


def _build_multimodal_messages(query: str, variables: dict) -> list[dict[str, Any]]:
    """
    Build the messages list for an agent call.
    If variables contain image data (image_url or image_base64), construct a
    multimodal content array with text + image. Otherwise, plain text message.
    """
    image_url = variables.get("image_url")
    image_base64 = variables.get("image_base64")

    if image_base64:
        # Base64-encoded image → use data URI
        mime = variables.get("image_mime", "image/jpeg")
        content = [
            {"type": "text", "text": query},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_base64}"}},
        ]
        return [{"role": "user", "content": content}]
    elif image_url:
        content = [
            {"type": "text", "text": query},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
        return [{"role": "user", "content": content}]
    else:
        return [{"role": "user", "content": query}]


def _first_choice_message(response: Any) -> Any:
    """Pull the assistant message out of a completion response, or None.

    The message is not guaranteed to be present: a choice can come back with a
    null message when the model produced nothing (content filter, an aborted
    generation, a length stop with no content). Reading ``.message.content``
    directly is what produced ``'NoneType' object has no attribute 'content'``.

    There is a third shape. An agent carrying a **server-executed** built-in
    tool — ``document_library`` above all — returns ``messages`` (plural): the
    transcript of what the server ran on its side, with ``message`` left null.
    Every RAG agent has that tool by definition, so this is the ordinary case
    for them rather than an edge one. The last entry is usually the assistant's
    reply — but not when the server stopped mid-round to hand our own tool
    calls back; ``_pending_tool_round`` handles that case.
    """
    choices = getattr(response, "choices", None)
    if not choices and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        return None

    choice = choices[0]
    if isinstance(choice, dict):
        found = choice.get("message") or choice.get("delta")
        transcript = choice.get("messages")
    else:
        # `delta` is the streaming-shaped equivalent; accept either.
        found = getattr(choice, "message", None) or getattr(choice, "delta", None)
        transcript = getattr(choice, "messages", None)

    if found is not None:
        return found
    return transcript[-1] if transcript else None


def _pending_tool_round(response: Any, round_num: int) -> tuple[list[dict], list] | None:
    """Split a transcript that stopped mid tool-round into ``(replay, calls_to_run)``.

    With a server-executed tool on the agent, one model turn can request a
    server call (``library_search``) and one of ours together. The server runs
    its own, appends the result and stops, so the transcript ends on a tool
    message. Reading that as the answer is what turned an empty library result
    into a step output of ``{}`` — and our call was never run at all.

    ``replay`` is the transcript rebuilt as request messages, to append as-is:
    the assistant turn with every call, then the server's results. The calls
    the server left unanswered are ours to run. Returns None when the reply is
    final, or is not a transcript at all.
    """
    choices = getattr(response, "choices", None)
    if not choices and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        return None
    choice = choices[0]
    transcript = choice.get("messages") if isinstance(choice, dict) else getattr(choice, "messages", None)
    if not transcript:
        return None

    def field(m: Any, key: str) -> Any:
        return m.get(key) if isinstance(m, dict) else getattr(m, key, None)

    last = transcript[-1]
    if field(last, "role") != "tool" and not _message_tool_calls(last):
        return None  # ends on the agent's reply: this turn is final

    answered = {field(m, "tool_call_id") for m in transcript if field(m, "role") == "tool"}
    names: dict[str, str] = {}
    replay: list[dict] = []
    pending: list = []
    for m in transcript:
        role = field(m, "role")
        if role == "assistant":
            calls = []
            for tc in _message_tool_calls(m):
                parsed = _parse_tool_call(tc, round_num)
                if parsed is None:
                    continue
                call_id, name, raw_args, _ = parsed
                names[call_id] = name
                calls.append({"id": call_id, "type": "function", "function": {
                    "name": name,
                    "arguments": raw_args if isinstance(raw_args, str) else json.dumps(raw_args),
                }})
                if call_id not in answered:
                    pending.append(tc)
            entry: dict[str, Any] = {"role": "assistant", "content": _message_text(m)}
            if calls:
                entry["tool_calls"] = calls
            replay.append(entry)
        elif role == "tool":
            call_id = field(m, "tool_call_id")
            content = field(m, "content")
            replay.append({
                "role": "tool",
                "name": names.get(call_id, ""),
                "tool_call_id": call_id,
                "content": content if isinstance(content, str) else json.dumps(content, default=str),
            })
    return replay, pending


def _finish_reason(response: Any) -> str:
    """Best-effort finish_reason for diagnostics when a message is missing."""
    choices = getattr(response, "choices", None)
    if not choices and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        return "no choices"
    choice = choices[0]
    reason = (
        choice.get("finish_reason") if isinstance(choice, dict)
        else getattr(choice, "finish_reason", None)
    )
    return str(reason) if reason is not None else "unknown"


def _message_text(msg: Any) -> str:
    """Normalise assistant content to plain text.

    Content is a string for ordinary replies but a list of typed chunks for
    multimodal or reference-annotated ones. Everything downstream does
    ``.strip()`` and regex over this value, so a list has to be flattened here
    rather than blowing up further along.
    """
    if msg is None:
        return ""

    content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
    if content is None:
        return ""
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for chunk in content:
            if isinstance(chunk, str):
                parts.append(chunk)
                continue
            text = chunk.get("text") if isinstance(chunk, dict) else getattr(chunk, "text", None)
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)

    return str(content)


def _message_tool_calls(msg: Any) -> list:
    """Tool calls requested by the assistant, or an empty list."""
    if msg is None:
        return []
    calls = msg.get("tool_calls") if isinstance(msg, dict) else getattr(msg, "tool_calls", None)
    return list(calls) if calls else []


def _parse_tool_call(tc: Any, round_num: int) -> tuple[str, str, str, dict] | None:
    """Unpack one tool call into ``(id, name, raw_arguments, parsed_arguments)``.

    Returns None when the call carries no usable function name, so the caller
    can keep the assistant message and the tool results consistent instead of
    dropping one side of the pair.
    """
    if isinstance(tc, dict):
        fn = tc.get("function") or {}
        call_id = tc.get("id")
        name = fn.get("name") if isinstance(fn, dict) else getattr(fn, "name", None)
        raw_args = fn.get("arguments") if isinstance(fn, dict) else getattr(fn, "arguments", None)
    else:
        fn = getattr(tc, "function", None)
        call_id = getattr(tc, "id", None)
        name = getattr(fn, "name", None) if fn is not None else None
        raw_args = getattr(fn, "arguments", None) if fn is not None else None

    if not name:
        return None

    if not call_id:
        call_id = f"tc_{round_num}_{name}"

    if raw_args is None:
        raw_args = "{}"

    if isinstance(raw_args, str):
        try:
            arguments = json.loads(raw_args) if raw_args.strip() else {}
        except (json.JSONDecodeError, ValueError):
            logger.warning("Tool call '%s' had unparseable arguments: %.200s", name, raw_args)
            arguments = {}
    elif isinstance(raw_args, dict):
        arguments = raw_args
        raw_args = json.dumps(raw_args)
    else:
        arguments = {}
        raw_args = "{}"

    if not isinstance(arguments, dict):
        arguments = {}

    return str(call_id), str(name), raw_args, arguments


class SafeDict(dict):
    """A dictionary that returns the key placeholder when a key is missing during string formatting."""
    def __missing__(self, key):
        return "{" + key + "}"

#: Returned by _lookup when a reference cannot be resolved. Distinct from None,
#: which is a value an earlier step genuinely produced.
_MISSING = object()

_WHOLE_TEMPLATE = re.compile(r"^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$")
_FENCED_JSON = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.S)


def _as_data(value, lenient: bool = False):
    """Turn a JSON string back into data; leave everything else untouched.

    Strict by default: only a string that *is* JSON is parsed, so a claim text
    that happens to contain braces stays a string. ``lenient`` also looks for a
    JSON object inside prose or a ```json fence — the shape agent answers take —
    and is used only when a caller needs structure, such as walking a dot path
    into an agent's output.
    """
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text[:1] in ("{", "["):
        try:
            return json.loads(text)
        except ValueError:
            pass
    if not lenient:
        return value
    fenced = _FENCED_JSON.search(text)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except ValueError:
            pass
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(text[start:end + 1])
        except ValueError:
            pass
    return value


def _unwrap(value):
    """Strip the ``{"status": "success", "data": ...}`` envelope tools return."""
    if isinstance(value, dict) and value.get("status") == "success" and "data" in value:
        return value["data"]
    return value


def _lookup(path: str, variables: dict):
    """Resolve ``step_x_output.field.sub`` against the run's variables.

    Walks into JSON strings, agent prose containing JSON, and tool envelopes at
    every hop. The previous walker only descended through dicts, but step
    outputs are stored as JSON strings by the local engine and agent outputs
    are text on both engines — so ``step_fraud_risk_scoring_output.
    fraud_evaluation_result`` always came back empty, and the fraud condition
    evaluated as if no fraud had been found.
    """
    parts = [p for p in (path or "").strip().split(".") if p]
    if not parts or parts[0] not in variables:
        return _MISSING
    value = variables[parts[0]]
    for part in parts[1:]:
        value = _unwrap(_as_data(value, lenient=True))
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return _MISSING
    return _unwrap(_as_data(value))


def substitute_double_brackets(
    text: str,
    variables: dict,
    missing: list | None = None,
    mark_missing: bool = False,
) -> str:
    """Replace {{ref}} inside a larger string. Supports dot paths.

    An unresolved reference is left as-is by default. With ``mark_missing`` it
    becomes an explicit note instead — used for agent prompts, where a literal
    ``{{step_x_output}}`` was being echoed straight into a customer letter, or
    worse, treated by the model as a gap it was free to fill with invented
    figures.
    """
    if not isinstance(text, str) or not variables:
        return text

    def repl(match):
        key = match.group(1).strip()
        val = _lookup(key, variables)
        if val is _MISSING or val is None:
            if missing is not None:
                missing.append(key)
            if mark_missing:
                return f"[not available: '{key}' was not produced by an earlier step]"
            return match.group(0)
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return str(val)

    return re.sub(r'\{{2,}([^{}]+)\}{2,}', repl, text)


def _coerce(value, expected: str | None):
    """Shape a resolved value to the parameter type the tool declared."""
    if not expected:
        return value
    if expected in ("object", "array"):
        return _unwrap(_as_data(value, lenient=True))
    if expected == "string":
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return value if isinstance(value, str) else str(value)
    if expected in ("number", "integer", "boolean"):
        v = _unwrap(_as_data(value, lenient=True))
        # A single-field object carrying the scalar — {"calculated_excess": 500}
        # — is the commonest shape a tool returns for "a number".
        if isinstance(v, dict) and len(v) == 1:
            v = next(iter(v.values()))
        if expected == "boolean":
            if isinstance(v, bool):
                return v
            if isinstance(v, str) and v.strip().lower() in ("true", "false"):
                return v.strip().lower() == "true"
            if isinstance(v, (int, float)):
                return bool(v)
            return v
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return int(v) if expected == "integer" and float(v).is_integer() else v
        if isinstance(v, str):
            cleaned = v.strip().replace(",", "").lstrip("£$€")
            try:
                number = float(cleaned)
            except ValueError:
                return v
            return int(number) if expected == "integer" and number.is_integer() else number
        return v
    return value


def _resolve_value(raw, variables: dict, missing: list):
    if isinstance(raw, str):
        whole = _WHOLE_TEMPLATE.match(raw)
        if whole:
            # Exactly one reference: pass the referenced data itself, not its
            # string form. This is the fix for every tool in a chain rejecting
            # its input with "must be a dictionary".
            value = _lookup(whole.group(1), variables)
            if value is _MISSING:
                missing.append(whole.group(1).strip())
                return raw
            return value
        if "{{" in raw:
            return substitute_double_brackets(raw, variables, missing=missing)
        return raw
    if isinstance(raw, dict):
        return {k: _resolve_value(v, variables, missing) for k, v in raw.items()}
    if isinstance(raw, list):
        return [_resolve_value(v, variables, missing) for v in raw]
    return raw


def _resolve_arguments(template: dict, variables: dict, param_types: dict) -> tuple[dict, list]:
    """Resolve a tool step's arguments. Returns ``(arguments, unresolved_refs)``."""
    missing: list = []
    resolved = {}
    for key, raw in (template or {}).items():
        resolved[key] = _coerce(_resolve_value(raw, variables, missing), param_types.get(key))
    return resolved, missing


async def _tool_param_types(tool_name: str) -> dict:
    """The tool's declared parameter types, from the registry.

    Refreshes once on a miss: the worker runs in its own process and may not
    have loaded dynamic tool schemas yet.
    """
    from app.services.tool_registry import ALL_TOOLS, refresh_dynamic_tools

    spec = ALL_TOOLS.get(tool_name)
    if spec is None:
        try:
            await refresh_dynamic_tools()
        except Exception as e:
            logger.debug("Could not refresh tool schemas for '%s': %s", tool_name, e)
        spec = ALL_TOOLS.get(tool_name)
    try:
        props = spec["function"]["parameters"]["properties"]
        return {k: v.get("type") for k, v in props.items() if isinstance(v, dict)}
    except Exception:
        return {}


def _envelope_error(value) -> str:
    """The message from a ``{"status": "error", ...}`` reply, or ''."""
    if isinstance(value, dict) and str(value.get("status", "")).lower() in ("error", "failed"):
        message = value.get("message") or value.get("error") or "the tool reported an error"
        kind = value.get("error_type")
        text = f"{kind}: {message}" if kind else str(message)
        detail = value.get("detail")
        if detail:
            text += f" — {str(detail)[:400]}"
        return text
    return ""

class DotDict(dict):
    """Dictionary supporting dot notation for condition evaluation."""
    def __getattr__(self, item):
        val = self.get(item)
        if isinstance(val, dict):
            return DotDict(val)
        return val


def _execute_tool_via_service(tool_name: str, arguments: dict) -> Any:
    """
    Execute a tool by calling the tool-service Docker container.
    POST {TOOL_SERVICE_URL}/execute/{tool_name} with {"arguments": arguments}
    Returns the tool result (any JSON-serializable value) or an error string.
    """
    import httpx
    from app.config import settings
    url = f"{settings.TOOL_SERVICE_URL}/execute/{tool_name}"
    try:
        resp = httpx.post(url, json={"arguments": arguments}, timeout=30.0)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("result", data)
        else:
            error_detail = resp.text[:500]
            logger.error("Tool '%s' execution failed (HTTP %d): %s", tool_name, resp.status_code, error_detail)
            return f"Error executing tool '{tool_name}': HTTP {resp.status_code} — {error_detail}"
    except httpx.TimeoutException:
        logger.error("Tool '%s' execution timed out", tool_name)
        return f"Error: tool '{tool_name}' execution timed out after 30s"
    except Exception as e:
        logger.error("Tool '%s' execution error: %s", tool_name, e)
        return f"Error executing tool '{tool_name}': {str(e)}"


async def _agent_complete_with_backoff(client, base_kwargs: dict, messages: list, step_id: str):
    """Call the agent, retrying only on rate limits.

    Temporal's own activity retry spacing (~1s, ~2s) is shorter than a
    rate-limit window, so without this a single 429 failed the whole run.
    """
    import random

    delay = 2.0
    for attempt in range(5):
        try:
            return await asyncio.to_thread(client.agents.complete, **base_kwargs, messages=messages)
        except Exception as e:
            text = str(e).lower()
            if ("429" not in text and "rate limit" not in text) or attempt == 4:
                raise
            wait = delay + random.uniform(0, delay / 2)
            logger.warning(
                "Step '%s' rate limited (attempt %d/5) — retrying in %.1fs",
                step_id, attempt + 1, wait,
            )
            await asyncio.sleep(wait)
            delay *= 2


async def run_agent_step(step: WorkflowStep, variables: dict) -> StepResult:
    """
    Execute an agent step.
    
    Priority:
      1. If step.config has an agent_id → call that agent directly via
         the Mistral conversations API (fast, no new agent created).
      2. Fallback → orchestrate() which creates a dynamic agent (slow).
    """
    start = time.time()
    # Set inside the agent branch below; reset in the finally so a leaked scope
    # can never make the *next* step search the wrong industry.
    agent_token = None

    try:
        from app.dependencies import get_mistral_client

        client = get_mistral_client()
        config = step.config

        # Resolve query template with variables
        query_template = config.get("query_template", config.get("query", ""))
        _missing_refs: list = []
        query = substitute_double_brackets(
            query_template, variables, missing=_missing_refs, mark_missing=True
        )
        if _missing_refs:
            logger.warning(
                "Step '%s' prompt references data no earlier step produced: %s",
                step.id, sorted(set(_missing_refs)),
            )

        agent_id = config.get("agent_id")

        if agent_id:
            # ── Resolve agent name → real UUID if needed ──
            # Offloaded: this does synchronous HTTP (agent lookup, and possibly
            # an agent create). Called inline it would block the event loop, and
            # with it every other request the API is serving.
            resolved_id = await asyncio.to_thread(_resolve_agent_id, client, agent_id)
            logger.info("Step '%s' — calling agent %s (resolved: %s) with query (%.300s)", step.id, agent_id, resolved_id, query)

            # Build messages — supports multimodal (text + image) if image data in variables
            messages: list[dict[str, Any]] = _build_multimodal_messages(query, variables)

            # Use conversation_id from config or create a new conversation
            conv_id = config.get("conversation_id")
            base_kwargs: dict[str, Any] = {"agent_id": resolved_id}
            if conv_id:
                base_kwargs["conversation_id"] = conv_id

            MAX_TOOL_ROUNDS = 10
            result_text = ""
            content = ""

            # Tells the industry-knowledge tool whose domain to search. Scoped
            # to the tool loop and reset immediately after, so a later step can
            # never inherit this agent's industry.
            from app.services import tool_registry

            agent_token = tool_registry.CURRENT_AGENT.set(resolved_id)

            for round_num in range(MAX_TOOL_ROUNDS):
                # The Mistral client here is the synchronous one, and a single
                # completion can take tens of seconds. Running it on the event
                # loop froze the whole API for the duration of every step —
                # which is why execution status appeared to stop updating mid-run.
                response = await _agent_complete_with_backoff(
                    client, base_kwargs, messages, step.id
                )

                msg = _first_choice_message(response)
                if msg is None:
                    # A choice with no message is a real API outcome (content
                    # filter, empty generation). Stop the loop and fall through
                    # to the non-empty-output guarantee rather than crashing:
                    # one silent agent should not fail the whole workflow.
                    logger.warning(
                        "Step '%s' round %d — no assistant message returned (finish_reason=%s)",
                        step.id, round_num, _finish_reason(response),
                    )
                    break

                # A server-run tool (document_library) returns a transcript. If it
                # stopped mid-round, its last entry is the server's tool result,
                # not the agent's answer, and our own calls are still waiting.
                pending_round = _pending_tool_round(response, round_num)
                if pending_round is not None:
                    replay, tool_calls = pending_round
                    content = ""
                    if not tool_calls:
                        messages.extend(replay)
                        continue
                else:
                    replay = None
                    content = _message_text(msg)
                    tool_calls = _message_tool_calls(msg)

                if not tool_calls:
                    # No tool calls → agent produced final text answer
                    result_text = content
                    logger.info(
                        "Step '%s' round %d — final answer, content_len=%d",
                        step.id, round_num, len(result_text),
                    )
                    break

                # Agent wants to call tools → execute them via tool-service
                logger.info(
                    "Step '%s' round %d — agent requested %d tool call(s)",
                    step.id, round_num, len(tool_calls),
                )

                # Parse every call up front. A call we cannot read must not be
                # skipped silently: the assistant message and the tool results
                # have to stay in lockstep, or the next round replays the same
                # request and the loop spins until MAX_TOOL_ROUNDS.
                parsed_calls = [_parse_tool_call(tc, round_num) for tc in tool_calls]
                parsed_calls = [c for c in parsed_calls if c is not None]

                if not parsed_calls:
                    logger.warning(
                        "Step '%s' round %d — %d tool call(s) requested but none could be parsed; "
                        "using the text answer instead",
                        step.id, round_num, len(tool_calls),
                    )
                    result_text = content
                    break

                # Append the assistant's tool-call message to the conversation
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": content or "",
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": raw_args},
                        }
                        for call_id, name, raw_args, _ in parsed_calls
                    ],
                }
                if replay is not None:
                    # The transcript already holds the assistant turn with every
                    # call, plus the server's results for its own calls.
                    messages.extend(replay)
                else:
                    messages.append(assistant_msg)

                # Execute each tool and append its result
                for call_id, tool_name, _raw_args, arguments in parsed_calls:
                    logger.info(
                        "Step '%s' — executing tool '%s' with args: %.200s",
                        step.id, tool_name, str(arguments)[:200],
                    )

                    # Route through the 3-tier router (native -> Docker -> MCP)
                    # rather than straight at the Docker service. Sending every
                    # call to Docker meant a backend-native tool — the industry
                    # knowledge graph among them — was unreachable from a
                    # workflow agent step, while working fine in chat.
                    from app.services.tool_registry import execute_tool
                    tool_result = await execute_tool(tool_name, arguments)
                    logger.info(
                        "Step '%s' — tool '%s' result: %.300s",
                        step.id, tool_name, str(tool_result)[:300],
                    )

                    messages.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result,
                        "tool_call_id": call_id,
                    })

                # If this was the last allowed round, use whatever content we got
                if round_num == MAX_TOOL_ROUNDS - 1:
                    result_text = content or f"Step '{step.id}' completed after {MAX_TOOL_ROUNDS} tool rounds."
                    logger.warning("Step '%s' — hit MAX_TOOL_ROUNDS cap", step.id)

            # Guarantee non-empty output
            if not result_text or not result_text.strip():
                result_text = f"Step '{step.id}' completed (agent {agent_id} produced no text output)."
                logger.warning("Step '%s' — agent returned empty content after tool loop", step.id)

            # Try to parse structured JSON from the agent response so
            # downstream steps can reference individual fields as variables.
            output: Any = result_text
            import re
            
            def extract_json(text: str) -> dict | None:
                # 1. Try finding explicitly marked JSON block
                match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
                if match:
                    try:
                        parsed = json.loads(match.group(1))
                        if isinstance(parsed, dict):
                            return parsed
                    except Exception:
                        pass
                
                # 2. Try just parsing the whole text after stripping
                try:
                    text_to_parse = text.strip()
                    if text_to_parse.startswith("```json"):
                        text_to_parse = text_to_parse[7:]
                    elif text_to_parse.startswith("```"):
                        text_to_parse = text_to_parse[3:]
                    if text_to_parse.endswith("```"):
                        text_to_parse = text_to_parse[:-3]
                    parsed = json.loads(text_to_parse.strip())
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    pass
                
                # 3. Try finding any {...} block
                match = re.search(r'(\{.*?\})', text, re.DOTALL)
                if match:
                    try:
                        parsed = json.loads(match.group(1))
                        if isinstance(parsed, dict):
                            return parsed
                    except Exception:
                        pass
                return None

            parsed_dict = extract_json(result_text)
            if parsed_dict is not None:
                output = parsed_dict

            duration = (time.time() - start) * 1000
            
            input_preview = query[:1000] + "..." if len(query) > 1000 else query
            output_preview = result_text[:1000] + "..." if len(result_text) > 1000 else result_text
            
            return StepResult(
                step_id=step.id,
                status="completed",
                output=output,
                duration_ms=duration,
                input_preview=input_preview,
                output_preview=output_preview,
            )
        else:
            # ── Slow path: orchestrate (creates new agent dynamically) ───
            logger.info("Step '%s' — no agent_id in config, using orchestrator", step.id)
            from app.services.orchestrator_service import orchestrate

            result = await orchestrate(
                client=client,
                query=query,
                conversation_id=config.get("conversation_id"),
                cleanup_agent=config.get("cleanup_agent", True),
            )

            output: Any = result.get("response", result)

            # Guarantee non-empty output
            if not output or (isinstance(output, str) and not output.strip()):
                output = f"Orchestrator completed step '{step.id}' but returned no text output."
            
            if isinstance(output, str):
                parsed_dict = extract_json(output)
                if parsed_dict is not None:
                    output = parsed_dict

            duration = (time.time() - start) * 1000
            
            input_preview = query[:1000] + "..." if len(query) > 1000 else query
            out_str = str(output)
            output_preview = out_str[:1000] + "..." if len(out_str) > 1000 else out_str
            
            return StepResult(
                step_id=step.id,
                status="completed",
                output=output,
                duration_ms=duration,
                input_preview=input_preview,
                output_preview=output_preview,
            )
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Agent step '%s' failed: %s", step.id, e)
        return StepResult(
            step_id=step.id, 
            status="failed", 
            error=str(e), 
            duration_ms=duration,
            input_preview=step.config.get("query_template") or step.config.get("instructions", "")
        )

    finally:
        if agent_token is not None:
            from app.services import tool_registry

            tool_registry.CURRENT_AGENT.reset(agent_token)



def _is_missing_tool(result) -> bool:
    """True when the tool service says the tool does not exist.

    ``execute_tool`` flattens every outcome to a string, so the shape has to be
    matched on text rather than on a dict key.
    """
    text = str(result).lower()
    return (
        "not found" in text
        or "not approved" in text
        or "no module path" in text
    )


def _is_tool_error(result) -> bool:
    """True when the result is an error rather than a tool's output."""
    if isinstance(result, dict):
        return "error" in result
    text = str(result).strip()
    return text.startswith("Error:") or _is_missing_tool(text)


def _infer_parameters(arguments: dict) -> dict:
    """A JSON-Schema properties block matching the arguments actually passed."""
    types = {
        bool: "boolean", int: "integer", float: "number",
        list: "array", dict: "object", str: "string",
    }
    return {
        key: {
            # bool before int: bool is a subclass of int in Python, and a
            # parameter declared "integer" would take the wrong sample value.
            "type": next(
                (name for cls, name in types.items() if isinstance(value, cls)),
                "string",
            ),
            "description": f"Value for {key.replace('_', ' ')}",
        }
        for key, value in arguments.items()
    }


async def run_tool_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Execute a tool step — calls tool_registry.execute() (native/dynamic/MCP)."""
    start = time.time()
    try:
        from app.services.tool_registry import execute_tool
        from app.services.tool_resolver import tool_resolver
        from app.services.tool_registry import refresh_dynamic_tools

        config = step.config
        tool_name = config.get("tool_name", "")

        # Resolve arguments against the tool's own declared parameter types.
        #
        # Every argument used to be run through string substitution, so an
        # object parameter received the previous step's output as a JSON
        # *string* and the tool rejected it. A value that is exactly one
        # {{reference}} now resolves to the referenced data itself.
        param_types = await _tool_param_types(tool_name)
        arguments, unresolved = _resolve_arguments(
            config.get("arguments", {}), variables, param_types
        )
        if unresolved:
            duration = (time.time() - start) * 1000
            refs = ", ".join(f"{{{{{r}}}}}" for r in sorted(set(unresolved)))
            message = (
                f"Arguments reference {refs}, which no earlier step produced. "
                f"Either the producing step has not run yet, or it returns "
                f"different field names from the ones referenced."
            )
            logger.error("Tool step '%s': %s", step.id, message)
            return StepResult(
                step_id=step.id,
                status="failed",
                error=message,
                duration_ms=duration,
                input_preview=json.dumps(config.get("arguments", {}), default=str)[:1000],
            )

        result = await execute_tool(tool_name, arguments)

        # Auto-synthesis fallback: build the tool if it does not exist yet.
        if _is_missing_tool(result):
            logger.info("Tool '%s' not found — synthesising it now", tool_name)
            synth = await tool_resolver.trigger_synthesis(
                name=tool_name,
                description=step.description or f"Perform {tool_name.replace('_', ' ')}",
                # Derived from the arguments this step actually passes, so the
                # rebuilt tool has the signature the step calls it with.
                parameters={"properties": _infer_parameters(arguments)},
                required=sorted(arguments.keys()),
                purpose="activity",
            )
            if synth.get("status") in ("synthesized", "approved"):
                await refresh_dynamic_tools()
                result = await execute_tool(tool_name, arguments)
                logger.info("Auto-synthesis of '%s' succeeded; step retried", tool_name)
            else:
                logger.warning(
                    "Auto-synthesis of '%s' failed: %s", tool_name, synth.get("message", synth)
                )

        duration = (time.time() - start) * 1000

        input_preview = json.dumps(arguments, default=str)[:1000]
        out_str = str(result)
        output_preview = out_str[:1000] + "..." if len(out_str) > 1000 else out_str

        # A tool that could not do its job is a failed step.
        #
        # Tools report failure as {"status": "error", ...} with HTTP 200, and
        # that envelope used to be recorded as a *completed* step. The run then
        # carried on, and a settlement letter was written to a customer from
        # calculations that had never succeeded — with the agent inventing the
        # figures it was not given. Failing here makes the compiled activity
        # raise, which halts the workflow on both executors.
        parsed = _as_data(result)
        envelope_error = _envelope_error(parsed)
        if envelope_error or _is_tool_error(result):
            message = (
                f"{tool_name}: {envelope_error}" if envelope_error else out_str[:1000]
            )
            logger.error("Tool step '%s' failed: %s", step.id, message[:300])
            return StepResult(
                step_id=step.id,
                status="failed",
                error=message,
                duration_ms=duration,
                input_preview=input_preview,
                output_preview=output_preview,
            )

        # The step's output is the tool's data, not its envelope, so
        # {{step_x_output.field}} addresses the field directly.
        output = _unwrap(parsed)

        return StepResult(
            step_id=step.id,
            status="completed",
            output=output,
            duration_ms=duration,
            input_preview=input_preview,
            output_preview=output_preview,
        )
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Tool step '%s' failed: %s", step.id, e)
        return StepResult(
            step_id=step.id,
            status="failed",
            error=str(e),
            duration_ms=duration,
            input_preview=json.dumps(step.config.get("arguments", {}), default=str)[:1000]
        )


def substitute_for_eval(text: str, variables: dict) -> str:
    """Replace {{key}} with Python literals so the expression can be eval'd.

    Uses the same JSON-aware lookup as prompt substitution, so a condition can
    read a field out of an agent's JSON answer. A "true"/"false" string — the
    way a model often writes a boolean — becomes a real boolean.
    """
    if not isinstance(text, str):
        return text

    def repl(match):
        key = match.group(1).strip()
        val = _lookup(key, variables)
        if val is _MISSING or val is None:
            return "None"
        if isinstance(val, bool):
            return "True" if val else "False"
        if isinstance(val, str) and val.strip().lower() in ("true", "false"):
            return "True" if val.strip().lower() == "true" else "False"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str):
            return repr(val)
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return repr(str(val))

    return re.sub(r'\{{2,}([^{}]+)\}{2,}', repl, text)


async def run_condition_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Evaluate a condition and return which branch to take."""
    start = time.time()
    try:
        config = step.config
        expression = config.get("expression", "True")

        # Substitute {{var.prop}} → properly quoted Python literals
        expression = substitute_for_eval(expression, variables)

        logger.info("Condition step '%s' — evaluating: %s", step.id, expression)

        # Provide JSON-style boolean aliases so 'true'/'false' work in eval
        safe_globals = {"__builtins__": None, "true": True, "false": False, "null": None, "True": True, "False": False, "None": None}
        result = eval(expression, safe_globals, {})

        branch = config.get("true_step") if result else config.get("false_step")

        # If condition evaluated to a falsy path and there's a fallback, prefer it
        if not branch:
            branch = config.get("fallback_step")

        duration = (time.time() - start) * 1000
        return StepResult(
            step_id=step.id,
            status="completed",
            output={"condition_result": bool(result), "next_step": branch},
            duration_ms=duration,
        )
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Condition step '%s' failed: %s", step.id, e)
        # On failure, use fallback_step if available instead of crashing
        fallback = step.config.get("fallback_step")
        if fallback:
            logger.info("Condition step '%s' — using fallback_step '%s'", step.id, fallback)
            return StepResult(
                step_id=step.id,
                status="completed",
                output={"condition_result": False, "next_step": fallback},
                duration_ms=duration,
            )
        return StepResult(step_id=step.id, status="failed", error=str(e), duration_ms=duration)


async def run_transform_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Transform/reshape data between steps."""
    start = time.time()
    try:
        config = step.config

        # Support simple key mappings
        mappings = config.get("mappings", {})
        output = {}
        for target_key, source_expr in mappings.items():
            if isinstance(source_expr, str) and source_expr.startswith("$"):
                # Reference to a variable: $variable_name
                var_name = source_expr[1:]
                output[target_key] = variables.get(var_name)
            elif isinstance(source_expr, str) and "{{" in source_expr:
                output[target_key] = substitute_double_brackets(source_expr, variables)
            else:
                output[target_key] = source_expr

        # Support Python transform code (advanced)
        transform_code = config.get("transform_code")
        if transform_code:
            safe_globals = {"__builtins__": {"str": str, "int": int, "float": float, "list": list, "dict": dict, "len": len, "json": json}}
            safe_locals = {"variables": variables, "output": output}
            exec(transform_code, safe_globals, safe_locals)
            output = safe_locals.get("output", output)

        duration = (time.time() - start) * 1000
        return StepResult(step_id=step.id, status="completed", output=output, duration_ms=duration)
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Transform step '%s' failed: %s", step.id, e)
        return StepResult(step_id=step.id, status="failed", error=str(e), duration_ms=duration)


def _report_egress_policy(step: WorkflowStep, connector_id: str, tool_name: str) -> None:
    """Log — but do not block — a restricted-data call to a third-party connector.

    Deliberately report-only. A runtime block fails a workflow that already
    passed validation, mid-execution, after the upstream steps have been paid
    for; that is a worse outcome than the leak it prevents in most cases, and
    the annotations driving it are still partly inferred. The publish-time
    check in ``ontology.constraints`` is the gate that should stop this.

    Read the WARNING lines this produces before anyone turns it into a block.
    """
    try:
        from app.ontology import store as ontology_store
        from app.ontology.vocab import RESTRICTED_DATA_CLASSES, Predicate, SubjectType

        annotations = ontology_store.annotations_for(
            SubjectType.CONNECTOR.value, connector_id
        )
        if not annotations.get(Predicate.EGRESSES_TO.value):
            return

        declared = (step.config or {}).get("data_classes") or []
        restricted = [
            c for c in declared if str(c).rsplit(".", 1)[-1] in RESTRICTED_DATA_CLASSES
        ]
        if restricted:
            logger.warning(
                "EGRESS POLICY (report-only): step '%s' sends %s to connector '%s' "
                "(tool '%s'), which egresses to a third party.",
                step.id, ", ".join(restricted), connector_id, tool_name,
            )
    except Exception as e:
        logger.debug("Egress policy check skipped for step '%s': %s", step.id, e)


def resolve_connector_arguments(step: WorkflowStep, variables: dict) -> dict:
    """Render a connector step's argument template against the workflow variables.

    Shared with the compiled Workflows module, which calls this from inside its
    generated activities — so a connector call receives identical arguments
    whether it runs locally or on a Mistral worker.
    """
    config = step.config or {}
    template = config.get("arguments", config.get("arguments_template", {})) or {}
    if not isinstance(template, dict):
        return {}

    arguments = {}
    for key, value in template.items():
        if isinstance(value, str) and "{{" in value:
            arguments[key] = substitute_double_brackets(value, variables)
        else:
            arguments[key] = value
    return arguments


async def run_connector_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Call a single tool on a Mistral Connector.

    This is the *local* execution path — used by the in-process DAG engine and
    by dev runs. When the same definition is compiled and deployed, the emitted
    module calls the connector through the Workflows SDK's injected
    ``ToolCallClient`` instead, so credentials resolve against the triggering
    user rather than this backend's API key. Both paths read the same step
    config, which is what keeps a local run faithful to a deployed one.
    """
    start = time.time()
    config = step.config or {}
    connector_id = config.get("connector_id") or config.get("connector_name") or ""
    tool_name = config.get("tool_name", "")

    try:
        from app.services import connector_service

        if not connector_id:
            raise ValueError("Connector step is missing 'connector_id'")
        if not tool_name:
            raise ValueError("Connector step is missing 'tool_name'")

        # Arguments are templated the same way tool steps template theirs, so
        # {{variables}} behave identically across both step kinds.
        arguments = resolve_connector_arguments(step, variables)

        _report_egress_policy(step, connector_id, tool_name)

        logger.info(
            "Step '%s' — calling connector '%s' tool '%s'", step.id, connector_id, tool_name
        )
        raw = await connector_service.call_connector_tool(
            connector_id,
            tool_name,
            arguments,
            credentials_name=config.get("credentials_name"),
        )
        output = connector_service.flatten_tool_result(raw)

        duration = (time.time() - start) * 1000
        out_str = str(output)
        return StepResult(
            step_id=step.id,
            status="completed",
            output=output,
            duration_ms=duration,
            input_preview=json.dumps(arguments)[:1000],
            output_preview=out_str[:1000] + "..." if len(out_str) > 1000 else out_str,
        )
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Connector step '%s' failed: %s", step.id, e)
        return StepResult(
            step_id=step.id,
            status="failed",
            error=str(e),
            duration_ms=duration,
            input_preview=json.dumps(config.get("arguments", {}))[:1000],
        )


# ── Step Runner Dispatcher ─────────────────────────────────────────────────

STEP_RUNNERS = {
    StepType.AGENT: run_agent_step,
    StepType.TOOL: run_tool_step,
    StepType.CONNECTOR: run_connector_step,
    StepType.CONDITION: run_condition_step,
    StepType.TRANSFORM: run_transform_step,
}


async def run_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Dispatch to the appropriate step runner."""
    runner = STEP_RUNNERS.get(step.type)
    if not runner:
        return StepResult(step_id=step.id, status="failed", error=f"Unknown step type: {step.type}")
    return await runner(step, variables)
