/* TCS Dynamic Agentic Workflow Composer: a clickable sales presentation.
   Storyline slides run in order; every component links to its feature slide, and back. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  /* ───────────── features (deep-dive slides) ───────────── */
  const F = {
    orchestrator: { name: "Orchestrator", layer: "experience", head: "Agents from a single sentence",
      what: ["Type what you need. It writes the brief and asks only for what is missing.",
             "It designs the agent, applies your rules and creates it on Mistral.",
             "It tests the agent on realistic requests and improves it before you use it."],
      value: ["New assistants in minutes, without a development backlog.",
              "Every choice comes with its reason, so risk teams can sign off quickly.",
              "Governed from the moment it exists."],
      stat: ["About 6 min", "from one sentence to a tested, governed agent"],
      shots: [["orchestrator", "Describe your goal; the Composer designs the agent."], ["agent_build_top", "Every design decision, with its reason, on one page."]],
      related: ["playground", "agents", "rules"] },
    planner: { name: "Workflow planner", layer: "experience", head: "Goal in, live workflow out",
      what: ["Describe the business process in plain English.",
             "Nine stages design, build, test and register the workflow for you.",
             "AI is used only where judgement is needed; rules and calculations become code."],
      value: ["Automate a new process without starting a project.",
              "Lower running cost, because most steps need no AI.",
              "Nothing goes live untested."],
      stat: ["Under 30 min", "to a tested 12-step invoice-approval workflow"],
      shots: [["workflow_new_ai", "Plan with AI: describe the workflow you want."], ["plan_top", "The finished build, stage by stage."], ["workflow_new", "Three ways to start: goal, canvas or template."]],
      related: ["builder", "repair", "refine"], see: ["workflow", "See the nine stages"] },
    builder: { name: "Visual builder", layer: "experience", head: "See and shape every step",
      what: ["A drag-and-drop canvas with AI agents, code steps, connectors, conditions and human review.",
             "Workflows built by the planner open here for fine-tuning.",
             "Live validation, then publish in one click."],
      value: ["Business analysts stay in control of the process.",
              "Change a flow without waiting for developers."],
      shots: [["wf_builder_canvas", "The invoice workflow, built by AI and editable by hand."], ["wf_builder", "The builder with its toolbar: settings, script, test with scenarios, publish."], ["visual_builder", "Start a new flow from the palette."]],
      related: ["planner", "refine", "review"] },
    playground: { name: "Playground", layer: "experience", head: "Try it on your own documents",
      what: ["Chat with any agent or Mistral model.",
             "Attach images, recordings, PDFs and Office files; each is sent in the form the model understands.",
             "Keep every conversation for review."],
      value: ["Business users validate an agent before it reaches a process.",
              "Compare models side by side on real work."],
      shots: [["playground", "Playground: pick a model or agent and start."], ["agent_detail", "Chat with an agent the Composer built."]],
      related: ["orchestrator", "agents", "mistral"] },
    refine: { name: "Refine with AI", layer: "intelligence", head: "Change a live workflow by asking",
      what: ["Say what should change, in plain English.",
             "Preview the proposed change on the process graph, then apply or discard it.",
             "Every change can be undone, with a full version history."],
      value: ["Processes evolve without rebuilds or change-request queues.",
              "The business sees exactly what changes before it goes live."],
      shots: [["wf_refine", "A change proposal, previewed on the graph and kept in the history."]],
      related: ["builder", "repair", "planner"] },
    repair: { name: "Test & self-repair", layer: "intelligence", head: "Quality assurance, built in",
      what: ["Writes its own test scenarios from your business rules.",
             "Runs them end to end before anyone reviews the result.",
             "Finds the cause of a failure and fixes it automatically."],
      value: ["Fewer production incidents.",
              "Faster sign-off, because the evidence is already there."],
      stat: ["Caught and fixed", "a missing hand-off in the invoice flow before review"],
      shots: [["plan_layer_dry_run_and_repair", "Tests run, the failure is fixed, all scenarios pass."]],
      related: ["planner", "refine", "run"] },
    agents: { name: "Agent Studio", layer: "assets", head: "A catalogue of reusable agents",
      what: ["Every agent in one governed catalogue, filed by industry and business domain.",
             "New builds reuse an existing agent whenever it fits.",
             "Change the model or instructions without rebuilding."],
      value: ["Every build makes the next one faster and cheaper.",
              "One place to see and govern all your AI agents."],
      shots: [["agents", "Agent Studio: agents filed by domain."], ["agent_detail", "An agent's page: chat, sessions, rules and configuration."]],
      related: ["orchestrator", "knowledge", "rules"] },
    tools: { name: "Tools & activities", layer: "assets", head: "The business logic it writes for you",
      what: ["The Composer writes, tests and versions the code each process needs.",
             "Code steps run without AI: the same input always gives the same answer.",
             "Rebuild a step from a production error in one click."],
      value: ["Lower running cost and exact calculations.",
              "Logic your auditors can read."],
      stat: ["8 of 12", "invoice-workflow steps run as plain code, with no AI cost"],
      shots: [["activities", "Activities the Composer wrote for real processes."], ["activity_detail", "Readable source code, versioned and approved."]],
      related: ["planner", "connectors", "repair"] },
    connectors: { name: "Connectors & MCP", layer: "assets", head: "Reach the systems your people use",
      what: ["Ready-made connectors: Microsoft Teams, Outlook, SharePoint, Slack, Gmail, Google Drive, Atlassian, GitHub, GitLab, BigQuery, Notion, Stripe and more.",
             "Register your own APIs as MCP servers and use them as agent tools.",
             "Approval gates on actions that need a person."],
      value: ["Automation reaches the last mile of the process.",
              "Sensitive data is stopped from leaving through a connector."],
      stat: ["23", "ready-made enterprise connectors"],
      shots: [["connectors", "The connector registry."], ["mcp", "Bring your own tools through MCP."]],
      related: ["tools", "rules", "agents"] },
    knowledge: { name: "Knowledge & processes", layer: "knowledge", head: "Your playbook, built into every build",
      what: ["Upload process documents and standards; they guide every design.",
             "An industry process library and a catalogue of every agent, tool and workflow.",
             "Document libraries ground agent answers in your own content.",
             "Repeated fixes become proposed guidance, reviewed before use."],
      value: ["Consistent quality, whoever builds.",
              "Answers grounded in your documents, not guesses."],
      shots: [["knowledge", "Build guidance the Composer follows."], ["processes", "Business processes by industry."], ["catalog", "One catalogue for every asset."]],
      related: ["agents", "planner", "orchestrator"] },
    rules: { name: "Rules & guardrails", layer: "trust", head: "Policy as code, enforced everywhere",
      what: ["Ready-made rules: approved models only, prompt-injection screening, personal-data redaction, step and tool limits, sensitive data stays internal.",
             "Safety checks at the start and end of every workflow.",
             "The Composer adds the right optional rules where the risk is real."],
      value: ["Compliance is enforced, not just documented.",
              "Faster risk and security sign-off."],
      stat: ["16", "policy rules ready to use, 10 always on"],
      shots: [["rules", "Rules & gates, with how each is enforced."]],
      related: ["review", "admin", "connectors"] },
    review: { name: "Human review", layer: "trust", head: "People decide what matters",
      what: ["Review steps placed where governance requires: thresholds, exceptions, costly actions.",
             "Approve, correct or reject from one inbox.",
             "Everything else runs straight through."],
      value: ["Control without slowing down every case.",
              "Corrections are captured so the process improves."],
      shots: [["reviews", "The human review inbox."]],
      related: ["rules", "builder", "run"] },
    run: { name: "Run, deploy & monitor", layer: "operations", head: "Operate with confidence",
      what: ["A ready run form for every workflow, with live step-by-step progress.",
             "Every action traced to Mistral Observability.",
             "Deploy packages to AWS, Azure, Google Cloud and more; live system status."],
      value: ["Transparent operations for business and IT.",
              "Run where your data lives."],
      stat: ["About 20 s", "to process a supplier invoice end to end"],
      shots: [["wf_execute", "Run form generated for the workflow."], ["logs", "Every action, traced."], ["remote_servers", "Deploy to your cloud."]],
      related: ["admin", "mistral", "repair"] },
    admin: { name: "Admin & workspaces", layer: "operations", head: "Enterprise control from day one",
      what: ["Separate workspaces for each team or business unit, each on its own Mistral key.",
             "Built-in and custom roles for least-privilege access.",
             "A full audit trail of sign-ins, changes and refusals."],
      value: ["Costs stay with the team that runs the work.",
              "Audit-ready from the first day."],
      stat: ["5", "built-in roles, plus custom roles"],
      shots: [["admin_overview", "Admin console overview."], ["admin_roles", "Roles and permissions."], ["admin_audit", "The audit log."]],
      related: ["rules", "run", "mistral"] },
    mistral: { name: "Mistral AI", layer: "foundation", head: "Built natively on Mistral",
      what: ["Mistral models, Agents, Workflows, Libraries, moderation and observability underneath everything.",
             "Choose the model for each task as a setting, not a code change."],
      value: ["An enterprise-grade European AI provider.",
              "No proprietary runtime to lock you in."],
      shots: [["settings", "Pick the Mistral model for each job."]],
      related: ["run", "admin", "orchestrator"] },
  };
  const FORDER = Object.keys(F);

  const LAYERS = [
    { id: "experience", name: "Experience", line: "Where your teams work", items: ["orchestrator", "planner", "builder", "playground"] },
    { id: "intelligence", name: "Intelligence", line: "Designs, tests and adapts", items: ["refine", "repair"] },
    { id: "assets", name: "Reusable assets", line: "Everything built is reused", items: ["agents", "tools", "connectors"] },
    { id: "knowledge", name: "Knowledge", line: "Your processes and playbook", items: ["knowledge"] },
    { id: "trust", name: "Trust", line: "Policy and people in control", items: ["rules", "review"] },
    { id: "operations", name: "Operations", line: "Run, monitor, administer", items: ["run", "admin"] },
    { id: "foundation", name: "Foundation", line: "Powered by Mistral", items: ["mistral"] },
  ];

  const STAGES = [
    { n: "Understand", role: "Solution architect", text: "Reads your goal, checks what you already own, applies your process and playbook, and decides where AI is really needed.", f: ["knowledge", "agents"] },
    { n: "Define the data", role: "Business analyst", text: "Agrees one data format for the whole process, so every step speaks the same language.", f: ["planner"] },
    { n: "Plan", role: "Delivery lead", text: "Chooses the right kind of agent, asks you for credentials or thresholds up front, and reuses existing agents first.", f: ["agents", "rules"] },
    { n: "Build", role: "Developers", text: "Writes and tests the business-logic code, then designs and creates the AI agents on Mistral.", f: ["tools", "mistral"] },
    { n: "Assemble", role: "Process designer", text: "Draws the process flow, adds human checkpoints where governance requires, and creates a ready run form.", f: ["builder", "review"] },
    { n: "Govern", role: "Risk & compliance", text: "Reviews the whole flow for data exposure and attaches the right policy rules.", f: ["rules"] },
    { n: "Check", role: "Release manager", text: "Validates the workflow, files it in the catalogue and prepares it for Mistral Workflows.", f: ["knowledge", "mistral"] },
    { n: "Verify", role: "Quality assurance", text: "Writes its own tests, runs them end to end and fixes whatever fails.", f: ["repair"] },
    { n: "Deliver", role: "Product owner", text: "You review, refine or roll back; then it goes live on Mistral.", f: ["refine", "run"] },
  ];

  /* Sublayers of each stage: what it does, and what it decided for the invoice example. */
  const SUBS = [
    [["Take inventory", "", "Finds the agents, code steps, connectors and documents you already have.", "Checked the workspace's existing agents and activities before designing anything."],
     ["Knowledge context", "", "Brings in your business process and approved build guidance.", "Applied 8 guidance items, 6 of them must-follow or must-avoid."],
     ["Decompose the goal", "plan_layer_decompose_the_goal", "Turns the goal into the business capabilities it needs.", "Split the goal into 10 capabilities: safety checks, validation, recalculation, PO match, routing, review, final status and notification."],
     ["Choose how each step runs", "plan_layer_choose_how_each_step_runs", "Decides AI agent, plain code or system integration for each capability.", "Made 8 steps plain code and used AI only for the review summary and the notification."]],
    [["Data contract", "plan_layer_define_the_data_contract", "Defines every record passed between steps, once, with fields, types and units.", "Defined the invoice record and every hand-off record, from the safe invoice to the final notification."]],
    [["Agent types", "", "Picks the right kind of agent for each job and the oversight it needs.", "Both agents are task agents that check their own work before answering."],
     ["What the build needs", "plan_layer_check_what_the_build_needs_from_you", "Asks up front for credentials, thresholds and business facts.", "Raised three business parameters: approval threshold, allowed amount difference and escalation timeout."],
     ["Reuse or create", "plan_layer_reuse_or_create", "Reuses existing agents before building new ones.", "No invoice agents existed yet, so it created 2 new ones."],
     ["Multi-agent patterns", "", "Adds helper agents only when a team of agents is needed.", "Not needed for this process."]],
    [["Write & test activities", "plan_layer_resolve_activities", "Writes, tests and approves the business-logic code.", "Wrote and approved 8 code steps, from input checks to final status."],
     ["Design each agent", "plan_layer_design_each_new_agent", "Designs each agent: model, instructions and moderation.", "Designed the review-summary and notification agents on Mistral Medium."],
     ["Agent rules", "plan_layer_choose_rules_for_each_agent", "Attaches policy rules where the risk is real.", "Added personal-data redaction to the notification agent, because reviewer comments can contain personal details."],
     ["Provision on Mistral", "plan_layer_provision_the_agents", "Creates the agents on Mistral, ready to run.", "Created both agents."]],
    [["Shape the graph", "plan_layer_shape_the_graph", "Draws the process flow, including branches.", "A validation and calculation chain, then a branch that sends only exceptions to a person."],
     ["Place human oversight", "", "Puts human review where governance requires it.", "Human review sits on the branch for invoices over the threshold, without a PO, or mismatched."],
     ["Wire the data", "plan_layer_wire_the_data", "Connects every hand-off so each step gets exactly what it needs.", "Wired every step's inputs to the right earlier results."],
     ["Design run inputs", "plan_layer_design_the_run_inputs", "Creates a ready run form with a realistic example.", "Built the invoice form with an example that exercises the review route."]],
    [["Review the whole path", "plan_layer_review_the_whole_path", "Checks what the whole process exposes, end to end.", "Confirmed safety checks at both ends, kept bank-account digits out of anything a person sees, and flagged one more check to add."],
     ["Workflow rules", "plan_layer_choose_workflow_rules", "Selects the policy rules the workflow must follow.", "Added input screening and personal-data redaction for financial data."]],
    [["Validate", "plan_layer_validate", "Makes sure the workflow can run before anything is published.", "Validated and ready to register."],
     ["Save to catalog", "plan_layer_save", "Files the workflow in the catalogue for reuse.", "Saved and filed under Finance operations and Procurement."],
     ["Compile", "plan_layer_compile", "Prepares the workflow for Mistral Workflows.", "Compiled to the Mistral Workflows SDK."]],
    [["Design test scenarios", "plan_layer_design_test_scenarios", "Writes test cases from your business rules.", "3 scenarios: an invoice needing review, a small invoice approved automatically, an unapproved supplier rejected."],
     ["Dry-run & repair", "plan_layer_dry_run_and_repair", "Runs every test end to end and fixes what fails.", "The first run found a missing hand-off on paths without a review; it was fixed automatically and all 3 tests passed."]],
    [["Your review", "", "You test, refine, accept or roll back everything the plan created.", "Accepted once all three tests passed."],
     ["Register on Mistral", "plan_layer_register", "Puts the workflow live on Mistral Workflows.", "Registered and live on Mistral Workflows."]],
  ];

  const FLOW = [
    { n: "Screen the invoice", k: "code", t: "Checks the incoming invoice for unsafe or malformed content before anything else runs." },
    { n: "Check the rules", k: "code", t: "Rejects impossible invoices early: negative amounts, a due date before the invoice date, no line items." },
    { n: "Recalculate", k: "code", t: "Recomputes every line, VAT and total, and flags any difference from what the supplier billed." },
    { n: "Match the PO", k: "code", t: "Compares the invoice with the purchase order: no PO, over the remaining amount, or within it." },
    { n: "Decide the route", k: "code", t: "Reject, send to a person, or approve automatically, based on supplier, amount and PO match." },
    { n: "Summarise for review", k: "ai", t: "When a person is needed, an AI agent writes a facts-only summary for the finance approver." },
    { n: "Human review", k: "person", t: "The finance approver approves or rejects. Only invoices over £5,000, without a PO, or mismatched reach this step." },
    { n: "Final status", k: "code", t: "Approved for payment or rejected, from the route and the review." },
    { n: "Notify", k: "ai", t: "An AI agent drafts the message to the person who submitted the invoice." },
    { n: "Safety check", k: "code", t: "Confirms the message has the invoice ID and status, and no bank-account digits." },
  ];

  /* ───────────── helpers ───────────── */
  const fLink = (id, cls = "chip") => `<a class="${cls}" href="#f-${id}">${esc(F[id].name)}<span aria-hidden="true">→</span></a>`;
  const shotBtn = (key, cap, cls = "") => IMG[key]
    ? `<button class="shot ${cls}" data-zoom="${esc(key)}" aria-label="Enlarge: ${esc(cap)}"><img src="${IMG[key]}" alt="${esc(cap)}"></button>` : "";

  /* ───────────── storyline slides ───────────── */
  const SLIDES = [
    { id: "welcome", title: "Welcome", render: () => `
      <div class="hero">
        <p class="eyebrow">Tata Consultancy Services · Powered by Mistral Ecosystem</p>
        <h1>Turn business goals into governed AI workflows</h1>
        <p class="lede">Describe the outcome in plain English. The Dynamic Agentic Workflow Composer designs it, builds it, tests it and puts it live on Mistral, with your controls already in place.</p>
        <div class="cta-row"><a class="btn btn-primary" href="#challenge">Start the tour →</a><a class="btn" href="#map">Explore the platform</a></div>
        <div class="proof">
          <div><b>Under 30 min</b><span>from a business goal to a tested, live workflow</span></div>
          <div><b>About 6 min</b><span>from one sentence to a governed AI agent</span></div>
          <div><b>Your rules</b><span>applied at build time and at run time</span></div>
        </div>
      </div>` },

    { id: "challenge", title: "The challenge", render: () => `
      <p class="eyebrow">The challenge</p>
      <h2>Why agentic AI stalls in the enterprise</h2>
      <div class="grid4">
        ${[["Slow delivery", "Every new process becomes a project, with months of specification and build.", "planner"],
           ["Rising run costs", "AI is called for work that is really rules and arithmetic.", "tools"],
           ["Governance risk", "Risk and compliance cannot sign off on a black box.", "rules"],
           ["No reuse", "Each team rebuilds the same agents and integrations.", "agents"]].map(([t, p, f]) => `
          <a class="card pain" href="#f-${f}"><h3>${t}</h3><p>${p}</p><span class="card-go">How the Composer solves it →</span></a>`).join("")}
      </div>` },

    { id: "meet", title: "Meet the Composer", render: () => `
      <p class="eyebrow">Meet the Composer</p>
      <h2>One platform, three ways to build</h2>
      <div class="grid3">
        <a class="card way" href="#f-planner"><span class="way-n">01</span><h3>Describe a goal</h3><p>Write the process in plain English. Get a tested workflow back.</p><span class="card-go">Workflow planner →</span></a>
        <a class="card way" href="#f-builder"><span class="way-n">02</span><h3>Draw it</h3><p>Shape the flow on a canvas with agents, code, connectors and people.</p><span class="card-go">Visual builder →</span></a>
        <a class="card way" href="#f-orchestrator"><span class="way-n">03</span><h3>Ask for an agent</h3><p>One sentence becomes a designed, tested, governed agent.</p><span class="card-go">Orchestrator →</span></a>
      </div>
      <a class="band-link" href="#f-refine"><b>Then change anything by asking.</b> Refine with AI turns a request into a reviewed change you can undo. →</a>` },

    { id: "map", title: "Platform map", render: () => `
      <p class="eyebrow">Platform map · click any component</p>
      <h2>The platform, layer by layer</h2>
      <div class="layers">${LAYERS.map((l) => `
        <div class="layer layer-${l.id}">
          <div class="layer-h"><b>${l.name}</b><span>${l.line}</span></div>
          <div class="layer-items">${l.items.map((id) => `<a class="comp" href="#f-${id}"><b>${esc(F[id].name)}</b><span>${esc(F[id].head)}</span></a>`).join("")}</div>
        </div>`).join("")}</div>` },

    { id: "workflow", title: "How a workflow is built", render: () => `
      <div class="wf-head">
        <div><p class="eyebrow">How a workflow is built · click a stage, then a sublayer</p>
        <h2>Nine layers do a delivery team’s work</h2></div>
        <button class="btn" data-open-plan>See the full planning record ↗</button>
      </div>
      <div class="wf">
        <div class="vstack">${STAGES.map((s, i) => `
          <div class="vlayer ${i === 0 ? "open" : ""}" id="vl-${i}">
            <button class="vl-h" data-vstage="${i}" aria-expanded="${i === 0}" aria-controls="vlb-${i}">
              <span class="vl-n">${i + 1}</span><b>${esc(s.n)}</b><span class="vl-role">${esc(s.role)}</span><span class="vl-c" aria-hidden="true">${SUBS[i].length} ▸</span>
            </button>
            <div class="vl-b" id="vlb-${i}" ${i === 0 ? "" : "hidden"}>
              <p>${esc(s.text)}</p>
              <div class="subs">${SUBS[i].map((x, j) => `<button class="sub" data-sub="${i}.${j}" aria-pressed="${i === 0 && j === 0}">${esc(x[0])}</button>`).join("")}</div>
            </div>
          </div>`).join("")}</div>
        <div class="detail" id="sub-detail" aria-live="polite">${subDetail(0, 0)}</div>
      </div>` },

    { id: "story", title: "Example: invoice approval", render: () => `
      <p class="eyebrow">Example · supplier invoice approval</p>
      <h2>From a finance goal to a live workflow</h2>
      <div class="story">
        <div class="story-ask"><span class="tag">The ask</span>
          <p>“Approve supplier invoices for payment, with mandatory human review before any payment over a threshold or with a mismatch.”</p></div>
        <div class="story-flow"><span class="tag">What the Composer delivered · click a step</span>
          <div class="flow">${FLOW.map((s, i) => `<button class="fstep fstep-${s.k}" data-step="${i}" aria-pressed="${i === 6}">${esc(s.n)}</button>`).join("")}</div>
          <div class="flow-legend"><span class="lg lg-code">Code: no AI cost</span><span class="lg lg-ai">AI agent</span><span class="lg lg-person">Person</span></div>
          <p class="flow-note" id="flow-note" aria-live="polite">${esc(FLOW[6].t)}</p>
          <div class="cta-row"><button class="btn see" data-zoom="wf_builder_canvas"><img src="${IMG.wf_builder_canvas}" alt="The delivered workflow in the visual builder" hidden>See it in the builder ↗</button>
          <button class="btn see" data-open-plan>See the full planning record ↗</button></div>
        </div>
        <div class="story-out"><span class="tag">Business outcomes</span>
          <ul class="outs">
            <li><b>Under 30 minutes</b> to build and test it</li>
            <li><b>8 of 12 steps</b> run as plain code, with no AI cost</li>
            <li><b>People see only exceptions:</b> over £5,000, no PO, or a mismatch</li>
            <li><b>About 20 seconds</b> to process an invoice</li>
          </ul>
          <div class="chips">${["planner", "tools", "review", "repair"].map((f) => fLink(f)).join("")}</div>
        </div>
      </div>` },

    { id: "agents-on-demand", title: "Agents on demand", render: () => `
      <p class="eyebrow">Agents on demand</p>
      <h2>One sentence to a governed agent</h2>
      <div class="split">
        <div class="col">
          <p class="quote">“Draft an onboarding checklist for a new data engineer.”</p>
          <ol class="steps">
            <li><b>Understands the need</b> and asks only for what is missing</li>
            <li><b>Designs the agent</b>: tools, knowledge, model and remit</li>
            <li><b>Applies your rules</b> from the moment it exists</li>
            <li><b>Tests and improves it</b> before handing it over</li>
          </ol>
          <p class="big"><b>About 6 minutes</b>, ready to use in the Playground and reuse in any workflow.</p>
          <div class="chips">${["orchestrator", "playground", "agents"].map((f) => fLink(f)).join("")}</div>
        </div>
        ${shotBtn("agent_build_top", "The agent's build, every decision explained", "shot-side")}
      </div>` },

    { id: "trust", title: "Trust & governance", render: () => `
      <p class="eyebrow">Trust &amp; governance</p>
      <h2>Built for regulated enterprises</h2>
      <div class="grid4">
        ${[["Policy rules", "16 ready-made rules, from approved models to personal-data redaction.", "rules"],
           ["Safety checks", "Every workflow screens what comes in and checks what goes out.", "rules"],
           ["Human in the loop", "People review exceptions and costly actions; the rest runs straight through.", "review"],
           ["Full audit trail", "Every action traced; every sign-in, change and refusal logged.", "admin"]].map(([t, p, f]) => `
          <a class="card" href="#f-${f}"><h3>${t}</h3><p>${p}</p><span class="card-go">${esc(F[f].name)} →</span></a>`).join("")}
      </div>
      <p class="note">Workspaces run on their own Mistral keys, with role-based access. <a href="#f-admin">Admin &amp; workspaces →</a></p>` },

    { id: "value", title: "Business value", render: () => `
      <p class="eyebrow">Business value</p>
      <h2>What it means for your business</h2>
      <div class="split">
        <div class="col">
          <div class="vals">
            <div><b>Speed to value</b><span>New processes live in minutes, not project cycles.</span></div>
            <div><b>Lower run cost</b><span>AI only where judgement is needed.</span></div>
            <div><b>Compliance by design</b><span>Rules and reviews applied automatically.</span></div>
            <div><b>Compounding reuse</b><span>Every agent and workflow is reused by the next build.</span></div>
          </div>
        </div>
        <div class="calc" id="calc">
          <div class="calc-h"><b>Size the saving</b><span class="tag tag-i">Example figures · replace with yours</span></div>
          <div class="calc-grid">
            <label for="c-vol">Invoices per month<input id="c-vol" type="number" min="0" step="100" value="2000"></label>
            <label for="c-min">Minutes per invoice today<input id="c-min" type="number" min="0" value="12"></label>
            <label for="c-auto">Handled automatically (%)<input id="c-auto" type="number" min="0" max="100" step="5" value="60"></label>
            <label for="c-rate">Cost per hour (£)<input id="c-rate" type="number" min="0" value="35"></label>
          </div>
          <div class="calc-out" aria-live="polite"><div><span id="c-h">–</span><small>hours saved a month</small></div><div><span id="c-c">–</span><small>saved a month</small></div><div><span id="c-f">–</span><small>people freed up</small></div></div>
        </div>
      </div>` },

    { id: "start", title: "Getting started", render: () => `
      <p class="eyebrow">Getting started</p>
      <h2>Bring one process. See it built live.</h2>
      <div class="grid3">
        <div class="card"><span class="way-n">01</span><h3>Discovery workshop</h3><p>Your team brings one real process. We build it together, live, with every decision visible.</p></div>
        <div class="card"><span class="way-n">02</span><h3>Pilot</h3><p>Run it in your own workspace, connected to your systems, with your rules and reviewers.</p></div>
        <div class="card"><span class="way-n">03</span><h3>Scale</h3><p>Reuse agents and workflows across functions, governed centrally.</p></div>
      </div>
      <div class="cta-row"><a class="btn btn-primary" href="#map">Explore the platform map</a><a class="btn" href="#welcome">Restart the tour</a></div>` },
  ];
  const SORDER = SLIDES.map((s) => s.id);

  function subDetail(i, j) {
    const s = STAGES[i], [n, key, what, ex] = SUBS[i][j];
    return `<p class="d-crumb">Layer ${i + 1} · ${esc(s.n)} › sublayer ${j + 1} of ${SUBS[i].length}</p>
      <h3>${esc(n)}</h3>
      <p class="d-what">${esc(what)}</p>
      <div class="d-ex"><span class="tag">In the invoice example</span><p>${esc(ex)}</p></div>
      ${key && IMG[key] ? `<button class="shot d-shot" data-zoom="${esc(key)}" aria-label="Enlarge: ${esc(n)} in the Composer"><img src="${IMG[key]}" alt="${esc(n)}, as recorded by the Composer"></button><p class="d-cap">As recorded by the Composer · click to enlarge</p>` : ""}
      <div class="d-f"><span>Features involved</span>${s.f.map((f) => fLink(f)).join("")}</div>`;
  }
  function openStage(i) {
    $$(".vlayer").forEach((el, k) => {
      const open = k === i;
      el.classList.toggle("open", open);
      $(".vl-h", el).setAttribute("aria-expanded", String(open));
      $(".vl-b", el).hidden = !open;
    });
  }

  function stagePanel(i) {
    const s = STAGES[i];
    return `<div class="sp-n">Stage ${i + 1} of 9</div><h3>${esc(s.n)}</h3><p>${esc(s.text)}</p>
      <div class="sp-row"><span class="sp-role">Does the job of: <b>${esc(s.role)}</b></span>
      <span class="sp-f">Features used: ${s.f.map((f) => fLink(f)).join("")}</span></div>`;
  }

  /* ───────────── feature slide ───────────── */
  function renderFeature(id) {
    const f = F[id], layer = LAYERS.find((l) => l.items.includes(id));
    const i = FORDER.indexOf(id);
    return `
      <p class="eyebrow">${esc(layer.name)} · Feature ${i + 1} of ${FORDER.length}</p>
      <div class="feature">
        <div class="col">
          <h2><span class="f-name">${esc(f.name)}</span>${esc(f.head)}</h2>
          <div class="fcols">
            <div><h4>What it does</h4><ul>${f.what.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
            <div><h4>Why it matters</h4><ul class="val">${f.value.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          </div>
          ${f.stat ? `<div class="stat"><b>${esc(f.stat[0])}</b><span>${esc(f.stat[1])}</span></div>` : ""}
          ${f.see ? `<div class="cta-row"><a class="btn see" href="#${f.see[0]}">${esc(f.see[1])} →</a><button class="btn see" data-open-plan>See the full planning record ↗</button></div>` : ""}
          <div class="works"><span>Works with</span>${f.related.map((r) => fLink(r)).join("")}</div>
        </div>
        <div class="gallery">
          <figure class="main-shot">${shotBtn(f.shots[0][0], f.shots[0][1])}<figcaption id="cap">${esc(f.shots[0][1])}</figcaption></figure>
          ${f.shots.length > 1 ? `<div class="thumbs">${f.shots.map(([k, c], j) => `<button class="thumb" data-shot="${esc(k)}" data-cap="${esc(c)}" aria-pressed="${j === 0}" aria-label="Show: ${esc(c)}"><img src="${IMG[k]}" alt=""></button>`).join("")}</div>` : ""}
        </div>
      </div>`;
  }

  /* ───────────── router & chrome ───────────── */
  let lastStory = "map";
  function current() {
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("f-") && F[h.slice(2)]) return { kind: "f", id: h.slice(2) };
    return { kind: "s", id: SORDER.includes(h) ? h : "welcome" };
  }
  function render() {
    const c = current(), stage = $("#stage");
    let html, title;
    if (c.kind === "f") { html = renderFeature(c.id); title = F[c.id].name; }
    else { lastStory = c.id; const s = SLIDES.find((x) => x.id === c.id); html = s.render(); title = s.title; }
    stage.innerHTML = `<section class="slide ${c.kind === "f" ? "is-feature" : "slide-" + c.id}" aria-label="${esc(title)}">${html}</section>`;
    $("#where").textContent = c.kind === "f" ? "Platform feature" : "Tour";
    $("#here").textContent = title;
    renderNav(c);
    runCalc();
    stage.scrollTop = 0;
    stage.focus({ preventScroll: true });
  }
  function renderNav(c) {
    const nav = $("#nav");
    if (c.kind === "s") {
      const i = SORDER.indexOf(c.id);
      nav.innerHTML = `
        ${i > 0 ? `<a class="nbtn" href="#${SORDER[i - 1]}" data-dir="prev">← ${esc(SLIDES[i - 1].title)}</a>` : `<span class="nbtn ghost"></span>`}
        <div class="dots">${SLIDES.map((s, j) => `<a href="#${s.id}" class="dot ${j === i ? "on" : ""}" aria-label="${esc(s.title)}" title="${esc(s.title)}"${j === i ? ' aria-current="step"' : ""}></a>`).join("")}<span class="count">${i + 1} / ${SORDER.length}</span></div>
        ${i < SORDER.length - 1 ? `<a class="nbtn nbtn-next" href="#${SORDER[i + 1]}" data-dir="next">${esc(SLIDES[i + 1].title)} →</a>` : `<a class="nbtn nbtn-next" href="#map">Platform map →</a>`}`;
    } else {
      const i = FORDER.indexOf(c.id), back = SLIDES.find((s) => s.id === lastStory);
      const p = FORDER[(i - 1 + FORDER.length) % FORDER.length], n = FORDER[(i + 1) % FORDER.length];
      nav.innerHTML = `
        <a class="nbtn" href="#f-${p}" data-dir="prev">← ${esc(F[p].name)}</a>
        <a class="back" href="#${back.id}">↩ Back to ${esc(back.title)}</a>
        <a class="nbtn nbtn-next" href="#f-${n}" data-dir="next">${esc(F[n].name)} →</a>`;
    }
  }
  function openIndex() {
    $("#index-body").innerHTML = `
      <div><h4>The tour</h4><ol class="ix">${SLIDES.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join("")}</ol></div>
      <div><h4>Platform features</h4>${LAYERS.map((l) => `<p class="ix-l">${esc(l.name)}</p><ul class="ix">${l.items.map((id) => `<li><a href="#f-${id}">${esc(F[id].name)}</a></li>`).join("")}</ul>`).join("")}</div>`;
    $("#index").hidden = false; $("#index-close").focus();
  }
  const closeIndex = () => { $("#index").hidden = true; };

  function runCalc() {
    if (!$("#calc")) return;
    const v = (id) => Math.max(0, parseFloat($(id).value) || 0);
    const vol = v("#c-vol"), min = v("#c-min"), auto = Math.min(v("#c-auto"), 100) / 100, rate = v("#c-rate");
    const hours = (vol * auto * min) / 60;
    $("#c-h").textContent = Math.round(hours).toLocaleString("en-GB");
    $("#c-c").textContent = "£" + Math.round(hours * rate).toLocaleString("en-GB");
    $("#c-f").textContent = (hours / 140).toFixed(1);
  }

  /* full planning record */
  function openPlan() {
    const img = $("#plan-img");
    if (!img.getAttribute("src")) img.src = IMG["plan_full"];
    $("#plan").hidden = false; $("#plan-scroll").scrollTop = 0; $("#plan-close").focus();
  }
  const closePlan = () => { $("#plan").hidden = true; };

  /* lightbox */
  function openBox(key, cap) { $("#box-img").src = IMG[key]; $("#box-img").alt = cap; $("#box-cap").textContent = cap; $("#box").hidden = false; $("#box-close").focus(); }
  function closeBox() { $("#box").hidden = true; $("#box-img").removeAttribute("src"); }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const stage = t.closest("[data-stage]");
    if (stage) {
      const i = +stage.dataset.stage;
      $$("[data-stage]").forEach((b) => b.setAttribute("aria-selected", String(b === stage)));
      $("#stage-panel").innerHTML = stagePanel(i);
      return;
    }
    const vs = t.closest("[data-vstage]");
    if (vs) {
      const i = +vs.dataset.vstage;
      openStage(i);
      $$("[data-sub]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sub === `${i}.0`)));
      $("#sub-detail").innerHTML = subDetail(i, 0);
      return;
    }
    const sb = t.closest("[data-sub]");
    if (sb) {
      const [i, j] = sb.dataset.sub.split(".").map(Number);
      $$("[data-sub]").forEach((b) => b.setAttribute("aria-pressed", String(b === sb)));
      $("#sub-detail").innerHTML = subDetail(i, j);
      return;
    }
    if (t.closest("[data-open-plan]")) { openPlan(); return; }
    if (t.closest("#plan-close") || t.id === "plan") { closePlan(); return; }
    const step = t.closest("[data-step]");
    if (step) {
      $$("[data-step]").forEach((b) => b.setAttribute("aria-pressed", String(b === step)));
      $("#flow-note").textContent = FLOW[+step.dataset.step].t;
      return;
    }
    const th = t.closest("[data-shot]");
    if (th) {
      const main = $(".main-shot .shot");
      main.dataset.zoom = th.dataset.shot; main.querySelector("img").src = IMG[th.dataset.shot]; main.querySelector("img").alt = th.dataset.cap;
      $("#cap").textContent = th.dataset.cap;
      $$("[data-shot]").forEach((b) => b.setAttribute("aria-pressed", String(b === th)));
      return;
    }
    const z = t.closest("[data-zoom]");
    if (z) { openBox(z.dataset.zoom, z.querySelector("img")?.alt || ""); return; }
    if (t.closest("#open-index")) { openIndex(); return; }
    if (t.closest("#index-close") || t.id === "index" || (t.closest("#index") && t.closest("a"))) { closeIndex(); return; }
    if (t.id === "box" || t.closest("#box-close")) { closeBox(); return; }
    if (t.closest("#theme")) {
      const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next; store.set("composer-theme", next);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#box").hidden) closeBox(); else if (!$("#plan").hidden) closePlan(); else if (!$("#index").hidden) closeIndex(); return; }
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (!$("#box").hidden || !$("#index").hidden || !$("#plan").hidden) return;
    const dir = { ArrowRight: "next", PageDown: "next", ArrowLeft: "prev", PageUp: "prev" }[e.key];
    if (dir) { const a = $(`#nav [data-dir="${dir}"]`); if (a) { e.preventDefault(); location.hash = a.getAttribute("href"); } }
  });
  document.addEventListener("input", (e) => { if (e.target.closest("#calc")) runCalc(); });

  const saved = store.get("composer-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  window.addEventListener("hashchange", render);
  render();
})();
