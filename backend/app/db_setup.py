"""
Database setup shared by every process that uses the backend's database.

The API server and the workflow worker both read it — the worker's agent steps
look up the agent's rules, its knowledge steps the ontology — so both prepare
it the same way on start. A deployed worker runs without the API server, on a
database nothing else has touched.

Idempotent: tables are created when missing, columns added when a table
predates them, and the recommended rules inserted only when absent.
"""

import logging

logger = logging.getLogger(__name__)


def prepare_database(*, seed_rules: bool = True) -> None:
    # Imported for their side effect: each registers its tables with Base,
    # and create_all() creates only the tables it knows about.
    import app.catalog.models
    import app.knowledge.models
    import app.process.models
    import app.safety.models
    import app.vault.models
    import app.rag.models
    import app.remote_server_model
    import app.rules.models
    import app.runs.models
    import app.workflow_inputs.models
    import app.workflow_revisions.models  # noqa: F401
    import app.services.workflow_engine.reviews  # noqa: F401
    import app.services.workflow_engine.run_history  # noqa: F401
    import app.auth.models  # noqa: F401
    from app.database import create_tables

    create_tables()

    # Accounts, roles and workspaces — and the workspace column on every
    # workspace-owned table, which must exist before anything below reads one.
    from app.auth.setup import prepare_auth

    prepare_auth()

    # Before anything reads or seeds rules: the Rule model has columns an
    # older rules table lacks. Likewise for the other additive migrations.
    from app.knowledge import reference as ontology_knowledge
    from app.rag import schema as rag_schema
    from app.remote_servers import schema as remote_servers_schema
    from app.rules import schema as rules_schema

    rules_schema.ensure_schema()
    remote_servers_schema.ensure_schema()
    ontology_knowledge.ensure_schema()
    rag_schema.ensure_schema()

    # The built-in process template, so process documents can be checked
    # before anyone uploads a template of their own.
    from app.process import templates as process_templates

    process_templates.ensure_schema()
    process_templates.ensure_builtin()

    # Tool safety rules: the built-in set, inserted off when missing.
    from app.safety import store as safety_store

    safety_store.seed()

    # Vault: drop audit events past their retention.
    from app.vault import store as vault_store

    vault_store.purge_audit()

    if seed_rules:
        # The recommended starter rules. Insert-if-missing, so edits made on
        # the Rules page survive a restart.
        try:
            from app.rules import seed as rules_seed

            added = rules_seed.load_seed()
            if added:
                logger.info("Rules: %d recommended rule(s) added", added)
        except Exception as e:
            logger.warning("Rules seed skipped: %s", e)
