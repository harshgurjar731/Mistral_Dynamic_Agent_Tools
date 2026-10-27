"""
Layers — Pipeline assembly and registration.

Defines three standard pipelines:

- ``chat_pipeline``     — used by ``/api/orchestrate`` and ``/api/orchestrate/stream``
- ``workflow_pipeline`` — used by ``/api/workflows/plan``
- ``revision_pipeline`` — used by ``/api/workflows/{name}/revisions``

Both were previously one monolithic layer doing all the design work in a single
LLM call. They are now chains of single-decision layers: each layer answers one
question against a prompt that asks about nothing else, and writes its answer
onto a typed spec (``app.core.specs``) that the layers after it read.

To add a decision, write a ``DecisionLayer`` subclass with its own prompt and
register it here:

    chat_pipeline.add(MyDecisionLayer(), before="guardrail_config")
"""

from app.build_prereqs.layer import BuildPrerequisitesLayer
from app.core.layer import ParallelGroup
from app.core.pipeline import Pipeline

from app.layers.agent import (
    AgentAssemblyLayer,
    AgentInventoryLayer,
    AgentRuleSelectionLayer,
    CapabilityGapLayer,
    ConnectorSelectionLayer,
    GuardrailConfigLayer,
    IdentityLayer,
    InstructionAuthoringLayer,
    LibraryProvisioningLayer,
    LibrarySelectionLayer,
    ModelSelectionLayer,
    RequirementAnalysisLayer,
    ToolSelectionLayer,
)
from app.layers.cleanup_layer import CleanupLayer
from app.layers.process_knowledge_layer import ProcessKnowledgeLayer
from app.layers.execution_layer import ExecutionLayer
from app.layers.revision import (
    RevisionApplyLayer,
    RevisionContextLayer,
    RevisionDiffLayer,
    RevisionIntentLayer,
    RevisionNormaliseLayer,
    RevisionProposalLayer,
    RevisionValidationLayer,
)
from app.layers.workflow import (
    ActivityGapLayer,
    AgentDesignLayer,
    AgentProvisioningLayer,
    CapabilityReuseLayer,
    DataFlowLayer,
    ExecutionModeLayer,
    GoalDecompositionLayer,
    ResourceInventoryLayer,
    StepTopologyLayer,
    WorkflowAgentRulesLayer,
    WorkflowCompilationLayer,
    WorkflowGuardrailLayer,
    WorkflowPersistenceLayer,
    WorkflowRegistrationLayer,
    WorkflowReviewLayer,
    WorkflowRuleSelectionLayer,
    WorkflowValidationLayer,
)

# ── Chat Pipeline ───────────────────────────────────────────────────────────
#
# Ordering constraints, in the order they bind:
#
#   CleanupLayer is outermost so its try/finally wraps every other layer.
#   BuildPrerequisitesLayer runs after the requirement is understood and before
#     CapabilityGapLayer, the first layer that can build anything — what the
#     build needs from the user is settled before any of it is spent.
#   CapabilityGapLayer runs before tool selection, because a tool synthesised
#     there has to be visible to the layer that selects tools.
#   AgentInventoryLayer runs before the facet group, because all five branches
#     read the same inventory and fetching it inside the group would issue the
#     same round trips five times.
#   The five facets are independent of each other by construction — none reads
#     another's output — which is what makes them safe to run concurrently.
#   LibraryProvisioningLayer runs next so a library the agent was designed
#     around exists before anything validates against it.
#   GuardrailConfigLayer runs after them because the moderation an agent
#     warrants depends on what it can actually do.
#   AgentRuleSelectionLayer runs after it for the same reason, and before the
#     instructions so they can be written for the rules the agent will follow.
#   InstructionAuthoringLayer runs last of the design layers because the
#     instructions are where every prior decision is expressed to the model.

chat_pipeline = Pipeline("agent_chat")
chat_pipeline.add(CleanupLayer())
chat_pipeline.add(RequirementAnalysisLayer())
chat_pipeline.add(BuildPrerequisitesLayer("agent"))
chat_pipeline.add(CapabilityGapLayer())
chat_pipeline.add(AgentInventoryLayer())
# After inventory (it resolves the scope this reads), before the facet group so
# every branch shares one process context. Off unless the request turns it on.
chat_pipeline.add(ProcessKnowledgeLayer("agent"))
chat_pipeline.add(ParallelGroup(
    "agent_facets",
    [
        ToolSelectionLayer(),
        ConnectorSelectionLayer(),
        LibrarySelectionLayer(),
        ModelSelectionLayer(),
        IdentityLayer(),
    ],
    label="Design the agent",
    detail="Five independent decisions, made at the same time.",
))
chat_pipeline.add(LibraryProvisioningLayer())
chat_pipeline.add(GuardrailConfigLayer())
chat_pipeline.add(AgentRuleSelectionLayer())
chat_pipeline.add(InstructionAuthoringLayer())
chat_pipeline.add(AgentAssemblyLayer())
chat_pipeline.add(ExecutionLayer())

# ── Workflow Pipeline ───────────────────────────────────────────────────────
#
# Strictly sequential: every layer consumes the previous one's output. The
# concurrency that exists is internal — AgentDesignLayer designs agents
# concurrently, ActivityGapLayer synthesises concurrently, and
# AgentProvisioningLayer creates concurrently, each under its own bound.
#
# BuildPrerequisitesLayer sits where the steps and how each runs are known and
# nothing has been created yet: a build that cannot get what it needs stops
# before it has spent anything.

workflow_pipeline = Pipeline("workflow_design")
workflow_pipeline.add(ResourceInventoryLayer())
workflow_pipeline.add(ProcessKnowledgeLayer("workflow"))
workflow_pipeline.add(GoalDecompositionLayer())
workflow_pipeline.add(ExecutionModeLayer())
workflow_pipeline.add(BuildPrerequisitesLayer("workflow"))
workflow_pipeline.add(CapabilityReuseLayer())
workflow_pipeline.add(ActivityGapLayer())
workflow_pipeline.add(AgentDesignLayer())
workflow_pipeline.add(WorkflowAgentRulesLayer())
workflow_pipeline.add(AgentProvisioningLayer())
workflow_pipeline.add(StepTopologyLayer())
workflow_pipeline.add(DataFlowLayer())
workflow_pipeline.add(WorkflowGuardrailLayer())
workflow_pipeline.add(WorkflowRuleSelectionLayer())
workflow_pipeline.add(WorkflowValidationLayer())
workflow_pipeline.add(WorkflowPersistenceLayer())
workflow_pipeline.add(WorkflowCompilationLayer())
workflow_pipeline.add(WorkflowReviewLayer())
workflow_pipeline.add(WorkflowRegistrationLayer())

# ── Revision Pipeline ───────────────────────────────────────────────────────
#
# Changes a saved workflow from an instruction, producing a proposal — never a
# saved change. Sequential, and only RevisionIntentLayer calls a model; it is
# skipped when the edit operations were chosen directly in the UI. The
# proposal layer runs last and always, so a failed or ambiguous request is
# still recorded and answered.

revision_pipeline = Pipeline("workflow_revision")
revision_pipeline.add(RevisionContextLayer())
revision_pipeline.add(RevisionIntentLayer())
revision_pipeline.add(RevisionApplyLayer())
revision_pipeline.add(RevisionNormaliseLayer())
revision_pipeline.add(RevisionValidationLayer())
revision_pipeline.add(RevisionDiffLayer())
revision_pipeline.add(RevisionProposalLayer())
