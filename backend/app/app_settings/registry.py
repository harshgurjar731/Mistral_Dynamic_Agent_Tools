"""
Every backend setting the Settings page shows — what it does, what it affects
in the product (``impact``), and where the code reads it (``used_in``).

Keep ``used_in`` current when a setting gains or loses a reader.

The ``UI_*`` settings are read by the frontend only, through
``GET /api/settings/public``; the backend stores and serves them.
"""

from __future__ import annotations

from app.app_settings.core import Section, SettingDef

SECTIONS = [
    # ── AI models ──────────────────────────────────────────────────────
    Section("models", "Models",
            "Which Mistral model each part of the platform runs on. Any model your account "
            "can call may be chosen.", "cpu", "models"),
    Section("model_routes", "Code pipeline model routes",
            "The model, reasoning effort, timeout and fallback for each job of the "
            "code-requirement pipeline that turns a request into a tested tool or activity.",
            "route", "models"),
    Section("catalog", "Model catalog sync",
            "How the list of Mistral models is kept up to date and what happens when Mistral "
            "deprecates a model you use.", "refresh", "models"),
    # ── Tool Service (backend side) ────────────────────────────────────
    Section("tool_connection", "Tool Service connection",
            "How the backend reaches the Tool Service that builds and runs tools.",
            "plug", "tool_service"),
    # ── Platform ───────────────────────────────────────────────────────
    Section("orchestration", "Orchestration & pacing",
            "How many model calls run at once, how rate limits are retried, and when an "
            "existing agent is reused.", "gauge", "platform"),
    Section("workflows", "Workflow engine & worker",
            "The Mistral Workflows worker and how workflow versions are kept.",
            "workflow", "platform"),
    Section("rag", "Knowledge graph & RAG",
            "The Neo4j knowledge graph and the limits on document ingestion.",
            "network", "platform"),
    Section("observability", "Observability",
            "Traces of every action exported to Mistral Observability and shown on the Logs page.",
            "activity", "platform"),
    Section("platform", "Platform & security", "API, database, CORS and uploads.",
            "shield", "platform"),
    # ── Process knowledge ──────────────────────────────────────────────
    Section("process_knowledge", "Matching & limits",
            "Whether builds use process knowledge by default, how closely a process must match a "
            "request to be used, and the largest document accepted.", "workflow", "process"),
    Section("guidance", "Build guidance",
            "The best-practice guidance builds follow: whether it is used, how many items a build "
            "and each decision get, how new items are reviewed, and the models that read and "
            "distil guidance sources.", "box", "process"),
    Section("guidance_ranking", "Guidance ranking with process knowledge",
            "How guidance is picked when a build has a process document: ranked against the "
            "process as well as the request, re-ranked for each workflow agent's own stage, and "
            "checked against what the process says about the work. The weights say how much "
            "each signal counts; the request should stay the strongest.", "gauge", "process"),
    # ── Vault & build prerequisites ────────────────────────────────────
    Section("vault", "Vault behaviour",
            "How stored credentials are protected, shown, kept and handed to the code that "
            "uses them.", "shield", "vault"),
    Section("build_prereqs", "Build prerequisites",
            "Before an agent or workflow is built, what it needs from you — credentials, "
            "service URLs, facts — is worked out and settled, so a build is never wasted on "
            "something it cannot use.", "workflow", "vault"),
    # ── Frontend ───────────────────────────────────────────────────────
    Section("ui_design", "Theme & design",
            "Colours, shape and typography of the whole interface. Applied the moment you save.",
            "palette", "frontend"),
    Section("ui_layout", "Layout & branding",
            "Sidebar, notifications and the names shown in the interface.", "layout", "frontend"),
    Section("ui_behavior", "Frontend behaviour",
            "Request timeouts and how often live status is refreshed.", "monitor", "frontend"),
]

_ORCH = "MISTRAL_ORCHESTRATOR_MODEL"
_APPLIER = "frontend components/layout/AppConfigApplier.tsx"

_EFFORT_LABELS = (
    ("high", "High — reasoning on"),
    ("medium", "Medium — some reasoning"),
    ("low", "Low — brief reasoning"),
    ("none", "None — reasoning off"),
    ("omit", "Omit — do not send the parameter"),
)

