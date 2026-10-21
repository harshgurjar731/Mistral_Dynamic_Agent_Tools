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
                   "ontology/classifier.py — domain classification",
                   "rag/optimizer.py — RAG query optimiser agent",
                   "rag/ontology_agent.py — ontology architect agent",
                   "services/conversational_workflow_service.py — conversational gateway",
               )),
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

    # ── Frontend: theme & design ───────────────────────────────────────
    SettingDef("UI_ACCENT", "ui_design", "Accent colour",
               "Brand colour for primary buttons, focus rings, active navigation, links and "
               "highlights.", type="enum", default="ember",
               options=("ember", "indigo", "violet", "blue", "cyan", "emerald", "amber", "rose"),
               option_labels=(("ember", "Ember (default)"), ("indigo", "Indigo"),
                              ("violet", "Violet"), ("blue", "Blue"), ("cyan", "Cyan"),
                              ("emerald", "Emerald"), ("amber", "Amber"), ("rose", "Rose")),
               impact=("Whole interface",), used_in=(_APPLIER,)),
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
                    "Screens the request against the tool-safety blocklist.",
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
                  else ("Tool & activity synthesis (code pipeline)",))
        defs += [
            SettingDef(f"{prefix}_MODEL", "model_routes", "Model", job, type="model",
                       default=route.model, capability="chat", group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_EFFORT", "model_routes", "Reasoning effort",
                       "High thinks before answering (slower, better); None answers directly; "
                       "Omit leaves it to the model.", type="enum",
                       options=("high", "none", "omit"), option_labels=_EFFORT_LABELS,
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


def all_defs() -> list[SettingDef]:
    return DEFS + _route_defs()


#: Settings the frontend reads from /settings/public.
UI_KEYS = [d.key for d in DEFS if d.key.startswith("UI_")]
