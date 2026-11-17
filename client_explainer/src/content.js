/* Content for the Composer explainer.
   kind: "m" = measured on the live Composer, "i" = indicative (an assumption, labelled on the page). */

const BANDS = [
  { id: "experience", n: "L1", name: "Experience", line: "Where business and delivery teams work: say the goal, shape the flow, chat, administer." },
  { id: "orchestrate", n: "L2", name: "Build & orchestrate", line: "The orchestration engine: layered pipelines that design, build, test and change agents and workflows." },
  { id: "assets", n: "L3", name: "Reusable assets", line: "Everything the engine produces is a governed, versioned asset the next build can reuse." },
  { id: "knowledge", n: "L4", name: "Knowledge & context", line: "Your processes, playbooks and documents ground every design decision and every answer." },
  { id: "govern", n: "L5", name: "Governance & trust", line: "Rules, guardrails, credentials and people in the loop, enforced at build time and at run time." },
  { id: "operate", n: "L6", name: "Run & observe", line: "Deploy, run, trace and monitor every agent and workflow in production." },
  { id: "foundation", n: "L7", name: "Mistral foundation", line: "Mistral models, Agents, Workflows, Libraries and Observability underneath it all." },
];

const C = {};
const comp = (o) => (C[o.id] = o);

/* ───────────────────────── L1 Experience ───────────────────────── */
comp({
  id: "orchestrator", band: "experience", code: "Or", name: "Orchestrator",
  pitch: "Describe a business need in one sentence and get a designed, governed and tested Mistral agent back, with every decision explained.",
  kpis: [
    { v: "6m 11s", l: "request to tested agent, including 24 s waiting for the user's answer", k: "m" },
    { v: "21", l: "decision layers run (20 completed, 1 skipped as not needed)", k: "m" },
    { v: "4", l: "always-on rules enforced at creation", k: "m" },
  ],
  biz: [
    "Turns intent into a working agent without a ticket queue: faster time to value for every business line.",
    "Every decision is shown with its reason, so risk, compliance and architecture teams can sign off on what was built.",
    "Each agent starts life governed: approved models, prompt-injection screening and instruction quality checks are in force from minute one.",
  ],
  tech: [
    "The agent pipeline runs 8 stages and 21 single-decision layers; each layer answers one question with its own prompt and writes a typed spec the next layers read.",
    "Tools, connectors, libraries, model and identity are decided by five layers running concurrently, then checked against each other for consistency.",
    "The new agent is created through the Mistral Agents API, tested on designed prompts by an LLM judge, and repaired (instructions revised, tools rebuilt) when it falls short.",
  ],
  shots: [["orchestrator", "The Orchestrator home: one box for the goal, process knowledge and guidance switches underneath."],
          ["agent_build_top", "A finished build reopened from history: every stage and layer with its timing."]],
  journey: "journey-agent",
  layers: [
    { t: "Understand the request", biz: "Clarifies what the business actually needs before spending anything.", tech: "Requirement analysis writes a structured brief (task type, domain, deliverable, success criteria, risks); prerequisites are asked for up front." },
    { t: "Build missing tools", biz: "If a capability is missing, the Composer builds it rather than stopping.", tech: "Capability-gap layer synthesises and tests a new tool in the Tool Service so tool selection can see it." },
    { t: "Ground, design, govern, author, verify", biz: "Design, controls and testing happen in one pass, not three teams.", tech: "Inventory + knowledge context + archetype, then 5 concurrent facet decisions, guardrails and rules, instructions, Agents API create, evaluation." },
  ],
  links: ["playground", "agents", "rules", "guardrails", "knowledge", "mistral"],
});

