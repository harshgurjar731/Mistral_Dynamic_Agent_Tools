import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clock,
  Copy,
  FilePen,
  GitBranch,
  Layers,
  Loader2,
  Lock,
  MousePointer2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { QK, workflowsApi } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElapsed } from "@/lib/runs/useRun";
import { formatElapsed } from "@/components/runs/runMeta";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useRunsStore } from "@/stores/runs";

export const Route = createFileRoute("/workflows/new/")({
  head: () => ({
    meta: [
      { title: "New workflow — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Plan a workflow from a goal, build it on a canvas, or start from a copy.",
      },
      { property: "og:title", content: "New workflow — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Plan a workflow from a goal, build it on a canvas, or start from a copy.",
      },
    ],
  }),
  component: NewWorkflowPage,
});

/* ── Illustrations: a tiny workflow drawn the way each path produces it ── */

type Tone = "purple" | "pink" | "indigo" | "cyan" | "emerald" | "muted";

const NODE_TONE: Record<Tone, string> = {
  purple: "fill-purple/15 stroke-purple/70 text-purple",
  pink: "fill-pink/15 stroke-pink/70 text-pink",
  indigo: "fill-indigo/15 stroke-indigo/70 text-indigo",
  cyan: "fill-cyan/15 stroke-cyan/70 text-cyan",
  emerald: "fill-emerald/15 stroke-emerald/70 text-emerald",
  muted: "fill-muted/40 stroke-border-strong text-muted-foreground",
};
const EDGE_TONE: Record<Tone, string> = {
  purple: "stroke-purple/70",
  pink: "stroke-pink/70",
  indigo: "stroke-indigo/70",
  cyan: "stroke-cyan/70",
  emerald: "stroke-emerald/70",
  muted: "stroke-border-strong",
};

function SvgNode({
  x,
  y,
  tone,
  icon: Icon,
  dashed,
}: {
  x: number;
  y: number;
  tone: Tone;
  icon: typeof Bot;
  dashed?: boolean;
}) {
  return (
    <g className={NODE_TONE[tone]}>
      <rect
        x={x}
        y={y}
        width={36}
        height={26}
        rx={8}
        strokeWidth={1.25}
        strokeDasharray={dashed ? "3 3" : undefined}
      />
      <Icon x={x + 11} y={y + 6} width={14} height={14} className="fill-none" />
    </g>
  );
}

/** An edge; `flow` animates data moving along it. */
function Edge({ d, tone = "muted", flow }: { d: string; tone?: Tone; flow?: boolean }) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={1.4}
      strokeLinecap="round"
      className={EDGE_TONE[tone]}
      strokeDasharray={flow ? "4 5" : undefined}
    >
      {flow ? (
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-18"
          dur="1.1s"
          repeatCount="indefinite"
        />
      ) : null}
    </path>
  );
}

function PlannerArt() {
  return (
    <svg viewBox="0 0 300 130" className="h-full w-full" aria-hidden>
      {/* the goal */}
      <rect
        x={6}
        y={46}
        width={84}
        height={38}
        rx={10}
        className="fill-background/80 stroke-border-strong"
      />
      <rect x={16} y={56} width={58} height={4} rx={2} className="fill-foreground/35" />
      <rect x={16} y={65} width={40} height={4} rx={2} className="fill-foreground/20" />
      <rect x={16} y={74} width={50} height={4} rx={2} className="fill-foreground/20" />
      <Edge d="M90 65 H124" tone="purple" flow />
      {/* the planner */}
      <circle cx={146} cy={65} r={20} className="fill-purple/10 stroke-purple/40">
        <animate attributeName="r" values="20;31" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx={146} cy={65} r={20} className="fill-purple/20 stroke-purple" strokeWidth={1.4} />
      <Sparkles x={136} y={55} width={20} height={20} className="text-purple" />
      {/* what it builds */}
      <Edge d="M166 65 C186 65 184 27 204 27" tone="purple" flow />
      <Edge d="M166 65 H204" tone="purple" flow />
      <Edge d="M166 65 C186 65 184 103 204 103" tone="purple" flow />
      <SvgNode x={204} y={14} tone="pink" icon={Zap} />
      <SvgNode x={204} y={52} tone="indigo" icon={Bot} />
      <SvgNode x={204} y={90} tone="cyan" icon={Wrench} />
      <Edge d="M240 27 C252 27 250 65 258 65" />
      <Edge d="M240 65 H258" />
      <Edge d="M240 103 C252 103 250 65 258 65" />
      <SvgNode x={258} y={52} tone="emerald" icon={Check} />
    </svg>
  );
}

