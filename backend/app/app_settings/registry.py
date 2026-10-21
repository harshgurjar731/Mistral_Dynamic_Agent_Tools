"""
Every backend setting the Settings page shows, and where each one is read.

``used_in`` is the answer to "where does changing this take effect" — keep it
current when a setting gains or loses a reader.
"""

from __future__ import annotations

from app.app_settings.core import Section, SettingDef

SECTIONS = [
    Section("models", "Models", "Which Mistral model each part of the platform runs on.", "cpu"),
    Section("model_routes", "Code pipeline model routes",
            "Per-job model, reasoning effort, timeout and fallback for the code-requirement "
            "pipeline (app/llm_routes.py).", "route"),
    Section("catalog", "Model catalog sync",
            "How the list of Mistral models is kept up to date.", "refresh"),
    Section("orchestration", "Orchestration & pacing",
            "Concurrency, retries and thresholds for the planner and agent pipeline.", "gauge"),
    Section("workflows", "Workflow engine & worker",
            "The Mistral Workflows worker and workflow bookkeeping.", "workflow"),
    Section("tool_connection", "Tool Service connection",
            "How the backend reaches the Tool Service.", "plug"),
    Section("rag", "Knowledge graph & RAG",
            "Neo4j connection and document ingestion limits.", "network"),
    Section("observability", "Observability", "Traces exported to Mistral Observability.", "activity"),
    Section("platform", "Platform & security", "API, database, CORS and uploads.", "shield"),
]

_ORCH = "MISTRAL_ORCHESTRATOR_MODEL"

