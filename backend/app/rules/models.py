"""
Rules tables.

Three tables, deliberately separate from the ontology:

* ``rules``             — the configured rules a user sees on the Rules page
* ``rule_assignments``  — which rules were selected for which agent
* ``rule_events``       — every time a rule ran, and what it decided

A workflow's selection is not stored here: it lives on the workflow definition
itself (``WorkflowDefinition.rules``), which is that workflow's single source of
truth. An agent has no local record of its own — it lives on Mistral — so its
selection needs a table.

Additive tables, created by ``Base.metadata.create_all()`` at startup.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base


class Rule(Base):
    """A configured instance of a rule type (see ``rules.catalog``)."""

    __tablename__ = "rules"

    id = Column(String, primary_key=True)                     # slug, e.g. "agent.read_only_database"
    scope = Column(String, nullable=False, index=True)        # agent | workflow
    type = Column(String, nullable=False)                     # a key of catalog.RULE_TYPES
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    params = Column(Text, nullable=False, default="{}")       # JSON object, shape set by the type
    enforcement = Column(String, nullable=False, default="block")  # block | warn | fix
    #: True applies the rule to every agent / workflow of its scope. False lets
    #: the orchestrator (or a person) attach it where it is relevant.
    always_on = Column(Boolean, nullable=False, default=False)
    enabled = Column(Boolean, nullable=False, default=True)
    source = Column(String, nullable=False, default="user")   # recommended | user
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RuleAssignment(Base):
    """One rule selected for one agent, and who selected it."""

    __tablename__ = "rule_assignments"

    id = Column(Integer, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    rule_id = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False, default="user")   # ai | user
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("agent_id", "rule_id", name="uq_rule_assignment"),
    )


class RuleEvent(Base):
    """One evaluation of one rule, with its outcome.

    ``subject_id`` is an agent id for agent rules and a workflow name for
    workflow rules. ``rule_name`` is a snapshot so the history still reads
    correctly after a rule is renamed or deleted.
    """

    __tablename__ = "rule_events"

    id = Column(Integer, primary_key=True)
    rule_id = Column(String, nullable=False, index=True)
    rule_name = Column(String, nullable=False)
    scope = Column(String, nullable=False)
    subject_id = Column(String, nullable=False)
    checkpoint = Column(String, nullable=False)   # creation | message | tool_call | answer | run | validate | step
    outcome = Column(String, nullable=False)      # passed | blocked | warned | fixed | applied
    message = Column(Text, nullable=True)
    detail = Column(Text, nullable=True)          # JSON
    conversation_id = Column(String, nullable=True)
    execution_id = Column(String, nullable=True)
    step_id = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_rule_event_subject", "scope", "subject_id", "created_at"),
    )