function BuilderArt() {
  return (
    <svg viewBox="0 0 300 130" className="h-full w-full" aria-hidden>
      <defs>
        <pattern id="builder-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" className="fill-foreground/15" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={300} height={130} fill="url(#builder-dots)" />
      {/* palette */}
      <rect
        x={10}
        y={20}
        width={40}
        height={90}
        rx={9}
        className="fill-background/80 stroke-border-strong"
      />
      <Bot x={22} y={30} width={16} height={16} className="text-indigo" />
      <Zap x={22} y={57} width={16} height={16} className="text-pink" />
      <Wrench x={22} y={84} width={16} height={16} className="text-cyan" />
      {/* canvas */}
      <SvgNode x={78} y={52} tone="pink" icon={Zap} />
      <Edge d="M114 65 C134 65 132 32 152 32" tone="cyan" />
      <Edge d="M114 65 C134 65 132 98 152 98" tone="cyan" />
      <SvgNode x={152} y={19} tone="indigo" icon={Bot} />
      <SvgNode x={152} y={85} tone="cyan" icon={Wrench} />
      {/* the connection being drawn */}
      <Edge d="M188 32 C212 32 210 65 232 65" tone="cyan" flow />
      <SvgNode x={232} y={52} tone="cyan" icon={Plus} dashed />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; -6 -4; 0 0"
          dur="2.4s"
          repeatCount="indefinite"
        />
        <MousePointer2 x={258} y={72} width={18} height={18} className="fill-cyan/30 text-cyan" />
      </g>
    </svg>
  );
}

function MiniFlow({ x, y, tone }: { x: number; y: number; tone: Tone }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={112}
        height={76}
        rx={12}
        className={cn(
          tone === "muted" ? "fill-background/60" : "fill-background/90",
          EDGE_TONE[tone],
        )}
        strokeWidth={1.25}
      />
      <Edge d={`M${x + 36} ${y + 38} H${x + 44}`} tone={tone} />
      <Edge d={`M${x + 80} ${y + 38} H${x + 88}`} tone={tone} />
      <rect x={x + 10} y={y + 28} width={26} height={20} rx={6} className={NODE_TONE[tone]} />
      <rect x={x + 44} y={y + 28} width={36} height={20} rx={6} className={NODE_TONE[tone]} />
      <circle cx={x + 96} cy={y + 38} r={7} className={NODE_TONE[tone]} />
      <rect x={x + 10} y={y + 10} width={40} height={4} rx={2} className="fill-foreground/25" />
    </g>
  );
}

function CopyArt() {
  return (
    <svg viewBox="0 0 300 130" className="h-full w-full" aria-hidden>
      <MiniFlow x={40} y={18} tone="muted" />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="-100 -8; 0 0; 0 0"
          keyTimes="0; 0.45; 1"
          dur="3.2s"
          repeatCount="indefinite"
        />
        <MiniFlow x={150} y={36} tone="emerald" />
      </g>
      <circle
        cx={150}
        cy={36}
        r={13}
        className="fill-background stroke-emerald"
        strokeWidth={1.4}
      />
      <Copy x={143} y={29} width={14} height={14} className="text-emerald" />
    </svg>
  );
}

/* ── One path ─────────────────────────────────────────────────────────── */

const PATH_TONE = {
  purple: {
    glow: "var(--purple)",
    text: "text-purple",
    chip: "border-purple/25 bg-purple/10 text-purple",
    hover: "hover:border-purple/45 hover:shadow-[0_24px_50px_-28px_var(--purple)]",
  },
  cyan: {
    glow: "var(--cyan)",
    text: "text-cyan",
    chip: "border-cyan/25 bg-cyan/10 text-cyan",
    hover: "hover:border-cyan/45 hover:shadow-[0_24px_50px_-28px_var(--cyan)]",
  },
  emerald: {
    glow: "var(--emerald)",
    text: "text-emerald",
    chip: "border-emerald/25 bg-emerald/10 text-emerald",
    hover: "hover:border-emerald/45 hover:shadow-[0_24px_50px_-28px_var(--emerald)]",
  },
} as const;