DEFS: list[SettingDef] = [
    # ── Models ─────────────────────────────────────────────────────────
    SettingDef(_ORCH, "models", "Orchestrator / decision model",
               "Runs every planning and decision call: agent pipeline facets, workflow planner "
               "layers, rule selection, domain classification, the RAG query optimiser and the "
               "ontology architect.",
               type="model", capability="chat", used_in=(
                   "Agent pipeline decision layers — core/decision.py (AgentDecisionLayer.model_for)",
                   "Workflow planner layers — layers/workflow/*.py via core/decision.py",
                   "Workflow agent design — layers/workflow/design_layer.py",
                   "Rule selection — rules/select.py",
                   "Domain classification — ontology/classifier.py",
                   "RAG query optimiser agent — rag/optimizer.py",
                   "Ontology architect agent — rag/ontology_agent.py",
                   "Conversational workflow gateway — services/conversational_workflow_service.py",
               )),
    SettingDef("DEFAULT_AGENT_MODEL", "models", "Default agent model",
               "Model given to an agent when nothing else chose one, and the fallback when the "
               "designer's choice is not recognised.",
               type="model", capability="function_calling", used_in=(
                   "Create-agent form default — frontend CreateAgentModal / routes/agents.py",
                   "Agent pipeline fallback — layers/agent/facets.py (ModelSelectionLayer)",
                   "Workflow agent design fallback — layers/workflow/design_layer.py",
                   "Agent spec default — core/specs.py",
                   "Stand-in agents for workflow steps — services/workflow_engine/step_runners.py",
                   "Deployment packages — services/workflow_packager.py",
                   "Workflow builder catalog — routes/workflows.py",
               )),
    SettingDef("AGENT_MODEL_LARGE", "models", "Large tier model",
               "What the designers' 'large' choice resolves to (complex reasoning, structured "
               "output, coding).",
               type="model", capability="function_calling", group="Agent model tiers", used_in=(
                   "Agent pipeline model selection — layers/agent/facets.py",
                   "Workflow agent design — layers/workflow/design_layer.py",
               )),
    SettingDef("AGENT_MODEL_MEDIUM", "models", "Medium tier model",
               "What the designers' 'medium' choice resolves to (balanced quality and speed).",
               type="model", capability="function_calling", group="Agent model tiers", used_in=(
                   "Agent pipeline model selection — layers/agent/facets.py",
                   "Workflow agent design — layers/workflow/design_layer.py",
               )),
    SettingDef("AGENT_MODEL_SMALL", "models", "Small tier model",
               "What the designers' 'small' choice resolves to (lookups, classification).",
               type="model", capability="function_calling", group="Agent model tiers", used_in=(
                   "Agent pipeline model selection — layers/agent/facets.py",
                   "Workflow agent design — layers/workflow/design_layer.py",
               )),
    SettingDef("AGENT_MODEL_CHOICES", "models", "Selectable models",
               "Models offered in every model picker, and accepted as-is when a designer names "
               "one directly.",
               type="model_list", capability="chat", used_in=(
                   "Playground model picker — frontend routes/playground.tsx",
                   "Create-agent form — frontend CreateAgentModal",
                   "Workflow builder — routes/workflows.py (builder catalog)",
                   "New-workflow agent form — frontend CreateModals",
                   "Approved-models rule options — frontend RuleParamsForm",
               )),
    SettingDef("CHAT_DEFAULT_MODEL", "models", "Chat default model",
               "Model for chat completions that name neither a model nor an agent.",
               type="model", capability="chat", used_in=(
                   "Chat completions — services/chat_service.py, routes/chat.py",
                   "Playground default selection — frontend routes/playground.tsx",
               )),
    SettingDef("RAG_EXTRACTION_MODEL", "models", "RAG extraction model",
               "Extracts entities and relations from each document chunk on ingestion.",
               type="model", capability="chat", used_in=("Graph RAG ingestion — rag/ingest.py",)),

    # ── Catalog sync ───────────────────────────────────────────────────
    SettingDef("MODEL_CATALOG_REFRESH_HOURS", "catalog", "Refresh interval (hours)",
               "How often the model list is re-read from Mistral. 0 turns automatic refresh off; "
               "the Refresh button always works.",
               type="float", minimum=0, maximum=720,
               used_in=("Background refresh — app_settings/catalog.py (refresh_loop)",)),
    SettingDef("AUTO_UPGRADE_DEPRECATED_MODELS", "catalog", "Auto-upgrade deprecated models",
               "After a refresh, switch any configured model Mistral has deprecated to the "
               "replacement Mistral names.",
               type="bool", used_in=("Catalog review — app_settings/catalog.py (review)",)),
    SettingDef("MISTRAL_API_BASE_URL", "catalog", "Mistral API base URL",
               "Where the model catalog is read from.", type="string",
               used_in=("Model catalog — app_settings/catalog.py",)),

    # ── Orchestration ──────────────────────────────────────────────────
    SettingDef("DECISION_CONCURRENCY", "orchestration", "Decision concurrency",
               "Decision calls allowed in flight at once across the process.",
               type="int", minimum=1, maximum=32, used_in=("core/decision.py (_concurrency_gate)",)),
    SettingDef("DECISION_MAX_RETRIES", "orchestration", "Decision retries",
               "Attempts per decision call when rate limited.",
               type="int", minimum=1, maximum=20, used_in=("core/decision.py (decide)",)),
    SettingDef("DECISION_RETRY_BASE_SECONDS", "orchestration", "Retry back-off base (s)",
               "First back-off delay; doubles each retry.",
               type="float", minimum=0.1, maximum=60, used_in=("core/decision.py (decide)",)),
    SettingDef("WORKFLOW_DESIGN_CONCURRENCY", "orchestration", "Agent design concurrency",
               "Agent designs run at once while planning a workflow.",
               type="int", minimum=1, maximum=32,
               used_in=("layers/workflow/design_layer.py (AgentDesignLayer)",)),
    SettingDef("AGENT_CREATION_CONCURRENCY", "orchestration", "Agent creation concurrency",
               "Agents created at once when a workflow plan is provisioned.",
               type="int", minimum=1, maximum=32,
               used_in=("layers/workflow/provisioning_layer.py",)),
    SettingDef("RULE_SELECTION_CONCURRENCY", "orchestration", "Rule selection concurrency",
               "Rule-selection calls at once while planning.",
               type="int", minimum=1, maximum=32, used_in=("layers/workflow/rule_layers.py",)),
    SettingDef("TOOL_SYNTHESIS_CONCURRENCY", "orchestration", "Tool synthesis concurrency",
               "Missing tools synthesised at once while planning.",
               type="int", minimum=1, maximum=16, used_in=("layers/workflow/tool_gap_layer.py",)),
    SettingDef("REUSE_MIN_CONFIDENCE", "orchestration", "Minimum reuse confidence",
               "Below this confidence an existing agent is not reused for a capability.",
               type="float", minimum=0, maximum=1, used_in=("layers/workflow/reuse_layer.py",)),

    # ── Workflows ──────────────────────────────────────────────────────
    SettingDef("MISTRAL_WORKER_ENABLED", "workflows", "Run the workflows worker",
               "Start the Mistral Workflows worker subprocess with the backend.",
               type="bool", apply="restart",
               used_in=("main.py (lifespan)", "remote_servers/deployers.py")),
    SettingDef("DEPLOYMENT_NAME", "workflows", "Worker deployment name",
               "Deployment the local worker registers workflows under.",
               type="string", apply="restart",
               used_in=("services/mistral_worker.py", "routes/workflows.py",
                        "remote_servers/deployers.py", "layers/workflow/finalize_layers.py")),
    SettingDef("MISTRAL_WORKFLOWS_DIR", "workflows", "Compiled workflows directory",
               "Where compiled workflow modules are written (relative to backend/).",
               type="string", apply="restart",
               used_in=("routes/workflows.py", "layers/workflow/finalize_layers.py",
                        "layers/workflow/plan_control.py", "services/mistral_worker.py")),
    SettingDef("WORKFLOW_REGISTRATION_WAIT", "workflows", "Registration wait (s)",
               "How long publishing waits for the worker to register a workflow.",
               type="float", minimum=0, maximum=600, used_in=("routes/workflows.py",)),
    SettingDef("WORKFLOW_MAX_VERSIONS", "workflows", "Versions kept per workflow",
               "Older revisions beyond this are pruned.",
               type="int", minimum=1, maximum=1000, used_in=("workflow_revisions/store.py",)),

    # ── Tool Service connection ────────────────────────────────────────
    SettingDef("TOOL_SERVICE_URL", "tool_connection", "Tool Service URL",
               "Base URL of the Tool Service container.", type="string", apply="restart",
               used_in=("services/tool_resolver.py", "services/workflow_engine/step_runners.py",
                        "app_settings/tool_service.py")),
    SettingDef("TOOL_SERVICE_WAIT_SECONDS", "tool_connection", "Wait when unreachable (s)",
               "How long a call keeps retrying while the Tool Service refuses connections.",
               type="float", minimum=0, maximum=900, used_in=("services/tool_resolver.py",)),

    # ── RAG ────────────────────────────────────────────────────────────
    SettingDef("RAG_CHUNK_CHARS", "rag", "Chunk size (chars)", "Characters per extraction chunk.",
               type="int", minimum=1000, maximum=100000, used_in=("rag/ingest.py",)),
    SettingDef("RAG_CHUNK_OVERLAP", "rag", "Chunk overlap (chars)", "Overlap between chunks.",
               type="int", minimum=0, maximum=20000, used_in=("rag/ingest.py",)),
    SettingDef("RAG_MAX_CHUNKS_PER_DOC", "rag", "Max chunks per document",
               "Hard ceiling on extraction calls per document.",
               type="int", minimum=1, maximum=1000, used_in=("rag/ingest.py",)),
    SettingDef("RAG_EXTRACTION_CONCURRENCY", "rag", "Extraction concurrency",
               "Chunks extracted at once.", type="int", minimum=1, maximum=32,
               used_in=("rag/ingest.py",)),
    SettingDef("RAG_TEXT_POLL_SECONDS", "rag", "Text poll interval (s)",
               "How often extracted library text is polled.", type="int", minimum=1, maximum=120,
               used_in=("rag/ingest.py", "workflow_inputs/documents.py")),
    SettingDef("RAG_TEXT_POLL_ATTEMPTS", "rag", "Text poll attempts",
               "Polls before giving up on a document.", type="int", minimum=1, maximum=1000,
               used_in=("rag/ingest.py", "workflow_inputs/documents.py")),
    SettingDef("NEO4J_URI", "rag", "Neo4j URI", "Bolt URI of the knowledge graph.",
               type="string", apply="restart", used_in=("rag/graph_store.py",)),
    SettingDef("NEO4J_USER", "rag", "Neo4j user", "", type="string", apply="restart",
               used_in=("rag/graph_store.py",)),
    SettingDef("NEO4J_PASSWORD", "rag", "Neo4j password", "Set in backend/.env.",
               type="secret", apply="restart", editable=False, used_in=("rag/graph_store.py",)),
    SettingDef("NEO4J_DATABASE", "rag", "Neo4j database", "", type="string", apply="restart",
               used_in=("rag/graph_store.py",)),

    # ── Observability ──────────────────────────────────────────────────
    SettingDef("OBSERVABILITY_ENABLED", "observability", "Export traces",
               "Send spans to Mistral Observability.", type="bool", apply="restart",
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_SERVICE_NAME", "observability", "Service name", "",
               type="string", apply="restart",
               used_in=("observability/tracing.py", "routes/observability.py")),
    SettingDef("OBSERVABILITY_ENVIRONMENT", "observability", "Environment", "",
               type="string", apply="restart", used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_ENDPOINT", "observability", "OTLP endpoint",
               "Empty: Mistral's telemetry endpoint.", type="string", apply="restart",
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_REDACT", "observability", "Redact secrets & PII",
               "Mask span attributes before export.", type="bool", apply="restart",
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_MAX_ATTR_CHARS", "observability", "Max attribute size (chars)", "",
               type="int", minimum=1000, maximum=1000000, used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_MAX_LOG_LINES", "observability", "Max log lines per span", "",
               type="int", minimum=10, maximum=10000, used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_CONSOLE_URL", "observability", "Console URL",
               "Where 'Open in Mistral' links point.", type="string",
               used_in=("routes/observability.py",)),

    # ── Platform ───────────────────────────────────────────────────────
    SettingDef("MISTRAL_API_KEY", "platform", "Mistral API key", "Set in backend/.env.",
               type="secret", apply="restart", editable=False,
               used_in=("dependencies.py", "services/mistral_worker.py", "app_settings/catalog.py")),
    SettingDef("DATABASE_URL", "platform", "Database URL", "Set in backend/.env.",
               type="string", apply="restart", editable=False,
               used_in=("database.py", "services/workflow_engine/engine.py")),
    SettingDef("SQL_TOOLS_DATABASE_URL", "platform", "SQL tools database URL",
               "Database the SQL tools query. Empty: the main database.",
               type="string", apply="restart", used_in=("services/tool_registry.py",)),
    SettingDef("CORS_ORIGINS", "platform", "CORS origins", "Comma-separated allowed origins.",
               type="string", apply="restart", used_in=("main.py",)),
    SettingDef("API_PREFIX", "platform", "API prefix", "The frontend expects /api.",
               type="string", apply="restart", editable=False, used_in=("main.py",)),
    SettingDef("UPLOAD_MAX_MB", "platform", "Max upload size (MB)", "", type="int",
               minimum=1, maximum=500, used_in=("routes/uploads.py",)),
]


