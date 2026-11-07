import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Building2,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Eye,
  FileSearch,
  GitBranch,
  HeartPulse,
  Headphones,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  Lock,
  MessageSquare,
  Network,
  Plug,
  Puzzle,
  Rocket,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Terminal,
  Unplug,
  UserCheck,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { gsap, useGSAP } from "./motion";
import {
  ChatVisual,
  CodeVisual,
  DagVisual,
  GraphVisual,
  Reveal,
  ReviewVisual,
  TraceVisual,
  WorkspacesVisual,
} from "./visuals";

/* ── Section frame ─────────────────────────────────────────────────────── */

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
  center,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  center?: boolean;
}) {
  return (
    <section id={id} className={cn("relative scroll-mt-20", className)}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <div className={cn("max-w-3xl", center && "mx-auto text-center")}>
          <Reveal>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <span className="h-px w-6 bg-primary/60" /> {eyebrow}
            </p>
          </Reveal>
          <h2
            data-a="heading"
            className="mt-4 font-display text-3xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-4xl"
          >
            {title}
          </h2>
          {intro ? (
            <Reveal delay={0.15}>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
                {intro}
              </p>
            </Reveal>
          ) : null}
        </div>
        <div className="mt-12 lg:mt-16">{children}</div>
      </div>
    </section>
  );
}

/* ── Integrations strip (under the hero) ───────────────────────────────── */

const STRIP = [
  "Mistral AI",
  "Mistral Agents",
  "Mistral Workflows",
  "Model Context Protocol",
  "Neo4j",
  "Docker",
  "AWS EC2",
  "Azure VM",
  "Google Compute Engine",
  "DigitalOcean",
  "NVIDIA Brev",
  "OpenTelemetry",
];