comp({
  id: "planner", band: "experience", code: "Pl", name: "Workflow planner",
  pitch: "Write the business process as a goal; the planner returns a deterministic, tested workflow registered on Mistral Workflows.",
  kpis: [
    { v: "26m 45s", l: "goal to a verified, registered 12-step workflow", k: "m" },
    { v: "26 / 26", l: "design layers completed, 0 failed, 0 rewinds", k: "m" },
    { v: "3 / 3", l: "self-designed test scenarios passing after 1 automatic repair", k: "m" },
    { v: "Days → minutes", l: "build effort compared with hand-building a governed 12-step flow (assumption: a delivery team needs days to specify, code, test and deploy it)", k: "i" },
  ],
  biz: [
    "Process owners describe the outcome in their own words; the Composer does the solution design, the coding and the testing.",
    "AI is used only where judgement is needed. Rules, calculations and routing become deterministic code, so runs are cheap, fast and auditable.",
    "Nothing ships unverified: the planner writes its own test pack, runs it, and repairs what fails before a person accepts it.",
  ],
  tech: [
    "Workflow pipeline: 10 stages, 26 layers, strictly sequential; concurrency lives inside layers (agent design, activity synthesis, provisioning).",
    "Output is a typed workflow definition (steps, conditions, transforms, data templates) compiled to a Mistral Workflows SDK module and registered with the worker.",
    "Every planning run is stored server-side with per-layer timings, decisions, model and tool calls, and can be reopened from history.",
  ],
  shots: [["workflow_new", "Three ways to build a workflow: describe the goal, build on a canvas, or copy a template."],
          ["workflow_new_ai", "Plan with AI: the goal box, with process knowledge and guidance switches."],
          ["plan_top", "The supplier invoice build reopened from history: goal, pipeline and 26 of 26 decisions."]],
  journey: "journey-workflow",
  layers: [],
  links: ["builder", "refine", "workflows", "activities", "verify", "runs"],
});

comp({
  id: "playground", band: "experience", code: "Pg", name: "Playground",
  pitch: "Chat with any agent or model and attach real business files: images, recordings, PDFs, Office documents.",
  kpis: [
    { v: "5", l: "files per message, each sent in the form the chosen model accepts", k: "m" },
    { v: "4", l: "file families handled: images, audio, PDF/Office documents, text", k: "m" },
  ],
  biz: [
    "Business users try an agent on their own documents before it goes into a process: faster, safer adoption.",
    "One place to compare models and agents side by side on the same task.",
  ],
  tech: [
    "Each attachment is routed by measured model support: native image/audio/document input where the model takes it, otherwise OCR text or a transcript, with one retry as text if a model refuses.",
    "Voxtral receives audio directly; other models get the recording's transcript, or a description when it has no speech.",
    "Chips under the input show how each file will be sent; sessions are kept per agent.",
  ],
  shots: [["playground", "Playground: model picker, settings and session history."],
          ["agent_detail", "Agent chat for the Invoice Review Summary Agent, with sessions, rules and configuration."]],
  layers: [
    { t: "File routing", biz: "Users never need to know which model reads which format.", tech: "Per-model capability table decides native file vs OCR text vs transcript." },
    { t: "Sessions", biz: "Conversations are kept for review and reuse.", tech: "Mistral Conversations API, listed per agent." },
  ],
  links: ["agents", "orchestrator", "mistral"],
});

comp({
  id: "builder", band: "experience", code: "Vb", name: "Visual builder",
  pitch: "A drag-and-drop canvas for the people who already know the shape of the process, with live validation and one-click publish.",
  kpis: [
    { v: "6", l: "step types on the palette: agent, activity, connector, condition, transform, human review", k: "m" },
    { v: "12", l: "steps of the planner-built invoice workflow, opened and editable on the canvas", k: "m" },
  ],
  biz: [
    "Planner and canvas produce the same artefact, so business analysts can adjust an AI-built flow without starting again.",
    "Live validation stops broken flows before they reach production.",
  ],
  tech: [
    "Palette: Agent, Activity, Connector, Condition, Transform, Human review; LR/TB layouts; script view of the definition.",
    "Save keeps edits local; Publish recompiles the module and re-registers it with the worker; Test with scenarios replays the planner's scenarios.",
  ],
  shots: [["wf_builder", "The supplier invoice workflow on the canvas, built by the planner, editable by hand."],
          ["visual_builder", "A new workflow on the canvas: start from the palette."]],
  layers: [
    { t: "Draft, validate, publish", biz: "Change control in three clicks.", tech: "Draft saves locally; validation runs on every edit; Publish compiles to the Mistral Workflows SDK and registers it." },
  ],
  links: ["planner", "workflows", "refine", "reviews"],
});

