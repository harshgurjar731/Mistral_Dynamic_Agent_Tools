"""
Step Runners — execute individual workflow steps.
Each step type has its own runner function.
"""

import json
import time
import logging
import re
import base64

from typing import Any
from app.services.workflow_engine.models import WorkflowStep, StepResult, StepType

logger = logging.getLogger(__name__)

# ── Agent name → ID cache (lives for the process lifetime) ────────────────
_agent_name_to_id_cache: dict[str, str] = {}


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
        )
        real_id = agent_obj.id
        _agent_name_to_id_cache[agent_id] = real_id
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


class SafeDict(dict):
    """A dictionary that returns the key placeholder when a key is missing during string formatting."""
    def __missing__(self, key):
        return "{" + key + "}"

def substitute_double_brackets(text: str, variables: dict) -> str:
    """Safely replace {{key}} with variables[key] without breaking on single {JSON} braces. Supports dot notation."""
    if not isinstance(text, str) or not variables:
        return text
    
    def repl(match):
        key = match.group(1).strip()
        parts = key.split('.')
        val = variables.get(parts[0])
        if val is None:
            return match.group(0)
            
        for part in parts[1:]:
            if isinstance(val, dict):
                val = val.get(part)
            else:
                return match.group(0)

        # Convert dicts/lists to JSON strings for prompt insertion
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return str(val)

    return re.sub(r'\{{2,}([^{}]+)\}{2,}', repl, text)

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


async def run_agent_step(step: WorkflowStep, variables: dict) -> StepResult:
    """
    Execute an agent step.
    
    Priority:
      1. If step.config has an agent_id → call that agent directly via
         the Mistral conversations API (fast, no new agent created).
      2. Fallback → orchestrate() which creates a dynamic agent (slow).
    """
    start = time.time()
    try:
        from app.dependencies import get_mistral_client

        client = get_mistral_client()
        config = step.config

        # Resolve query template with variables
        query_template = config.get("query_template", config.get("query", ""))
        query = substitute_double_brackets(query_template, variables)

        agent_id = config.get("agent_id")

        if agent_id:
            # ── Resolve agent name → real UUID if needed ──
            resolved_id = _resolve_agent_id(client, agent_id)
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

            for round_num in range(MAX_TOOL_ROUNDS):
                response = client.agents.complete(**base_kwargs, messages=messages)

                if not response.choices:
                    logger.warning("Step '%s' round %d — no choices returned", step.id, round_num)
                    break

                msg = response.choices[0].message
                content = msg.content or ""
                tool_calls = getattr(msg, "tool_calls", None) or []

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

                # Append the assistant's tool-call message to conversation
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": content or ""}
                # Build tool_calls list for the message
                tc_list = []
                for tc in tool_calls:
                    fn = getattr(tc, "function", None)
                    if fn:
                        tc_list.append({
                            "id": getattr(tc, "id", f"tc_{round_num}_{fn.name}"),
                            "type": "function",
                            "function": {"name": fn.name, "arguments": fn.arguments},
                        })
                if tc_list:
                    assistant_msg["tool_calls"] = tc_list
                messages.append(assistant_msg)

                # Execute each tool and build tool-result messages
                for tc in tool_calls:
                    fn = getattr(tc, "function", None)
                    if not fn:
                        continue

                    tc_id = getattr(tc, "id", f"tc_{round_num}_{fn.name}")
                    tool_name = fn.name
                    try:
                        arguments = json.loads(fn.arguments) if isinstance(fn.arguments, str) else fn.arguments
                    except (json.JSONDecodeError, TypeError):
                        arguments = {}

                    logger.info("Step '%s' — executing tool '%s' with args: %.200s", step.id, tool_name, str(arguments)[:200])

                    # Call tool-service
                    tool_result = _execute_tool_via_service(tool_name, arguments)
                    logger.info("Step '%s' — tool '%s' result: %.300s", step.id, tool_name, str(tool_result)[:300])

                    # Append tool result message
                    messages.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result,
                        "tool_call_id": tc_id,
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



async def run_tool_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Execute a tool step — calls tool_registry.execute() (native/dynamic/MCP)."""
    start = time.time()
    try:
        from app.services.tool_registry import execute_tool
        from app.services.tool_resolver import tool_resolver
        from app.services.tool_registry import refresh_dynamic_tools

        config = step.config
        tool_name = config.get("tool_name", "")

        # Resolve arguments template with variables
        args_template = config.get("arguments", {})
        arguments = {}
        for k, v in args_template.items():
            if isinstance(v, str) and "{{" in v:
                arguments[k] = substitute_double_brackets(v, variables)
            else:
                arguments[k] = v

        result = await execute_tool(tool_name, arguments)

        # Auto-synthesis fallback: if tool not found, synthesise and retry
        if isinstance(result, dict) and "not found" in str(result.get("error", "")).lower():
            logger.info("Tool '%s' not found — triggering auto-synthesis", tool_name)
            description = config.get("description", f"A tool to perform {tool_name}")
            synth = await tool_resolver.synthesize_from_task(description)
            if synth.get("status") in ("synthesized", "approved"):
                await refresh_dynamic_tools()
                result = await execute_tool(tool_name, arguments)
                logger.info("Auto-synthesis succeeded for '%s', retry result: %s", tool_name, result)
            else:
                logger.warning("Auto-synthesis failed for '%s': %s", tool_name, synth)

        duration = (time.time() - start) * 1000
        
        input_preview = json.dumps(arguments)[:1000]
        out_str = str(result)
        output_preview = out_str[:1000] + "..." if len(out_str) > 1000 else out_str
        
        return StepResult(
            step_id=step.id, 
            status="completed", 
            output=result, 
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
            input_preview=json.dumps(step.config.get("arguments", {}))[:1000]
        )


def substitute_for_eval(text: str, variables: dict) -> str:
    """Replace {{key}} with properly quoted Python literals for safe eval().
    
    Unlike substitute_double_brackets (which produces raw strings for prompt
    insertion), this function wraps string values in repr() quotes so the
    result is a valid Python expression, e.g.:
        {{step_x.input_type}} == 'image'  →  'text' == 'image'
    """
    if not isinstance(text, str):
        return text

    def repl(match):
        key = match.group(1).strip()
        parts = key.split(".")
        val = variables.get(parts[0])
        if val is None:
            return "None"

        for part in parts[1:]:
            if isinstance(val, dict):
                val = val.get(part)
            else:
                return "None"
            if val is None:
                return "None"

        if isinstance(val, bool):
            return "True" if val else "False"
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


# ── Step Runner Dispatcher ─────────────────────────────────────────────────

STEP_RUNNERS = {
    StepType.AGENT: run_agent_step,
    StepType.TOOL: run_tool_step,
    StepType.CONDITION: run_condition_step,
    StepType.TRANSFORM: run_transform_step,
}


async def run_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Dispatch to the appropriate step runner."""
    runner = STEP_RUNNERS.get(step.type)
    if not runner:
        return StepResult(step_id=step.id, status="failed", error=f"Unknown step type: {step.type}")
    return await runner(step, variables)
