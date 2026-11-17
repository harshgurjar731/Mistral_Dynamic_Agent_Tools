/* Rendering and interaction for the Composer explainer. Depends on DATA, IMG, BANDS, C, STAGE_BIZ, LAYER_TEXT, STEP_BIZ. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const fmtMs = (ms) => {
    if (ms == null) return "–";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
    const m = Math.floor(s / 60), r = Math.round(s - m * 60);
    return `${m}m ${String(r).padStart(2, "0")}s`;
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const bandOf = (id) => BANDS.find((b) => b.id === id);
  const PLAN = DATA.plan, AGENT = DATA.agent, WF = DATA.workflow;

  /* ───────── building blocks ───────── */
  const kpis = (list) => `<div class="kpis">${list.map((k) => `
    <div class="kpi ${k.k === "i" ? "kpi-i" : ""}">
      <div class="kpi-v">${esc(k.v)}</div>
      <div class="kpi-l">${esc(k.l)}</div>
      <span class="tag ${k.k === "i" ? "tag-i" : "tag-m"}">${k.k === "i" ? "Indicative" : "Measured"}</span>
    </div>`).join("")}</div>`;

  const shot = (key, cap, cls = "") => IMG[key] ? `
    <figure class="shot ${cls}">
      <button class="shot-btn" data-zoom="${esc(key)}" aria-label="Enlarge: ${esc(cap)}"><img src="${IMG[key]}" alt="${esc(cap)}" loading="lazy"></button>
      <figcaption>${esc(cap)}</figcaption>
    </figure>` : "";

  const views = (biz, tech, bizTitle = "Business view", techTitle = "Technology view") => `
    <div class="views">
      <section class="view biz"><h4><span class="dot dot-biz"></span>${bizTitle}</h4>${Array.isArray(biz) ? `<ul>${biz.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<p>${esc(biz)}</p>`}</section>
      <section class="view tech"><h4><span class="dot dot-tech"></span>${techTitle}</h4>${Array.isArray(tech) ? `<ul>${tech.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<p>${esc(tech)}</p>`}</section>
    </div>`;

  let lvlSeq = 0;
  /* A level card: header always visible; body opens on double-click (or the toggle button / Enter). */
  const lvl = ({ level, title, meta = "", sub = "", body, id = "", cls = "" }) => {
    const bid = `lvlb-${++lvlSeq}`;
    return `
    <article class="lvl lvl-${level} ${cls}" ${id ? `id="${id}"` : ""}>
      <header class="lvl-h" tabindex="0" aria-controls="${bid}" title="Double-click to open">
        <span class="lvl-n">L${level}</span>
        <div class="lvl-t"><h4>${title}</h4>${sub ? `<p>${sub}</p>` : ""}</div>
        ${meta ? `<div class="lvl-meta">${meta}</div>` : ""}
        <button class="lvl-btn" aria-expanded="false" aria-controls="${bid}" aria-label="Open or close this level"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5"/></svg></button>
      </header>
      <div class="lvl-b" id="${bid}" hidden>${body}</div>
    </article>`;
  };

  const toggle = (card, force) => {
    const body = $(":scope > .lvl-b", card), btn = $(":scope > .lvl-h .lvl-btn", card);
    const open = force ?? body.hidden;
    body.hidden = !open;
    card.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  };

  const crumbs = (parts) => {
    $("#crumbs").innerHTML = parts.map((p, i) => i < parts.length - 1
      ? `<a href="${p[1]}">${esc(p[0])}</a><span aria-hidden="true">›</span>` : `<strong>${esc(p[0])}</strong>`).join("");
  };

  const levelBar = () => `
    <div class="lvlbar">
      <p><b>Double-click</b> any card to open the next level, or press Enter, or use the arrow on touch screens.</p>
      <div class="lvlbar-actions"><button data-all="open">Open every level</button><button data-all="close">Close all</button></div>
    </div>`;

  const linkChips = (ids) => `<div class="chips">${ids.filter((i) => C[i]).map((i) => `
    <a class="chip" href="#c-${i}"><span class="code">${esc(C[i].code)}</span>${esc(C[i].name)}</a>`).join("")}</div>`;

  /* ───────── L0 overview ───────── */
  const tile = (c) => `
    <a class="tile" href="#c-${c.id}" data-band="${c.band}">
      <span class="code">${esc(c.code)}</span>
      <span class="tile-t">${esc(c.name)}</span>
      <span class="tile-p" title="${esc(c.pitch)}">${esc(c.pitch)}</span>
    </a>`;

  function renderOverview() {
    crumbs([["Overview", "#overview"]]);
    const n = Object.keys(C).length;
    return `
    <section class="hero">
      <p class="eyebrow">Client walkthrough · ${n} components · captured live on 17 Nov 2026</p>
      <h1>Dynamic Agentic Workflow Composer</h1>
      <p class="tagline">Compose, adapt and govern enterprise agentic workflows on demand, powered by Mistral AI.</p>
      <p class="lede">Business teams describe the outcome in plain English. The Composer does the solution design, writes and tests the code,
      creates the agents, applies the controls, and puts the result live on Mistral, with every decision explained.</p>
      ${kpis([
        { v: fmtMs(PLAN.duration_ms), l: "goal to a verified 12-step workflow registered on Mistral (supplier invoices)", k: "m" },
        { v: `${PLAN.layer_counts.completed} / ${PLAN.layer_counts.total}`, l: `design layers completed, ${PLAN.layer_counts.failed} failed, ${PLAN.rewinds} rewinds`, k: "m" },
        { v: "3 / 3", l: "self-written test scenarios passing after 1 automatic repair", k: "m" },
        { v: fmtMs(AGENT.duration_ms), l: "plain-English request to a tested Mistral agent", k: "m" },
        { v: `${(WF.metrics.average_latency_ms / 1000).toFixed(1)} s`, l: `average end-to-end run on Mistral Workflows (${WF.metrics.success_count} of ${WF.metrics.execution_count} runs completed)`, k: "m" },
        { v: "Days → minutes", l: "build effort versus hand-building a governed workflow (assumption, replace with the client's baseline)", k: "i" },
      ])}
    </section>

    <section class="sec">
      <div class="sec-h"><h2>Two journeys to show the client</h2><p>Real builds picked from the Composer's history. Click to walk through every layer.</p></div>
      <div class="journeys">
        <a class="journey" href="#journey-workflow">
          <span class="j-k">Journey 1 · Workflow</span>
          <span class="j-t">From a business goal to a governed workflow</span>
          <span class="j-p">Supplier invoice approval with mandatory human review: ${PLAN.stages.length} stages, ${PLAN.layer_counts.total} layers, ${fmtMs(PLAN.duration_ms)}.</span>
          <span class="j-flow">${PLAN.stages.map((s) => `<i style="flex:${Math.max(s.ms, 15000)}" title="${esc(s.label)} · ${fmtMs(s.ms)}"></i>`).join("")}</span>
        </a>
        <a class="journey" href="#journey-agent">
          <span class="j-k">Journey 2 · Agent</span>
          <span class="j-t">From a one-line request to a tested agent</span>
          <span class="j-p">"Draft an onboarding checklist for a new data engineer": ${AGENT.stages.length} stages, ${AGENT.layer_counts.total} layers, ${fmtMs(AGENT.duration_ms)}.</span>
          <span class="j-flow">${AGENT.stages.map((s) => `<i style="flex:${Math.max(s.ms, 4000)}" title="${esc(s.label)} · ${fmtMs(s.ms)}"></i>`).join("")}</span>
        </a>
      </div>
    </section>

    <section class="sec">
      <div class="sec-h"><h2>Every component, layer by layer</h2><p>Seven layers, top to bottom: from the people using it down to Mistral. Click a component to open it.</p></div>
      <div class="stack">
        ${BANDS.map((b) => `
          <div class="band" id="band-${b.id}">
            <div class="band-label"><span class="band-n">${b.n}</span><h3>${esc(b.name)}</h3><p>${esc(b.line)}</p></div>
            <div class="band-tiles">${Object.values(C).filter((c) => c.band === b.id).map(tile).join("")}</div>
          </div>`).join("")}
      </div>
    </section>

    <section class="sec">
      <div class="sec-h"><h2>Business case</h2><p>What to say in one breath, and a calculator to size the value with the client's own figures.</p></div>
      <div class="pitch-grid">
        <div class="pitch"><h4>Speed to value</h4><p>Goals become running, governed workflows in under half an hour of machine time, not a sprint.</p></div>
        <div class="pitch"><h4>Lower run cost</h4><p>8 of 12 invoice steps are plain code with no model calls. AI is used only where judgement is needed.</p></div>
        <div class="pitch"><h4>Compliance built in</h4><p>16 rules, guardrails and human review are applied at build and run time, with every verdict traced.</p></div>
        <div class="pitch"><h4>Compounding reuse</h4><p>Every agent, activity and workflow is catalogued and versioned for the next build to reuse.</p></div>
      </div>
      ${calculator()}
    </section>`;
  }

  /* ───────── value calculator (indicative) ───────── */
  function calculator() {
    return `
    <div class="calc" id="calc">
      <div class="calc-h"><h3>Value sizing</h3><span class="tag tag-i">Indicative · example assumptions</span></div>
      <p class="calc-note">Every input below is an example. Replace them with the client's own volumes and costs. The invoice routing logic is the one the Composer built.</p>
      <div class="calc-grid">
        <label for="calc-vol">Invoices per month<input id="calc-vol" type="number" min="0" step="100" value="2000"></label>
        <label for="calc-min">Manual minutes per invoice today<input id="calc-min" type="number" min="0" step="1" value="12"></label>
        <label for="calc-auto">Share that can auto-route (approve or reject), %<input id="calc-auto" type="number" min="0" max="100" step="5" value="60"></label>
        <label for="calc-rev">Time saved on reviewed invoices, %<input id="calc-rev" type="number" min="0" max="100" step="5" value="40"></label>
        <label for="calc-rate">Loaded cost per hour (£)<input id="calc-rate" type="number" min="0" step="1" value="35"></label>
      </div>
      <div class="calc-out" aria-live="polite">
        <div><span id="calc-h">–</span><small>hours saved per month</small></div>
        <div><span id="calc-c">–</span><small>cost avoided per month</small></div>
        <div><span id="calc-f">–</span><small>full-time equivalents (140 h per month)</small></div>
      </div>
    </div>`;
  }
  function runCalc() {
    const v = (id) => Math.max(0, parseFloat($(id)?.value) || 0);
    if (!$("#calc")) return;
    const vol = v("#calc-vol"), min = v("#calc-min"), auto = Math.min(v("#calc-auto"), 100) / 100,
      rev = Math.min(v("#calc-rev"), 100) / 100, rate = v("#calc-rate");
    const hours = (vol * auto * min + vol * (1 - auto) * min * rev) / 60;
    $("#calc-h").textContent = Math.round(hours).toLocaleString("en-GB");
    $("#calc-c").textContent = "£" + Math.round(hours * rate).toLocaleString("en-GB");
    $("#calc-f").textContent = (hours / 140).toFixed(1);
  }

  /* ───────── L1 component page ───────── */
  function renderComponent(id) {
    const c = C[id];
    if (!c) return renderOverview();
    const band = bandOf(c.band);
    crumbs([["Overview", "#overview"], [band.name, `#overview`], [c.name, `#c-${id}`]]);
    const siblings = Object.values(C).filter((x) => x.band === c.band);
    const i = siblings.indexOf(c);
    const prev = siblings[i - 1], next = siblings[i + 1];
    const shots = c.shots || [];
    return `
    <section class="page-h">
      <a class="back" href="#overview">← All components</a>
      <div class="ph-row">
        <span class="code code-lg">${esc(c.code)}</span>
        <div><p class="eyebrow">${esc(band.n)} · ${esc(band.name)}</p><h1>${esc(c.name)}</h1></div>
      </div>
      <p class="lede">${esc(c.pitch)}</p>
      ${kpis(c.kpis)}
    </section>
    ${views(c.biz, c.tech)}
    ${c.journey ? `<a class="cta" href="#${c.journey}"><span>See it working on a real build</span><b>${c.journey === "journey-workflow" ? "Journey 1 · Goal to governed workflow" : "Journey 2 · Request to tested agent"} →</b></a>` : ""}
    ${(c.layers && c.layers.length) ? `
      <section class="sec">
        <div class="sec-h"><h2>Inside ${esc(c.name)}</h2><p>Each part with its business purpose and how it works.</p></div>
        ${levelBar()}
        <div class="lvls">${c.layers.map((l) => lvl({
          level: 2, title: esc(l.t), sub: esc(l.biz),
          body: `${views(l.biz, l.tech)}${l.img ? shot(l.img, `${l.t}: evidence from the live Composer`, "shot-crop") : ""}`,
        })).join("")}</div>
      </section>` : ""}
    ${shots.length ? `
      <section class="sec">
        <div class="sec-h"><h2>On the live Composer</h2><p>Captured from the running system. Click a screen to enlarge.</p></div>
        <div class="gallery ${shots.length === 1 ? "gallery-1" : ""}">${shots.map(([k, cap]) => shot(k, cap)).join("")}</div>
      </section>` : ""}
    <section class="sec">
      <div class="sec-h"><h2>Connected components</h2></div>
      ${linkChips(c.links || [])}
      <nav class="pager">
        ${prev ? `<a href="#c-${prev.id}">← ${esc(prev.name)}</a>` : "<span></span>"}
        ${next ? `<a href="#c-${next.id}">${esc(next.name)} →</a>` : "<span></span>"}
      </nav>
    </section>`;
  }

  /* ───────── journeys: shared stage/layer renderer ───────── */
  function stageCards(run, kind) {
    const prefix = kind === "wf" ? "plan_layer_" : "agent_layer_";
    return run.stages.map((s, i) => {
      const layers = s.layers.map((l) => {
        const txt = (kind === "ag" && LAYER_TEXT[l.name + "_ag"]) || LAYER_TEXT[l.name] || ["", l.detail || ""];
        const key = prefix + slug(l.label);
        const skipped = l.state === "skipped";
        const inner = l.depth === 2;
        return lvl({
          level: 3, cls: inner ? "lvl-inner" : "",
          title: `${esc(l.label)}${inner ? ` <span class="pill pill-c">concurrent</span>` : ""}`,
          sub: esc(txt[0]),
          meta: `<span class="ms">${skipped ? "skipped" : fmtMs(l.ms)}</span>`,
          body: `
            ${views(txt[0], [txt[1], l.detail].filter(Boolean))}
            ${l.summary ? `<div class="decided"><h5>What it decided in this build</h5><p>${esc(l.summary)}</p></div>` : ""}
            ${shot(key, `${l.label}, as recorded by the Composer`, "shot-crop")}`,
        });
      }).join("");
      const share = (s.ms / run.duration_ms) * 100;
      return lvl({
        level: 2, id: `st-${kind}-${s.name}`,
        title: `<span class="stage-i">${i + 1}</span>${esc(s.label)}`,
        sub: esc(STAGE_BIZ[`${s.name}@${kind}`] || s.detail),
        meta: `<span class="ms">${fmtMs(s.ms)}</span><span class="count">${s.layers.length} layer${s.layers.length === 1 ? "" : "s"}</span>`,
        body: `<p class="stage-tech"><span class="dot dot-tech"></span>${esc(s.detail)} <span class="share">${share.toFixed(share < 1 ? 2 : 0)}% of build time</span></p>
               <div class="lvls">${layers}</div>`,
      });
    }).join("");
  }

  function timeline(run, kind) {
    return `<div class="timeline" role="list">${run.stages.map((s, i) => `
      <button role="listitem" class="tl-seg" data-stage="st-${kind}-${s.name}" style="flex:${Math.max(s.ms, run.duration_ms * 0.035)}" title="${esc(s.label)} · ${fmtMs(s.ms)}">
        <span class="tl-i">${i + 1}</span><span class="tl-l">${esc(s.label)}</span><span class="tl-ms">${fmtMs(s.ms)}</span>
      </button>`).join("")}</div>`;
  }

  /* ───────── journey 1: workflow ───────── */
  function graphSvg() {
    const steps = Object.fromEntries(WF.steps.map((s) => [s.id, s]));
    const rows = ["input_safety_validation", "validate_invoice_business_rules", "recalculate_invoice_amounts", "match_invoice_to_po",
      "determine_approval_route", "condition_human_review", "generate_review_summary", "conduct_human_review",
      "select_human_review_result", "determine_final_status", "draft_notification", "output_safety_validation"];
    const right = new Set(["generate_review_summary", "conduct_human_review"]);
    const H = 44, G = 64, W = 660, MX = 40, MW = 300, RX = 400, RW = 240;
    const pos = {};
    rows.forEach((id, i) => { pos[id] = right.has(id) ? { x: RX, w: RW, y: 16 + i * G } : { x: MX, w: MW, y: 16 + i * G }; });
    const kind = (t) => ({ tool: "activity", agent: "agent", condition: "condition", transform: "transform" }[t] || "activity");
    const label = (t) => ({ tool: "activity", agent: "agent", condition: "condition", transform: "transform" }[t] || t);
    const cx = (p) => p.x + p.w / 2;
    const edge = (a, b, lbl = "", lx = 0) => {
      const p = pos[a], q = pos[b];
      let d;
      if (p.x === q.x) d = `M${cx(p)},${p.y + H} L${cx(q)},${q.y - 2}`;
      else d = `M${cx(p)},${p.y + H} C${cx(p)},${p.y + H + 26} ${cx(q)},${q.y - 30} ${cx(q)},${q.y - 2}`;
      return `<path class="g-edge" d="${d}" marker-end="url(#arr)"/>${lbl ? `<text class="g-elbl" x="${lx}" y="${p.y + H + 16}">${lbl}</text>` : ""}`;
    };
    const bypass = (() => { const p = pos.condition_human_review, q = pos.select_human_review_result;
      return `<path class="g-edge" d="M${p.x + 26},${p.y + H} L${q.x + 26},${q.y - 2}" marker-end="url(#arr)"/>
              <text class="g-elbl" x="${p.x + 34}" y="${p.y + H + 40}">otherwise</text>`; })();
    let edges = "";
    for (let i = 0; i < 5; i++) edges += edge(rows[i], rows[i + 1]);
    edges += edge("condition_human_review", "generate_review_summary", "route = human_review", RX - 4);
    edges += edge("generate_review_summary", "conduct_human_review");
    edges += edge("conduct_human_review", "select_human_review_result");
    edges += bypass;
    for (let i = 8; i < 11; i++) edges += edge(rows[i], rows[i + 1]);
    const nodes = rows.map((id) => {
      const p = pos[id], s = steps[id] || { type: "tool" };
      return `<g class="g-node g-${kind(s.type)}"><title>${esc(STEP_BIZ[id] || "")}</title>
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${H}" rx="${s.type === "condition" ? 22 : 8}"/>
        <text class="g-id" x="${p.x + 14}" y="${p.y + 19}">${esc(id)}</text>
        <text class="g-type" x="${p.x + 14}" y="${p.y + 35}">${label(s.type)}${s.tier === "foundation" ? " · safety" : ""}</text></g>`;
    }).join("");
    return `<div class="graph-wrap"><svg class="graph" viewBox="0 0 ${W} ${16 + rows.length * G}" role="img" aria-label="The 12-step supplier invoice workflow graph">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="g-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
      ${edges}${nodes}</svg></div>`;
  }

  function renderJourneyWorkflow() {
    crumbs([["Overview", "#overview"], ["Journey 1 · Goal to governed workflow", "#journey-workflow"]]);
    const counts = WF.steps.reduce((a, s) => (a[s.type] = (a[s.type] || 0) + 1, a), {});
    const runs = (WF.metrics.latency_over_time || []).map((r) => r[1]);
    const goal = PLAN.goal;
    const goalShort = goal.split("\n")[0].replace(/^Build a workflow that /, "").replace(/\.$/, "");
    return `
    <section class="page-h">
      <a class="back" href="#overview">← Overview</a>
      <p class="eyebrow">Journey 1 · picked from history · planned 16 Nov 2026</p>
      <h1>From a business goal to a governed workflow</h1>
      <p class="lede">The planner was given one goal: a workflow that ${esc(goalShort)}. Here is what each layer of the Composer did with it, in order, with its real timings.</p>
      ${kpis([
        { v: fmtMs(PLAN.duration_ms), l: "end to end, goal to registered workflow", k: "m" },
        { v: `${PLAN.stages.length} · ${PLAN.layer_counts.total}`, l: "stages · layers run, all completed", k: "m" },
        { v: `${counts.tool} + ${counts.agent}`, l: "activities (plain code) + agents in the result", k: "m" },
        { v: "3 / 3", l: "test scenarios passing after 1 automatic repair", k: "m" },
        { v: `${PLAN.calls.find((c) => c.kind === "model")?.count ?? "–"}`, l: "model calls to design and build it", k: "m" },
      ])}
    </section>
    ${levelBar()}

    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">A</span>The ask</h2><p>The goal exactly as the business wrote it.</p></div>
      ${lvl({ level: 1, title: "Supplier invoice approval", sub: "Approve supplier invoices for payment, with mandatory human review over a threshold or on a mismatch.",
        meta: `<span class="count">${goal.split("\n").filter((x) => /^\d\./.test(x.trim())).length} business steps</span>`,
        body: `<pre class="goal">${esc(goal)}</pre>` })}
    </section>

    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">B</span>How the Composer built it, stage by stage</h2>
        <p>Bar widths show where the time went. Click a stage on the bar to jump to it, or double-click a stage card to see its layers. Double-click a layer to see what it decided.</p></div>
      ${timeline(PLAN, "wf")}
      <div class="lvls">${stageCards(PLAN, "wf")}</div>
    </section>

    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">C</span>What got built</h2><p>${WF.steps.length} steps: ${counts.tool} activities, ${counts.agent} agents, ${counts.condition} condition, ${counts.transform} transform. Human review is only reached when the route requires it.</p></div>
      <div class="built">
        ${graphSvg()}
        <div class="built-side">
          <div class="legend"><span class="lg lg-activity">Activity: plain code, no model</span><span class="lg lg-agent">Agent: Mistral model</span><span class="lg lg-condition">Condition</span><span class="lg lg-transform">Transform</span></div>
          <div class="lvls">${WF.steps.map((s) => lvl({ level: 2, title: `<code>${esc(s.id)}</code>`, sub: esc(STEP_BIZ[s.id] || ""),
            meta: `<span class="pill pill-${s.type}">${s.type === "tool" ? "activity" : s.type}</span>`,
            body: views(STEP_BIZ[s.id] || "", [s.description, s.tier ? `Tier: ${s.tier}.` : ""].filter(Boolean)) })).join("")}</div>
        </div>
      </div>
      <div class="gallery">${shot("wf_builder", "The same workflow in the visual builder, editable by hand.")}${shot("wf_compiled_module", "Compiled to a Mistral Workflows SDK module.")}</div>
    </section>

    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">D</span>Tested and repaired before anyone reviewed it</h2></div>
      <ol class="story">
        <li><b>Test pack written.</b> Three scenarios from the business rules: an over-PO invoice that needs review, a small invoice that auto-approves, and an unapproved supplier that is rejected.</li>
        <li><b>First dry run, 17:44.</b> Two of the three scenarios failed: on paths without a review, the final-status step had no review result to read.</li>
        <li><b>Diagnosed and fixed automatically, 17:47.</b> ${esc(WF.revision?.summary || "")} Applied as version ${esc(WF.revision?.applied_version || "2")}.</li>
        <li><b>Second dry run, 17:47.</b> All three scenarios passed, then the workflow was accepted and registered.</li>
      </ol>
      <div class="gallery">${shot("plan_layer_dry_run_and_repair", "Dry-run and repair: 20 steps, 3 of 3 passing after 1 repair.", "shot-crop")}${shot("wf_refine", "The repair, kept in the workflow's revision history.")}</div>
    </section>

    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">E</span>Live on Mistral Workflows</h2></div>
      ${kpis([
        { v: `${WF.metrics.success_count} / ${WF.metrics.execution_count}`, l: "production runs completed", k: "m" },
        { v: runs.map((r) => (r / 1000).toFixed(1) + " s").join(" · "), l: "end-to-end run times, 11 steps executed each", k: "m" },
        { v: "Over PO → review", l: "both runs sent the sample invoice (gross £5,400 against £4,000 left on the PO) down the human-review branch", k: "m" },
      ])}
      <div class="gallery">${shot("wf_execute", "Run form generated from the input schema.")}${shot("run_execution", "The run's trace: input and dispatch to the Mistral worker.")}</div>
      ${linkChips(["reviews", "runs", "logs", "refine", "builder"])}
    </section>`;
  }

  /* ───────── journey 2: agent ───────── */
  function renderJourneyAgent() {
    crumbs([["Overview", "#overview"], ["Journey 2 · Request to tested agent", "#journey-agent"]]);
    const ev = AGENT.events || {};
    const req = ev.requirements || {}, cfg = ev.agent_config || {}, evals = ev.agent_evaluation || {};
    const rules = (ev.rules_applied && ev.rules_applied.outcomes) || [];
    return `
    <section class="page-h">
      <a class="back" href="#overview">← Overview</a>
      <p class="eyebrow">Journey 2 · picked from history · built 17 Nov 2026</p>
      <h1>From a one-line request to a tested agent</h1>
      <p class="lede">One sentence was typed into the Orchestrator. The Composer worked out the brief, designed the agent, put its controls in place, created it on Mistral, graded it, and answered the request.</p>
      ${kpis([
        { v: fmtMs(AGENT.duration_ms), l: `end to end, including ${fmtMs(AGENT.waiting_ms)} waiting for the user's answer`, k: "m" },
        { v: `${AGENT.layer_counts.completed} / ${AGENT.layer_counts.total}`, l: `layers completed (${AGENT.layer_counts.skipped} skipped as not needed)`, k: "m" },
        { v: `${rules.length}`, l: "rules in force or passed at creation", k: "m" },
        { v: `${evals.passed_after ?? "–"} / ${evals.tests ?? "–"}`, l: "test prompts passing; instructions revised automatically from the judge's findings", k: "m" },
      ])}
    </section>
    ${levelBar()}
    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">A</span>The ask, and the brief the Composer wrote</h2></div>
      ${lvl({ level: 1, title: esc(AGENT.goal), sub: esc(req.intent || ""), meta: `<span class="count">${esc(req.complexity || "")} · ${esc(req.task_type || "")}</span>`,
        body: `<div class="brief"><p><b>Deliverable.</b> ${esc(req.deliverable || "")}</p>
          ${(req.success_criteria || []).length ? `<h5>Done when</h5><ul>${req.success_criteria.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
          ${shot("agent_layer_understand_the_request", "Understand the request, as recorded", "shot-crop")}` })}
    </section>
    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">B</span>How the Composer built it, stage by stage</h2><p>Click a stage on the bar to jump to it; double-click cards to go deeper.</p></div>
      ${timeline(AGENT, "ag")}
      <div class="lvls">${stageCards(AGENT, "ag")}</div>
    </section>
    <section class="sec">
      <div class="sec-h"><h2><span class="sec-n">C</span>What got built</h2></div>
      <div class="agent-card">
        <div class="ac-h"><span class="code">Ag</span><div><h3><code>${esc(cfg.agent_name || "")}</code></h3><p>${esc(cfg.description || "")}</p></div></div>
        <dl class="ac-dl"><div><dt>Model</dt><dd><code>${esc(cfg.model || "")}</code> at temperature ${esc(cfg.temperature ?? "")}</dd></div>
          <div><dt>Tier</dt><dd>${esc(cfg.tier || "")}</dd></div>
          <div><dt>Tools / connectors</dt><dd>${(cfg.tools || []).length} / ${(cfg.connectors || []).length}: the job needs only the model's own knowledge</dd></div></dl>
        <h5>Rules at creation</h5>
        <ul class="rules">${rules.map((r) => `<li><span class="pill ${r.outcome === "passed" ? "pill-ok" : "pill-agent"}">${esc(r.outcome)}</span><b>${esc(r.name)}</b> ${esc(r.message)}</li>`).join("")}</ul>
      </div>
      <div class="gallery">${shot("agent_layer_test_the_agent", "Test the agent: designed prompts, judged, instructions revised.", "shot-crop")}${shot("agent_build_top", "The build reopened from the Orchestrator's history.")}</div>
      ${linkChips(["orchestrator", "agentpipe", "agents", "rules", "playground"])}
    </section>`;
  }

  /* ───────── router ───────── */
  function route() {
    const h = location.hash.replace(/^#/, "");
    let html;
    if (h === "journey-workflow") html = renderJourneyWorkflow();
    else if (h === "journey-agent") html = renderJourneyAgent();
    else if (h.startsWith("c-")) html = renderComponent(h.slice(2));
    else html = renderOverview();
    const main = $("#main");
    main.innerHTML = html;
    runCalc();
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  /* ───────── events ───────── */
  document.addEventListener("dblclick", (e) => {
    const h = e.target.closest(".lvl-h");
    if (!h || e.target.closest("a")) return;
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();
    toggle(h.parentElement);
  });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".lvl-btn");
    if (btn) { e.stopPropagation(); toggle(btn.closest(".lvl")); return; }
    const all = e.target.closest("[data-all]");
    if (all) { const open = all.dataset.all === "open"; $$("#main .lvl").forEach((c) => toggle(c, open)); return; }
    const seg = e.target.closest("[data-stage]");
    if (seg) {
      const card = document.getElementById(seg.dataset.stage);
      if (card) { toggle(card, true); card.scrollIntoView({ behavior: "smooth", block: "start" }); }
      return;
    }
    const z = e.target.closest("[data-zoom]");
    if (z) { openBox(z.dataset.zoom, z.querySelector("img")?.alt || ""); return; }
    const lens = e.target.closest("[data-lens]");
    if (lens) { setLens(lens.dataset.lens); return; }
    if (e.target.closest("#theme")) { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : document.documentElement.dataset.theme === "light" ? "dark" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark")); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#box").hidden) { closeBox(); return; }
    const h = e.target.closest && e.target.closest(".lvl-h");
    if (h && (e.key === "Enter" || e.key === " ") && e.target === h) { e.preventDefault(); toggle(h.parentElement); }
  });
  document.addEventListener("input", (e) => { if (e.target.closest("#calc")) runCalc(); });

  /* lightbox */
  function openBox(key, cap) {
    $("#box-img").src = IMG[key]; $("#box-img").alt = cap; $("#box-cap").textContent = cap;
    $("#box").hidden = false; $("#box-close").focus();
  }
  function closeBox() { $("#box").hidden = true; $("#box-img").removeAttribute("src"); }
  $("#box").addEventListener("click", (e) => { if (e.target.id === "box" || e.target.closest("#box-close")) closeBox(); });

  /* lens + theme */
  function setLens(l) {
    document.body.dataset.lens = l;
    $$("[data-lens]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lens === l)));
    store.set("composer-lens", l);
  }
  function setTheme(t) { document.documentElement.dataset.theme = t; store.set("composer-theme", t); }
  const savedTheme = store.get("composer-theme");
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
  setLens(["both", "biz", "tech"].includes(store.get("composer-lens")) ? store.get("composer-lens") : "both");

  window.addEventListener("hashchange", route);
  route();
})();