comp({
  id: "admin", band: "experience", code: "Ad", name: "Admin console",
  pitch: "Run the Composer as an enterprise service: workspaces on their own Mistral keys, role-based access and a full audit trail.",
  kpis: [
    { v: "5", l: "built-in roles (Maintainer, Builder, Operator, Reviewer, Viewer)", k: "m" },
    { v: "27", l: "fine-grained permissions to compose custom roles", k: "m" },
    { v: "Every", l: "sign-in, change and refusal is written to the audit log", k: "m" },
  ],
  biz: [
    "Separate teams or clients get separate workspaces, each billed to its own Mistral API key.",
    "Least-privilege access out of the box; custom roles when a built-in one gives too much or too little.",
    "Audit-ready: who, what, when and from where, with passwords never recorded.",
  ],
  tech: [
    "A workspace is a Mistral API key, verified before it is saved; its agents, libraries, workflows and traces live in that Mistral workspace.",
    "Sessions are encrypted cookies and access is checked on every request; admin sessions end when the browser closes.",
    "Activity logs read every user's API actions, workflow runs and model calls back from Mistral Observability.",
  ],
  shots: [["admin_overview", "Admin overview: users, workspaces, sign-ins and recent activity."],
          ["admin_roles", "Roles & permissions: 5 built-in roles and their share of the 27 permissions."],
          ["admin_audit", "Audit log: every sign-in, change and refusal."],
          ["admin_workspaces", "Workspaces run on their own Mistral keys."],
          ["admin_health", "System health: API, database, Mistral, Tool Service, workflow workers, knowledge graph."]],
  layers: [
    { t: "Workspaces", biz: "One Composer, many teams, cost kept separate.", tech: "Workspace = Mistral API key; verified on save; worker runs per workspace." , img: "admin_workspaces"},
    { t: "Users, roles, admins", biz: "Invite, place and permission people in minutes.", tech: "Built-in roles + custom roles from 27 permissions; one-time invite links.", img: "admin_role_detail" },
    { t: "Activity & audit", biz: "Evidence for every control review.", tech: "Activity logs from Mistral Observability; audit log of auth and admin events.", img: "admin_logs" },
  ],
  links: ["settings", "status", "logs", "vault"],
});

/* ───────────────────────── L2 Build & orchestrate ───────────────────────── */
comp({
  id: "agentpipe", band: "orchestrate", code: "Ap", name: "Agent pipeline",
  pitch: "The engine behind the Orchestrator: 8 stages, 21 layers, one decision per layer.",
  kpis: [
    { v: "8 / 21", l: "stages / layers in the agent pipeline", k: "m" },
    { v: "5", l: "design decisions made concurrently (tools, integrations, knowledge, model, identity)", k: "m" },
    { v: "26", l: "model calls in the onboarding-agent build", k: "m" },
  ],
  biz: ["Small, explainable decisions instead of one opaque prompt: easier to trust, easier to audit.",
        "Concurrency where it is safe keeps builds quick."],
  tech: ["Pipeline of DecisionLayer subclasses grouped into Stages; a ParallelGroup runs the five independent facets at once.",
         "CleanupLayer wraps everything in try/finally so a failed build leaves nothing behind."],
  shots: [["agent_build_top", "The agent pipeline for the onboarding-agent build."]],
  journey: "journey-agent",
  layers: [],
  links: ["orchestrator", "agents", "rules", "guardrails"],
});

comp({
  id: "wfpipe", band: "orchestrate", code: "Wp", name: "Workflow pipeline",
  pitch: "The engine behind the planner: 10 stages and 26 layers from a goal to a registered, verified workflow.",
  kpis: [
    { v: "10 / 26", l: "stages / layers in the workflow pipeline", k: "m" },
    { v: "41", l: "model calls in the supplier-invoice build", k: "m" },
    { v: "40", l: "tool calls (activity tests and checks) in the same build", k: "m" },
  ],
  biz: ["A repeatable delivery method encoded in software: the same quality bar on every build.",
        "Every layer leaves evidence: what it decided, why, and how long it took."],
  tech: ["Strictly sequential layers; when validation fails, control returns to the layer at fault.",
         "Build prerequisites are settled before anything is created, so a blocked build spends nothing."],
  shots: [["plan_top", "Workflow pipeline for the supplier-invoice build."]],
  journey: "journey-workflow",
  layers: [],
  links: ["planner", "verify", "workflows", "activities"],
});

