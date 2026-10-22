"""The tool safety rules table."""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class SafetyRule(Base):
    __tablename__ = "tool_safety_rules"

    id = Column(String, primary_key=True)                 # e.g. "no_arbitrary_code"
    title = Column(String, nullable=False)
    #: The rule as the model reads it: "Never design or request a tool that …".
    rule = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)
    #: advise | standard | strict — see app.safety.store.STRICTNESS
    strictness = Column(String, nullable=False, default="standard")
    #: JSON list of application point keys (app.safety.store.POINTS).
    applies_to = Column(Text, nullable=False, default="[]")
    builtin = Column(Boolean, nullable=False, default=False)
    sort = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
