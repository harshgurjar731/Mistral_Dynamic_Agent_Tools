import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  Cpu,
  Eye,
  GitBranch,
  KeyRound,
  Lock,
  Network,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/auth/AuthParts";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuthSession } from "@/lib/auth";
import { useUiConfig } from "@/lib/uiConfig";
import { cn } from "@/lib/utils";

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bot,
    title: "Orchestrator",
    body: "Describe a goal in plain language. The orchestrator designs the agent, picks its tools and rules, and runs it live.",
  },
  {
    icon: Wrench,
    title: "Tools written on demand",
    body: "When an agent needs a capability that doesn't exist, it is written, linted, sandboxed and registered — no restart.",
  },
  {
    icon: GitBranch,
    title: "Deterministic workflows",
    body: "Multi-step pipelines with a visual builder, versions, revisions and one-click publishing to Mistral Workflows.",
  },
  {
    icon: Network,
    title: "Knowledge & graph RAG",
    body: "Libraries, guidance and a knowledge graph ground every agent in your industry's processes and documents.",
  },
  {
    icon: UserCheck,
    title: "Rules, gates & reviews",
    body: "Always-on rules, tool safety checks and human review steps keep automated work inside the lines.",
  },
  {
    icon: ScrollText,
    title: "Full observability",
    body: "Every run, step, rule verdict and model call is traced to your workspace's Mistral Observability.",
  },
];

const PIPELINE = [
  { label: "Analyse goal", detail: "intent, domain, constraints", state: "done" },
  { label: "Synthesize tools", detail: "2 new · 5 reused", state: "done" },
  { label: "Assemble agent", detail: "rules, knowledge, guardrails", state: "active" },
  { label: "Run & observe", detail: "streaming to Mistral", state: "pending" },
] as const;

