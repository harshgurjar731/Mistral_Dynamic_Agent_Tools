"""
SQLAlchemy models for Remote Servers — user-configured deployment targets.

A server has a *purpose* (what gets deployed to it) and a *provider* (how we
talk to it). ``purpose="tool"`` servers receive dynamic tool source over HTTP;
``purpose="workflow"`` servers receive a workflow deployment package, over SSH
(any VM) or an HTTP deploy endpoint. See app/remote_servers/providers.py for
the catalog.

Non-secret connection details live in ``config`` (JSON); passwords, keys and
tokens live in ``secrets``, encrypted at rest and never returned to the client.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class RemoteServer(Base):
    """A remote server that can receive tool code or a workflow package."""
    __tablename__ = "remote_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Display address: the endpoint URL for HTTP providers, ssh://user@host:port
    # for SSH ones. Kept as a column because older rows only have this.
    url = Column(String, nullable=False)
    description = Column(Text, nullable=True, default="")
    purpose = Column(String, nullable=True, default="tool")
    provider = Column(String, nullable=True, default="mcp_code_endpoint")
    config = Column(Text, nullable=True)          # JSON, non-secret
    secrets = Column(Text, nullable=True)         # Fernet-encrypted JSON
    last_status = Column(String, nullable=True)   # healthy | degraded | unreachable
    last_check = Column(Text, nullable=True)      # JSON diagnostics report
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, nullable=True, onupdate=func.now())


class RemoteDeployment(Base):
    """One push of a tool or a workflow package to a remote server."""
    __tablename__ = "remote_deployments"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("remote_servers.id", ondelete="CASCADE"), index=True)
    kind = Column(String, nullable=False)          # tool | workflow
    target = Column(String, nullable=False)        # tool or workflow name
    status = Column(String, nullable=False, default="queued")  # queued | running | succeeded | failed
    options = Column(Text, nullable=True)          # JSON, secrets stripped
    log = Column(Text, nullable=True, default="")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)