comp({
  id: "refine", band: "orchestrate", code: "Rf", name: "Refine with AI",
  pitch: "Change a live workflow by asking for it. Each request becomes a proposal you preview on the graph, apply, or discard, and every change can be undone.",
  kpis: [
    { v: "11", l: "layers in the revision pipeline", k: "m" },
    { v: "1", l: "automatic repair applied during the invoice build (version 2)", k: "m" },
    { v: "1 click", l: "undo of any applied change; full version history", k: "m" },
  ],
  biz: ["Processes change; workflows keep up without a rebuild or a change request backlog.",
        "Proposals, not silent edits: the business sees the diff before anything goes live."],
  tech: ["Context → Diagnosis → Intent → Plan → Apply → Normalise → Validation → Repair → Code fix → Diff → Proposal.",
         "Only the intent layer calls a model; edits chosen directly in the UI skip it. The proposal layer always runs, so even an ambiguous request is recorded and answered."],
  shots: [["wf_refine", "Refine with AI on the invoice workflow: the planner's own repair, applied as version 2."]],
  layers: [
    { t: "Diagnose", biz: "Finds the real cause of a failure.", tech: "Reads failing runs and step errors; classifies wiring, condition, template or activity code faults." },
    { t: "Plan and apply", biz: "Proposes the smallest safe change.", tech: "Edit operations applied to a copy, normalised and validated; repaired once or twice if needed." },
    { t: "Diff and propose", biz: "Business sign-off on a visual diff.", tech: "Graph diff + proposal record; publish recompiles and re-registers." },
  ],
  links: ["planner", "verify", "builder", "workflows"],
});

comp({
  id: "verify", band: "orchestrate", code: "Vf", name: "Verify & self-repair",
  pitch: "Every build is tested before a person sees it: scenarios are designed, run end to end, and failures are fixed automatically.",
  kpis: [
    { v: "3", l: "scenarios designed for the invoice flow: review route, auto-approve, reject", k: "m" },
    { v: "2 → 0", l: "failing scenarios before and after the automatic repair", k: "m" },
    { v: "2m 47s", l: "dry-run, diagnose, repair and re-run", k: "m" },
  ],
  biz: ["Quality assurance is built in, not a separate phase: fewer production incidents, faster sign-off.",
        "Agents are tested the same way: designed prompts, an LLM judge, and revised instructions."],
  tech: ["Dry runs stub connectors and human reviews, check every step output and outcome, then route failures into the revision pipeline.",
         "In the invoice build the first round failed because non-review paths had no human_review_result; the repair added a merge transform (select_human_review_result)."],
  shots: [["wf_refine", "The repair proposal applied during verification."]],
  layers: [
    { t: "Design test scenarios", biz: "A test pack written from the business rules.", tech: "Typical case plus one scenario per outcome and threshold.", img: "plan_layer_design_test_scenarios" },
    { t: "Dry-run and repair", biz: "Self-healing before go-live.", tech: "20 steps: plan the fix, edit, keep the graph whole, re-check, re-run all scenarios.", img: "plan_layer_dry_run_and_repair" },
    { t: "Agent evaluation", biz: "Agents are graded before anyone relies on them.", tech: "3 designed prompts (typical, edge, guardrail), judged; instructions revised from the judge's findings.", img: "agent_layer_test_the_agent" },
  ],
  links: ["planner", "refine", "runs"],
});

/* ───────────────────────── L3 Reusable assets ───────────────────────── */
comp({
  id: "agents", band: "assets", code: "Ag", name: "Agent Studio",
  pitch: "Every agent the Composer creates, or you create by hand, in one governed catalog: tier, model, domains, rules and sessions.",
  kpis: [
    { v: "7", l: "agents in the workspace", k: "m" },
    { v: "3", l: "tiers: foundation, domain, use-case, for reuse at the right level", k: "m" },
    { v: "0 → 2", l: "agents reused vs created in the invoice build (nothing invoice-specific existed yet)", k: "m" },
  ],
  biz: ["Agents become reusable business assets, so the next workflow in the same domain reuses rather than rebuilds.",
        "Classification by industry and domain makes the catalog searchable by the business."],
  tech: ["Agents live in Mistral (Agents API); the Composer stores tier, domain tags and rules alongside.",
         "The reuse layer matches each needed capability against existing domain and use-case agents before creating any."],
  shots: [["agents", "Agent Studio: the invoice agents next to the other agents."],
          ["agent_detail", "An agent's page: chat, sessions, model, domains, rules and configuration."]],
  layers: [
    { t: "Tiers", biz: "Reuse at the right level of the business.", tech: "Foundation (safety, routing), domain (procurement, energy…), use-case (one product)." },
    { t: "Configuration", biz: "Change model or instructions without a rebuild.", tech: "Model, temperature, instructions, tools, connectors, libraries, moderation." },
  ],
  links: ["orchestrator", "rules", "catalog", "playground"],
});

