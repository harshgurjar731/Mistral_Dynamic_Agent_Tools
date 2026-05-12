"""Quick validation of all prompt templates."""
from app.prompts import (
    ORCHESTRATOR_SYSTEM_PROMPT,
    SYNTHESIS_CHECK_PROMPT,
    WORKFLOW_ANALYSIS_PROMPT,
    WORKFLOW_DAG_PROMPT,
    EXPLICIT_SYNTHESIS_PROMPT,
    CONVERSATIONAL_GATEWAY_PROMPT,
)

# 1. Orchestrator
r = ORCHESTRATOR_SYSTEM_PROMPT.format(
    tool_descriptions="[web_search, calc]",
    tool_keys='["web_search","calc"]',
)
assert "tool_descriptions" not in r and "{" in r
print("1. ORCHESTRATOR_SYSTEM_PROMPT: OK")

# 2. Synthesis check
r = SYNTHESIS_CHECK_PROMPT.format(tool_descriptions="[web_search]")
assert "tool_descriptions" not in r
print("2. SYNTHESIS_CHECK_PROMPT: OK")

# 3. Workflow analysis
r = WORKFLOW_ANALYSIS_PROMPT.format(
    existing_tools="[]", existing_agents="[]", existing_workflows="[]"
)
assert "existing_tools" not in r
print("3. WORKFLOW_ANALYSIS_PROMPT: OK")

# 4. DAG
r = WORKFLOW_DAG_PROMPT.format(
    agents_json="{}", goal="test goal", requirements_json="{}"
)
assert "agents_json" not in r
print("4. WORKFLOW_DAG_PROMPT: OK")

# 5. Gateway
r = CONVERSATIONAL_GATEWAY_PROMPT.format(
    workflow_name="test_wf",
    workflow_display_name="Test Workflow",
    workflow_description="A test workflow.",
    input_schema_desc="- field1: str",
)
assert "workflow_name" not in r
print("5. CONVERSATIONAL_GATEWAY_PROMPT: OK")

# 6. Explicit synthesis (no template vars)
assert len(EXPLICIT_SYNTHESIS_PROMPT) > 100
print("6. EXPLICIT_SYNTHESIS_PROMPT: OK")

print("\nAll 6 backend prompt templates validated successfully!")
