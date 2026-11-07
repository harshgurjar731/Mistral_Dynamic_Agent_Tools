"""
Preparing auth at start-up: tables, built-in roles, the Default workspace,
workspace columns on the scoped tables, and the first admin. Idempotent.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def register_scoped_models() -> None:
    """Every table whose rows belong to one workspace."""
    from app.auth import scoping
    from app.remote_server_model import RemoteDeployment, RemoteServer
    from app.runs.models import PipelineRunRecord
    from app.services.workflow_engine.engine import _DeletedWorkflowRecord, _WorkflowRecord
    from app.services.workflow_engine.reviews import HumanReview
    from app.vault.models import VaultAuditEvent, VaultSecret
    from app.workflow_revisions.models import WorkflowRevisionRecord, WorkflowVersionRecord

    scoping.register(
        _WorkflowRecord, _DeletedWorkflowRecord, WorkflowRevisionRecord, WorkflowVersionRecord,
        PipelineRunRecord, HumanReview, VaultSecret, VaultAuditEvent, RemoteServer,
        RemoteDeployment,
    )
    scoping.install()


def prepare_auth() -> dict:
    import app.auth.models  # noqa: F401 — registers the auth tables with Base
    from app.auth import scoping, store
    from app.database import create_tables

    create_tables()
    register_scoped_models()
    roles = store.ensure_system_roles()
    default_ws = store.ensure_default_workspace()
    migrated = scoping.ensure_columns(default_ws)
    admin = store.ensure_bootstrap_admin()
    purged = store.purge_expired()
    summary = {"roles_updated": roles, "default_workspace": default_ws,
               "rows_assigned": migrated, "bootstrap_admin": bool(admin), "purged": purged}
    logger.info("✅ Auth ready: %s", summary)
    return summary