comp({
  id: "tools", band: "assets", code: "Tl", name: "Tool lifecycle",
  pitch: "Tools the Composer writes for itself, with review, versions, tests and one-click rebuild from a production error.",
  kpis: [
    { v: "33", l: "active tools in the workspace", k: "m" },
    { v: "26", l: "of them are deterministic activities", k: "m" },
    { v: "8", l: "activities written and tested for the invoice flow", k: "m" },
  ],
  biz: ["Integration and logic code is produced on demand, so delivery is not blocked on developer capacity.",
        "Approval and versioning keep generated code under change control."],
  tech: ["Synthesise → review → approve → version; Test, Rebuild from error, Edit, Publish to MCP, Send to a remote server.",
         "Code runs in the Tool Service with a JSON-schema contract per tool."],
  shots: [["tools", "Tool lifecycle: active tools and the review queue."],
          ["activity_detail", "recalculate_invoice_amounts: source, schema and lifecycle actions."]],
  layers: [
    { t: "Synthesise", biz: "Code written to the data contract.", tech: "Code pipeline with contracts, preflight, smoke tests and feedback loops." },
    { t: "Rebuild from error", biz: "Production issues fixed from the failure itself.", tech: "A failed run's error seeds a new version; the old one stays for rollback." },
  ],
  links: ["activities", "mcp", "remote", "workflows"],
});

comp({
  id: "activities", band: "assets", code: "Ac", name: "Activity gallery",
  pitch: "Isolated, retryable units of business logic a workflow runs directly, with no LLM in the loop.",
  kpis: [
    { v: "8 of 12", l: "invoice-workflow steps are activities (plain code)", k: "m" },
    { v: "0", l: "model calls inside an activity step", k: "m" },
  ],
  biz: ["Rules, calculations and routing are exact, cheap and repeatable: the same input gives the same output.",
        "Auditors read the code; no prompt to interpret."],
  tech: ["Activities run as their own step in the Mistral Workflows graph, with retries and typed inputs and outputs.",
         "The execution-mode layer decides agent vs activity vs integration for each unit of work."],
  shots: [["activities", "Activity gallery: activities built for the invoice, parcel and energy flows."],
          ["activity_detail", "Source code and JSON schema of an activity."]],
  layers: [],
  links: ["tools", "workflows", "planner"],
});

comp({
  id: "workflows", band: "assets", code: "Wf", name: "Workflows",
  pitch: "Deterministic multi-step pipelines compiled to Mistral Workflows: versioned, classified, packaged and ready to run.",
  kpis: [
    { v: "3", l: "planner-built workflows in the workspace (invoices, parcel claims, energy disputes)", k: "m" },
    { v: "12", l: "steps in supplier_invoice_approval", k: "m" },
    { v: "18.8 s", l: "average end-to-end run on Mistral Workflows (2 of 2 runs completed)", k: "m" },
  ],
  biz: ["A workflow is a product: run it, version it, package it and deploy it anywhere.",
        "Readiness checks tell operations exactly what a workflow needs before it runs."],
  tech: ["Graph / Steps / Compiled module / Validation tabs; History, Export, Package, Classify, Refine with AI, Edit, Republish, Run.",
         "Save keeps edits local; publish compiles the definition and registers it with the Mistral worker."],
  shots: [["workflows", "Workflows: three planner-built, published workflows."],
          ["wf_overview", "supplier_invoice_approval: ready to run, with its readiness checks."],
          ["wf_steps", "Steps view: tier, type and wiring of each step."],
          ["wf_compiled_module", "The generated Mistral Workflows SDK module."],
          ["wf_validation", "Validation and the rules on this workflow."]],
  layers: [
    { t: "Package & deploy", biz: "Take the workflow to the client's own infrastructure.", tech: "Deployment manifest lists agents, tools, connectors and setup; package for a remote server." },
  ],
  links: ["planner", "builder", "runs", "refine", "remote"],
});

comp({
  id: "connectors", band: "assets", code: "Cn", name: "Connectors",
  pitch: "Enterprise systems one switch away: MCP connectors registered with Mistral, ready for agents and workflow steps.",
  kpis: [
    { v: "23", l: "connectors registered (Atlassian, Teams, Slack, SharePoint, Gmail, Outlook, GitHub, GitLab, BigQuery, Notion, Stripe…)", k: "m" },
  ],
  biz: ["Agents act in the systems people already use, so automation reaches the last mile.",
        "Connectors that send data out are governed by the 'Sensitive data stays internal' rule."],
  tech: ["Connectors are Mistral MCP connectors; the connector-selection layer decides which an agent must reach.",
         "Approval gates are placed on connector actions that need a person."],
  shots: [["connectors", "Connector registry."]],
  layers: [],
  links: ["mcp", "rules", "agents"],
});