export function IntegrationStrip() {
  const items = [...STRIP, ...STRIP];
  return (
    <div className="relative overflow-hidden border-y border-border bg-background-elevated/50 py-5">
      <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Works with the stack you already run
      </p>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent"
        aria-hidden
      />
      <div data-a="marquee" className="flex w-max gap-3 will-change-transform">
        {items.map((name, i) => (
          <span
            key={`${name}-${i}`}
            aria-hidden={i >= STRIP.length || undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 text-sm text-foreground"
          >
            <span className="size-1.5 rounded-full bg-primary" /> {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Manifesto (words light up as you read) ────────────────────────────── */

export function ManifestoSection() {
  return (
    <section aria-label="Why it exists" className="relative">
      <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 lg:py-36">
        <Reveal>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-px w-6 bg-primary/60" /> Why it exists
          </p>
        </Reveal>
        <p
          data-a="manifesto"
          className="mt-6 font-display text-[1.85rem] font-bold leading-[1.25] tracking-tight text-foreground sm:text-5xl sm:leading-[1.15]"
        >
          Every business already knows how its work should be done. The rules live in policies, the
          steps in people&apos;s heads, the exceptions in email threads.{" "}
          <span className="text-primary">We turn that knowledge into agents that do the work</span>{" "}
          — and show you exactly how they did it.
        </p>
      </div>
    </section>
  );
}

/* ── Problem ───────────────────────────────────────────────────────────── */

const PROBLEMS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Unplug,
    title: "Agents stop where their tools stop",
    body: "An agent can only call the functions it shipped with. The first task that needs something new means a developer, a release and a wait.",
  },
  {
    icon: Puzzle,
    title: "Every process is a custom project",
    body: "Prompts, tools, retrieval, orchestration and deployment are glued together by hand for each use case — and rebuilt for the next one.",
  },
  {
    icon: ShieldAlert,
    title: "Automation without guardrails",
    body: "Regulated work needs rules, approvals and a person in the loop. Most agent stacks leave that to whoever writes the prompt.",
  },
  {
    icon: Eye,
    title: "A black box nobody can audit",
    body: "When an answer is wrong, there is no record of which step, tool, rule or model call produced it — or who was allowed to run it.",
  },
];

export function ProblemSection() {
  return (
    <Section
      id="problem"
      eyebrow="The problem"
      title={
        <>
          AI agents are easy to demo.{" "}
          <span className="text-gradient-brand">Hard to put to work.</span>
        </>
      }
      intro="Teams can get a model to answer questions in an afternoon. Turning that into a dependable business process — one that does real work, follows the rules and can be explained afterwards — is where projects stall."
    >
      {/* Each card sticks a little lower than the last, so they pile up as you
          scroll; the one underneath sinks back (motion.ts: stack). */}
      <div className="mx-auto max-w-4xl">
        {PROBLEMS.map((p, i) => (
          <div
            key={p.title}
            data-a="stack-card"
            className="sticky pb-6"
            style={{ top: `calc(5.5rem + ${i * 1.25}rem)` }}
          >
            <div
              data-a="stack-inner"
              className="relative origin-top overflow-hidden rounded-3xl border border-border bg-background-elevated p-7 shadow-[0_-18px_50px_-30px_rgb(0_0_0/0.6)] sm:p-10"
            >
              <div
                aria-hidden
                className="absolute -right-16 -top-16 size-56 rounded-full bg-red/10 blur-3xl"
              />
              <div className="relative grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-10">
                <div className="flex items-center gap-4 sm:flex-col sm:items-start">
                  <span className="font-mono text-5xl font-bold leading-none text-red/30 sm:text-6xl">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="grid size-11 place-items-center rounded-xl border border-red/25 bg-red/10">
                    <p.icon className="size-5 text-red" />
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground sm:text-2xl">{p.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </div>
              <div
                aria-hidden
                data-a="stack-shade"
                className="pointer-events-none absolute inset-0 z-10 bg-background opacity-0"
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Solution ──────────────────────────────────────────────────────────── */

const FLOW: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Sparkles,
    title: "Describe the outcome",
    body: "Write the goal in plain language — “pre-screen mortgage applications”. No flowcharts, no code.",
  },
  {
    icon: Bot,
    title: "The platform designs it",
    body: "It reads your process knowledge, then designs the agents, their instructions and how they hand work to each other — or a deterministic multi-step workflow.",
  },
  {
    icon: Wrench,
    title: "It equips itself",
    body: "Capabilities that don't exist yet are written as tools, linted, checked and tested in a sandbox before they're registered. Existing agents, tools and libraries are reused.",
  },
  {
    icon: ShieldCheck,
    title: "Governed from the first run",
    body: "Rules and gates are attached automatically, human-review steps pause for a person, and every action is checked against the caller's role.",
  },
  {
    icon: Rocket,
    title: "Run it anywhere, see everything",
    body: "Run on the local engine or Mistral Workflows, deploy to your own servers, and trace every step, tool call and model call.",
  },
];

export function SolutionSection() {
  return (
    <div
      data-a="iris"
      className="relative overflow-hidden border-y border-border bg-background-elevated/70"
    >
      <div aria-hidden className="grid-backdrop absolute inset-0 opacity-40" />
      <div
        aria-hidden
        data-a="iris-glow"
        className="pointer-events-none absolute inset-x-0 top-[8%] mx-auto h-[560px] w-[min(960px,100%)]"
      >
        <div
          className="size-full rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
      </div>
      <Section
        id="solution"
        eyebrow="The solution"
        title={
          <>
            One control plane from <span className="text-gradient-brand">intent to production</span>
          </>
        }
        intro="Agentic AI Design Patterns turns a business goal into a running, governed AI workflow — designed, equipped, checked and observed by the platform itself, on Mistral."
      >
        <div data-a="flow" className="relative">
          {/* The track, and the line that draws along it as you scroll. */}
          <div
            aria-hidden
            className="absolute bottom-6 left-[1.375rem] top-6 w-px bg-border sm:left-[1.625rem]"
          />
          <div
            aria-hidden
            data-a="flow-line"
            className="absolute bottom-6 left-[1.375rem] top-6 w-[2px] -translate-x-[0.5px] rounded-full bg-gradient-to-b from-primary via-primary to-primary/30 shadow-[0_0_14px_var(--primary)] sm:left-[1.625rem]"
          />
          <ol className="space-y-5">
            {FLOW.map((s, i) => (
              <li
                key={s.title}
                data-a="flow-step"
                className="flow-step relative flex gap-5 sm:gap-7"
              >
                <span
                  data-a="flow-dot"
                  className="flow-dot relative z-10 grid size-11 shrink-0 place-items-center rounded-full border border-primary/40 bg-background text-primary transition-all duration-500 sm:size-[3.25rem]"
                >
                  <s.icon className="size-5" />
                </span>
                <div
                  data-a="flow-body"
                  className="flow-body glass flex-1 rounded-2xl p-5 transition-all duration-500 sm:p-6"
                >
                  <p className="font-mono text-[11px] font-bold text-primary">
                    STEP {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>
    </div>
  );
}

/* ── Product reveal (pinned on desktop) ────────────────────────────────── */

const CAPTIONS: { eyebrow: string; title: ReactNode; body: string }[] = [
  {
    eyebrow: "The product",
    title: (
      <>
        One console for <span className="text-gradient-brand">every agent and workflow</span>
      </>
    ),
    body: "Design, run, review and observe — in the same place, scoped to your workspace and role.",
  },
  {
    eyebrow: "Design",
    title: (
      <>
        Goals become <span className="text-gradient-brand">workflows you can see</span>
      </>
    ),
    body: "Every step, agent and hand-off laid out. Revise it in plain language, version it, publish it.",
  },
  {
    eyebrow: "Run & observe",
    title: (
      <>
        Every run, <span className="text-gradient-brand">traced as it happens</span>
      </>
    ),
    body: "Live steps, rule verdicts and reviews waiting for a person — nothing happens off the record.",
  },
];

const MOCK_NAV: { icon: LucideIcon; label: string }[] = [
  { icon: MessageSquare, label: "Orchestrator" },
  { icon: GitBranch, label: "Workflows" },
  { icon: Bot, label: "Agents" },
  { icon: Wrench, label: "Tools" },
  { icon: Library, label: "Knowledge" },
  { icon: UserCheck, label: "Reviews" },
  { icon: SquareTerminal, label: "Logs" },
];

const MOCK_NODES: { x: number; y: number; label: string; tone?: "review" | "done" }[] = [
  { x: 70, y: 150, label: "Read application", tone: "done" },
  { x: 225, y: 75, label: "Credit check", tone: "done" },
  { x: 225, y: 225, label: "Income check", tone: "done" },
  { x: 380, y: 150, label: "Affordability rules" },
  { x: 530, y: 80, label: "Underwriter review", tone: "review" },
  { x: 530, y: 220, label: "Decision letter" },
];

const MOCK_EDGES = [
  "M130 150 C150 150 145 75 165 75",
  "M130 150 C150 150 145 225 165 225",
  "M285 75 C305 75 300 150 320 150",
  "M285 225 C305 225 300 150 320 150",
  "M440 150 C460 150 450 80 470 80",
  "M440 150 C460 150 450 220 470 220",
];

function PlatformMock() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px] border border-border-strong bg-background shadow-[0_40px_120px_-40px_rgb(0_0_0/0.65)]">
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-border bg-background-elevated px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-red/70" />
          <span className="size-2.5 rounded-full bg-amber/70" />
          <span className="size-2.5 rounded-full bg-emerald/70" />
        </span>
        <span className="mx-auto truncate rounded-md border border-border bg-background px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
          workflows / mortgage-pre-screen
        </span>
      </div>
      <div className="grid min-h-0 flex-1 sm:grid-cols-[1fr_240px] lg:grid-cols-[176px_1fr_260px]">
        {/* Sidebar */}
        <nav className="hidden flex-col gap-1 border-r border-border p-3 lg:flex" aria-hidden>
          <span className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-foreground">
            <LayoutDashboard className="size-4 text-primary" /> Lending team
          </span>
          {MOCK_NAV.map((n) => (
            <span
              key={n.label}
              data-p="nav"
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                n.label === "Workflows"
                  ? "bg-primary/12 font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <n.icon className={cn("size-3.5", n.label === "Workflows" && "text-primary")} />
              {n.label}
            </span>
          ))}
        </nav>

        {/* Canvas */}
        <div className="flex min-w-0 flex-col p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Mortgage pre-screen</p>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              v3
            </span>
            <span className="rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 text-[10px] font-medium text-emerald">
              Published
            </span>
          </div>
          <div className="mt-4 min-h-0 flex-1 rounded-xl border border-border bg-background-elevated/60 p-2">
            <svg
              viewBox="0 0 600 300"
              className="size-full"
              role="img"
              aria-label="A six-step lending workflow"
            >
              {MOCK_EDGES.map((d) => (
                <path key={`t-${d}`} d={d} fill="none" className="stroke-border" strokeWidth={2} />
              ))}
              {MOCK_EDGES.map((d) => (
                <path
                  key={d}
                  d={d}
                  data-p="edge"
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))}
              {MOCK_NODES.map((n) => (
                <g key={n.label} data-p="node">
                  <rect
                    x={n.x - 60}
                    y={n.y - 21}
                    width={120}
                    height={42}
                    rx={10}
                    className={cn(
                      "fill-background",
                      n.tone === "review"
                        ? "stroke-amber"
                        : n.tone === "done"
                          ? "stroke-emerald"
                          : "stroke-primary",
                    )}
                    strokeWidth={1.5}
                  />
                  <text
                    x={n.x}
                    y={n.y + 4}
                    textAnchor="middle"
                    className="fill-foreground"
                    style={{ fontSize: 11, fontWeight: 600 }}
                  >
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Run panel */}
        <aside className="hidden flex-col gap-3 border-l border-border p-4 sm:flex" aria-hidden>
          <div
            data-p="panel"
            className="rounded-xl border border-border bg-background-elevated/70 p-3"
          >
            <p className="flex items-center justify-between text-xs font-semibold text-foreground">
              Run #1842
              <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" /> running
              </span>
            </p>
            <div className="mt-3 space-y-2.5">
              {[
                ["Read application", "100%", "bg-emerald"],
                ["Credit check", "100%", "bg-emerald"],
                ["Income check", "100%", "bg-emerald"],
                ["Affordability rules", "64%", "bg-primary"],
              ].map(([label, w, tone]) => (
                <div key={label}>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-secondary">
                    <div
                      data-p="bar"
                      className={cn("h-full rounded-full", tone)}
                      style={{ width: w }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            data-p="panel"
            className="rounded-xl border border-border bg-background-elevated/70 p-3"
          >
            <p className="text-xs font-semibold text-foreground">Rule verdicts</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-emerald/10 px-2 py-0.5 text-[10px] text-emerald">
                LTV ≤ 85% · pass
              </span>
              <span className="rounded-md bg-emerald/10 px-2 py-0.5 text-[10px] text-emerald">
                DTI ≤ 40% · pass
              </span>
              <span className="rounded-md bg-amber/10 px-2 py-0.5 text-[10px] text-amber">
                Self-employed · review
              </span>
            </div>
          </div>
          <div data-p="panel" className="rounded-xl border border-amber/30 bg-amber/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <UserCheck className="size-3.5 text-amber" /> Waiting for an underwriter
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Paused at step 5 until a reviewer approves, corrects or rejects.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ProductRevealSection() {
  return (
    <section id="product" data-a="product" className="relative scroll-mt-20">
      <div
        data-a="product-stage"
        className="relative flex flex-col px-4 py-20 sm:px-6 lg:h-screen lg:py-0 lg:pb-[4vh] lg:pt-[calc(4rem+4vh)]"
      >
        <div className="relative mx-auto w-full max-w-3xl text-center lg:h-32 lg:shrink-0">
          {CAPTIONS.map((c, i) => (
            <div
              key={c.eyebrow}
              data-a="product-caption"
              className={cn(i > 0 && "product-caption-alt absolute inset-x-0 top-0")}
              style={i > 0 ? { opacity: 0, visibility: "hidden" } : undefined}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {c.eyebrow}
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {c.title}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
                {c.body}
              </p>
            </div>
          ))}
        </div>
        <div
          data-a="product-frame"
          className="relative mx-auto mt-10 h-[420px] w-full max-w-6xl sm:h-[460px] lg:mt-6 lg:h-auto lg:min-h-0 lg:flex-1"
        >
          <PlatformMock />
        </div>
      </div>
    </section>
  );
}

/* ── Features (bento) ──────────────────────────────────────────────────── */

function Bento({
  icon: Icon,
  title,
  body,
  visual,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-a="bento"
      data-tilt
      className={cn(
        "group spotlight glass relative flex h-full flex-col overflow-hidden rounded-2xl p-6 transition-colors hover:border-primary/35",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute -right-16 -top-16 size-40 rounded-full opacity-0 blur-3xl transition duration-500 group-hover:opacity-30"
        style={{ background: "var(--gradient-brand)" }}
      />
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-border bg-secondary transition group-hover:border-primary/40">
          <Icon className="size-5 text-primary" />
        </span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {visual ? <div className="mt-5 flex-1">{visual}</div> : null}
    </div>
  );
}

export function FeaturesSection() {
  return (
    <Section
      id="features"
      eyebrow="Platform"
      title={
        <>
          Everything an agent needs — <span className="text-gradient-brand">in one place</span>
        </>
      }
      intro="Design, tools, knowledge, workflows, governance and operations are parts of one system, so each one knows about the others."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Bento
          className="md:col-span-2"
          icon={Bot}
          title="Orchestrator"
          body="Describe a goal; the orchestrator classifies it, picks or designs the right agent, attaches rules and knowledge, and runs it — streaming every decision as it makes it."
          visual={<ChatVisual />}
        />
        <Bento
          icon={Wrench}
          title="Tools written on demand"
          body="Missing capabilities are generated as Python tools and must pass lint, structure checks and a sandboxed test before they're used. Failures are fixed automatically."
          visual={<CodeVisual />}
        />
        <Bento
          icon={GitBranch}
          title="Deterministic workflows"
          body="Multi-step pipelines from a goal, a visual builder or plain-language revisions — with versions, undo and one-click publishing to Mistral Workflows."
          visual={<DagVisual />}
        />
        <Bento
          icon={Network}
          title="Knowledge & graph RAG"
          body="Libraries, distilled best-practice guidance, industry processes and a knowledge graph ground every agent in how your business actually works."
          visual={<GraphVisual />}
        />
        <Bento
          icon={UserCheck}
          title="Rules, gates & human review"
          body="Always-on and targeted rules, tool safety checks, and review steps that pause a workflow until a person approves, corrects or rejects."
          visual={<ReviewVisual />}
        />
        <Bento
          className="md:col-span-2"
          icon={Users}
          title="Workspaces, roles & access"
          body="Each team works in its own workspace on its own Mistral key. Built-in and custom roles decide who can build, run, review or only view — enforced on every request."
          visual={<WorkspacesVisual />}
        />
        <Bento
          icon={Activity}
          title="Full observability"
          body="Every run, step, rule verdict, tool call and model call is traced to Mistral Observability and readable on the Logs page."
          visual={<TraceVisual />}
        />
        <Bento
          icon={KeyRound}
          title="Encrypted vault"
          body="API keys and credentials are encrypted at rest and handed to a tool only while it runs — never in code, prompts or logs."
        />
        <Bento
          icon={Server}
          title="Deploy to your servers"
          body="Package a workflow or push a tool to a VM, cloud instance or HTTP endpoint, start its worker and run it there — from the same console."
        />
        <Bento
          icon={Zap}
          title="Runs that never get lost"
          body="Long builds run in the background with a fair queue per workspace, resume their progress view after a refresh, and are cleaned up if interrupted."
        />
      </div>
    </Section>
  );
}

/* ── Use cases ─────────────────────────────────────────────────────────── */

const USE_CASES: {
  id: string;
  label: string;
  icon: LucideIcon;
  goal: string;
  steps: string[];
  builds: string[];
  outcomes: string[];
}[] = [
  {
    id: "lending",
    label: "Lending",
    icon: Landmark,
    goal: "Pre-screen mortgage applications and route edge cases to an underwriter.",
    steps: [
      "Read the application",
      "Check credit & income",
      "Apply affordability rules",
      "Decide or escalate",
      "Draft the decision letter",
    ],
    builds: [
      "Intake, credit and decision agents",
      "Affordability & document tools",
      "Lending rules and an underwriter review",
    ],
    outcomes: [
      "Consistent first-pass decisions",
      "Underwriters see only the cases that need them",
      "Every decision traced to its rule and data",
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    icon: ClipboardCheck,
    goal: "Validate new claims against the policy and flag likely fraud.",
    steps: [
      "Extract claim details",
      "Match the policy & cover",
      "Score fraud signals",
      "Approve, request info or escalate",
    ],
    builds: [
      "Claim extraction with OCR",
      "Policy lookup and scoring tools",
      "Fraud and cover-limit gates",
    ],
    outcomes: [
      "Faster triage of routine claims",
      "Exceptions reach adjusters with context",
      "An auditable trail per claim",
    ],
  },
  {
    id: "banking",
    label: "Banking & KYC",
    icon: Building2,
    goal: "Onboard a business customer: verify documents, screen and score risk.",
    steps: [
      "Collect & read documents",
      "Verify identity data",
      "Screen and score risk",
      "Approve or request review",
    ],
    builds: [
      "Document and verification agents",
      "Screening connectors via MCP",
      "KYC rules with a compliance approval",
    ],
    outcomes: [
      "Onboarding without manual copy-paste",
      "Compliance signs off where it must",
      "Credentials kept in the vault",
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    icon: HeartPulse,
    goal: "Triage patient-reported symptoms and suggest next steps for a clinician.",
    steps: [
      "Gather symptoms",
      "Check against guidance",
      "Suggest urgency and next steps",
      "Clinician review",
    ],
    builds: [
      "Symptom intake agent",
      "Clinical guidance from your library",
      "Safety guardrails and mandatory review",
    ],
    outcomes: [
      "Structured, guidance-grounded summaries",
      "A clinician always has the final say",
      "Answers cite their sources",
    ],
  },
  {
    id: "support",
    label: "Customer support",
    icon: Headphones,
    goal: "Answer tier-one tickets from our knowledge base and hand off the rest.",
    steps: [
      "Classify the ticket",
      "Search the knowledge base",
      "Draft a reply",
      "Hand off with context",
    ],
    builds: [
      "Classifier and answer agents",
      "Retrieval over your help docs",
      "Tone and escalation rules",
    ],
    outcomes: [
      "Routine questions answered quickly",
      "Agents get a drafted, sourced reply",
      "Escalations arrive with the full history",
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Layers,
    goal: "Reconcile supplier invoices against purchase orders and report mismatches.",
    steps: ["Read invoices", "Match purchase orders", "Flag mismatches", "Report to finance"],
    builds: [
      "Invoice reader with OCR",
      "Database query tools",
      "Tolerance rules and a finance review",
    ],
    outcomes: [
      "Mismatches surfaced, not buried",
      "Reusable for every supplier",
      "Runs on a schedule on your own server",
    ],
  },
];

/** The two result cards of a use case, shared by the tabs and the track. */
function UseCaseBoxes({ uc, className }: { uc: (typeof USE_CASES)[number]; className?: string }) {
  return (
    <div className={cn("grid gap-5", className)}>
      <div data-uc="box" className="rounded-2xl border border-border bg-background-elevated/70 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Boxes className="size-4 text-primary" /> What the platform builds
        </p>
        <ul className="mt-3 space-y-2">
          {uc.builds.map((b) => (
            <li key={b} className="flex gap-2 text-sm text-muted-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div data-uc="box" className="rounded-2xl border border-emerald/25 bg-emerald/5 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-4 text-emerald" /> What your team gets
        </p>
        <ul className="mt-3 space-y-2">
          {uc.outcomes.map((o) => (
            <li key={o} className="flex gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald" />
              {o}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function UseCaseSteps({ uc }: { uc: (typeof USE_CASES)[number] }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-2">
      {uc.steps.map((s, i) => (
        <li key={`${uc.id}-${s}`} data-uc="step" className="flex items-center gap-2">
          <span className="rounded-lg border border-border bg-background-elevated px-3 py-1.5 text-xs text-foreground">
            <span className="mr-1.5 font-mono text-[10px] text-primary">{i + 1}</span>
            {s}
          </span>
          {i < uc.steps.length - 1 ? (
            <ArrowRight className="size-3.5 text-muted-foreground" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const SIDE_GUTTER = "max(1.5rem,calc((100vw - 72rem) / 2 + 1.5rem))";

/** Desktop: the section pins and the industries slide past (motion.ts: horizontal). */
function UseCasesTrack() {
  return (
    <section data-a="hscroll" className="uc-track relative h-screen overflow-hidden">
      <div className="flex h-full flex-col justify-center pt-16">
        <div
          data-a="htrack"
          className="flex w-max items-stretch gap-6"
          style={{ paddingLeft: SIDE_GUTTER, paddingRight: SIDE_GUTTER }}
        >
          <div className="flex w-[25rem] shrink-0 flex-col justify-center pr-6">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <span className="h-px w-6 bg-primary/60" /> Use cases
            </p>
            <h2
              data-a="heading"
              className="mt-4 font-display text-4xl font-bold leading-[1.12] tracking-tight text-foreground"
            >
              Built for the processes{" "}
              <span className="text-gradient-brand">that run your business</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Industry catalogs for banking, lending, insurance, healthcare and a dozen more sectors
              give the platform a head start on how each process works.
            </p>
            <p className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground">
              Keep scrolling <ArrowRight className="size-4 text-primary" />
            </p>
          </div>
          {USE_CASES.map((u, i) => (
            <article
              key={u.id}
              data-a="hpanel"
              className="glass-elevated flex w-[min(46rem,68vw)] shrink-0 flex-col rounded-3xl p-8"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-foreground">
                  <u.icon className="size-4 text-primary" /> {u.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")} / {String(USE_CASES.length).padStart(2, "0")}
                </span>
              </div>
              <p className="technical-label mt-6">The goal you type</p>
              <p className="mt-2 font-display text-2xl font-bold leading-snug text-foreground">
                “{u.goal}”
              </p>
              <p className="technical-label mt-6">The workflow it designs</p>
              <UseCaseSteps uc={u} />
              <UseCaseBoxes uc={u} className="mt-6 grid-cols-2" />
            </article>
          ))}
        </div>
        <div className="mt-8 flex justify-center gap-2" aria-hidden>
          {USE_CASES.map((u) => (
            <span key={u.id} data-a="hdot" className="hdot h-1.5 w-6 rounded-full bg-border" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function UseCasesSection() {
  return (
    <div id="use-cases" className="relative scroll-mt-20">
      <UseCasesTrack />
      <div className="uc-tabs">
        <UseCasesTabs />
      </div>
    </div>
  );
}

function UseCasesTabs() {
  const [active, setActive] = useState(USE_CASES[0]!.id);
  const panel = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const uc = USE_CASES.find((u) => u.id === active) ?? USE_CASES[0]!;

  // Each tab change choreographs the new content in: the goal, then the
  // workflow chips one by one, then the two result cards.
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (!panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(panel.current.querySelector("[data-uc='goal']"), {
        autoAlpha: 0,
        y: 18,
        duration: 0.5,
      })
        .from(
          panel.current.querySelectorAll("[data-uc='step']"),
          { autoAlpha: 0, x: -18, duration: 0.4, stagger: 0.07 },
          "-=0.25",
        )
        .from(
          panel.current.querySelectorAll("[data-uc='box']"),
          { autoAlpha: 0, y: 24, scale: 0.97, duration: 0.55, stagger: 0.1 },
          "-=0.35",
        );
    },
    { dependencies: [active], scope: panel },
  );

  // The highlight pill slides to the selected tab.
  useGSAP(
    () => {
      const wrap = tabs.current;
      const pill = wrap?.querySelector<HTMLElement>("[data-uc='pill']");
      const btn = wrap?.querySelector<HTMLElement>(`[data-tab='${active}']`);
      if (!wrap || !pill || !btn) return;
      const place = (duration: number) =>
        gsap.to(pill, {
          x: btn.offsetLeft,
          y: btn.offsetTop,
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          duration,
          ease: "expo.out",
        });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      place(reduce ? 0 : 0.5);
      // Tabs wrap differently at other widths: follow the button.
      const onResize = () => place(0);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    },
    { dependencies: [active], scope: tabs },
  );

  return (
    <Section
      id="use-cases-list"
      eyebrow="Use cases"
      title={
        <>
          Built for the processes{" "}
          <span className="text-gradient-brand">that run your business</span>
        </>
      }
      intro="Industry catalogs for banking, lending, insurance, healthcare and a dozen more sectors give the platform a head start on how each process works."
    >
      <Reveal>
        <div
          ref={tabs}
          className="relative flex flex-wrap gap-2"
          role="tablist"
          aria-label="Use cases"
        >
          <span
            data-uc="pill"
            aria-hidden
            className="absolute left-0 top-0 rounded-full border border-primary/50 bg-primary/15 shadow-[var(--shadow-glow)]"
          />
          {USE_CASES.map((u) => (
            <button
              key={u.id}
              type="button"
              role="tab"
              data-tab={u.id}
              aria-selected={u.id === active}
              onClick={() => setActive(u.id)}
              className={cn(
                "relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                u.id === active
                  ? "border-transparent text-foreground"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              <u.icon className={cn("size-4", u.id === active && "text-primary")} />
              {u.label}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-6">
        <div
          ref={panel}
          className="glass-elevated grid gap-8 overflow-hidden rounded-3xl p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr]"
        >
          <div>
            <p className="technical-label">The goal you type</p>
            <p
              data-uc="goal"
              className="mt-2 font-display text-xl font-bold leading-snug text-foreground sm:text-2xl"
            >
              “{uc.goal}”
            </p>
            <p className="technical-label mt-8">The workflow it designs</p>
            <UseCaseSteps uc={uc} />
          </div>
          <UseCaseBoxes uc={uc} className="sm:grid-cols-2 lg:grid-cols-1" />
        </div>
      </Reveal>
    </Section>
  );
}

/* ── Integrations ──────────────────────────────────────────────────────── */

const INTEGRATIONS: {
  icon: LucideIcon;
  title: string;
  tone: string;
  items: { name: string; what: string }[];
}[] = [
  {
    icon: Brain,
    title: "Mistral AI",
    tone: "text-primary",
    items: [
      { name: "Models", what: "Large, Medium, Small, reasoning and Codestral — chosen per task" },
      { name: "Agents & Conversations", what: "every designed agent is a Mistral agent" },
      { name: "Libraries", what: "document search for agents" },
      { name: "Workflows", what: "durable, Temporal-based workflow execution" },
      { name: "Observability", what: "traces of every step and model call" },
      { name: "Vision & OCR", what: "images and scanned documents as input" },
    ],
  },
  {
    icon: Plug,
    title: "Tools, data & knowledge",
    tone: "text-cyan",
    items: [
      { name: "Model Context Protocol", what: "register MCP servers and use their tools" },
      { name: "Connectors", what: "OAuth and credentialed connectors, scoped per workspace" },
      { name: "Sandboxed tool service", what: "generated tools run isolated in Docker" },
      { name: "SQL databases", what: "query and inspect your data from agents" },
      { name: "Neo4j", what: "the knowledge graph behind graph RAG" },
    ],
  },
  {
    icon: Cloud,
    title: "Deployment targets",
    tone: "text-emerald",
    items: [
      { name: "Linux VMs over SSH", what: "any server you can reach" },
      { name: "AWS EC2 · Azure VM · Google Compute", what: "discovered from your cloud account" },
      { name: "DigitalOcean · NVIDIA Brev", what: "droplets and GPU instances" },
      { name: "HTTP deploy & MCP endpoints", what: "push packages and tools to a URL" },
    ],
  },
  {
    icon: Lock,
    title: "Security & operations",
    tone: "text-amber",
    items: [
      { name: "Encrypted vault", what: "credentials with history, expiry and audit" },
      { name: "Workspaces & RBAC", what: "built-in and custom roles, per workspace" },
      { name: "Audit log", what: "sign-ins, changes and refusals" },
      { name: "OpenTelemetry", what: "standard traces, redacted before export" },
    ],
  },
];

export function IntegrationsSection() {
  return (
    <Section
      id="integrations"
      eyebrow="Integrations"
      title={
        <>
          Plugs into <span className="text-gradient-brand">your models, data and servers</span>
        </>
      }
      intro="Built natively on Mistral AI, open to the tools you already have through the Model Context Protocol and connectors, and deployable wherever your workloads live."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {INTEGRATIONS.map((g) => (
          <div
            key={g.title}
            data-a="side-card"
            data-tilt
            className="spotlight glass h-full rounded-2xl p-6"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-border bg-secondary">
                <g.icon className={cn("size-5", g.tone)} />
              </span>
              <h3 className="text-lg font-semibold text-foreground">{g.title}</h3>
            </div>
            <ul className="mt-5 divide-y divide-border">
              {g.items.map((it) => (
                <li
                  key={it.name}
                  data-a="row"
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
                >
                  <span className="text-sm font-medium text-foreground">{it.name}</span>
                  <span className="text-xs text-muted-foreground">{it.what}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Security band ─────────────────────────────────────────────────────── */

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Isolated workspaces",
    body: "Each team on its own Mistral key, data and traces.",
  },
  {
    icon: ShieldCheck,
    title: "Least-privilege roles",
    body: "Deny by default; every request checked server-side.",
  },
  { icon: Lock, title: "Secure sessions", body: "httpOnly cookies, lockout, sign-out everywhere." },
  {
    icon: KeyRound,
    title: "Secrets stay secret",
    body: "Encrypted at rest, never sent to a browser.",
  },
  {
    icon: ScrollText,
    title: "Complete audit trail",
    body: "Who did what, when, from where — kept.",
  },
  {
    icon: FileSearch,
    title: "Explainable runs",
    body: "Every decision traced to its step, rule and data.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="relative scroll-mt-20 overflow-hidden border-y border-border">
      <div
        data-a="parallax"
        data-speed="0.25"
        className="grid-backdrop absolute inset-0 opacity-30"
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:py-24">
        <div>
          <Reveal>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <span className="h-px w-6 bg-primary/60" /> Security & governance
            </p>
          </Reveal>
          <h2
            data-a="heading"
            className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
          >
            Access you can explain <span className="text-gradient-brand">to an auditor</span>
          </h2>
          <Reveal delay={0.15}>
            <p className="mt-4 text-muted-foreground">
              Governance isn't a plug-in here. Roles, rules, reviews, secrets and traces are part of
              how every agent and workflow is built and run.
            </p>
          </Reveal>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRUST.map((t) => (
            <div
              key={t.title}
              data-a="card"
              className="flex h-full gap-3 rounded-xl border border-border bg-background/80 p-4"
            >
              <t.icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Who uses it ───────────────────────────────────────────────────────── */

const PERSONAS: { icon: LucideIcon; role: string; body: string }[] = [
  {
    icon: Sparkles,
    role: "Builders",
    body: "Design agents and workflows from a goal, refine them in plain language.",
  },
  {
    icon: Terminal,
    role: "Operators",
    body: "Run what's been built, follow every step live, cancel or retry.",
  },
  {
    icon: UserCheck,
    role: "Reviewers",
    body: "Approve, correct or reject the steps that need a person.",
  },
  {
    icon: Cable,
    role: "Platform admins",
    body: "Add workspaces and keys, invite people, define roles, watch health.",
  },
];

export function PersonasStrip() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PERSONAS.map((p) => (
          <div key={p.role} data-a="card" className="h-full rounded-2xl border border-border p-5">
            <p.icon className="size-5 text-primary" />
            <p className="mt-3 text-sm font-semibold text-foreground">{p.role}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