function PathCard({
  tone,
  step,
  icon: Icon,
  kicker,
  title,
  description,
  art,
  traits,
  recommended,
  children,
}: {
  tone: keyof typeof PATH_TONE;
  step: string;
  icon: typeof Sparkles;
  kicker: string;
  title: string;
  description: string;
  art: ReactNode;
  traits: Array<{ icon: typeof Clock; label: string }>;
  recommended?: boolean;
  children: ReactNode;
}) {
  const t = PATH_TONE[tone];
  const artStyle: CSSProperties = {
    background: `radial-gradient(120% 100% at 50% 0%, color-mix(in oklch, ${t.glow} 24%, transparent), transparent 72%)`,
  };
  return (
    <article
      className={cn(
        "group glass relative flex flex-col overflow-hidden rounded-2xl transition duration-300 hover:-translate-y-1",
        t.hover,
        recommended && "border-purple/35",
      )}
    >
      <div className="relative h-52 border-b border-border/60" style={artStyle}>
        <div className="absolute inset-x-4 top-8 bottom-2 transition duration-500 group-hover:scale-[1.04]">
          {art}
        </div>
        <span className="technical-label absolute top-3 left-4">{step}</span>
        {recommended ? (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-purple px-2.5 py-1 text-[10px] font-semibold text-white shadow-[0_6px_20px_-6px_var(--purple)]">
            <Sparkles className="size-3" /> Recommended
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase", t.text)}>
          <Icon className="size-3.5" /> {kicker}
        </p>
        <h3 className="mt-1.5 font-display text-xl font-bold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {traits.map((tr) => (
            <li
              key={tr.label}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                t.chip,
              )}
            >
              <tr.icon className="size-3" /> {tr.label}
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-6">{children}</div>
      </div>
    </article>
  );
}

/* ── Plans still going ────────────────────────────────────────────────── */

