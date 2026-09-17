"""
Agent orchestration layers — one decision each.

Replaces the single ``AgentResolverLayer``, whose one completion returned an
agent's name, tier, model, temperature, tools, connectors, libraries and
instructions together.

Chain, as assembled in ``app.layers``:

    RequirementAnalysisLayer     what does the user actually need
    CapabilityGapLayer           is the platform missing a capability
    AgentInventoryLayer          what could this agent be given        (no LLM)
    ── agent_facets, concurrent ──
      ToolSelectionLayer         which platform tools
      ConnectorSelectionLayer    which external services
      LibrarySelectionLayer      which documents, and the knowledge graph
      ModelSelectionLayer        which model, at what temperature
      IdentityLayer              which tier, and therefore which name
    ──────────────────────────────
    LibraryProvisioningLayer     create the library it needs, if none exists   (no LLM)
    GuardrailConfigLayer         what moderation does this configuration warrant
    AgentRuleSelectionLayer      which of the optional agent rules apply
    InstructionAuthoringLayer    how should this agent think
    AgentAssemblyLayer           create it                             (no LLM)
"""

from app.layers.agent.assembly_layer import AgentAssemblyLayer
from app.layers.agent.capability_gap_layer import CapabilityGapLayer
from app.layers.agent.facets import (
    ConnectorSelectionLayer,
    IdentityLayer,
    LibrarySelectionLayer,
    ModelSelectionLayer,
    ToolSelectionLayer,
)
from app.layers.agent.guardrail_layer import GuardrailConfigLayer
from app.layers.agent.instruction_layer import InstructionAuthoringLayer
from app.layers.agent.inventory_layer import AgentInventoryLayer
from app.layers.agent.library_provisioning_layer import LibraryProvisioningLayer
from app.layers.agent.requirement_layer import RequirementAnalysisLayer
from app.layers.agent.rule_selection_layer import AgentRuleSelectionLayer

__all__ = [
    "AgentRuleSelectionLayer",
    "RequirementAnalysisLayer",
    "CapabilityGapLayer",
    "AgentInventoryLayer",
    "ToolSelectionLayer",
    "ConnectorSelectionLayer",
    "LibrarySelectionLayer",
    "ModelSelectionLayer",
    "IdentityLayer",
    "LibraryProvisioningLayer",
    "GuardrailConfigLayer",
    "InstructionAuthoringLayer",
    "AgentAssemblyLayer",
]
