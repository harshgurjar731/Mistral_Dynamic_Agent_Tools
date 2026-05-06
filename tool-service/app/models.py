"""
SQLAlchemy models for Tool Service.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class ToolRecord(Base):
    """Persistent record of a synthesized tool."""
    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    hash = Column(String, nullable=False, unique=True, index=True)
    version = Column(String, nullable=False, default="1.0.0")
    schema_json = Column(Text, nullable=False)
    source_code = Column(Text, nullable=False)
    module_path = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending_approval")  # pending_approval | approved | rejected
    sandbox_output = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