function PlanningRunRow({
  id,
  title,
  createdAt,
  label,
}: {
  id: string;
  title: string;
  createdAt: string | null;
  label: string | null | undefined;
}) {
  const elapsed = useElapsed(createdAt, true);
  return (
    <Link
      to="/workflows/new/ai"
      search={{ run: id }}
      className="group flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2.5 transition hover:border-primary/50 hover:bg-primary/10"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/15">
        <Loader2 className="size-3.5 animate-spin text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {label ?? "Starting…"}
        </span>
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {formatElapsed(elapsed)}
      </span>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        Watch <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/* ── At a glance ──────────────────────────────────────────────────────── */

const COMPARE: Array<{ label: string; values: [string, string, string] }> = [
  { label: "What you provide", values: ["One sentence", "Every step", "What differs"] },
  {
    label: "Creates missing agents & activities",
    values: ["Yes, automatically", "No — pick existing", "No — reuses the source"],
  },
  {
    label: "Time to a runnable workflow",
    values: ["1–3 minutes", "Up to you", "Seconds to start"],
  },
  { label: "Ends as", values: ["Published", "Draft, then publish", "Draft, then publish"] },
];
const COMPARE_HEAD = [
  { label: "Planner", className: "text-purple" },
  { label: "Builder", className: "text-cyan" },
  { label: "Copy", className: "text-emerald" },
];

function AtAGlance() {
  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] gap-2 border-b border-border/60 bg-background/40 px-5 py-3 text-[11px] font-semibold uppercase">
        <span className="text-muted-foreground">At a glance</span>
        {COMPARE_HEAD.map((h) => (
          <span key={h.label} className={h.className}>
            {h.label}
          </span>
        ))}
      </div>
      {COMPARE.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1.4fr_repeat(3,1fr)] items-center gap-2 border-b border-border/40 px-5 py-2.5 text-xs last:border-b-0"
        >
          <span className="text-muted-foreground">{row.label}</span>
          {row.values.map((v, i) => (
            <span key={i} className="font-medium text-foreground">
              {v}
            </span>
          ))}
        </div>
      ))}
    </section>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function NewWorkflowPage() {
  const navigate = useNavigate();
  const [source, setSource] = useState("");

  const workflows = useQuery({ queryKey: QK.workflows(), queryFn: workflowsApi.list });
  const copyable = useMemo(
    () =>
      (workflows.data?.workflows ?? [])
        .filter((w) => !w.archived && w.steps?.length)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [workflows.data],
  );

  const runs = useRunsStore((s) => s.runs);
  const planning = useMemo(
    () =>
      Object.values(runs)
        .filter((r) => r.kind === "workflow_plan" && r.status === "running")
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [runs],
  );

  return (
    <div className="relative mx-auto max-w-6xl px-6 pt-6 pb-12">
      {/* backdrop */}
      <div
        className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[28rem]"
        style={{
          maskImage: "radial-gradient(70% 60% at 50% 25%, black, transparent)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 25%, black, transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-64 w-[44rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{
          background: "linear-gradient(90deg, var(--purple), var(--cyan) 50%, var(--emerald))",
        }}
      />

      <div className="relative">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/workflows">
            <ArrowLeft className="size-3.5" /> All workflows
          </Link>
        </Button>

        {/* ── Hero ── */}
        <header className="mx-auto mt-4 max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            <GitBranch className="size-3" /> New workflow
          </span>
          <h1 className="mt-4 font-display text-3xl leading-tight font-bold text-foreground sm:text-[2.6rem]">
            How do you want to <span className="text-gradient-brand">build</span> it?
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Three ways in, one result — a validated workflow the Mistral worker can run. You can
            switch to the builder at any point to change it by hand.
          </p>
        </header>

        {planning.length > 0 ? (
          <section className="mx-auto mt-8 max-w-3xl space-y-2">
            <h2 className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase">
              <span className="pulse-dot size-1.5 rounded-full bg-primary text-primary" /> Still
              planning ({planning.length})
            </h2>
            <div className="grid gap-2">
              {planning.map((r) => (
                <PlanningRunRow
                  key={r.id}
                  id={r.id}
                  title={r.title}
                  createdAt={r.created_at}
                  label={r.progress?.label}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── The three paths ── */}
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <PathCard
            tone="purple"
            step="01"
            icon={Sparkles}
            kicker="AI planner"
            title="Describe the goal"
            description="Say what you want in plain words. The planner picks the steps, reuses or builds the agents and activities, wires the data and publishes."
            art={<PlannerArt />}
            recommended
            traits={[
              { icon: Clock, label: "1–3 min" },
              { icon: Bot, label: "Builds what's missing" },
              { icon: Rocket, label: "Published" },
            ]}
          >
            <Button asChild className="w-full bg-purple text-white hover:bg-purple/90">
              <Link to="/workflows/new/ai">
                Open the planner <ArrowRight className="size-4" />
              </Link>
            </Button>
          </PathCard>

          <PathCard
            tone="cyan"
            step="02"
            icon={Wrench}
            kicker="Visual builder"
            title="Build it on a canvas"
            description="Drag agents, activities and integrations from the palette and connect them yourself — for when you already know the shape."
            art={<BuilderArt />}
            traits={[
              { icon: MousePointer2, label: "Drag & connect" },
              { icon: ShieldCheck, label: "Live validation" },
              { icon: FilePen, label: "Draft first" },
            ]}
          >
            <Button
              asChild
              variant="outline"
              className="w-full border-cyan/40 text-cyan hover:bg-cyan/10 hover:text-cyan"
            >
              <Link to="/workflows/new/visual">
                Open the builder <ArrowRight className="size-4" />
              </Link>
            </Button>
          </PathCard>

          <PathCard
            tone="emerald"
            step="03"
            icon={Copy}
            kicker="From a template"
            title="Copy a workflow"
            description="Start from something that already works. Its steps, wiring and inputs open in the builder under a new name."
            art={<CopyArt />}
            traits={[
              { icon: Layers, label: "Keeps wiring" },
              { icon: Zap, label: "Seconds to start" },
              { icon: Lock, label: "Original untouched" },
            ]}
          >
            <div className="flex gap-2">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9 min-w-0 flex-1 rounded-lg border-border/60 bg-background-elevated text-xs">
                  <SelectValue
                    placeholder={
                      workflows.isLoading
                        ? "Loading workflows…"
                        : copyable.length
                          ? "Choose a workflow"
                          : "No workflows yet"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-lg border-border-strong bg-popover/95 backdrop-blur-xl">
                  {copyable.map((w) => (
                    <SelectItem key={w.name} value={w.name} className="text-xs">
                      <span className="flex items-center gap-2">
                        <GitBranch className="size-3 text-muted-foreground" />
                        <span className="truncate">{w.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {w.steps.length} steps
                          {w.created_at ? ` · ${formatRelative(w.created_at)}` : ""}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                aria-label="Copy and edit"
                className="border-emerald/40 text-emerald hover:bg-emerald/10 hover:text-emerald"
                disabled={!source}
                onClick={() =>
                  void navigate({ to: "/workflows/new/visual", search: { from: source } })
                }
              >
                Copy <ArrowRight className="size-4" />
              </Button>
            </div>
          </PathCard>
        </div>

        <div className="mt-8 hidden md:block">
          <AtAGlance />
        </div>
      </div>
    </div>
  );
}
