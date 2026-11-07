import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Scroll reveal ─────────────────────────────────────────────────────── */

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string | undefined;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ── Hero: a build, playing ────────────────────────────────────────────── */

const BUILDS = [
  {
    goal: "Pre-screen mortgage applications and flag the ones a person should review.",
    workspace: "Lending",
    made: ["3 agents", "2 new tools", "4 rules", "1 human review"],
  },
  {
    goal: "Validate incoming insurance claims against the policy and route exceptions.",
    workspace: "Claims",
    made: ["2 agents", "1 new tool", "3 rules", "1 human review"],
  },
  {
    goal: "Onboard a business customer: KYC checks, risk score and a welcome pack.",
    workspace: "Onboarding",
    made: ["4 agents", "3 new tools", "5 rules", "1 approval"],
  },
];

const STEPS: { icon: LucideIcon; label: string; detail: string }[] = [
  { icon: Sparkles, label: "Understand the goal", detail: "intent, domain, constraints" },
  { icon: BookOpen, label: "Ground in your knowledge", detail: "processes, guidance, documents" },
  { icon: Bot, label: "Design the agents", detail: "roles, instructions, hand-offs" },
  { icon: Wrench, label: "Write missing tools", detail: "generated, linted, sandboxed" },
  { icon: ShieldCheck, label: "Apply rules & reviews", detail: "gates, guardrails, approvals" },
  { icon: Play, label: "Run & trace", detail: "every step, on Mistral" },
];

