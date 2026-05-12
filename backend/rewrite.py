import re

with open('app/services/mistral_workflows_compiler.py', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update imports
if 'workflows_mistralai' not in code:
    code = code.replace(
'''        "from mistralai.workflows import workflow, task",
        "from mistralai.workflows.client import get_mistral_client",
''',
'''        "from mistralai.workflows import workflow, task",
        "import mistralai.workflows.plugins.mistralai as workflows_mistralai",
        "from mistralai.client.models import TextChunk",
'''
    )

# 2. Update _generate_agent_activity_body
old_agent_body = '''def _generate_agent_activity_body(lines: list[str], step, config: dict):
    """
    Generate activity body for AGENT steps.
    Uses get_mistral_client() -> client.agents.complete_async().
    """
    agent_id = config.get("agent_id", "")
    query_template = config.get("query_template", config.get("query", f"Execute step: {step.id}"))
    query_template_escaped = _escape_str(query_template)

    lines += [
        f"    print(f'>>> Executing Agent Activity for step: {step.id}')",
        f"    client = get_mistral_client()",
        f'    query = _substitute("{query_template_escaped}", variables)',
        f"    print(f'>>> Calling agent {agent_id} ...')",
        f"    response = await client.agents.complete_async(",
        f'        agent_id="{agent_id}",',
        f'        messages=[{{"role": "user", "content": query}}],',
        f"    )",
        f"    content = response.choices[0].message.content if response.choices else ''",
        f"    print(f'>>> Received response length: {{len(content)}}')",
        f"    return content",
    ]'''

new_agent_body = '''def _generate_agent_activity_body(lines: list[str], step, config: dict):
    """
    Generate an agent instantiation at module level instead of an activity.
    The execution will happen inside the workflow run() using Runner.run().
    """
    from app.config import get_db_session
    from app.models.agent import Agent

    with get_db_session() as db:
        step_agent = db.query(Agent).filter_by(id=step.agent_id).first()
        if not step_agent:
            raise ValueError(f"Agent {step.agent_id} not found for step {step.id}")
        agent_id_str = step_agent.mistral_agent_id

    query_template = config.get("query_template", config.get("query", f"Execute step: {step.id}"))
    query_template_escaped = _escape_str(query_template)

    lines += [
        f"agent_{step.id} = workflows_mistralai.Agent(",
        f'    id="{agent_id_str}",',
        f")",
        "",
        f"def get_query_{step.id}(variables):",
        f'    return _substitute("{query_template_escaped}", variables)',
        ""
    ]'''
code = code.replace(old_agent_body, new_agent_body)

# 3. Update _generate_workflow_class signature
old_class_def = '''    lines += [
        f"@workflows.workflow.define(",
        f'    name="{workflow_def.name}",',
        f'    workflow_display_name="{display_name}",',
        f'    workflow_description="{description}",',
        f"    execution_timeout=timedelta(hours=24),",
        f")",
        f"class {class_name}:",'''

new_class_def = '''    lines += [
        f"@workflows.workflow.define(",
        f'    name="{workflow_def.name}",',
        f'    workflow_display_name="{display_name}",',
        f'    workflow_description="{description}",',
        f"    execution_timeout=timedelta(hours=24),",
        f")",
        f"class {class_name}(workflows.InteractiveWorkflow):",'''
code = code.replace(old_class_def, new_class_def)

# 4. Update the step dispatcher inside the entrypoint
old_dispatch = '''            lines += [
                f'            {prefix} current_step == "{step.id}":',
                f'                self._progress.append("{step.id}")',
                f"                output = await run_{step.id}(variables)",
                f"                last_output = output",
                f"                self._last_result = output",
                f"                if isinstance(output, dict):",
                f"                    variables.update(output)",
                f"                else:",
                f'                    variables["step_{step.id}_output"] = output',
                "",
            ]'''

new_dispatch = '''            if step.type == StepType.AGENT:
                lines += [
                    f'            {prefix} current_step == "{step.id}":',
                    f'                self._progress.append("{step.id}")',
                    f'                session = workflows_mistralai.RemoteSession()',
                    f'                query = get_query_{step.id}(variables)',
                    f'                print(f">>> Running Agent {step.id} ...")',
                    f"                output_chunks = await workflows_mistralai.Runner.run(",
                    f"                    agent=agent_{step.id},",
                    f"                    inputs=query,",
                    f"                    session=session,",
                    f"                )",
                    f'                output = "\\n".join([chunk.text for chunk in output_chunks if isinstance(chunk, TextChunk)])',
                    f'                print(f">>> Agent {step.id} returned {{len(output)}} chars")',
                    f"                last_output = output",
                    f"                self._last_result = output",
                    f"                if isinstance(output, dict):",
                    f"                    variables.update(output)",
                    f"                else:",
                    f'                    variables["step_{step.id}_output"] = output',
                    "",
                ]
            else:
                lines += [
                    f'            {prefix} current_step == "{step.id}":',
                    f'                self._progress.append("{step.id}")',
                    f"                output = await run_{step.id}(variables)",
                    f"                last_output = output",
                    f"                self._last_result = output",
                    f"                if isinstance(output, dict):",
                    f"                    variables.update(output)",
                    f"                else:",
                    f'                    variables["step_{step.id}_output"] = output',
                    "",
                ]'''
code = code.replace(old_dispatch, new_dispatch)

with open('app/services/mistral_workflows_compiler.py', 'w', encoding='utf-8') as f:
    f.write(code)

print('Rewrite complete. Check file contents.')