export function LandingPage() {
  const ui = useUiConfig();
  const { data } = useAuthSession();
  const signedIn = !!data?.user;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="app-atmosphere" aria-hidden />

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <BrandMark size="sm" to="/welcome" />
          <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#platform" className="transition hover:text-foreground">
              Platform
            </a>
            <a href="#how" className="transition hover:text-foreground">
              How it works
            </a>
            <a href="#security" className="transition hover:text-foreground">
              Security
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/admin/login"
              className="hidden h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground sm:inline-flex"
            >
              Admin
            </Link>
            <Link
              to={signedIn ? "/" : "/login"}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/88"
            >
              {signedIn ? "Open the app" : "Sign in"}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="grid-backdrop absolute inset-0 opacity-40" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-28 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              Agentic AI control plane on Mistral
            </span>
            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Describe the goal.
              <br />
              <span className="text-gradient-brand">Ship the agent.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {ui.UI_BRAND_TITLE} designs, equips, governs and runs AI agents and workflows for your
              teams — each team in its own workspace, on its own Mistral key, under roles you
              control.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={signedIn ? "/" : "/login"}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/88"
              >
                {signedIn ? "Open the app" : "Sign in to your workspace"}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/admin/login"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-background-elevated px-5 text-sm font-medium text-foreground shadow-sm transition hover:border-border-strong hover:bg-surface-hover"
              >
                <ShieldCheck className="size-4 text-primary" />
                Admin console
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Accounts are created by your platform administrator. Got an invite link? Open it to
              set your password.
            </p>
          </div>

          <HeroVisual />
        </div>
      </section>

      {/* Proof strip */}
      <section className="border-y border-border bg-background-elevated/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            ["3-tier", "tool router: native, sandboxed, MCP"],
            ["5-phase", "streamed workflow planner"],
            ["Per-workspace", "Mistral keys, data and traces"],
            ["Every action", "checked by role and audited"],
          ].map(([k, v]) => (
            <div key={k} className="bg-background-elevated px-5 py-6">
              <p className="font-display text-lg font-bold text-foreground">{k}</p>
              <p className="mt-1 text-xs text-muted-foreground">{v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <Section
        id="platform"
        eyebrow="Platform"
        title="Everything an agent needs, in one control plane"
        intro="From the first prompt to a governed, observable production workflow."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="glass group rounded-lg p-6 transition hover:border-border-strong"
            >
              <span className="grid size-10 place-items-center rounded-md border border-border bg-secondary transition group-hover:border-primary/40">
                <f.icon className="size-5 text-primary" />
              </span>
              <h3 className="mt-5 text-[15px] font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section
        id="how"
        eyebrow="How it works"
        title="From invite to production in three steps"
        className="border-t border-border"
      >
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Building2,
              title: "An admin sets up workspaces",
              body: "Each workspace is a team with its own Mistral API key, verified with Mistral before it is saved.",
            },
            {
              icon: Users,
              title: "People are invited with a role",
              body: "Builders, operators, reviewers, viewers — or a custom role. One person can belong to several workspaces.",
            },
            {
              icon: Cpu,
              title: "Teams design, run and review",
              body: "Agents, tools and workflows land in the team's own Mistral workspace, with traces to match.",
            },
          ].map((s, i) => (
            <li key={s.title} className="relative rounded-lg border border-border p-6">
              <span className="font-display text-xs font-bold text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <s.icon className="mt-4 size-5 text-foreground" />
              <h3 className="mt-3 text-[15px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Security */}
      <Section
        id="security"
        eyebrow="Security"
        title="Access you can explain to an auditor"
        className="border-t border-border"
      >
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <ul className="space-y-4">
            {[
              [
                Lock,
                "Encrypted, httpOnly sessions",
                "Session cookies scripts can't read, idle and absolute timeouts, sign-out everywhere.",
              ],
              [
                ShieldCheck,
                "Role-based access, enforced server-side",
                "Built-in roles plus custom roles with exactly the permissions you choose — deny by default.",
              ],
              [
                KeyRound,
                "Keys stay on the server",
                "Mistral keys are encrypted at rest and never sent to a browser; only the last four characters are shown.",
              ],
              [
                Eye,
                "Lockout and audit",
                "Repeated failures lock the account; every sign-in, change and refusal is in the audit log.",
              ],
            ].map(([Icon, title, body]) => {
              const I = Icon as LucideIcon;
              return (
                <li key={title as string} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-secondary">
                    <I className="size-4 text-primary" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      {title as string}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {body as string}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <WorkspaceDiagram />
        </div>
      </Section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="glass-elevated relative overflow-hidden rounded-xl px-6 py-10 sm:px-10">
            <div
              aria-hidden
              className="absolute -right-20 -top-20 size-72 rounded-full opacity-25 blur-3xl"
              style={{ background: "var(--gradient-brand)" }}
            />
            <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h2 className="font-display text-2xl font-bold">Ready when your team is.</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sign in with the account your administrator created for you.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={signedIn ? "/" : "/login"}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/88"
                >
                  {signedIn ? "Open the app" : "Sign in"}
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/admin/login"
                  className="inline-flex h-10 items-center rounded-md border border-border bg-background-elevated px-5 text-sm font-medium transition hover:bg-surface-hover"
                >
                  Admin console
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>
            © {new Date().getFullYear()} {ui.UI_BRAND_TITLE}. Built on Mistral AI.
          </span>
          <span className="flex gap-4">
            <Link to="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link to="/admin/login" className="hover:text-foreground">
              Admin
            </Link>
            <Link to="/forgot-password" className="hover:text-foreground">
              Can't sign in?
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-16", className)}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="technical-label">{eyebrow}</p>
        <h2 className="mt-3 max-w-2xl font-display text-2xl font-bold leading-tight sm:text-3xl">
          {title}
        </h2>
        {intro ? <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p> : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative">
      <div className="glass-elevated rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red/70" />
            <span className="size-2.5 rounded-full bg-amber/70" />
            <span className="size-2.5 rounded-full bg-emerald/70" />
          </div>
          <span className="technical-label">orchestrator · live</span>
        </div>
        <div className="mt-5 rounded-md border border-border bg-background-elevated p-4">
          <p className="technical-label">Goal</p>
          <p className="mt-1.5 text-sm text-foreground">
            “Pre-screen mortgage applications and flag anything a human should review.”
          </p>
        </div>
        <ol className="mt-4 space-y-2">
          {PIPELINE.map((step) => (
            <li
              key={step.label}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3.5 py-3 transition",
                step.state === "active"
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-background-elevated/60",
              )}
            >
              {step.state === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald" />
              ) : step.state === "active" ? (
                <span className="relative flex size-4 shrink-0 items-center justify-center">
                  <span className="absolute size-4 animate-ping rounded-full bg-primary/40" />
                  <span className="size-2 rounded-full bg-primary" />
                </span>
              ) : (
                <span className="size-4 shrink-0 rounded-full border border-border-strong" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{step.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="glass absolute -bottom-6 -left-4 hidden rounded-lg px-4 py-3 sm:block">
        <p className="technical-label">Workspace</p>
        <p className="mt-0.5 flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-emerald" /> Lending · Builder
        </p>
      </div>
    </div>
  );
}

function WorkspaceDiagram() {
  const rows = [
    { name: "Lending", key: "••••7f3a", people: 12 },
    { name: "Claims", key: "••••19be", people: 7 },
    { name: "Research", key: "••••c402", people: 4 },
  ];
  return (
    <div className="glass rounded-xl p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Workspaces</p>
        <span className="technical-label">admin view</span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-center gap-3 rounded-md border border-border bg-background-elevated px-3.5 py-3"
          >
            <span className="grid size-8 place-items-center rounded-md bg-secondary text-xs font-bold">
              {r.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{r.name}</span>
              <span className="block text-xs text-muted-foreground">{r.people} members</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground">
              <KeyRound className="size-3 text-emerald" /> {r.key}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Each workspace's agents, conversations and traces live in its own Mistral workspace. Roles
        are decided here, never by Mistral.
      </p>
    </div>
  );
}