DEFS: list[SettingDef] = [
    # ── Models ─────────────────────────────────────────────────────────
    SettingDef(_ORCH, "models", "Orchestrator / decision model",
               "The model behind every planning decision: analysing what an agent needs, "
               "choosing its tools, writing its instructions, decomposing a goal into workflow "
               "steps, selecting rules and classifying domains. A stronger model plans better; "
               "a lighter one plans faster and cheaper.",
               type="model", capability="chat",
               impact=("Agent creation (Orchestrator chat)", "Workflow planning (AI builder)",
                       "Rule selection", "Domain classification", "RAG query optimiser",
                       "Ontology architect"),
               used_in=(
                   "core/decision.py — AgentDecisionLayer.model_for (every agent pipeline facet)",
                   "layers/workflow/*.py — workflow planner layers via core/decision.py",
                   "layers/workflow/design_layer.py — agent design for workflow steps",
                   "rules/select.py — rule selection",
                   "catalog/tagging.py — domain classification",
                   "rag/optimizer.py — RAG query optimiser agent",
                   "rag/ontology_agent.py — ontology architect agent",
                   "services/conversational_workflow_service.py — conversational gateway",
               )),
    SettingDef("ORCHESTRATOR_REASONING_EFFORT", "models", "Orchestrator reasoning effort",
               "How hard the orchestrator model thinks before each planning decision. High "
               "plans most accurately; a model that does not reason ignores it.",
               type="enum", options=("high", "medium", "low", "none", "omit"),
               option_labels=_EFFORT_LABELS, default="high",
               impact=("Agent creation (Orchestrator chat)", "Workflow planning (AI builder)",
                       "Refine with AI"),
               used_in=("core/decision.py — decide() on the orchestrator model",)),
    SettingDef("ORCHESTRATOR_FALLBACK_MODEL", "models", "Orchestrator fallback model",
               "Tried once when the orchestrator model fails for a reason other than a timeout "
               "or a rate limit; 'none' disables.",
               type="model", capability="chat", allow_none=True, default="mistral-medium-2604",
               impact=("Agent creation (Orchestrator chat)", "Workflow planning (AI builder)"),
               used_in=("core/decision.py — decide() on the orchestrator model",)),
    SettingDef("DEFAULT_AGENT_MODEL", "models", "Default agent model",
               "The model a new agent runs on when nothing else chose one: the default in the "
               "Create Agent form, stand-in agents created for workflow steps, deployment "
               "packages, and the fallback when the designer's choice is not recognised.",
               type="model", capability="function_calling",
               impact=("Create Agent form default", "Agents designed by the orchestrator (fallback)",
                       "Workflow step stand-in agents", "Deployment packages",
                       "Workflow builder"),
               used_in=(
                   "routes/agents.py — CreateAgentRequest default",
                   "layers/agent/facets.py — ModelSelectionLayer fallback",
                   "layers/workflow/design_layer.py — agent design fallback",
                   "core/specs.py — AgentSpec.to_config default",
                   "services/workflow_engine/step_runners.py — auto-created step agents",
                   "services/workflow_packager.py — deployment agent specs",
                   "routes/workflows.py — builder catalog agents",
                   "frontend CreateAgentModal / CreateModals — form default",
               )),
    SettingDef("AGENT_MODEL_LARGE", "models", "Large tier model",
               "When the agent designer decides a task needs the large tier (complex reasoning, "
               "structured output, coding, multi-step analysis), the agent is created on this "
               "model.",
               type="model", capability="function_calling", group="Agent model tiers",
               impact=("Agents designed by the orchestrator", "Agents designed for workflows"),
               used_in=("config.py — resolve_agent_model",
                        "layers/agent/facets.py — ModelSelectionLayer",
                        "layers/workflow/design_layer.py — AgentDesignLayer")),
    SettingDef("AGENT_MODEL_MEDIUM", "models", "Medium tier model",
               "Model for agents the designer puts in the medium tier — balanced quality and "
               "speed for summarisation, general Q&A and moderate tasks.",
               type="model", capability="function_calling", group="Agent model tiers",
               impact=("Agents designed by the orchestrator", "Agents designed for workflows"),
               used_in=("config.py — resolve_agent_model",
                        "layers/agent/facets.py — ModelSelectionLayer",
                        "layers/workflow/design_layer.py — AgentDesignLayer")),
    SettingDef("AGENT_MODEL_SMALL", "models", "Small tier model",
               "Model for agents the designer puts in the small tier — single-fact lookups, "
               "yes/no classification and very short answers.",
               type="model", capability="function_calling", group="Agent model tiers",
               impact=("Agents designed by the orchestrator", "Agents designed for workflows"),
               used_in=("config.py — resolve_agent_model",
                        "layers/agent/facets.py — ModelSelectionLayer",
                        "layers/workflow/design_layer.py — AgentDesignLayer")),
    SettingDef("AGENT_MODEL_CHOICES", "models", "Pinned models",
               "Models listed first in every model dropdown of the app. Every other Mistral "
               "model is still selectable below them. A designer may also pick any of these "
               "directly.",
               type="model_list", capability="chat",
               impact=("Playground model dropdown", "Create Agent form", "Workflow builder",
                       "New-workflow agent form", "Approved-models rule"),
               used_in=(
                   "routes/settings.py — /settings/public (choices)",
                   "routes/workflows.py — builder catalog models",
                   "config.py — resolve_agent_model",
                   "frontend lib/models.ts — useModelConfig",
               )),
    SettingDef("CHAT_DEFAULT_MODEL", "models", "Chat default model",
               "Model used for a chat completion that names neither a model nor an agent, and "
               "the model the Playground opens on.",
               type="model", capability="chat",
               impact=("Playground default model", "Chat API without a model"),
               used_in=("services/chat_service.py — complete / stream",
                        "routes/chat.py — ChatCompletionRequest",
                        "frontend routes/playground.tsx — initial selection")),
    SettingDef("RAG_EXTRACTION_MODEL", "models", "RAG extraction model",
               "Reads each chunk of an uploaded document and extracts the entities and "
               "relations that become the knowledge graph. Called once per chunk, so it is the "
               "main cost of ingestion.",
               type="model", capability="chat",
               impact=("Library document ingestion", "Knowledge graph quality"),
               used_in=("rag/ingest.py — extract",)),

    # ── Catalog sync ───────────────────────────────────────────────────
    SettingDef("MODEL_CATALOG_REFRESH_HOURS", "catalog", "Automatic refresh interval",
               "How often the model list is re-read from Mistral in the background, after which "
               "every configured model is checked again. 0 turns automatic refresh off — the "
               "Refresh button always works.",
               type="float", minimum=0, maximum=720, unit="hours",
               impact=("Model dropdowns", "Model availability warnings"),
               used_in=("app_settings/catalog.py — refresh_loop",)),
    SettingDef("AUTO_UPGRADE_DEPRECATED_MODELS", "catalog", "Auto-upgrade deprecated models",
               "After a refresh, switch every configured model that Mistral has deprecated to "
               "the replacement model Mistral names — on the backend and the Tool Service. Off: "
               "you are warned and choose yourself.",
               type="bool",
               impact=("Every model setting on both services",),
               used_in=("app_settings/catalog.py — review",)),
    SettingDef("MISTRAL_API_BASE_URL", "catalog", "Mistral API base URL",
               "Where the model list is read from. Change only for a proxy or a regional "
               "endpoint.", type="string",
               impact=("Refresh from Mistral",), used_in=("app_settings/catalog.py — fetch",)),

    # ── Tool Service connection ────────────────────────────────────────
    SettingDef("TOOL_SERVICE_URL", "tool_connection", "Tool Service URL",
               "Base URL of the Tool Service container. Applied immediately: the backend's "
               "HTTP client is rebuilt on save.", type="string",
               impact=("Tool synthesis", "Tool execution in chats and workflows", "Tools page",
                       "MCP servers", "Tool Service settings on this page"),
               used_in=("services/tool_resolver.py — ToolResolver (retargeted on change)",
                        "services/workflow_engine/step_runners.py — tool steps",
                        "app_settings/tool_service.py — settings proxy")),
    SettingDef("TOOL_SERVICE_WAIT_SECONDS", "tool_connection", "Wait while unreachable",
               "How long a call keeps retrying while the Tool Service refuses connections — a "
               "container restart takes 15-30 s, and a workflow step that fails on the first "
               "refusal fails the whole run.",
               type="float", minimum=0, maximum=900, unit="seconds",
               impact=("Workflow runs during a Tool Service restart", "Tool calls"),
               used_in=("services/tool_resolver.py — _send",)),

    # ── Orchestration ──────────────────────────────────────────────────
    SettingDef("DECISION_CONCURRENCY", "orchestration", "Decision concurrency",
               "Planning calls allowed in flight at once across the backend. Higher is faster "
               "on a generous quota; on a modest quota it causes rate-limit (429) storms.",
               type="int", minimum=1, maximum=32, unit="calls",
               impact=("Agent creation speed", "Workflow planning speed", "Rate-limit errors"),
               used_in=("core/decision.py — _concurrency_gate",)),
    SettingDef("DECISION_MAX_RETRIES", "orchestration", "Retries on rate limit",
               "Attempts per planning call when Mistral answers with a rate limit, before the "
               "step falls back to its default.",
               type="int", minimum=1, maximum=20, unit="attempts",
               impact=("Agent creation", "Workflow planning"),
               used_in=("core/decision.py — decide",)),
    SettingDef("DECISION_RETRY_BASE_SECONDS", "orchestration", "Retry back-off base",
               "First wait before retrying a rate-limited call; it doubles on each retry.",
               type="float", minimum=0.1, maximum=60, unit="seconds",
               impact=("Agent creation", "Workflow planning"),
               used_in=("core/decision.py — decide",)),
    SettingDef("WORKFLOW_DESIGN_CONCURRENCY", "orchestration", "Agent design concurrency",
               "Agents designed in parallel while planning a workflow.",
               type="int", minimum=1, maximum=32, unit="agents",
               impact=("Workflow planning speed",),
               used_in=("layers/workflow/design_layer.py — AgentDesignLayer",)),
    SettingDef("AGENT_CREATION_CONCURRENCY", "orchestration", "Agent creation concurrency",
               "Agents created on Mistral in parallel when a workflow plan is provisioned.",
               type="int", minimum=1, maximum=32, unit="agents",
               impact=("Workflow provisioning speed",),
               used_in=("layers/workflow/provisioning_layer.py",)),
    SettingDef("RULE_SELECTION_CONCURRENCY", "orchestration", "Rule selection concurrency",
               "Rule-selection calls in parallel while planning.",
               type="int", minimum=1, maximum=32, unit="calls",
               impact=("Workflow planning speed",), used_in=("layers/workflow/rule_layers.py",)),
    SettingDef("TOOL_SYNTHESIS_CONCURRENCY", "orchestration", "Tool synthesis concurrency",
               "Missing tools built in parallel while planning. Each one generates and sandboxes "
               "real code on the Tool Service.",
               type="int", minimum=1, maximum=16, unit="tools",
               impact=("Workflow planning speed", "Tool Service load"),
               used_in=("layers/workflow/tool_gap_layer.py",)),
    SettingDef("RUN_CONCURRENCY", "orchestration", "Background runs at once (per workspace)",
               "Agent designs, workflow plans, tool syntheses and rebuilds a workspace runs at "
               "the same time. More wait in line and start in the order they were asked for; "
               "each workspace has its own line.",
               type="int", minimum=1, maximum=32, unit="runs",
               impact=("Waiting time when many people build at once", "Rate-limit errors",
                       "Memory use"),
               used_in=("runs/manager.py — RunManager._slot",)),
    SettingDef("REUSE_MIN_CONFIDENCE", "orchestration", "Minimum reuse confidence",
               "Below this confidence (0-1) the planner designs a new agent instead of reusing "
               "an existing one. A wrong reuse is worse than one redundant agent.",
               type="float", minimum=0, maximum=1,
               impact=("Workflow planning — agent reuse",),
               used_in=("layers/workflow/reuse_layer.py",)),

    # ── Workflows ──────────────────────────────────────────────────────
    SettingDef("MISTRAL_WORKER_ENABLED", "workflows", "Run the workflows worker",
               "Start the Mistral Workflows worker subprocess together with the backend. Off: "
               "workflows cannot run on Mistral from this machine.",
               type="bool", apply="restart",
               impact=("Running workflows", "Workflow publishing"),
               used_in=("main.py — lifespan", "remote_servers/deployers.py")),
    SettingDef("DEPLOYMENT_NAME", "workflows", "Worker deployment name",
               "Deployment the local worker registers workflows under on Mistral.",
               type="string", apply="restart",
               impact=("Running workflows", "Remote deployments"),
               used_in=("services/mistral_worker.py", "routes/workflows.py",
                        "remote_servers/deployers.py", "layers/workflow/finalize_layers.py")),
    SettingDef("MISTRAL_WORKFLOWS_DIR", "workflows", "Compiled workflows directory",
               "Folder compiled workflow modules are written to and loaded from, relative to "
               "backend/.",
               type="string", apply="restart",
               impact=("Workflow publishing", "Running workflows"),
               used_in=("routes/workflows.py", "layers/workflow/finalize_layers.py",
                        "layers/workflow/plan_control.py", "services/mistral_worker.py")),
    SettingDef("WORKFLOW_REGISTRATION_WAIT", "workflows", "Registration wait",
               "How long publishing waits for the worker to register a new workflow before "
               "reporting it as pending.",
               type="float", minimum=0, maximum=600, unit="seconds",
               impact=("Workflow publishing",), used_in=("routes/workflows.py",)),
    SettingDef("WORKFLOW_MAX_VERSIONS", "workflows", "Versions kept per workflow",
               "Revisions kept in each workflow's version history; older ones are pruned.",
               type="int", minimum=1, maximum=1000, unit="versions",
               impact=("Workflow version history (Refine)",),
               used_in=("workflow_revisions/store.py",)),

    # ── RAG ────────────────────────────────────────────────────────────
    SettingDef("RAG_CHUNK_CHARS", "rag", "Chunk size",
               "Characters per extraction chunk. Larger chunks mean fewer model calls but less "
               "precise entities.", type="int", minimum=1000, maximum=100000, unit="characters",
               impact=("Document ingestion cost", "Knowledge graph quality"),
               used_in=("rag/ingest.py",)),
    SettingDef("RAG_CHUNK_OVERLAP", "rag", "Chunk overlap",
               "Characters repeated between neighbouring chunks so facts on a boundary are not "
               "lost.", type="int", minimum=0, maximum=20000, unit="characters",
               impact=("Knowledge graph quality",), used_in=("rag/ingest.py",)),
    SettingDef("RAG_MAX_CHUNKS_PER_DOC", "rag", "Max chunks per document",
               "Hard ceiling on extraction calls per document, so one huge PDF cannot spend "
               "hundreds of calls.", type="int", minimum=1, maximum=1000, unit="chunks",
               impact=("Document ingestion cost",), used_in=("rag/ingest.py",)),
    SettingDef("RAG_EXTRACTION_CONCURRENCY", "rag", "Extraction concurrency",
               "Chunks extracted in parallel.", type="int", minimum=1, maximum=32, unit="chunks",
               impact=("Document ingestion speed",), used_in=("rag/ingest.py",)),
    SettingDef("RAG_TEXT_POLL_SECONDS", "rag", "Text poll interval",
               "How often the text Mistral extracts from an uploaded document is checked for.",
               type="int", minimum=1, maximum=120, unit="seconds",
               impact=("Document ingestion", "Workflow document inputs"),
               used_in=("rag/ingest.py", "workflow_inputs/documents.py")),
    SettingDef("RAG_TEXT_POLL_ATTEMPTS", "rag", "Text poll attempts",
               "Checks before a document is reported as failed to extract.",
               type="int", minimum=1, maximum=1000, unit="attempts",
               impact=("Document ingestion", "Workflow document inputs"),
               used_in=("rag/ingest.py", "workflow_inputs/documents.py")),
    SettingDef("NEO4J_URI", "rag", "Neo4j URI",
               "Bolt URI of the knowledge graph. Applied immediately: the driver reconnects on "
               "save.", type="string",
               impact=("Knowledge graph", "Domain knowledge search", "Ontology page"),
               used_in=("rag/graph_store.py — _get_driver (reset on change)",)),
    SettingDef("NEO4J_USER", "rag", "Neo4j user",
               "User the backend signs in to Neo4j as. Applied immediately.", type="string",
               impact=("Knowledge graph",), used_in=("rag/graph_store.py",)),
    SettingDef("NEO4J_PASSWORD", "rag", "Neo4j password",
               "Kept in backend/.env only, never sent to the browser.",
               type="secret", apply="restart", editable=False,
               impact=("Knowledge graph",), used_in=("rag/graph_store.py",)),
    SettingDef("NEO4J_DATABASE", "rag", "Neo4j database",
               "Database inside Neo4j that holds the graph. Applied immediately.", type="string",
               impact=("Knowledge graph",), used_in=("rag/graph_store.py",)),

    # ── Observability ──────────────────────────────────────────────────
    SettingDef("OBSERVABILITY_ENABLED", "observability", "Export traces",
               "Send a trace of every API action, workflow run, tool call and model call to "
               "Mistral Observability.", type="bool", apply="restart",
               impact=("Logs page",), used_in=("observability/tracing.py — setup",)),
    SettingDef("OBSERVABILITY_SERVICE_NAME", "observability", "Service name",
               "Name traces are filed under; the Logs page filters by it.",
               type="string", apply="restart", impact=("Logs page",),
               used_in=("observability/tracing.py", "routes/observability.py")),
    SettingDef("OBSERVABILITY_ENVIRONMENT", "observability", "Environment",
               "Environment tag on every trace (development, staging, production).",
               type="string", apply="restart", impact=("Logs page",),
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_ENDPOINT", "observability", "OTLP endpoint",
               "Where traces are sent. Empty: Mistral's telemetry endpoint.",
               type="string", apply="restart", impact=("Logs page",),
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_REDACT", "observability", "Redact secrets & PII",
               "Mask secrets and personal data in traces before they leave the process.",
               type="bool", apply="restart", impact=("Logs page", "Data protection"),
               used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_MAX_ATTR_CHARS", "observability", "Max attribute size",
               "Inputs and outputs longer than this are clipped in traces.",
               type="int", minimum=1000, maximum=1000000, unit="characters",
               impact=("Logs page detail",), used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_MAX_LOG_LINES", "observability", "Max log lines per span",
               "Log lines captured on each span.",
               type="int", minimum=10, maximum=10000, unit="lines",
               impact=("Logs page detail",), used_in=("observability/tracing.py",)),
    SettingDef("OBSERVABILITY_CONSOLE_URL", "observability", "Console URL",
               "Where the 'Open in Mistral' links on the Logs page point.", type="string",
               impact=("Logs page links",), used_in=("routes/observability.py",)),

    # ── Platform ───────────────────────────────────────────────────────
    SettingDef("MISTRAL_API_KEY", "platform", "Mistral API key",
               "Kept in backend/.env only, never sent to the browser.",
               type="secret", apply="restart", editable=False,
               impact=("Everything that calls Mistral",),
               used_in=("dependencies.py", "services/mistral_worker.py", "app_settings/catalog.py")),
    SettingDef("DATABASE_URL", "platform", "Database URL",
               "The backend's own database. Set in backend/.env.",
               type="string", apply="restart", editable=False,
               impact=("All stored data",),
               used_in=("database.py", "services/workflow_engine/engine.py")),
    SettingDef("SQL_TOOLS_DATABASE_URL", "platform", "SQL tools database URL",
               "Database the SQL tools (execute_sql_query, get_database_schema) query. Empty: "
               "the backend's own database.",
               type="string", apply="restart", impact=("SQL tools in agents and workflows",),
               used_in=("services/tool_registry.py",)),
    SettingDef("CORS_ORIGINS", "platform", "CORS origins",
               "Comma-separated origins allowed to call the API from a browser.",
               type="string", apply="restart", impact=("Frontend access",), used_in=("main.py",)),
    SettingDef("API_PREFIX", "platform", "API prefix",
               "Path prefix of every API route. The frontend expects /api.",
               type="string", apply="restart", editable=False, impact=("Frontend access",),
               used_in=("main.py",)),
    SettingDef("UPLOAD_MAX_MB", "platform", "Max upload size",
               "Largest file accepted by the upload endpoint (chat attachments, documents).",
               type="int", minimum=1, maximum=500, unit="MB",
               impact=("Chat attachments", "Document uploads"), used_in=("routes/uploads.py",)),

    # ── Process knowledge ──────────────────────────────────────────────
    SettingDef("PROCESS_KNOWLEDGE_DEFAULT", "process_knowledge", "On by default",
               "Whether the Process knowledge toggle starts on for a new visitor to the agent and "
               "workflow orchestration pages. Each page then remembers its own choice.",
               type="bool", impact=("Orchestrator", "Workflow planner"),
               used_in=("routes/processes.py — config",)),
    SettingDef("PROCESS_DOC_MAX_KB", "process_knowledge", "Max process document size",
               "Largest process document accepted on the Processes page and the orchestration "
               "pages.", type="int", minimum=16, maximum=10240, unit="KB",
               impact=("Process uploads",), used_in=("process_knowledge/validation.py",)),
    SettingDef("PROCESS_MATCH_MIN_SCORE", "process_knowledge", "Minimum match score",
               "When no document is attached, how well a process must match the request before "
               "it is used. Higher: fewer, surer matches. The Ontology → Scope tab shows the "
               "scores for any goal.", type="float", minimum=0, maximum=50,
               impact=("Process matching",), used_in=("process_knowledge/resolver.py",)),

    # ── Build guidance ─────────────────────────────────────────────────
    SettingDef("GUIDANCE_DEFAULT_MODE", "guidance", "Use guidance",
               "Auto: every build follows the active guidance in its scope. Off: only a build "
               "that asks for guidance gets it.", type="enum", options=("auto", "off"),
               option_labels=(("auto", "Auto — whenever guidance is in scope"),
                              ("off", "Off — only when a build asks")),
               impact=("Agent creation", "Workflow planning", "Refine with AI"),
               used_in=("layers/knowledge_context_layer.py — resolve_guidance",
                        "routes/knowledge.py — config")),
    SettingDef("GUIDANCE_PACK_SIZE", "guidance", "Guidance per build",
               "How many of the best-ranked guidance items one build takes into account. Each "
               "decision then sees only the ones for its kind of decision.",
               type="int", minimum=1, maximum=200, unit="items",
               impact=("Agent creation", "Workflow planning"),
               used_in=("layers/knowledge_context_layer.py — resolve_guidance",
                        "routes/knowledge.py — retrieve")),
    SettingDef("GUIDANCE_VIEW_SIZE", "guidance", "Guidance per decision",
               "The most guidance items shown to any one decision (agent design, instructions, "
               "rules, topology…). More is more context per call, and more to follow.",
               type="int", minimum=1, maximum=30, unit="items",
               impact=("Agent creation", "Workflow planning"),
               used_in=("knowledge/pipeline.py — block", "routes/knowledge.py — retrieve")),
    SettingDef("GUIDANCE_VIEW_MIN", "guidance", "Places kept for every kind of decision",
               "After the best items are taken, each kind of decision that has fewer than this "
               "many gets the next-best items for it, so common guidance cannot crowd rarer "
               "guidance out (for example naming or data handling). 0 turns this off. Never "
               "more than 'Guidance per decision'.",
               type="int", minimum=0, maximum=30, unit="items",
               impact=("Agent creation", "Workflow planning"),
               used_in=("knowledge/retrieval.py — select (view_min)",
                        "layers/knowledge_context_layer.py — view_min")),
    SettingDef("GUIDANCE_AUTO_APPROVE", "guidance", "Auto-approve distilled guidance",
               "Off: guidance distilled from a source waits for review on the Knowledge page. "
               "On: high-confidence items go live at once.", type="bool",
               impact=("Knowledge sources",), used_in=("knowledge/ingest.py",)),
    SettingDef("KNOWLEDGE_SOURCE_MAX_MB", "guidance", "Max guidance source size",
               "Largest file accepted as a guidance or reference source on the Knowledge page.",
               type="int", minimum=1, maximum=500, unit="MB",
               impact=("Knowledge sources",), used_in=("routes/knowledge.py — add_source",)),
    SettingDef("KNOWLEDGE_DISTILL_MODEL", "guidance", "Distillation model",
               "The model that turns a source document into guidance and reference items.",
               type="model", capability="chat", impact=("Knowledge sources",),
               used_in=("knowledge/distill.py",)),
    SettingDef("KNOWLEDGE_OCR_MODEL", "guidance", "Document reading (OCR) model",
               "Reads PDFs and images added as knowledge sources.", type="model",
               capability="ocr", impact=("Knowledge sources",), used_in=("knowledge/extract.py",)),
    SettingDef("KNOWLEDGE_EMBED_MODEL", "guidance", "Embedding model",
               "Turns guidance, requests and processes into vectors so guidance can be matched "
               "by meaning, not only by shared words. Changing it needs items to be re-embedded.",
               type="model", impact=("Agent creation", "Workflow planning", "Knowledge sources"),
               used_in=("knowledge/embed.py",)),

    # ── Guidance ranking with process knowledge ────────────────────────
    SettingDef("GUIDANCE_PROCESS_RANKING", "guidance_ranking", "Rank against the process",
               "When a build has a process document, also match guidance to its stages, "
               "controls, risks, regulations and data — not only to the request. Finds guidance "
               "the request never mentions (KYC screening for 'vendor onboarding'). One extra "
               "embedding call per build.", type="bool",
               impact=("Agent creation", "Workflow planning", "Refine with AI"),
               used_in=("layers/knowledge_context_layer.py — resolve_guidance",
                        "process/context.py — query_text")),
    SettingDef("GUIDANCE_STAGE_RANKING", "guidance_ranking", "Rank per stage for workflow agents",
               "Re-rank the guidance each workflow agent sees for the process stage it "
               "performs, so the payment agent gets payment guidance and the intake agent "
               "intake guidance. Applies to agent design and agent rule choice.", type="bool",
               impact=("Workflow planning",),
               used_in=("knowledge/retrieval.py — render(focus)",
                        "layers/workflow/design_layer.py", "layers/workflow/rule_layers.py")),
    SettingDef("GUIDANCE_PROCESS_REQUIREMENTS", "guidance_ranking",
               "Task facts from the process (workflows)",
               "Workflow builds have no request analysis, so guidance that applies only to "
               "complex or conversational work could not be checked. On: the process "
               "document's number of steps and interaction style stand in for it.",
               type="bool", impact=("Workflow planning", "Refine with AI"),
               used_in=("layers/knowledge_context_layer.py — derived_requirements",
                        "process/context.py — derived_requirements")),
    SettingDef("GUIDANCE_GOAL_WEIGHT", "guidance_ranking", "Weight: meaning of the request",
               "How much matching the request's meaning counts. Keep it the largest weight so "
               "the request leads.", type="float", minimum=0, maximum=50,
               impact=("Guidance ranking",), used_in=("knowledge/retrieval.py — select",)),
    SettingDef("GUIDANCE_PROCESS_WEIGHT", "guidance_ranking", "Weight: meaning of the process",
               "How much matching the process document's meaning counts.", type="float",
               minimum=0, maximum=50, impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — select",)),
    SettingDef("GUIDANCE_PROCESS_WORD_WEIGHT", "guidance_ranking",
               "Weight: each word shared with the process",
               "Added for every word a guidance item shares with the process but not with the "
               "request.", type="float", minimum=0, maximum=10, impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — select",)),
    SettingDef("GUIDANCE_PROCESS_WORDS_MAX", "guidance_ranking", "Most process words counted",
               "Cap on the shared process words counted per item, so a long document cannot "
               "outweigh the request.", type="int", minimum=0, maximum=50, unit="words",
               impact=("Guidance ranking",), used_in=("knowledge/retrieval.py — select",)),
    SettingDef("GUIDANCE_STAGE_WEIGHT", "guidance_ranking", "Weight: meaning of the agent's stage",
               "How much matching the stage's meaning counts when a workflow agent's guidance is "
               "re-ranked.", type="float", minimum=0, maximum=50, impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — rank_for_stage",)),
    SettingDef("GUIDANCE_STAGE_WORD_WEIGHT", "guidance_ranking",
               "Weight: each word shared with the stage",
               "Added for every word an item shares with the agent's stage.", type="float",
               minimum=0, maximum=10, impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — rank_for_stage",)),
    SettingDef("GUIDANCE_STAGE_WORDS_MAX", "guidance_ranking", "Most stage words counted",
               "Cap on the shared stage words counted per item.", type="int", minimum=0,
               maximum=50, unit="words", impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — rank_for_stage",)),
    SettingDef("GUIDANCE_CONDITION_BOOST", "guidance_ranking", "Bonus: conditions confirmed",
               "Added to an item whose conditions (risk level, data kind, complexity…) were all "
               "checked against the build and hold — it is clearly about this build.",
               type="float", minimum=0, maximum=50, impact=("Guidance ranking",),
               used_in=("knowledge/retrieval.py — select",)),

    # ── Vault ──────────────────────────────────────────────────────────
    SettingDef("VAULT_ENABLED", "vault", "Vault on",
               "Off: nothing is read from or offered from the vault — tools fall back to the "
               "Tool Service's environment, and builds ask for nothing to be stored. Stored "
               "entries are kept.", type="bool",
               impact=("Tool & activity execution", "Build prerequisites", "Connector credentials"),
               used_in=("vault/store.py — enabled, resolve",
                        "services/tool_resolver.py — execute_tool")),
    SettingDef("VAULT_ALLOW_REVEAL", "vault", "Allow revealing sensitive values",
               "Off (recommended): a sensitive value can be replaced but never shown again. "
               "On: the eye button shows it, and every reveal is written to the audit log. "
               "Non-sensitive values (URLs, regions) are always shown.", type="bool",
               impact=("Settings → Vault",), used_in=("vault/store.py — reveal",)),
    SettingDef("VAULT_ENV_FALLBACK", "vault", "Fall back to the Tool Service environment",
               "When a name is not in the vault, the Tool Service may still supply it from its "
               "own environment (listed in its SECRETS_ALLOWLIST). Off: only the vault supplies "
               "credentials, so every one is visible and audited here.", type="bool",
               impact=("Tool & activity execution", "Run prerequisites"),
               used_in=("services/tool_resolver.py — execute_tool",
                        "services/workflow_engine/prerequisites.py — secret checks")),
    SettingDef("VAULT_REDACT_RESULTS", "vault", "Mask vault values in results",
               "Replace any stored value that appears in a tool's result with [vault:NAME] "
               "before the result reaches an agent, a run log or a trace.", type="bool",
               impact=("Tool results", "Run logs", "Traces"),
               used_in=("services/tool_resolver.py — execute_tool", "vault/redact.py")),
    SettingDef("VAULT_AUDIT_USE", "vault", "Audit every use",
               "Write an audit event each time code receives a value. Off: only the use count "
               "and last-used time are kept; changes, reveals and refusals are always audited.",
               type="bool", impact=("Settings → Vault → Audit",),
               used_in=("vault/store.py — resolve",)),
    SettingDef("VAULT_AUDIT_RETENTION_DAYS", "vault", "Keep audit events for",
               "Older events are removed at start-up. 0 keeps them forever.", type="int",
               minimum=0, maximum=3650, unit="days", apply="restart",
               impact=("Settings → Vault → Audit",), used_in=("vault/store.py — purge_audit",)),
    SettingDef("VAULT_VERSION_HISTORY", "vault", "Previous values kept",
               "How many earlier values of each entry are kept (encrypted) so a bad change can "
               "be rolled back. 0 keeps none.", type="int", minimum=0, maximum=50,
               impact=("Settings → Vault → History",), used_in=("vault/store.py — set_value",)),
    SettingDef("VAULT_DEFAULT_EXPIRY_DAYS", "vault", "Default expiry for new entries",
               "A new entry with no expiry date of its own expires after this many days, and "
               "code stops receiving it. 0: entries do not expire unless you set a date.",
               type="int", minimum=0, maximum=3650, unit="days",
               impact=("Settings → Vault", "Build prerequisites"),
               used_in=("vault/store.py — create_secret",)),
    SettingDef("VAULT_ROTATION_REMINDER_DAYS", "vault", "Rotation reminder",
               "Flag an entry whose value has not changed in this many days. A reminder only — "
               "the value keeps working. 0 turns the reminder off.", type="int", minimum=0,
               maximum=3650, unit="days", impact=("Settings → Vault",),
               used_in=("vault/store.py — _status",)),

    # ── Build prerequisites ────────────────────────────────────────────
    SettingDef("PREREQ_CHECK_ENABLED", "build_prereqs", "Check prerequisites before building",
               "Before building an agent or workflow, work out which credentials, service URLs "
               "and facts it needs, match them against the vault, and ask you for what is "
               "missing. Off: builds start at once, as before.", type="bool",
               impact=("Agent creation (Orchestrator)", "Workflow planning (AI builder)"),
               used_in=("build_prereqs/layer.py — BuildPrerequisitesLayer",)),
    SettingDef("PREREQ_AUTO_USE_VAULT", "build_prereqs", "Use matching vault entries automatically",
               "A requirement whose vault entry is certain (same name, or the only entry for "
               "that service and kind) is used without asking. Off: you confirm every one.",
               type="bool", impact=("Build prerequisites",),
               used_in=("build_prereqs/resolve.py — auto_resolve",)),
    SettingDef("PREREQ_ASK_WHEN_SATISFIED", "build_prereqs", "Ask even when everything is satisfied",
               "Show the prerequisite list for confirmation even when the vault already covers "
               "all of it. Off: the build continues and the list is shown in its timeline.",
               type="bool", impact=("Build prerequisites",),
               used_in=("build_prereqs/layer.py",)),
    SettingDef("PREREQ_ASK_FOR_INFORMATION", "build_prereqs", "Ask for facts, not only credentials",
               "Also ask for information the build cannot know — a tax rate, an approval "
               "threshold, a recipient address. Off: only credentials and service URLs are "
               "asked for; the build assumes the rest.", type="bool",
               impact=("Build prerequisites",), used_in=("build_prereqs/analysis.py",)),
    SettingDef("PREREQ_UNATTENDED_POLICY", "build_prereqs", "When nobody can be asked",
               "A build started without a live page (the plain streaming endpoints, API "
               "clients) cannot ask. Proceed: build anyway — code that needs a missing "
               "credential reports a configuration error until it is added to the vault. "
               "Stop: refuse to build and return the prerequisite list.",
               type="enum", options=("proceed", "stop"),
               option_labels=(("proceed", "Proceed without what is missing"),
                              ("stop", "Stop and report what is missing")),
               impact=("Agent creation (API)", "Workflow planning (API)"),
               used_in=("build_prereqs/layer.py",)),
    SettingDef("PREREQ_CODE_CHECK", "build_prereqs", "Check credentials again before building code",
               "After a tool's or activity's specification is written, check that every "
               "credential it names is available, and ask about any the first check missed — "
               "before the code is generated.", type="bool",
               impact=("Tool & activity synthesis",),
               used_in=("layers/codegen/layers.py — CredentialCheckLayer (R4b)",)),
    SettingDef("PREREQ_BLOCK_RUN_ON_MISSING", "build_prereqs", "Block runs with missing credentials",
               "A workflow whose activity needs a credential that neither the vault nor the "
               "Tool Service has is refused at start (its prerequisites show what to add). "
               "Off: it starts, and that step fails with a configuration error.", type="bool",
               impact=("Workflow runs", "Run prerequisites"),
               used_in=("services/workflow_engine/prerequisites.py",)),

    # ── Frontend: theme & design ───────────────────────────────────────
    SettingDef("UI_ACCENT", "ui_design", "Accent colour",
               "Brand colour for primary buttons, focus rings, active navigation, links and "
               "highlights.", type="enum", default="ember",
               options=("ember", "indigo", "violet", "blue", "cyan", "emerald", "amber", "rose"),
               option_labels=(("ember", "Ember (default)"), ("indigo", "Indigo"),
                              ("violet", "Violet"), ("blue", "Blue"), ("cyan", "Cyan"),
                              ("emerald", "Emerald"), ("amber", "Amber"), ("rose", "Rose")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
    SettingDef("UI_COLOR_MODE", "ui_design", "Day / night mode",
               "What every page shows to someone who has not picked a mode with the sun/moon "
               "toggle in the sidebar (or Shift+Alt+L). A person's own choice is kept in their "
               "browser and always wins. Match system follows the device's light or dark setting.",
               type="enum", default="dark", options=("dark", "light", "system"),
               option_labels=(("dark", "Night (default)"), ("light", "Day"),
                              ("system", "Match the device")),
               impact=("Whole interface",),
               used_in=(_APPLIER, "frontend lib/theme.ts", "frontend components/layout/ThemeToggle.tsx")),
    SettingDef("UI_SURFACE_TONE", "ui_design", "Surface tone",
               "Tint of backgrounds, panels and the sidebar.", type="enum", default="neutral",
               options=("neutral", "warm", "cool", "midnight"),
               option_labels=(("neutral", "Neutral (default)"), ("warm", "Warm"),
                              ("cool", "Cool"), ("midnight", "Midnight blue")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
    SettingDef("UI_RADIUS", "ui_design", "Corner radius",
               "Roundness of cards, buttons, inputs and dialogs.", type="enum", default="default",
               options=("sharp", "default", "rounded", "extra"),
               option_labels=(("sharp", "Sharp — 4 px"), ("default", "Default — 8 px"),
                              ("rounded", "Rounded — 12 px"), ("extra", "Extra round — 16 px")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
    SettingDef("UI_FONT_BODY", "ui_design", "Interface font",
               "Typeface for body text, labels and controls.", type="enum", default="rubik",
               options=("rubik", "inter", "ibm-plex-sans", "dm-sans", "system"),
               option_labels=(("rubik", "Rubik (default)"), ("inter", "Inter"),
                              ("ibm-plex-sans", "IBM Plex Sans"), ("dm-sans", "DM Sans"),
                              ("system", "System UI")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
    SettingDef("UI_FONT_DISPLAY", "ui_design", "Heading & code font",
               "Typeface for headings, numbers and code.", type="enum", default="space-mono",
               options=("space-mono", "jetbrains-mono", "ibm-plex-mono", "body"),
               option_labels=(("space-mono", "Space Mono (default)"),
                              ("jetbrains-mono", "JetBrains Mono"),
                              ("ibm-plex-mono", "IBM Plex Mono"),
                              ("body", "Same as interface font")),
               impact=("Headings", "Code blocks", "Stat tiles"), used_in=(_APPLIER,)),
    SettingDef("UI_TEXT_SCALE", "ui_design", "Text size & density",
               "Scales text and spacing of the whole interface together.", type="enum",
               default="default", options=("compact", "default", "comfortable", "large"),
               option_labels=(("compact", "Compact — 94%"), ("default", "Default — 100%"),
                              ("comfortable", "Comfortable — 106%"), ("large", "Large — 112%")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
    SettingDef("UI_BACKGROUND_EFFECTS", "ui_design", "Background effects",
               "The soft glow and grid behind every page. Off gives a plain background.",
               type="bool", default=True,
               impact=("Page background",), used_in=("frontend routes/__root.tsx",)),

    # ── Frontend: layout & branding ────────────────────────────────────
    SettingDef("UI_BRAND_TITLE", "ui_layout", "Product name",
               "First line of the sidebar header.", type="string", default="Agentic AI",
               impact=("Sidebar",), used_in=("frontend components/layout/Sidebar.tsx",)),
    SettingDef("UI_BRAND_SUBTITLE", "ui_layout", "Product subtitle",
               "Second line of the sidebar header.", type="string", default="Design Patterns",
               impact=("Sidebar",), used_in=("frontend components/layout/Sidebar.tsx",)),
    SettingDef("UI_DOCUMENT_TITLE", "ui_layout", "Browser tab title",
               "Name shown after the page name in the browser tab.", type="string",
               default="Agentic AI Design Patterns",
               impact=("Browser tab titles",), used_in=(_APPLIER,)),
    SettingDef("UI_SIDEBAR_COLLAPSED", "ui_layout", "Start with sidebar collapsed",
               "Whether the navigation opens as an icon rail or fully expanded.", type="bool",
               default=True, impact=("Sidebar",), used_in=("frontend routes/__root.tsx",)),
    SettingDef("UI_NAV_LAYOUT", "ui_layout", "Navigation menu",
               "Order of the sidebar's pages, which are shown, and what each feature is called. "
               "Drag to reorder; switch a page off to hide it from the sidebar — it still opens "
               "from a link; the pencil renames a feature's sidebar label, page title, page "
               "description and browser tab name. Empty: the built-in menu and texts.",
               type="json", default="",
               impact=("Sidebar", "Page titles", "Browser tab titles"),
               used_in=("frontend components/layout/nav-items.ts",
                        "frontend components/layout/FeatureText.tsx")),
    SettingDef("UI_TOAST_POSITION", "ui_layout", "Notification position",
               "Where success and error notifications appear.", type="enum",
               default="top-right",
               options=("top-right", "top-center", "top-left", "bottom-right", "bottom-center",
                        "bottom-left"),
               option_labels=(("top-right", "Top right (default)"), ("top-center", "Top centre"),
                              ("top-left", "Top left"), ("bottom-right", "Bottom right"),
                              ("bottom-center", "Bottom centre"), ("bottom-left", "Bottom left")),
               impact=("Notifications",), used_in=("frontend routes/__root.tsx",)),

    # ── Frontend: behaviour ────────────────────────────────────────────
    SettingDef("UI_API_TIMEOUT_SECONDS", "ui_behavior", "API request timeout",
               "How long the browser waits for one API call. Planning and tool synthesis are "
               "slow, so keep this generous.", type="int", default=420, minimum=10,
               maximum=3600, unit="seconds",
               impact=("Every page",), used_in=("frontend api/client.ts",)),
    SettingDef("UI_HEALTH_POLL_SECONDS", "ui_behavior", "Status indicator refresh",
               "How often the sidebar's system status indicator checks the backend.",
               type="int", default=30, minimum=5, maximum=3600, unit="seconds",
               impact=("Sidebar status indicator",),
               used_in=("frontend components/layout/HealthIndicator.tsx",)),
    SettingDef("UI_HEALTH_PAGE_POLL_SECONDS", "ui_behavior", "Health page refresh",
               "How often the Health page refreshes service status.",
               type="int", default=15, minimum=5, maximum=3600, unit="seconds",
               impact=("Health page",), used_in=("frontend routes/health.tsx",)),
]

_ROUTE_JOBS = {
    "need_normalise": ("Need normalisation (R1)",
                       "Turns a free-text request into a structured need.",
                       "layers/codegen/layers.py — need normalisation (R1)"),
    "policy_gate": ("Policy gate (R2)",
                    "Screens a tool or activity request against the tool safety rules switched "
                    "on for it (Settings → Tool safety). Not called when none are on.",
                    "layers/codegen/layers.py — policy screen (R2)"),
    "reuse_resolution": ("Reuse resolution (R3)",
                         "Decides whether an existing tool or activity already does the job.",
                         "layers/codegen/layers.py — reuse resolution (R3)"),
    "spec_author": ("Specification author (R4)",
                    "Writes the specification the code is generated and tested against.",
                    "layers/codegen/layers.py — specification authoring (R4)"),
    "capability_gap": ("Capability gap (chat)",
                       "Decides in the Orchestrator chat whether a missing capability needs a "
                       "new tool.",
                       "layers/agent/capability_gap_layer.py"),
    "spec_revision": ("Rebuild specification revision",
                      "When a tool or activity is rebuilt from an error, revises its "
                      "specification so the new version does exactly what you asked.",
                      "layers/codegen/feedback.py — rebuild-from-error"),
    "input_schema": ("Workflow input schema",
                     "Designs a workflow's run inputs — fields, types, nested shapes — and one "
                     "realistic, consistent example to fill the run form with.",
                     "layers/workflow/input_schema_layer.py"),
    "workflow_revision": ("Refine with AI",
                          "Turns an instruction into edits of a saved workflow, and repairs "
                          "edits that would leave it invalid.",
                          "layers/revision/intent_layer.py, layers/revision/repair_layer.py"),
    "prerequisite_analysis": ("Build prerequisites",
                              "Works out, before an agent or workflow is built, which "
                              "credentials, service URLs and facts it needs from you.",
                              "build_prereqs/analysis.py"),
}


def _route_defs() -> list[SettingDef]:
    """Four rows per route in app/llm_routes.py; defaults are the code's routes."""
    from app.llm_routes import _ROUTES

    defs = []
    for role, route in _ROUTES.items():
        prefix = f"ROUTE_{role.upper()}"
        title, job, where = _ROUTE_JOBS.get(
            role, (role.replace("_", " ").capitalize(), f"Route '{role}'.", f"Route '{role}'"))
        used = (where, "core/decision.py — decide(route=…)", "llm_routes.py — route_for")
        impact = (("Tool & activity synthesis", "Orchestrator chat") if role == "capability_gap"
                  else ("Agent creation", "Workflow planning") if role == "prerequisite_analysis"
                  else ("Workflow planning", "Workflow run form") if role == "input_schema"
                  else ("Refine with AI",) if role == "workflow_revision"
                  else ("Tool & activity synthesis (code pipeline)",))
        defs += [
            SettingDef(f"{prefix}_MODEL", "model_routes", "Model", job, type="model",
                       default=route.model, capability="chat", group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_EFFORT", "model_routes", "Reasoning effort",
                       "High thinks before answering (slower, better); None answers directly; "
                       "Omit leaves it to the model.", type="enum",
                       options=("high", "medium", "low", "none", "omit"),
                       option_labels=_EFFORT_LABELS,
                       default=route.reasoning_effort or "omit", group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_TIMEOUT_MS", "model_routes", "Timeout",
                       "Longest one call may take.", type="int", unit="ms",
                       minimum=5000, maximum=1_800_000, default=route.timeout_ms, group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_FALLBACK", "model_routes", "Fallback model",
                       "Tried once when the primary model fails; 'none' disables.",
                       type="model", default=route.fallback_model or "none", allow_none=True,
                       capability="chat", group=title, impact=impact, used_in=used),
        ]
    return defs


#: Numeric settings: (at the minimum, at the maximum) — one short sentence each,
#: shown under the control with the default, minimum and maximum. Every int and
#: float setting must have an entry (tests/test_app_settings.py).
EFFECTS: dict[str, tuple[str, str]] = {
    "MODEL_CATALOG_REFRESH_HOURS": (
        "0 turns automatic refresh off; the model list only updates when you press Refresh.",
        "The list is re-read only once a month; new or deprecated models are noticed late."),
    "TOOL_SERVICE_WAIT_SECONDS": (
        "0 fails at once when the Tool Service is restarting — runs fail during a rebuild.",
        "A call can hang up to 15 minutes when the Tool Service is really down."),
    "DECISION_CONCURRENCY": (
        "One planning call at a time — slow builds, but never rate limited.",
        "Many calls at once — fastest, but a modest quota will hit rate limits."),
    "DECISION_MAX_RETRIES": (
        "A rate-limited call is not retried; the step falls back to its default at once.",
        "Keeps retrying for a long time before giving up — builds stay slow under limits."),
    "DECISION_RETRY_BASE_SECONDS": (
        "Retries almost immediately and may be rate limited again.",
        "Waits a minute or more between retries — builds stall under rate limits."),
    "WORKFLOW_DESIGN_CONCURRENCY": (
        "Agents of a workflow are designed one by one — slowest planning.",
        "All agents designed at once — fastest, but heavy on the rate limit."),
    "AGENT_CREATION_CONCURRENCY": (
        "Agents are created on Mistral one by one.",
        "All agents created at once — may hit Mistral's rate limit."),
    "RULE_SELECTION_CONCURRENCY": (
        "Rules are chosen for one agent at a time.",
        "Rules chosen for all agents at once — may hit the rate limit."),
    "TOOL_SYNTHESIS_CONCURRENCY": (
        "Missing tools are built one at a time — long planning when several are needed.",
        "Many tools built at once — heavy load on the Tool Service and the model quota."),
    "RUN_CONCURRENCY": (
        "One build at a time per workspace — everyone else waits in line.",
        "Many builds at once — they compete for the same rate quota and run slower."),
    "REUSE_MIN_CONFIDENCE": (
        "Any existing agent that looks related is reused, even a poor fit.",
        "Existing agents are almost never reused; a new agent is designed every time."),
    "WORKFLOW_REGISTRATION_WAIT": (
        "Publishing reports 'pending' at once without waiting for the worker.",
        "Publishing can wait up to 10 minutes for the worker to register the workflow."),
    "WORKFLOW_MAX_VERSIONS": (
        "Only the current version is kept — nothing to roll back to.",
        "A long history is kept; the database grows with every save."),
    "RAG_CHUNK_CHARS": (
        "Small chunks: precise entities, but many more extraction calls per document.",
        "Huge chunks: few calls, but entities and relations are extracted less precisely."),
    "RAG_CHUNK_OVERLAP": (
        "No overlap — facts split across a chunk boundary can be lost.",
        "Large overlap — the same text is extracted again and again, wasting calls."),
    "RAG_MAX_CHUNKS_PER_DOC": (
        "Only the first chunk of each document is read.",
        "A very large document can spend up to 1,000 extraction calls."),
    "RAG_EXTRACTION_CONCURRENCY": (
        "Chunks are extracted one at a time — slow ingestion.",
        "Many chunks at once — fast, but likely to hit the rate limit."),
    "RAG_TEXT_POLL_SECONDS": (
        "Checks every second whether the document's text is ready — many requests.",
        "Checks only every 2 minutes — ingestion starts later than it could."),
    "RAG_TEXT_POLL_ATTEMPTS": (
        "Gives up after one check — slow documents are reported as failed.",
        "Keeps checking for a very long time before reporting a failure."),
    "OBSERVABILITY_MAX_ATTR_CHARS": (
        "Inputs and outputs in traces are clipped heavily — hard to debug.",
        "Full inputs and outputs are kept — traces become very large."),
    "OBSERVABILITY_MAX_LOG_LINES": (
        "Only a few log lines are kept per span.",
        "Very many log lines per span — large traces, slower Logs page."),
    "UPLOAD_MAX_MB": (
        "Only tiny files (1 MB) can be uploaded.",
        "Files up to 500 MB are accepted — uploads and processing get slow."),
    "PROCESS_DOC_MAX_KB": (
        "Only very short process documents are accepted.",
        "Process documents up to 10 MB are accepted — more prompt text per build."),
    "PROCESS_MATCH_MIN_SCORE": (
        "Any process that matches a single word may be used — wrong processes can be picked.",
        "Only near-exact matches are used — process knowledge is rarely found automatically."),
    "GUIDANCE_PACK_SIZE": (
        "Only the single best guidance item is considered per build.",
        "Up to 200 items considered — most decisions see more, weaker guidance."),
    "GUIDANCE_VIEW_SIZE": (
        "Each decision sees one guidance item — little context, easy to follow.",
        "Each decision sees up to 30 items — long prompts, harder to follow them all."),
    "GUIDANCE_VIEW_MIN": (
        "0: no places are kept — common guidance can push rarer kinds out entirely.",
        "Every kind of decision is topped up to its full share — larger, noisier packs."),
    "KNOWLEDGE_SOURCE_MAX_MB": (
        "Only tiny source files (1 MB) can be added on the Knowledge page.",
        "Sources up to 500 MB — distilling them takes many model calls."),
    "GUIDANCE_GOAL_WEIGHT": (
        "0: the meaning of the request is ignored when ranking guidance.",
        "The request's meaning outweighs everything else, process and stage included."),
    "GUIDANCE_PROCESS_WEIGHT": (
        "0: the process document's meaning is ignored when ranking guidance.",
        "The process can outrank the request — guidance may drift from what was asked."),
    "GUIDANCE_PROCESS_WORD_WEIGHT": (
        "0: words shared with the process do not count.",
        "Shared process words dominate — wordy items rank high whatever they say."),
    "GUIDANCE_PROCESS_WORDS_MAX": (
        "0: no process words are counted at all.",
        "Up to 50 shared words count — a long process document can drown the request."),
    "GUIDANCE_STAGE_WEIGHT": (
        "0: a stage's meaning does not change an agent's guidance order.",
        "The stage decides the order almost alone — the request barely matters."),
    "GUIDANCE_STAGE_WORD_WEIGHT": (
        "0: words shared with the agent's stage do not count.",
        "Shared stage words dominate the order of an agent's guidance."),
    "GUIDANCE_STAGE_WORDS_MAX": (
        "0: no stage words are counted.",
        "Up to 50 shared stage words count — long stages dominate the order."),
    "GUIDANCE_CONDITION_BOOST": (
        "0: confirmed conditions give no extra rank.",
        "Items whose conditions hold always come first, however unrelated otherwise."),
    "VAULT_AUDIT_RETENTION_DAYS": (
        "0 keeps audit events forever — the audit table only grows.",
        "Events are kept for up to 10 years."),
    "VAULT_VERSION_HISTORY": (
        "0 keeps no earlier values — a bad change cannot be rolled back.",
        "50 earlier values are kept per entry (encrypted)."),
    "VAULT_DEFAULT_EXPIRY_DAYS": (
        "0: new entries never expire.",
        "New entries expire after 10 years — effectively never."),
    "VAULT_ROTATION_REMINDER_DAYS": (
        "0 turns rotation reminders off.",
        "Reminds only after 10 years — effectively never."),
    "UI_API_TIMEOUT_SECONDS": (
        "The browser gives up after 10 s — planning and tool builds will appear to fail.",
        "Waits up to an hour for one call — a stuck request is noticed late."),
    "UI_HEALTH_POLL_SECONDS": (
        "Status checked every 5 s — current, but constant requests.",
        "Status checked hourly — the indicator can be badly out of date."),
    "UI_HEALTH_PAGE_POLL_SECONDS": (
        "Health page refreshes every 5 s.",
        "Health page refreshes hourly — reload it to see changes."),
}

#: Every model route's timeout (one per route) shares these.
ROUTE_TIMEOUT_EFFECT = (
    "5 s — a reasoning model rarely answers in time; calls fail or fall back.",
    "Up to 30 min per call — a hung call holds the build that long.")


def _with_effects(defs: list[SettingDef]) -> list[SettingDef]:
    from dataclasses import replace

    out = []
    for d in defs:
        effect = EFFECTS.get(d.key) or (
            ROUTE_TIMEOUT_EFFECT if d.key.startswith("ROUTE_") and d.key.endswith("_TIMEOUT_MS")
            else None)
        out.append(replace(d, low_effect=effect[0], high_effect=effect[1]) if effect else d)
    return out


def all_defs() -> list[SettingDef]:
    return _with_effects(DEFS + _route_defs())


#: Settings the frontend reads from /settings/public.
UI_KEYS = [d.key for d in DEFS if d.key.startswith("UI_")]
