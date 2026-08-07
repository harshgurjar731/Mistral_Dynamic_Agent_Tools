"""
SQLAlchemy model for Remote Servers — user-configured endpoints
that accept tool source code via HTTP POST.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class RemoteServer(Base):
    """A remote server that can receive tool code."""
    __tablename__ = "remote_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    description = Column(Text, nullable=True, default="")
    created_at = Column(DateTime, server_default=func.now())