comp({
  id: "mcp", band: "assets", code: "Mc", name: "MCP servers",
  pitch: "Bring your own tools: register any Model Context Protocol server, check its health and try its tools before wiring them in.",
  kpis: [ { v: "3 steps", l: "register, discover tools automatically, try in the playground", k: "m" } ],
  biz: ["Existing internal APIs become agent tools without new integration projects."],
  tech: ["Point at an MCP endpoint; the Tool Service handshakes, lists tools with their input schemas, and agents can call them."],
  shots: [["mcp", "MCP servers: register, discover, try & use."]],
  layers: [],
  links: ["connectors", "tools"],
});

/* ───────────────────────── L4 Knowledge ───────────────────────── */
comp({
  id: "knowledge", band: "knowledge", code: "Kn", name: "Knowledge & guidance",
  pitch: "Your build playbook and reference knowledge: the orchestrator follows the guidance when it designs, and agents read the reference when they run.",
  kpis: [
    { v: "30", l: "active guidance items", k: "m" },
    { v: "8", l: "guidance items in scope for the invoice build (6 must / avoid)", k: "m" },
    { v: "Learns", l: "new guidance is proposed from repeated fixes, then waits for review", k: "m" },
  ],
  biz: ["Your standards are applied on every build automatically, so quality does not depend on who is building.",
        "The Composer gets better with use: repeated fixes become proposed guidance."],
  tech: ["Tabs: Guidance, Sources (distil PDFs, Word, PowerPoint, images, text, JSON), Reference, Try retrieval, Feedback.",
         "The knowledge-context layer selects the guidance and process facts in scope and hands each later layer only its slice."],
  shots: [["knowledge", "Guidance: one proposed by the learning loop, waiting for review."],
          ["knowledge_sources", "Sources: documents distilled into guidance items."]],
  layers: [],
  links: ["processes", "catalog", "libraries"],
});

comp({
  id: "processes", band: "knowledge", code: "Pr", name: "Processes",
  pitch: "The business processes each industry runs, filed by domain; attach a process document and every build follows it.",
  kpis: [ { v: "Industry → process → subprocess", l: "five-level process tree aligned to the catalog", k: "m" } ],
  biz: ["Builds speak the client's process language (BFSI, energy, healthcare, manufacturing, public sector…).",
        "Process-grounded design reduces rework with the business."],
  tech: ["Industry / domain / subdomain / process / subprocess; templates downloadable; recommendations importable.",
         "When Process knowledge is on, the process document grounds agent and workflow design."],
  shots: [["processes", "Processes by industry."]],
  layers: [],
  links: ["knowledge", "catalog"],
});

comp({
  id: "catalog", band: "knowledge", code: "Ct", name: "Catalog & knowledge graph",
  pitch: "One tree of industries, domains and processes, with tags that file every agent, tool, connector, workflow and library under it.",
  kpis: [
    { v: "111", l: "concepts in 7 schemes", k: "m" },
    { v: "63", l: "annotations linking assets to the tree", k: "m" },
  ],
  biz: ["Find, reuse and govern assets by business area, not by technical name.",
        "The planner narrows on the catalog before it picks agents: better reuse, fewer duplicates."],
  tech: ["Ontology with schemes and concepts; annotations are subject–predicate–concept triples on platform resources.",
         "Application graph and graph-RAG retrieval backed by a Neo4j knowledge graph."],
  shots: [["catalog", "Catalog: application graph, vocabulary and knowledge."]],
  layers: [],
  links: ["processes", "libraries", "agents"],
});

comp({
  id: "libraries", band: "knowledge", code: "Lb", name: "Libraries",
  pitch: "Document sets an agent can be pointed at for retrieval-augmented answers, created automatically when a design needs one.",
  kpis: [ { v: "Auto", l: "a library is provisioned by the build when an agent is designed around documents", k: "m" } ],
  biz: ["Answers grounded in the client's own documents, with less hallucination risk."],
  tech: ["Mistral Libraries; the library-selection layer decides what an agent reads and whether it reasons over the graph; library provisioning creates it."],
  shots: [["libraries", "Libraries (none needed for the agents shown on this page)."]],
  layers: [],
  links: ["catalog", "knowledge", "agents"],
});

