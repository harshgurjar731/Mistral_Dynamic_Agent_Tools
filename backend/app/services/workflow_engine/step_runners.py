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
            # ── Fast path: call existing agent directly ──────────────────
            logger.info("Step '%s' — calling existing agent %s", step.id, agent_id)

            messages = [{"role": "user", "content": query}]

            # Use conversation_id from config or create a new conversation
            conv_id = config.get("conversation_id")
            kwargs = {"agent_id": agent_id, "messages": messages}
            if conv_id:
                kwargs["conversation_id"] = conv_id

            response = client.agents.complete(**kwargs)
            result_text = response.choices[0].message.content if response.choices else ""

            duration = (time.time() - start) * 1000
            return StepResult(
                step_id=step.id,
                status="completed",
                output=result_text,
                duration_ms=duration,
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

            duration = (time.time() - start) * 1000
            return StepResult(
                step_id=step.id,
                status="completed",
                output=result.get("response", result),
                duration_ms=duration,
            )
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Agent step '%s' failed: %s", step.id, e)
        return StepResult(step_id=step.id, status="failed", error=str(e), duration_ms=duration)



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
        return StepResult(step_id=step.id, status="completed", output=result, duration_ms=duration)
    except Exception as e:
        duration = (time.time() - start) * 1000
        logger.error("Tool step '%s' failed: %s", step.id, e)
        return StepResult(step_id=step.id, status="failed", error=str(e), duration_ms=duration)


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
