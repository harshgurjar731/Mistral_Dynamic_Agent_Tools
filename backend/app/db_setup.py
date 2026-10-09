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
    import app.ontology.models
    import app.rag.models
    import app.remote_server_model
    import app.rules.models
    import app.runs.models  # noqa: F401
    from app.database import create_tables

    create_tables()

    # Before anything reads or seeds rules: the Rule model has columns an
    # older rules table lacks. Likewise for the other additive migrations.
    from app.ontology import knowledge as ontology_knowledge
    from app.rag import schema as rag_schema
    from app.remote_servers import schema as remote_servers_schema
    from app.rules import schema as rules_schema

    rules_schema.ensure_schema()
    remote_servers_schema.ensure_schema()
    ontology_knowledge.ensure_schema()
    rag_schema.ensure_schema()

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
