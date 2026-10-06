"""
Mistral Dynamic Agent Backend — FastAPI Application Entry Point.
"""

import asyncio
import logging
from contextlib import asynccontextmanager


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.dependencies import init_mistral_client
from app.exceptions import (
    MistralAPIError, AgentNotFoundError, ConversationNotFoundError,
    ToolServiceError, WorkflowError,
    mistral_api_error_handler, agent_not_found_handler,
    conversation_not_found_handler, tool_service_error_handler,
    workflow_error_handler, generic_error_handler,
)
from app.routes import agents, conversations, chat, orchestrator, tools, uploads, libraries, remote_servers, connectors, ontology, rag

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# Show WARNING+ from worker SDK (catches registration failures).
# Suppress verbose config/temporal tracebacks that are self-recovering.
logging.getLogger("mistralai.workflows.core.worker").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.config").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.config.config_discovery").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.temporal").setLevel(logging.WARNING)
logging.getLogger("mistralai.workflows.core.temporal.temporal_client").setLevel(logging.WARNING)
# Suppress stale Temporal workflow activation replay errors (not actionable)
logging.getLogger("temporalio.worker._workflow").setLevel(logging.CRITICAL)



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle.

    Starts the Mistral Workflows worker supervisor as a background subprocess
    so you only need ``uvicorn app.main:app --reload`` to run everything.
    """
    import os
    import sys
    import subprocess

    logger.info("🚀 Starting Mistral Dynamic Agent Backend …")
    # Before the client exists, so the client is created already traced.
    from app import observability
    observability.setup("api")
    init_mistral_client()
    logger.info("✅ Mistral client initialized")

    # Tee workflow log output into per-execution buffers so the execution
    # console can tail it. Installed here as well as lazily in the engine so a
    # run started by any path is captured.
    from app.services.workflow_engine import execution_logs
    execution_logs.install()

    # Create ORM tables (remote_servers, ontology, etc.)
    from app.database import create_tables
    import app.remote_server_model  # noqa: F401 — register model with Base
    import app.ontology.models       # noqa: F401 — register ontology tables with Base
    import app.rag.models            # noqa: F401 — register graph-RAG tables with Base
    import app.rules.models          # noqa: F401 — register rules tables with Base
    import app.runs.models           # noqa: F401 — register background-run tables with Base
    create_tables()

    # Before anything reads or seeds rules: the Rule model now has columns an
    # older rules table lacks.
    from app.rules import schema as rules_schema
    rules_schema.ensure_schema()

    # Remote servers gained purpose/provider/config/secrets columns.
    from app.remote_servers import schema as remote_servers_schema
    from app.remote_servers.deployers import recover_interrupted
    remote_servers_schema.ensure_schema()
    recover_interrupted()

    # Runs a previous process left in flight died with it; say so rather than
    # leaving them spinning in the UI. Then keep the log to a useful size.
    try:
        from app.runs import store as runs_store

        interrupted = runs_store.mark_interrupted()
        pruned_runs = runs_store.prune()
        if interrupted or pruned_runs:
            logger.info(
                "✅ Background runs: %d interrupted by restart, %d old run(s) pruned",
                interrupted, pruned_runs,
            )
    except Exception as e:
        logger.warning("⚠️ Background run housekeeping skipped: %s", e)

    # The recommended starter rules. Insert-if-missing, so edits made on the
    # Rules page survive a restart.
    try:
        from app.rules import seed as rules_seed, store as rules_store

        added = rules_seed.load_seed()
        pruned = rules_store.prune_events()
        logger.info("✅ Rules ready: %d recommended rule(s) added, %d old event(s) pruned", added, pruned)
    except Exception as e:
        logger.warning("⚠️ Rules seed skipped: %s", e)

    # Additive column migrations for tables that predate a field.
    from app.ontology import knowledge as ontology_knowledge
    ontology_knowledge.ensure_schema()

    from app.rag import schema as rag_schema
    rag_schema.ensure_schema()

    # Knowledge-graph constraints and the entity full-text index that retrieval
    # runs on. Skipped without complaint when Neo4j is not up — the graph is
    # optional infrastructure, and RAG degrades to document search without it.
    try:
        from app.rag import graph_store, timeline as rag_timeline

        if graph_store.ensure_constraints():
            stats = graph_store.stats().get("totals", {})
            logger.info("✅ Knowledge graph ready: %s", stats or "empty")
        else:
            logger.info(
                "ℹ️ Knowledge graph not available (%s) — graph RAG is disabled "
                "until 'docker compose up -d neo4j' is running",
                graph_store.status().get("reason"),
            )
        # Timelines are diagnostic; keep the last few hundred runs, not all of them.
        rag_timeline.prune()
    except Exception as e:
        logger.warning("⚠️ Knowledge graph setup skipped: %s", e)

    # Upsert the shipped vocabulary. Idempotent, so it is safe on every boot —
    # this project has no migration tool, and the loader is what keeps the
    # YAML and the database in step.
    try:
        from app.ontology.seed_loader import load_seed
        summary = load_seed()
        logger.info("✅ Ontology seeded: %s", summary)
    except Exception as e:
        logger.warning("⚠️ Ontology seed skipped: %s", e)

    # Classify any workflow that predates workflow annotation. Cheap (lexical,
    # no model call) and idempotent — annotate_workflow skips anything a human
    # has already confirmed, so this cannot undo review work.
    try:
        from app.ontology import autotag
        from app.ontology.vocab import SubjectType
        from app.ontology import store as ontology_store
        from app.services.workflow_engine.engine import list_workflows

        tagged = 0
        for workflow in list_workflows():
            if ontology_store.annotations_for(SubjectType.WORKFLOW.value, workflow.name):
                continue
            step_text = " ".join(
                f"{s.id.replace('_', ' ')} {s.description or ''}" for s in workflow.steps
            )
            if autotag.annotate_workflow(
                workflow.name,
                description=workflow.description or "",
                step_text=step_text,
            ):
                tagged += 1
        if tagged:
            logger.info("✅ Annotated %d previously unclassified workflow(s)", tagged)
    except Exception as e:
        logger.warning("⚠️ Workflow annotation backfill skipped: %s", e)

    # Classify any agent still without a domain. Without one the knowledge tool
    # cannot scope itself and falls back to searching every industry, which is
    # the difference between "mortgage knowledge" and "some knowledge".
    #
    # Scheduled in the background: this is an LLM call per agent, and holding up
    # boot for it would be the wrong trade for an enhancement that lands
    # seconds later and then persists.
    try:
        from app.dependencies import get_mistral_client
        from app.ontology import autotag
        from app.ontology import store as ontology_store
        from app.ontology.vocab import (
            SYSTEM_DOMAIN,
            AgentTier,
            Predicate,
            SubjectType,
            coerce_tier,
        )
        from app.services import agent_service

        client = get_mistral_client()
        listing = await agent_service.list_agents(client, page=0, page_size=200)
        items = listing.get("items", [])
        ids = [a["id"] for a in items if a.get("id")]
        annotated = ontology_store.annotations_for_many(SubjectType.AGENT.value, ids)

        # File every foundation agent under System.
        #
        # The block below only classifies agents with *no* domain, which would
        # leave the ones that need this most untouched: a guardrail the old
        # lexical backfill filed under Mortgage — because its instructions say
        # "reject anything unrelated to mortgage lending" — already has a
        # domain, so it would never be revisited, and would stay scoped out of
        # every workflow that is not about mortgages.
        #
        # Lexical, idempotent and free: `annotate_agent` re-derives the domain
        # from the tier and declines to overwrite anything a human has stated,
        # so this converges on the second boot and then does nothing.
        refiled = 0
        for agent in items:
            agent_id = agent.get("id")
            if not agent_id or coerce_tier(agent.get("tier")) != AgentTier.FOUNDATION.value:
                continue
            current = annotated.get(agent_id, {}).get(Predicate.SERVES_DOMAIN.value) or []
            if current == [SYSTEM_DOMAIN]:
                continue
            written = autotag.annotate_agent(
                agent_id,
                name=agent.get("name") or "",
                description=agent.get("description") or "",
                instructions=(agent.get("instructions") or "")[:2000],
                tier=AgentTier.FOUNDATION.value,
            )
            if written.get(Predicate.SERVES_DOMAIN.value):
                # Keep the local view in step so the pass below does not then
                # spend an LLM call re-classifying an agent just filed.
                annotated.setdefault(agent_id, {})[Predicate.SERVES_DOMAIN.value] = [
                    SYSTEM_DOMAIN
                ]
                refiled += 1
        if refiled:
            logger.info("🏛️ Filed %d foundation agent(s) under System", refiled)

        unscoped = [
            a for a in items
            if a.get("id")
            and not annotated.get(a["id"], {}).get(Predicate.SERVES_DOMAIN.value)
        ]
        for agent in unscoped:
            agent_service.schedule_classification(
                client,
                subject_type=SubjectType.AGENT.value,
                subject_id=agent["id"],
                name=agent.get("name") or "",
                description=agent.get("description") or "",
                instructions=(agent.get("instructions") or "")[:2000],
            )
        if unscoped:
            logger.info("🔎 Classifying %d agent(s) with no domain", len(unscoped))
    except Exception as e:
        logger.warning("⚠️ Agent domain classification skipped: %s", e)

    # The query optimiser every RAG retrieval passes through. Created once and
    # registered locally, which is both what stops a second one appearing on the
    # next boot and what makes it non-deletable.
    try:
        from app.dependencies import get_mistral_client
        from app.rag import optimizer as rag_optimizer

        optimizer_id = await rag_optimizer.ensure_system_agent(get_mistral_client())
        if optimizer_id:
            logger.info(
                "✅ Query optimiser ready: %s (backend: %s)",
                optimizer_id, rag_optimizer.backend_name(),
            )
    except Exception as e:
        logger.warning("⚠️ Query optimiser setup skipped: %s", e)

    # The architect that designs each library's content schema. Same
    # adopt-don't-duplicate contract as the optimiser, so a reset database
    # reuses the existing agent instead of filling the workspace with copies.
    try:
        from app.dependencies import get_mistral_client
        from app.rag import ontology_agent

        architect_id = await ontology_agent.ensure_agent(get_mistral_client())
        if architect_id:
            logger.info("✅ Ontology architect ready: %s", architect_id)
    except Exception as e:
        logger.warning("⚠️ Ontology architect setup skipped: %s", e)

    # Annotate libraries against the domain taxonomy. Libraries predate this
    # entirely, so without a backfill the planner's domain scoping would apply
    # to an empty set and quietly change nothing.
    try:
        from app.dependencies import get_mistral_client
        from app.rag import library_domain

        summary = await library_domain.backfill(get_mistral_client())
        logger.info("✅ Library domains: %s", summary)
    except Exception as e:
        logger.warning("⚠️ Library domain backfill skipped: %s", e)

    # Mirror the taxonomy into Neo4j so concepts, libraries, documents and
    # entities form one graph. Derived state, rebuilt from SQLite, so it can
    # never drift into a second disagreeing copy.
    try:
        from app.rag import unified_graph

        summary = unified_graph.sync_taxonomy()
        logger.info("✅ Taxonomy mirror: %s", summary)
    except Exception as e:
        logger.warning("⚠️ Taxonomy mirror skipped: %s", e)

    # One reconcile for the one grounded-knowledge tool: attach it to agents
    # that have documents or a domain worth searching, remove it from those
    # that do not, and strip the two tools it replaced off anything created
    # before the consolidation. Idempotent, so it is safe on every boot, and it
    # does nothing at all when Neo4j is down rather than stripping every agent.
    try:
        from app.dependencies import get_mistral_client
        from app.rag import rag_tools

        summary = await rag_tools.backfill_rag_tool(get_mistral_client())
        logger.info("✅ Domain search tool: %s", summary)
    except Exception as e:
        logger.warning("⚠️ Domain search reconcile skipped: %s", e)

    # Refresh dynamic tools from Docker Tool Service
    from app.services.tool_registry import refresh_dynamic_tools
    try:
        await refresh_dynamic_tools()
        logger.info("✅ Dynamic tools refreshed from Tool Service")
    except Exception as e:
        logger.warning("⚠️ Could not refresh dynamic tools: %s (Tool Service may not be running)", e)

    # ── Start Mistral Workflows worker as a managed subprocess ──────────
    worker_proc = None
    if settings.MISTRAL_WORKER_ENABLED:
        try:
            backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            worker_script = os.path.join(backend_dir, "app", "services", "mistral_worker.py")

            # Note: We use subprocess.Popen instead of asyncio.create_subprocess_exec
            # because uvicorn sets the event loop to SelectorEventLoop on Windows,
            # which raises NotImplementedError for async subprocesses.
            worker_proc = subprocess.Popen(
                [sys.executable, worker_script],
                cwd=backend_dir,
                env={**os.environ},
                stdout=None,
                stderr=None,
            )
            logger.info("✅ Mistral worker supervisor started (pid=%d)", worker_proc.pid)
        except Exception as e:
            logger.error("⚠️ Could not start Mistral worker:", exc_info=True)
            worker_proc = None
    else:
        logger.info("ℹ️ Mistral worker disabled (MISTRAL_WORKER_ENABLED=false)")

    yield

    # ── Shutdown: record in-flight background runs as interrupted ───────
    try:
        from app.runs.manager import manager as run_manager
        await run_manager.shutdown()
    except Exception as e:
        logger.warning("Error closing background runs: %s", e)

    # ── Shutdown: stop the worker subprocess ────────────────────────────
    if worker_proc and worker_proc.poll() is None:
        logger.info("🛑 Stopping Mistral worker supervisor (pid=%d)…", worker_proc.pid)
        try:
            worker_proc.terminate()
            try:
                # wait() on Windows Popen takes timeout in seconds and raises TimeoutExpired
                worker_proc.wait(timeout=8.0)
            except subprocess.TimeoutExpired:
                logger.warning("Worker did not exit in 8s — killing forcefully.")
                worker_proc.kill()
                worker_proc.wait()
            logger.info("✅ Worker stopped.")
        except Exception as e:
            logger.warning("Error stopping worker: %s", e)

    try:
        from app.rag import graph_store
        graph_store.close()
    except Exception:
        pass

    # Last, so spans from the shutdown itself are sent too.
    observability.shutdown()

    logger.info("🛑 Shutting down …")



app = FastAPI(
    title="Mistral Dynamic Agent API",
    description="Backend service for creating and managing Mistral AI agents, conversations, and chat completions.",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One trace on Mistral per user action (every non-GET request). CORS
# preflights are OPTIONS requests, which the middleware passes straight through.
from app.observability.http import ActionTracingMiddleware  # noqa: E402

app.add_middleware(ActionTracingMiddleware)

# ── Exception Handlers ─────────────────────────────────────────────────────

app.add_exception_handler(MistralAPIError, mistral_api_error_handler)
app.add_exception_handler(AgentNotFoundError, agent_not_found_handler)
app.add_exception_handler(ConversationNotFoundError, conversation_not_found_handler)
app.add_exception_handler(ToolServiceError, tool_service_error_handler)
app.add_exception_handler(WorkflowError, workflow_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

# ── Routes ──────────────────────────────────────────────────────────────────

app.include_router(agents.router, prefix=settings.API_PREFIX)
app.include_router(conversations.router, prefix=settings.API_PREFIX)
app.include_router(chat.router, prefix=settings.API_PREFIX)
app.include_router(orchestrator.router, prefix=settings.API_PREFIX)
app.include_router(tools.router, prefix=settings.API_PREFIX)
app.include_router(uploads.router, prefix=settings.API_PREFIX)
app.include_router(libraries.router, prefix=settings.API_PREFIX)
app.include_router(remote_servers.router, prefix=settings.API_PREFIX)
app.include_router(connectors.router, prefix=settings.API_PREFIX)
app.include_router(ontology.router, prefix=settings.API_PREFIX)
app.include_router(rag.router, prefix=settings.API_PREFIX)

from app.routes import rules as rules_routes  # noqa: E402
app.include_router(rules_routes.router, prefix=settings.API_PREFIX)

from app.routes import runs as runs_routes  # noqa: E402
app.include_router(runs_routes.router, prefix=settings.API_PREFIX)

from app.routes import observability as observability_routes  # noqa: E402
app.include_router(observability_routes.router, prefix=settings.API_PREFIX)

# ── Static file serving for uploads ─────────────────────────────────────────
import os
_uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# Workflow routes (Phase 3)
#
# Order is load-bearing: the execution routes own the literal path
# ``/workflows/executions/…``, which the workflow routes would otherwise
# swallow via ``/workflows/{workflow_name}``. FastAPI matches in registration
# order, so executions must be included first.
try:
    from app.routes import executions, workflows
    app.include_router(executions.router, prefix=settings.API_PREFIX)
    app.include_router(workflows.router, prefix=settings.API_PREFIX)
    logger.info("Workflow + execution routes loaded")
except ImportError:
    logger.exception("Workflow routes could not be loaded")

try:
    from app.routes import workflow_deployment
    app.include_router(workflow_deployment.router, prefix=settings.API_PREFIX)
    logger.info("Workflow deployment routes loaded")
except ImportError:
    logger.exception("Workflow deployment routes could not be loaded")


@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint."""
    from app.services.tool_resolver import tool_resolver
    tool_service_ok = await tool_resolver.health_check()
    return {
        "status": "healthy",
        "service": "mistral-dynamic-agent",
        "version": "2.0.0",
        "docker_tool_service": "reachable" if tool_service_ok else "unreachable",
    }