export function LiveBuild() {
  const reduce = useReducedMotion();
  const [build, setBuild] = useState(0);
  const [typed, setTyped] = useState(reduce ? BUILDS[0]!.goal.length : 0);
  const [step, setStep] = useState(reduce ? STEPS.length : -1);
  const current = BUILDS[build]!;

  useEffect(() => {
    if (reduce) return;
    setTyped(0);
    setStep(-1);
    const timers: number[] = [];
    const goal = current.goal;
    for (let i = 1; i <= goal.length; i++) {
      timers.push(window.setTimeout(() => setTyped(i), i * 22));
    }
    const typedAt = goal.length * 22 + 300;
    STEPS.forEach((_, i) => {
      timers.push(window.setTimeout(() => setStep(i), typedAt + i * 750));
    });
    timers.push(window.setTimeout(() => setStep(STEPS.length), typedAt + STEPS.length * 750));
    timers.push(
      window.setTimeout(
        () => setBuild((b) => (b + 1) % BUILDS.length),
        typedAt + STEPS.length * 750 + 2600,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [build, reduce, current.goal]);

  const finished = step >= STEPS.length;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2rem] opacity-40 blur-2xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <div className="glass-elevated relative overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="size-2.5 rounded-full bg-red/70" />
          <span className="size-2.5 rounded-full bg-amber/70" />
          <span className="size-2.5 rounded-full bg-emerald/70" />
          <span className="ml-3 truncate font-mono text-[11px] text-muted-foreground">
            orchestrator · workspace {current.workspace}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 text-[10px] font-medium text-emerald">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald" /> live
          </span>
        </div>

        <div className="p-5">
          <p className="technical-label">Goal</p>
          <p className="mt-1.5 min-h-[3rem] text-sm leading-relaxed text-foreground">
            “{current.goal.slice(0, typed)}
            {typed < current.goal.length ? (
              <span className="ml-px inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary" />
            ) : null}
            ”
          </p>

          <ol className="mt-4 space-y-1.5">
            {STEPS.map((s, i) => {
              const state = i < step || finished ? "done" : i === step ? "active" : "todo";
              return (
                <li
                  key={s.label}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-500",
                    state === "active" && "border-primary/40 bg-primary/10",
                    state === "done" && "border-border bg-background-elevated/60",
                    state === "todo" && "border-transparent opacity-45",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md border transition-colors",
                      state === "done"
                        ? "border-emerald/30 bg-emerald/10 text-emerald"
                        : state === "active"
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="size-3.5" />
                    ) : state === "active" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <s.icon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-foreground">{s.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {s.detail}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex min-h-[2rem] flex-wrap items-center gap-1.5">
            <AnimatePresence>
              {finished
                ? current.made.map((m, i) => (
                    <motion.span
                      key={`${build}-${m}`}
                      initial={{ opacity: 0, scale: 0.9, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald/30 bg-emerald/10 px-2.5 py-1 text-[11px] font-medium text-emerald"
                    >
                      <CheckCircle2 className="size-3" /> {m}
                    </motion.span>
                  ))
                : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Feature mini-visuals ──────────────────────────────────────────────── */

export function CodeVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background-elevated font-mono text-[11px] leading-relaxed">
      <div className="border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        fetch_exchange_rate.py · generated
      </div>
      <pre className="overflow-hidden px-3 py-2 text-muted-foreground">
        <span className="text-primary">def</span>{" "}
        <span className="text-foreground">fetch_exchange_rate</span>(base, quote):{"\n"}
        {"    "}
        <span className="text-muted-foreground/70">"""Live FX rate for a pair."""</span>
        {"\n"}
        {"    "}r = http.get(API, params=...){"\n"}
        {"    "}
        <span className="text-primary">return</span> r.json()["rate"]
      </pre>
      <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
        {["lint", "AST check", "sandbox test", "registered"].map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded border border-emerald/25 bg-emerald/10 px-1.5 py-0.5 text-[10px] text-emerald"
          >
            <Check className="size-2.5" /> {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DagVisual() {
  const nodes = [
    { x: 12, y: 46, label: "Intake" },
    { x: 112, y: 14, label: "Credit" },
    { x: 112, y: 78, label: "Income" },
    { x: 212, y: 46, label: "Decide" },
    { x: 300, y: 46, label: "Review" },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
  ];
  return (
    <svg viewBox="0 0 372 110" className="h-auto w-full" role="img" aria-label="A workflow graph">
      {edges.map(([a, b]) => {
        const s = nodes[a]!;
        const t = nodes[b]!;
        return (
          <path
            key={`${a}-${b}`}
            d={`M${s.x + 62} ${s.y + 9} C ${s.x + 90} ${s.y + 9}, ${t.x - 28} ${t.y + 9}, ${t.x} ${t.y + 9}`}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
        );
      })}
      {nodes.map((n, i) => (
        <g key={n.label}>
          <rect
            x={n.x}
            y={n.y}
            width="62"
            height="18"
            rx="5"
            fill={i === 4 ? "var(--primary)" : "var(--secondary)"}
            fillOpacity={i === 4 ? 0.18 : 1}
            stroke={i === 4 ? "var(--primary)" : "var(--border)"}
          />
          <text
            x={n.x + 31}
            y={n.y + 12.5}
            textAnchor="middle"
            fontSize="9"
            fill="var(--foreground)"
            fontFamily="var(--font-sans)"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function GraphVisual() {
  const pts = [
    [60, 55],
    [130, 22],
    [140, 88],
    [210, 50],
    [26, 18],
    [24, 92],
    [196, 102],
    [232, 14],
  ] as const;
  const links: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [0, 4],
    [0, 5],
    [2, 6],
    [3, 7],
    [1, 7],
  ];
  return (
    <svg viewBox="0 0 256 116" className="h-auto w-full" role="img" aria-label="A knowledge graph">
      {links.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={pts[a]![0]}
          y1={pts[a]![1]}
          x2={pts[b]![0]}
          y2={pts[b]![1]}
          stroke="var(--border-strong)"
          strokeWidth="1"
        />
      ))}
      {pts.map(([x, y], i) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={i === 0 ? 9 : i < 4 ? 6.5 : 4.5}
          fill={i === 0 ? "var(--primary)" : i < 4 ? "var(--cyan)" : "var(--muted-foreground)"}
          fillOpacity={i === 0 ? 0.9 : 0.75}
        />
      ))}
    </svg>
  );
}

export function TraceVisual() {
  const rows = [
    ["workflow run", 0, 100, "var(--primary)"],
    ["intake agent", 2, 24, "var(--cyan)"],
    ["credit tool", 26, 22, "var(--emerald)"],
    ["rule: affordability", 49, 8, "var(--amber)"],
    ["decision model", 58, 30, "var(--cyan)"],
    ["human review", 89, 11, "var(--purple)"],
  ] as const;
  return (
    <div className="space-y-1.5">
      {rows.map(([label, start, width, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
            {label}
          </span>
          <span className="relative h-2.5 flex-1 rounded-full bg-secondary">
            <span
              className="absolute inset-y-0 rounded-full"
              style={{ left: `${start}%`, width: `${width}%`, background: color, opacity: 0.85 }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReviewVisual() {
  return (
    <div className="rounded-lg border border-border bg-background-elevated p-3">
      <p className="text-[11px] font-medium text-foreground">Loan above auto-approval limit</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Step “Decide” · waiting for a Reviewer
      </p>
      <div className="mt-2.5 flex gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
          <Check className="size-3" /> Approve
        </span>
        <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
          Correct
        </span>
        <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
          Reject
        </span>
      </div>
    </div>
  );
}

export function WorkspacesVisual() {
  const spaces = [
    ["Lending", "Builder", "••••7f3a"],
    ["Claims", "Reviewer", "••••19be"],
    ["Research", "Viewer", "••••c402"],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {spaces.map(([name, role, key]) => (
        <div key={name} className="rounded-lg border border-border bg-background-elevated p-3">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded bg-secondary text-[10px] font-bold">
              {name!.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-xs font-medium text-foreground">{name}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {role}
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <KeyRound className="size-2.5 text-emerald" /> {key}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatVisual() {
  return (
    <div className="space-y-2 text-[11px]">
      <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-3 py-2 text-foreground">
        Build an agent that drafts the decision letter for approved personal loans.
      </div>
      <div className="flex max-w-[90%] gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary">
          <Cpu className="size-3.5 text-primary" />
        </span>
        <div className="rounded-xl rounded-tl-sm border border-border bg-background-elevated px-3 py-2 text-muted-foreground">
          Designed <span className="text-foreground">Decision Letter Writer</span> with your lending
          guidance, a template tool and the tone rule. Ready to run.
        </div>
      </div>
    </div>
  );
}