/* ───────────────────────── L5 Governance ───────────────────────── */
comp({
  id: "rules", band: "govern", code: "Ru", name: "Rules & gates",
  pitch: "Policy as code: always-on rules everywhere, and optional rules the orchestrator attaches where the risk is real.",
  kpis: [
    { v: "16", l: "rules: 8 for agents, 8 for workflows", k: "m" },
    { v: "10", l: "always on", k: "m" },
    { v: "4", l: "checkpoints: at creation, on every message, before every tool call, on every answer", k: "m" },
  ],
  biz: ["Compliance is enforced, not documented: approved models only, prompt-injection screening, PII redaction, step and tool limits.",
        "Risk teams see which rules each agent and workflow follows and every verdict in the logs."],
  tech: ["Agent rules: Approved models, Harmful content filter, Instruction quality, JSON answers, Personal data redaction, Prompt-injection screen, Read-only database, Tool call limit.",
         "Workflow rules: Capability coverage, Documents match the domain, Input screening, Redact personal data in results, Screen input first, Sensitive data stays internal, Step limit, Tool calls per agent step.",
         "Enforcement modes: block, fix, warn; the rule-selection layers choose optional rules per agent and per workflow."],
  shots: [["rules", "Rules & gates, with their enforcement and checkpoints."]],
  layers: [
    { t: "Chosen for the invoice workflow", biz: "Rules picked for financial data.", tech: "Input screening + Redact personal data in results, on top of 6 always-on workflow rules.", img: "plan_layer_choose_workflow_rules" },
    { t: "Chosen for the invoice agents", biz: "PII redaction where reviewer comments may contain personal data.", tech: "Personal data redaction on the notification agent.", img: "plan_layer_choose_rules_for_each_agent" },
    { t: "Enforced at agent creation", biz: "Evidence of compliance from minute one.", tech: "Prompt-injection screen and read-only database applied; approved model and instruction quality passed.", img: "agent_layer_assemble_the_agent" },
  ],
  links: ["guardrails", "reviews", "logs", "vault"],
});

comp({
  id: "guardrails", band: "govern", code: "Gr", name: "Guardrails & safety",
  pitch: "Moderation on every agent that needs it, safety gates at both ends of every workflow, and an end-to-end review of what the whole path exposes.",
  kpis: [
    { v: "2", l: "safety bookends in the invoice flow: input validation and output validation", k: "m" },
    { v: "1", l: "missing gate flagged by the whole-path review (after the review summary)", k: "m" },
  ],
  biz: ["Sensitive data such as bank-account digits is kept out of anything a person or customer sees.",
        "Moderation is switched on where it matters and left off where it would only add latency."],
  tech: ["Guardrail layer decides Mistral moderation categories and thresholds per agent (block on error, tool-round budget).",
         "Workflow guardrail layer traces data exposure across the assembled graph: something no single step reveals."],
  shots: [],
  layers: [
    { t: "Review the whole path", biz: "End-to-end data exposure check.", tech: "Input gate, output gate, PII policy, missing gates, data exposure per audience.", img: "plan_layer_review_the_whole_path" },
    { t: "Agent moderation", biz: "Right-sized moderation per agent.", tech: "Categories, thresholds and action decided from what the agent can do.", img: "agent_layer_configure_guardrails" },
  ],
  links: ["rules", "reviews", "vault"],
});

comp({
  id: "reviews", band: "govern", code: "Hr", name: "Human reviews",
  pitch: "People stay in charge: steps wait for a person to approve, correct or reject before a costly action, above a threshold, or on exceptions.",
  kpis: [ { v: "5", l: "review outcomes tracked: waiting, approved, corrected, rejected, timed out", k: "m" } ],
  biz: ["Human-in-the-loop where governance asks for it, straight-through processing everywhere else.",
        "Corrections are captured, so the process improves."],
  tech: ["The oversight-placement layer adds review steps where the governance requires them and gates connector actions that need approval.",
         "Human review is a step type on the canvas; a waiting run pauses until the decision arrives."],
  shots: [["reviews", "Human reviews inbox."]],
  layers: [],
  links: ["rules", "builder", "runs"],
});

comp({
  id: "vault", band: "govern", code: "Va", name: "Vault & prerequisites",
  pitch: "The build asks for credentials, service URLs and business facts before it spends anything, and reuses what the vault already holds.",
  kpis: [
    { v: "3", l: "business parameters raised by the invoice build (approval threshold, gross-difference tolerance, escalation timeout)", k: "m" },
    { v: "0", l: "secrets needed for the invoice flow: no external services", k: "m" },
  ],
  biz: ["No half-built automations waiting on a password; the business owner sees exactly what is needed, up front."],
  tech: ["Prerequisites layer runs once steps are known and nothing is created; values come from the vault, the environment, the user, or are skipped with a stated alternative."],
  shots: [],
  layers: [
    { t: "Workflow prerequisites", biz: "Business thresholds confirmed before build.", tech: "3 items raised and resolved from the goal's own values.", img: "plan_layer_check_what_the_build_needs_from_you" },
    { t: "Agent prerequisites", biz: "Optional context, with a default when skipped.", tech: "4 information items; the user skipped them and the agent used stated defaults.", img: "agent_layer_check_what_the_build_needs_from_you" },
  ],
  links: ["rules", "settings", "admin"],
});

