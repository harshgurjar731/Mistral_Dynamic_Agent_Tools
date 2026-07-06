"""
Layers — Pipeline assembly and registration.

Defines two standard pipelines:

- ``chat_pipeline`` — used by ``/api/orchestrate`` and ``/api/orchestrate/stream``
- ``workflow_pipeline`` — used by ``/api/workflows/plan``

To add a new feature (e.g., caching, rate-limiting, logging) create a new
Layer subclass and register it here:

    chat_pipeline.add(RateLimitLayer(), before="synthesis")
    chat_pipeline.add(CachingLayer(), before="execution")
"""

from app.core.pipeline import Pipeline

from app.layers.synthesis_layer import SynthesisLayer
from app.layers.agent_resolver_layer import AgentResolverLayer
from app.layers.execution_layer import ExecutionLayer
from app.layers.cleanup_layer import CleanupLayer
from app.layers.workflow_planning_layer import WorkflowPlanningLayer


# ── Chat Pipeline ───────────────────────────────────────────────────────────
# Synthesis MUST run before AgentResolver because synthesis may create new
# tools that the analysis LLM and agent creation need to see.
# Cleanup wraps everything in try/finally for agent deletion.
#
# Parallelism is applied WITHIN layers (e.g., concurrent tool execution
# inside ExecutionLayer) rather than between these layers, because they
# have data dependencies:
#   synthesis → modifies tool registry → agent_resolver reads it

chat_pipeline = Pipeline()
chat_pipeline.add(CleanupLayer())           # wraps everything in try/finally
chat_pipeline.add(SynthesisLayer())         # check/create new tools first
chat_pipeline.add(AgentResolverLayer())     # analyse query + create agent (sees new tools)
chat_pipeline.add(ExecutionLayer())         # run conversation + parallel tool calls

# ── Workflow Pipeline ───────────────────────────────────────────────────────
# Parallelism is INTERNAL to the WorkflowPlanningLayer (Phases 1-3).

workflow_pipeline = Pipeline()
workflow_pipeline.add(WorkflowPlanningLayer())
