"""
Workflow Planner Service — 5-Phase SSE generator.

Phase 1 — Analyse goal   → extract tools + agents needed
Phase 2 — Synthesise     → trigger Docker Tool Service for missing tools
Phase 3 — Create agents  → create Mistral agents with required tools
Phase 4 — Build DAG      → LLM assembles WorkflowDefinition JSON
Phase 5 — Save & emit    → persist workflow, emit workflow_ready + done
"""

import asyncio
import json
import logging
from typing import AsyncGenerator

import httpx
from mistralai.client import Mistral
from app.config import settings

logger = logging.getLogger(__name__)


# ── SSE helper (mirrors orchestrator_service) ─────────────────────────────

def _sse(data, event: str = "message") -> str:
    payload = json.dumps(data) if not isinstance(data, str) else data
    if isinstance(payload, str):
        payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


# ── Phase 1 Prompt ─────────────────────────────────────────────────────────

ANALYSIS_PROMPT = """\
You are a workflow architect. Given a user's goal, identify the exact tools and \
agents needed to build a multi-step automated pipeline for it.

Respond ONLY with a valid JSON object — no markdown, no explanation:
{{
  "workflow_description": "<one sentence summary>",
  "tools_needed": [
    {{
      "name": "snake_case_name",
      "description": "What this tool does",
      "parameters": {{
        "type": "object",
        "properties": {{
          "param1": {{"type": "string", "description": "..."}}
        }}
      }},
      "required": ["param1"]
    }}
  ],
  "agents_needed": [
    {{
      "name": "AgentName",
      "description": "What this agent does in the workflow",
      "instructions": "Detailed system prompt for this agent",
      "model": "mistral-large-latest",
      "tools": ["tool_name_1", "tool_name_2"]
    }}
  ]
}}

Available tools already in the system (do NOT re-create these):
{existing_tools}

Available agents already in the system (you MUST reuse these if they match your needs):
{existing_agents}

Available workflows already deployed on the server:
{existing_workflows}
"""

# ── Phase 4 Prompt ─────────────────────────────────────────────────────────

DAG_PROMPT = """\
You are a workflow DAG builder. Given agents and requirements, build a \
WorkflowDefinition JSON for a multi-step pipeline.

WorkflowDefinition schema:
{{
  "name": "snake_case_workflow_name",
  "description": "What this workflow does",
  "entry_step": "first_step_id",
  "steps": [
    {{
      "id": "step_id",
      "type": "agent|tool|condition|transform",
      "description": "What this step does",
      "config": {{
        "agent_id": "<agent_id for agent steps>",
        "query_template": "<query with {{variable}} placeholders for agent steps>",
        "tool_name": "<tool name for tool steps>",
        "arguments": {{"param": "{{variable}}"}}
      }},
      "next_steps": ["next_step_id"]
    }}
  ],
  "input_schema": [{{"name": "input_field", "type": "string", "description": "..."}}],
  "variables": {{}}
}}

Step types:
- "agent"    → config needs: agent_id, query_template
- "tool"     → config needs: tool_name, arguments
- "condition"→ config needs: expression (Python bool), true_step, false_step
- "transform"→ config needs: mappings dict

Agents available (use their IDs):
{agents_json}

Workflow goal: {goal}
Requirements: {requirements_json}

Respond ONLY with the valid JSON WorkflowDefinition object. No markdown.
"""


# ── Main SSE Generator ─────────────────────────────────────────────────────

