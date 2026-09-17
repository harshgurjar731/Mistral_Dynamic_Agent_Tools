"""
Workflow orchestration layers — one decision each.

Replaces the single 762-line ``WorkflowPlanningLayer``, whose five phases were
one function with two LLM calls doing most of the work: one that analysed the
goal, decided which agents existed and designed the ones that did not, and one
that produced an entire DAG including every query template.

Chain, as assembled in ``app.layers``:

    ResourceInventoryLayer      what exists to draw on              (no LLM)
    GoalDecompositionLayer      what work does this goal require
    ExecutionModeLayer          agent, function or integration — and prune the rest
    CapabilityReuseLayer        which of it is already covered
    ActivityGapLayer            which deterministic steps must be built
    AgentDesignLayer            design each new agent, one call each
    WorkflowAgentRulesLayer     which optional agent rules each new agent follows
    AgentProvisioningLayer      create them                         (no LLM)
    StepTopologyLayer           what shape is the graph
    DataFlowLayer               how does data move through it
    WorkflowGuardrailLayer      what does the assembled path expose
    WorkflowRuleSelectionLayer  which optional workflow rules apply
    WorkflowValidationLayer     is it runnable, and does it follow its rules (no LLM)
    WorkflowPersistenceLayer    save it                             (no LLM)
    WorkflowCompilationLayer    compile to the SDK                  (no LLM)
    WorkflowRegistrationLayer   register on Mistral                 (no LLM)

Once ``ctx.error`` is set, every remaining layer passes straight through — see
``base.workflow_ready``.
"""

from app.layers.workflow.dataflow_layer import DataFlowLayer
from app.layers.workflow.decomposition_layer import GoalDecompositionLayer
from app.layers.workflow.execution_mode_layer import ExecutionModeLayer
from app.layers.workflow.design_layer import AgentDesignLayer
from app.layers.workflow.finalize_layers import (
    WorkflowCompilationLayer,
    WorkflowPersistenceLayer,
    WorkflowRegistrationLayer,
    WorkflowValidationLayer,
)
from app.layers.workflow.guardrail_layer import WorkflowGuardrailLayer
from app.layers.workflow.inventory_layer import ResourceInventoryLayer
from app.layers.workflow.provisioning_layer import AgentProvisioningLayer
from app.layers.workflow.reuse_layer import CapabilityReuseLayer
from app.layers.workflow.rule_layers import WorkflowAgentRulesLayer, WorkflowRuleSelectionLayer
from app.layers.workflow.tool_gap_layer import ActivityGapLayer
from app.layers.workflow.topology_layer import StepTopologyLayer

__all__ = [
    "WorkflowAgentRulesLayer",
    "WorkflowRuleSelectionLayer",
    "ResourceInventoryLayer",
    "GoalDecompositionLayer",
    "ExecutionModeLayer",
    "CapabilityReuseLayer",
    "ActivityGapLayer",
    "AgentDesignLayer",
    "AgentProvisioningLayer",
    "StepTopologyLayer",
    "DataFlowLayer",
    "WorkflowGuardrailLayer",
    "WorkflowValidationLayer",
    "WorkflowPersistenceLayer",
    "WorkflowCompilationLayer",
    "WorkflowRegistrationLayer",
]