def _route_defs() -> list[SettingDef]:
    """Four rows per route in app/llm_routes.py; defaults are the code's routes."""
    from app.llm_routes import _ROUTES

    used = {
        "need_normalise": "Code pipeline R1 — layers/codegen/layers.py (need normalisation)",
        "policy_gate": "Code pipeline R2 — layers/codegen/layers.py (policy screen)",
        "reuse_resolution": "Code pipeline R3 — layers/codegen/layers.py (reuse resolution)",
        "spec_author": "Code pipeline R4 — layers/codegen/layers.py (specification authoring)",
        "capability_gap": "Chat pipeline — layers/agent/capability_gap_layer.py",
    }
    defs = []
    for role, route in _ROUTES.items():
        prefix = f"ROUTE_{role.upper()}"
        group = role.replace("_", " ").capitalize()
        where = (used.get(role, f"Route '{role}'"), "core/decision.py (decide, route=…)")
        defs += [
            SettingDef(f"{prefix}_MODEL", "model_routes", "Model", "", type="model",
                       default=route.model, capability="chat", group=group, used_in=where),
            SettingDef(f"{prefix}_EFFORT", "model_routes", "Reasoning effort",
                       "high | none | omit (do not send).", type="enum",
                       options=("high", "none", "omit"),
                       default=route.reasoning_effort or "omit", group=group, used_in=where),
            SettingDef(f"{prefix}_TIMEOUT_MS", "model_routes", "Timeout (ms)", "", type="int",
                       minimum=5000, maximum=1_800_000, default=route.timeout_ms, group=group,
                       used_in=where),
            SettingDef(f"{prefix}_FALLBACK", "model_routes", "Fallback model",
                       "Tried once when the primary fails; 'none' disables.", type="model",
                       default=route.fallback_model or "none", allow_none=True,
                       capability="chat", group=group, used_in=where),
        ]
    return defs


def all_defs() -> list[SettingDef]:
    return DEFS + _route_defs()