async def plan_workflow_stream(
    client: Mistral,
    goal: str,
) -> AsyncGenerator[str, None]:
    """
    5-phase async generator that streams SSE events for workflow planning.
    Mirrors orchestrate_stream() in orchestrator_service.py.
    """
    from app.services.tool_resolver import tool_resolver
    from app.services.tool_registry import refresh_dynamic_tools
    from app.services.workflow_engine.engine import save_workflow
    from app.services.workflow_engine.models import WorkflowDefinition

    try:
        # ── Phase 1: Analyse goal ─────────────────────────────────────────
        yield _sse("Analysing your workflow goal…", "status")

        # Fetch existing tools
        existing_tools = await tool_resolver.list_tools()
        existing_tool_names = [t.get("name", "") for t in existing_tools]

        # Fetch existing agents
        from app.services import agent_service
        agents_resp = await agent_service.list_agents(client, page=0, page_size=100)
        existing_agents = [{"id": a["id"], "name": a["name"], "instructions": a.get("instructions", "")} for a in agents_resp.get("items", [])]
        
        # Fetch existing workflows
        import httpx
        try:
            wf_resp = httpx.get("https://api.mistral.ai/v1/workflows", headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"}, timeout=5.0)
            existing_workflows = [w.get("name") for w in wf_resp.json().get("workflows", [])] if wf_resp.status_code == 200 else []
        except Exception:
            existing_workflows = []

        analysis_result = client.chat.complete(
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": ANALYSIS_PROMPT.format(
                        existing_tools=json.dumps(existing_tool_names),
                        existing_agents=json.dumps(existing_agents),
                        existing_workflows=json.dumps(existing_workflows)
                    ),
                },
                {"role": "user", "content": f"Goal: {goal}"},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = analysis_result.choices[0].message.content
        requirements = _safe_parse(raw, {"tools_needed": [], "agents_needed": [], "workflow_description": goal})

        yield _sse(json.dumps({
            "tools_needed": [t["name"] for t in requirements.get("tools_needed", [])],
            "agents_needed": [a["name"] for a in requirements.get("agents_needed", [])],
            "description": requirements.get("workflow_description", goal),
        }), "requirements")

        # ── Phase 2: Synthesise missing tools ─────────────────────────────
        tools_needed = requirements.get("tools_needed", [])
        for tool_spec in tools_needed:
            tool_name = tool_spec.get("name", "unknown")
            # Skip if already exists
            if tool_name in existing_tool_names:
                yield _sse(json.dumps({"tool_name": tool_name, "status": "exists"}), "tool_synthesised")
                continue

            yield _sse(f"Synthesising tool: {tool_name}…", "status")
            try:
                synth_result = await tool_resolver.trigger_synthesis(
                    name=tool_name,
                    description=tool_spec.get("description", f"Tool to {tool_name}"),
                    parameters=tool_spec.get("parameters", {"type": "object", "properties": {}}),
                    required=tool_spec.get("required", []),
                )
                status = synth_result.get("status", "unknown")
                yield _sse(json.dumps({"tool_name": tool_name, "status": status}), "tool_synthesised")

                # Refresh tool cache so agents can use the new tool
                await refresh_dynamic_tools()
            except Exception as e:
                logger.error("Tool synthesis failed for %s: %s", tool_name, e)
                yield _sse(json.dumps({"tool_name": tool_name, "status": "failed", "error": str(e)}), "tool_synthesised")

        # ── Phase 3: Create agents ────────────────────────────────────────
        agents_needed = requirements.get("agents_needed", [])
        created_agents: list[dict] = []

        for agent_spec in agents_needed:
            agent_name = agent_spec.get("name", "WorkflowAgent")
            
            # Check if we can reuse an existing agent from the server
            existing_agent = next((a for a in existing_agents if a["name"] == agent_name), None)
            if existing_agent:
                yield _sse(f"Reusing existing agent from server: {agent_name}…", "status")
                agent_info = {
                    "agent_id": existing_agent["id"],
                    "agent_name": agent_name,
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "tools": agent_spec.get("tools", []),
                    "description": agent_spec.get("description", ""),
                }
                created_agents.append(agent_info)
                yield _sse(json.dumps(agent_info), "agent_created")
                continue

            yield _sse(f"Creating agent: {agent_name}…", "status")
            try:
                from app.services.tool_registry import get_tools
                tool_keys = agent_spec.get("tools", [])
                tool_definitions = get_tools(tool_keys)

                create_kwargs: dict = {
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "name": agent_name,
                    "instructions": agent_spec.get("instructions", f"You are {agent_name}, a specialist agent."),
                    "description": agent_spec.get("description", f"Workflow agent: {agent_name}"),
                    "metadata": {"workflow_goal": goal[:200], "source": "workflow_planner"},
                }
                if tool_definitions:
                    create_kwargs["tools"] = tool_definitions

                agent_obj = client.beta.agents.create(**create_kwargs)
                agent_id = agent_obj.id

                agent_info = {
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "tools": tool_keys,
                    "description": agent_spec.get("description", ""),
                }
                created_agents.append(agent_info)

                yield _sse(json.dumps(agent_info), "agent_created")

            except Exception as e:
                logger.error("Agent creation failed for %s: %s", agent_name, e)
                yield _sse(json.dumps({"agent_name": agent_name, "error": str(e)}), "agent_created")

        # ── Phase 4: Build DAG ────────────────────────────────────────────
        yield _sse("Building workflow DAG…", "status")

        dag_result = client.chat.complete(
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": DAG_PROMPT.format(
                        agents_json=json.dumps(created_agents, indent=2),
                        goal=goal,
                        requirements_json=json.dumps(requirements, indent=2),
                    ),
                },
                {"role": "user", "content": "Build the WorkflowDefinition JSON now."},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw_dag = dag_result.choices[0].message.content
        dag_dict = _safe_parse(raw_dag, None)

        if not dag_dict:
            raise ValueError("LLM returned invalid DAG JSON")

        # ── Phase 5: Save & compile & register & le Chat ──────────────────
        yield _sse("Saving workflow…", "status")

        workflow_def = WorkflowDefinition(**dag_dict)
        workflow_name = save_workflow(workflow_def)

        yield _sse(json.dumps({
            "workflow_name": workflow_name,
            "description": workflow_def.description or goal,
            "step_count": len(workflow_def.steps),
            "entry_step": workflow_def.entry_step,
            "agents": [a["agent_name"] for a in created_agents],
            "dag": dag_dict,
        }), "workflow_ready")

        # ── Phase 5b: Compile to Mistral Workflows SDK Python ────────────
        yield _sse("Compiling workflow to Mistral SDK…", "status")
        try:
            import os
            from app.services.mistral_workflows_compiler import compile_workflow_to_python

            workflows_dir = os.path.abspath(
                os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
            )
            os.makedirs(workflows_dir, exist_ok=True)

            python_code = compile_workflow_to_python(workflow_def)
            file_name = f"workflow_{workflow_name}.py"
            file_path = os.path.join(workflows_dir, file_name)

            # Use asyncio.to_thread so the write doesn't block the event loop
            import asyncio as _asyncio

            def _write_file():
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(python_code)

            await _asyncio.to_thread(_write_file)

            logger.info("Compiled workflow '%s' → %s", workflow_name, file_path)
            yield _sse(json.dumps({
                "workflow_name": workflow_name,
                "file_path": file_path,
            }), "compiled")

        except Exception as e:
            logger.error("Workflow compilation failed: %s", e)
            yield _sse(json.dumps({"workflow_name": workflow_name, "error": str(e)}), "compiled")

        # ── Phase 5c: Register on Mistral Workflows server ────────────────
        yield _sse("Checking Mistral server registration…", "status")
        mistral_workflow_id = None
        try:
            # Single best-effort check — no polling loop.
            # If the Temporal worker is connected it will have registered the
            # workflow by now (the file was just written in Phase 5b).
            # Use asyncio.to_thread so the sync httpx call doesn't block the
            # event loop.
            def _check_registration():
                try:
                    r = httpx.get(
                        "https://api.mistral.ai/v1/workflows",
                        headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                        timeout=5.0,
                    )
                    if r.status_code == 200:
                        for wf in r.json().get("workflows", []):
                            if wf.get("name") == workflow_name:
                                return wf.get("id")
                except Exception:
                    pass
                return None

            mistral_workflow_id = await asyncio.to_thread(_check_registration)

            if mistral_workflow_id:
                workflow_def.is_deployed = True
                workflow_def.id = mistral_workflow_id
                save_workflow(workflow_def)
                logger.info("Workflow '%s' confirmed on Mistral (id=%s)", workflow_name, mistral_workflow_id)
                yield _sse(json.dumps({
                    "workflow_name": workflow_name,
                    "mistral_workflow_id": mistral_workflow_id,
                }), "registered")
            else:
                # Normal when Temporal worker is not running — not an error.
                yield _sse(json.dumps({
                    "workflow_name": workflow_name,
                    "error": "Workflow compiled and saved locally. It will auto-register when the Mistral worker connects.",
                }), "registered")

        except Exception as e:
            logger.error("Workflow registration check failed: %s", e)
            yield _sse(json.dumps({"workflow_name": workflow_name, "error": str(e)}), "registered")

        # ── Phase 5d: Publish as le Chat conversational assistant ─────────
        yield _sse("Publishing as le Chat assistant…", "status")
        le_chat_url = None
        try:
            from app.services.conversational_workflow_service import publish_as_le_chat

            backing_agent_id = created_agents[-1]["agent_id"] if created_agents else None
            le_chat_info = await publish_as_le_chat(
                client=client,
                workflow_name=workflow_name,
                workflow_description=workflow_def.description or goal,
                input_schema=workflow_def.input_schema,
                existing_agent_id=backing_agent_id,
            )
            le_chat_url = le_chat_info["le_chat_url"]
            logger.info("Workflow '%s' published to le Chat: %s", workflow_name, le_chat_url)
            yield _sse(json.dumps({
                "workflow_name": workflow_name,
                "agent_id": le_chat_info["agent_id"],
                "le_chat_url": le_chat_url,
                "is_new": le_chat_info.get("is_new", True),
            }), "le_chat_published")

        except Exception as e:
            logger.error("le Chat publish failed for '%s': %s", workflow_name, e)
            yield _sse(json.dumps({"workflow_name": workflow_name, "error": str(e)}), "le_chat_published")

        # ── Final done ────────────────────────────────────────────────────
        yield _sse(json.dumps({
            "workflow_name": workflow_name,
            "mistral_workflow_id": mistral_workflow_id,
            "le_chat_url": le_chat_url,
        }), "done")

    except Exception as e:
        logger.error("Workflow planning failed: %s", e)
        yield _sse(str(e), "error")


def _safe_parse(raw: str, fallback) -> dict | None:
    """Parse JSON, stripping markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except Exception as e:
        logger.error("JSON parse failed: %s — raw: %s", e, text[:200])
        return fallback
