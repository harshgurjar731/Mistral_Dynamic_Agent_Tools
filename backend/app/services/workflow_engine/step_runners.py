"""
Step Runners — execute individual workflow steps.
Each step type has its own runner function.
"""

import json
import time
import logging

from typing import Any
from app.services.workflow_engine.models import WorkflowStep, StepResult, StepType

logger = logging.getLogger(__name__)

class SafeDict(dict):
    """A dictionary that returns the key placeholder when a key is missing during string formatting."""
    def __missing__(self, key):
        return "{" + key + "}"


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
        query = query_template.format_map(SafeDict(**variables)) if variables else query_template

        agent_id = config.get("agent_id")

        if agent_id:
            # ── Fast path: call existing agent with tool execution loop ──
            logger.info("Step '%s' — calling agent %s with query (%.300s)", step.id, agent_id, query)

            messages: list[dict[str, Any]] = [{"role": "user", "content": query}]

            # Use conversation_id from config or create a new conversation
            conv_id = config.get("conversation_id")
            base_kwargs: dict[str, Any] = {"agent_id": agent_id}
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
            try:
                parsed = json.loads(result_text)
                if isinstance(parsed, dict):
                    output = parsed
            except (json.JSONDecodeError, TypeError):
                pass

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
        safe_vars = SafeDict(**variables) if variables else SafeDict()
        for k, v in args_template.items():
            if isinstance(v, str) and "{" in v:
                arguments[k] = v.format_map(safe_vars)
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


async def run_condition_step(step: WorkflowStep, variables: dict) -> StepResult:
    """Evaluate a condition and return which branch to take."""
    start = time.time()
    try:
        config = step.config
        expression = config.get("expression", "True")

        # Safe eval with only variables in scope
        safe_globals = {"__builtins__": None}
        safe_locals = {**variables}
        result = eval(expression, safe_globals, safe_locals)

        branch = config.get("true_step") if result else config.get("false_step")

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
            elif isinstance(source_expr, str) and "{" in source_expr:
                safe_vars = SafeDict(**variables) if variables else SafeDict()
                output[target_key] = source_expr.format_map(safe_vars)
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
