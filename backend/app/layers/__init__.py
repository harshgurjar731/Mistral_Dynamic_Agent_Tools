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
from app.core.stages import Stage

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
from app.layers.workflow.data_contract_layer import DataContractLayer
from app.layers.workflow.verify_layers import ScenarioDesignLayer, WorkflowDryRunLayer
from app.layers.agent.verification_layers import AgentEvaluationLayer, FacetConsistencyLayer
from app.layers.agent.archetype_layer import AgentArchetypeLayer
from app.layers.knowledge_context_layer import KnowledgeContextLayer
from app.layers.industry_knowledge_layer import IndustryKnowledgeLayer
from app.layers.workflow.oversight_layer import OversightPlacementLayer
from app.layers.workflow.pattern_expansion_layer import PatternExpansionLayer
from app.layers.execution_layer import ExecutionLayer
from app.layers.revision import (
    RevisionApplyLayer,
    RevisionCodeFixLayer,
    RevisionContextLayer,
    RevisionDiagnosisLayer,
    RevisionPlanLayer,
    RevisionDiffLayer,
    RevisionIntentLayer,
    RevisionNormaliseLayer,
    RevisionProposalLayer,
    RevisionRepairLayer,
    RevisionValidationLayer,
)
from app.layers.workflow import (
    ActivityGapLayer,
    AgentDesignLayer,
    AgentProvisioningLayer,
    CapabilityReuseLayer,
    DataFlowLayer,
    InputSchemaLayer,
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
chat_pipeline.add(Stage("understand", "Understand the request",
                        "What is asked, and what the build needs from you first.", [
    RequirementAnalysisLayer(),
    BuildPrerequisitesLayer("agent"),
]))
chat_pipeline.add(Stage("equip", "Build missing tools",
                        "Writes and tests any tool the agent needs that does not exist yet.", [
    CapabilityGapLayer(),
]))
chat_pipeline.add(Stage("ground", "Gather what it can use",
                        "The tools, connectors and libraries available, the process knowledge, "
                        "industry knowledge and guidance in scope, and the kind of agent this is.", [
    AgentInventoryLayer(),
    # After inventory (it resolves the scope this reads), before the facets so
    # every branch shares one process context and one guidance pack.
    KnowledgeContextLayer("agent"),
    # After process knowledge (its document's domain widens the scope), before
    # the archetype and facets so every decision reads one industry pack.
    IndustryKnowledgeLayer("agent"),
    # After knowledge (it reads the process facts and guidance), before the
    # facets so model, tools and instructions are chosen for the agent type.
    AgentArchetypeLayer("agent"),
]))
chat_pipeline.add(Stage("design", "Design the agent",
                        "Five independent decisions made at once, then checked against each other.", [
    ParallelGroup(
        "agent_facets",
        [
            ToolSelectionLayer(),
            ConnectorSelectionLayer(),
            LibrarySelectionLayer(),
            ModelSelectionLayer(),
            IdentityLayer(),
        ],
        label="Decide tools, connectors, libraries, model and identity",
        detail="Five independent decisions, made at the same time.",
    ),
    FacetConsistencyLayer(),
]))
chat_pipeline.add(Stage("govern", "Provision and govern",
                        "Creates the library it was designed around, then its guardrails and rules.", [
    LibraryProvisioningLayer(),
    GuardrailConfigLayer(),
    AgentRuleSelectionLayer(),
]))
chat_pipeline.add(Stage("author", "Write and create",
                        "Instructions that express every decision, then the agent on Mistral.", [
    InstructionAuthoringLayer(),
    AgentAssemblyLayer(),
]))
chat_pipeline.add(Stage("verify", "Test the agent",
                        "Runs it on designed prompts and repairs its tools and instructions if it falls short.", [
    AgentEvaluationLayer(),
]))
chat_pipeline.add(Stage("answer", "Answer", "The agent answers your request.", [
    ExecutionLayer(),
]))

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
workflow_pipeline.add(Stage("understand", "Understand the goal",
                            "What exists, what the business and its industry know, the work to do and how "
                            "each part runs.", [
    ResourceInventoryLayer(),
    KnowledgeContextLayer("workflow"),
    # Next to process knowledge, before decomposition: every planning decision
    # and every activity's code reads the same industry pack.
    IndustryKnowledgeLayer("workflow"),
    GoalDecompositionLayer(),
    ExecutionModeLayer(),
]))
workflow_pipeline.add(Stage("contract", "Define the data",
                            "Every record passed between steps — fields, types, units — decided once.", [
    DataContractLayer(),
]))
workflow_pipeline.add(Stage("plan", "Plan the agents",
                            "Agent types, what the build needs from you, what is reused, what is expanded.", [
    # Only capabilities routed to "agent" need a type; decided before
    # prerequisites so a type that needs something is caught early.
    AgentArchetypeLayer("workflow"),
    BuildPrerequisitesLayer("workflow"),
    CapabilityReuseLayer(),
    # After reuse (only capabilities being created are expanded), before design
    # so the sub-agents are designed and created like any other agent.
    PatternExpansionLayer(),
]))
workflow_pipeline.add(Stage("build", "Build activities and agents",
                            "Activities written and tested to the data contract; agents designed, governed "
                            "and created.", [
    ActivityGapLayer(),
    AgentDesignLayer(),
    WorkflowAgentRulesLayer(),
    AgentProvisioningLayer(),
]))
workflow_pipeline.add(Stage("assemble", "Assemble the workflow",
                            "The graph, human oversight, the wiring between steps and the run inputs.", [
    StepTopologyLayer(),
    # After the graph exists, before data flow wires the review steps it adds.
    OversightPlacementLayer(),
    DataFlowLayer(),
    # Its own decision: the run form's inputs and a valid, coherent example.
    InputSchemaLayer(),
]))
workflow_pipeline.add(Stage("govern", "Govern",
                            "Exposure and gates traced; the workflow rules chosen.", [
    WorkflowGuardrailLayer(),
    WorkflowRuleSelectionLayer(),
]))
workflow_pipeline.add(Stage("check", "Check and save",
                            "Validated (going back to the layer at fault when it is not), saved and compiled.", [
    WorkflowValidationLayer(),
    WorkflowPersistenceLayer(),
    WorkflowCompilationLayer(),
]))
workflow_pipeline.add(Stage("verify", "Verify by running",
                            "Test scenarios run end to end; what fails is repaired — edits and code — and run again.", [
    ScenarioDesignLayer(),
    WorkflowDryRunLayer(),
]))
workflow_pipeline.add(Stage("deliver", "Review and register",
                            "You test, refine and accept it; then it is registered on Mistral.", [
    WorkflowReviewLayer(),
    WorkflowRegistrationLayer(),
]))

# ── Revision Pipeline ───────────────────────────────────────────────────────
#
# Changes a saved workflow from an instruction, producing a proposal — never a
# saved change. Sequential, and only RevisionIntentLayer calls a model; it is
# skipped when the edit operations were chosen directly in the UI. The
# proposal layer runs last and always, so a failed or ambiguous request is
# still recorded and answered.

revision_pipeline = Pipeline("workflow_revision")
revision_pipeline.add(RevisionContextLayer())
revision_pipeline.add(RevisionDiagnosisLayer())
revision_pipeline.add(RevisionIntentLayer())
revision_pipeline.add(RevisionPlanLayer())
revision_pipeline.add(RevisionApplyLayer())
revision_pipeline.add(RevisionNormaliseLayer())
revision_pipeline.add(RevisionValidationLayer())
# Model-made edits that failed or introduced errors go back to the editor once or twice.
revision_pipeline.add(RevisionRepairLayer())
revision_pipeline.add(RevisionCodeFixLayer())
revision_pipeline.add(RevisionDiffLayer())
revision_pipeline.add(RevisionProposalLayer())
