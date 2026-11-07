import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  Lock,
  Network,
  Plug,
  Puzzle,
  Rocket,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Unplug,
  UserCheck,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
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
        <Reveal className={cn("max-w-3xl", center && "mx-auto text-center")}>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-px w-6 bg-primary/60" /> {eyebrow}
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-4xl">
            {title}
          </h2>
          {intro ? (
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {intro}
            </p>
          ) : null}
        </Reveal>
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
  const reduce = useReducedMotion();
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
      <motion.div
        className="flex w-max gap-3"
        {...(reduce ? {} : { animate: { x: ["0%", "-50%"] } })}
        transition={{ duration: 40, ease: "linear", repeat: Infinity }}
      >
        {items.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 text-sm text-foreground"
          >
            <span className="size-1.5 rounded-full bg-primary" /> {name}
          </span>
        ))}
      </motion.div>
    </div>
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
          AI agents are easy to demo.
          <br className="hidden sm:block" />{" "}
          <span className="text-gradient-brand">Hard to put to work.</span>
        </>
      }
      intro="Teams can get a model to answer questions in an afternoon. Turning that into a dependable business process — one that does real work, follows the rules and can be explained afterwards — is where projects stall."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.06}>
            <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-background-elevated/60 p-6 transition hover:border-red/30">
              <div
                aria-hidden
                className="absolute -right-10 -top-10 size-32 rounded-full bg-red/10 opacity-0 blur-2xl transition group-hover:opacity-100"
              />
              <span className="grid size-11 place-items-center rounded-xl border border-red/25 bg-red/10">
                <p.icon className="size-5 text-red" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </Reveal>
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
      <div className="relative">
        <div
          aria-hidden
          className="absolute bottom-6 left-[1.375rem] top-6 w-px bg-gradient-to-b from-primary via-primary/40 to-transparent sm:left-[1.625rem]"
        />
        <ol className="space-y-5">
          {FLOW.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.07}>
              <li className="relative flex gap-5 sm:gap-7">
                <span className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full border border-primary/40 bg-background text-primary shadow-[var(--shadow-glow)] sm:size-[3.25rem]">
                  <s.icon className="size-5" />
                </span>
                <div className="glass flex-1 rounded-2xl p-5 sm:p-6">
                  <p className="font-mono text-[11px] font-bold text-primary">
                    STEP {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}

/* ── Features (bento) ──────────────────────────────────────────────────── */

function Bento({
  icon: Icon,
  title,
  body,
  visual,
  className,
  delay = 0,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  visual?: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <div className="group glass relative flex h-full flex-col overflow-hidden rounded-2xl p-6 transition hover:border-primary/35">
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
    </Reveal>
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
          delay={0.05}
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
          delay={0.05}
          title="Knowledge & graph RAG"
          body="Libraries, distilled best-practice guidance, industry processes and a knowledge graph ground every agent in how your business actually works."
          visual={<GraphVisual />}
        />
        <Bento
          icon={UserCheck}
          delay={0.1}
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
          delay={0.05}
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
          delay={0.05}
          title="Deploy to your servers"
          body="Package a workflow or push a tool to a VM, cloud instance or HTTP endpoint, start its worker and run it there — from the same console."
        />
        <Bento
          icon={Zap}
          delay={0.1}
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

export function UseCasesSection() {
  const [active, setActive] = useState(USE_CASES[0]!.id);
  const reduce = useReducedMotion();
  const uc = USE_CASES.find((u) => u.id === active) ?? USE_CASES[0]!;
  return (
    <Section
      id="use-cases"
      eyebrow="Use cases"
      title={
        <>
          Built for the processes{" "}
          <span className="text-gradient-brand">that run your business</span>
        </>
      }
      intro="Industry catalogs for banking, lending, insurance, healthcare and a dozen more sectors give the platform a head start on how each process works."
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Use cases">
        {USE_CASES.map((u) => (
          <button
            key={u.id}
            type="button"
            role="tab"
            aria-selected={u.id === active}
            onClick={() => setActive(u.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
              u.id === active
                ? "border-primary/50 bg-primary/15 text-foreground shadow-[var(--shadow-glow)]"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            <u.icon className={cn("size-4", u.id === active && "text-primary")} />
            {u.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={uc.id}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? {} : { opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="glass-elevated grid gap-8 overflow-hidden rounded-3xl p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr]"
          >
            <div>
              <p className="technical-label">The goal you type</p>
              <p className="mt-2 font-display text-xl font-bold leading-snug text-foreground sm:text-2xl">
                “{uc.goal}”
              </p>
              <p className="technical-label mt-8">The workflow it designs</p>
              <ol className="mt-3 flex flex-wrap items-center gap-2">
                {uc.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
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
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl border border-border bg-background-elevated/70 p-5">
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
              <div className="rounded-2xl border border-emerald/25 bg-emerald/5 p-5">
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
          </motion.div>
        </AnimatePresence>
      </div>
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
        {INTEGRATIONS.map((g, gi) => (
          <Reveal key={g.title} delay={gi * 0.06}>
            <div className="glass h-full rounded-2xl p-6">
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
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
                  >
                    <span className="text-sm font-medium text-foreground">{it.name}</span>
                    <span className="text-xs text-muted-foreground">{it.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
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
    <section id="security" className="relative scroll-mt-20 border-y border-border">
      <div className="grid-backdrop absolute inset-0 opacity-30" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:py-24">
        <Reveal>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-px w-6 bg-primary/60" /> Security & governance
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Access you can explain <span className="text-gradient-brand">to an auditor</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Governance isn't a plug-in here. Roles, rules, reviews, secrets and traces are part of
            how every agent and workflow is built and run.
          </p>
        </Reveal>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 0.04}>
              <div className="flex h-full gap-3 rounded-xl border border-border bg-background/80 p-4">
                <t.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.body}</p>
                </div>
              </div>
            </Reveal>
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
        {PERSONAS.map((p, i) => (
          <Reveal key={p.role} delay={i * 0.05}>
            <div className="h-full rounded-2xl border border-border p-5">
              <p.icon className="size-5 text-primary" />
              <p className="mt-3 text-sm font-semibold text-foreground">{p.role}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