/* ───────────────────────── L6 Run & observe ───────────────────────── */
comp({
  id: "runs", band: "operate", code: "Rn", name: "Runs & deployment",
  pitch: "Run a workflow from a form, watch each step live, and deploy the package to the client's own servers.",
  kpis: [
    { v: "2 / 2", l: "supplier-invoice runs completed on Mistral Workflows", k: "m" },
    { v: "17.3–20.3 s", l: "end-to-end run time across 11 executed steps", k: "m" },
  ],
  biz: ["Operations get a ready run form with a realistic example on day one.",
        "Readiness checks prevent failed runs caused by missing setup."],
  tech: ["Run form generated from the input schema; JSON or form entry; live step progress; notifications when a run finishes or fails.",
         "Remote servers on AWS, Google Cloud, Azure, DigitalOcean and NVIDIA Brev host tool and workflow packages."],
  shots: [["wf_execute", "Run form for supplier_invoice_approval."],
          ["run_execution", "A run's trace: input and dispatch to Mistral."],
          ["remote_servers", "Remote servers: provider accounts for deployment."]],
  layers: [],
  links: ["workflows", "logs", "status"],
});

comp({
  id: "logs", band: "operate", code: "Lg", name: "Logs & traces",
  pitch: "Every action the Composer takes (API calls, runs and each of their steps, rule verdicts, tool calls, pipeline layers, model calls) traced to Mistral Observability and read back here.",
  kpis: [ { v: "Every", l: "action is traced; secrets and PII are masked before export", k: "m" } ],
  biz: ["One audit trail for operations, risk and finance: who ran what, what it cost in calls, and which rule said no."],
  tech: ["Views: All actions, By workflow, Rule verdicts; per trace: duration, spans, model calls, tool calls, tokens, rules passed/failed, errors.",
         "OpenTelemetry spans exported to Mistral Observability."],
  shots: [["logs", "Logs & traces."], ["logs_trace", "One trace with its spans and attributes."]],
  layers: [],
  links: ["runs", "rules", "admin"],
});

comp({
  id: "status", band: "operate", code: "St", name: "Status & settings",
  pitch: "Live health for every part of the Composer, and every model and configuration value in one place.",
  kpis: [
    { v: "65", l: "Mistral models available to choose from", k: "m" },
    { v: "5", l: "components watched on the status page (platform, Mistral models, tools, workflow runs, knowledge graph)", k: "m" },
  ],
  biz: ["Model choice is a setting, not a code change: switch to faster or cheaper models as Mistral ships them."],
  tech: ["Orchestrator/decision model, reasoning effort and fallbacks per pipeline; Tool Service, platform, process knowledge, tool safety, vault, UI and cleanup sections.",
         "Saved values take effect immediately wherever they are used."],
  shots: [["status", "System status."], ["settings", "Settings: AI models."]],
  layers: [],
  links: ["admin", "mistral", "logs"],
});

/* ───────────────────────── L7 Foundation ───────────────────────── */
comp({
  id: "mistral", band: "foundation", code: "Mi", name: "Mistral AI",
  pitch: "Built natively on the Mistral ecosystem: models, Agents, Conversations, Workflows, Libraries, Moderation and Observability.",
  kpis: [
    { v: "large · medium", l: "mistral-large-latest designs; mistral-medium-latest runs the invoice agents", k: "m" },
    { v: "30", l: "chat-completion calls to design the invoice workflow", k: "m" },
    { v: "2", l: "Agents API creations in that build", k: "m" },
  ],
  biz: ["A European model provider with enterprise deployment options and per-workspace cost control.",
        "No proprietary runtime lock-in: agents and workflows run on Mistral's own services."],
  tech: ["Chat completions for decisions; Agents API for agents; Conversations for chat; Workflows SDK + worker for execution; Libraries for retrieval; moderation for guardrails; embeddings; Observability for traces."],
  shots: [],
  layers: [],
  links: ["status", "agents", "workflows", "logs"],
});
