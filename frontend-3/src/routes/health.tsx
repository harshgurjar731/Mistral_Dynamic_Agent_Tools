import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, CircleOff, RefreshCw, XCircle } from "lucide-react";
import type { ComponentState, StatusComponent, SystemVerdict } from "@/api/auth";
import { errorMessage } from "@/api/client";
import { useSystemStatus } from "@/components/layout/HealthIndicator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/health")({
  head: () => ({
    meta: [
      { title: "System status — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Whether the platform is live, and what is affected if not.",
      },
    ],
  }),
  component: StatusPage,
});

const VERDICT: Record<SystemVerdict, { tone: string; icon: typeof CheckCircle2; sub: string }> = {
  operational: {
    tone: "border-emerald/30 bg-emerald/10 text-emerald",
    icon: CheckCircle2,
    sub: "Everything is working normally.",
  },
  degraded: {
    tone: "border-amber/30 bg-amber/10 text-amber",
    icon: AlertTriangle,
    sub: "The platform is live, but some features are affected. Details below.",
  },
  outage: {
    tone: "border-red/30 bg-red/10 text-red",
    icon: XCircle,
    sub: "The platform can't do its main work right now. Your administrator has the details.",
  },
};

const STATE: Record<ComponentState, { label: string; dot: string; text: string }> = {
  ok: { label: "Working", dot: "bg-emerald", text: "text-emerald" },
  degraded: { label: "Degraded", dot: "bg-amber", text: "text-amber" },
  down: { label: "Unavailable", dot: "bg-red", text: "text-red" },
  off: { label: "Off", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

function StatusPage() {
  const user = useCurrentUser();
  const q = useSystemStatus();
  const d = q.data;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">System status</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {user ? `For your work in ${user.workspace.name}.` : null} Checked automatically every
            half minute.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background-elevated px-3 text-sm transition hover:bg-surface-hover disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} /> Check now
        </button>
      </div>

      {q.isLoading ? (
        <Skeleton className="mt-8 h-28 rounded-lg" />
      ) : q.isError || !d ? (
        <Verdict
          tone={VERDICT.outage.tone}
          Icon={XCircle}
          title="Can't reach the platform"
          sub={`${errorMessage(q.error)} If this keeps happening, tell your administrator.`}
        />
      ) : (
        <>
          <Verdict
            tone={VERDICT[d.status].tone}
            Icon={VERDICT[d.status].icon}
            title={d.status === "operational" ? "Live — all systems operational" : d.headline}
            sub={VERDICT[d.status].sub}
            when={d.checked_at}
          />

          {d.issues.length ? (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What's affected
              </h2>
              <ul className="mt-3 space-y-3">
                {d.issues.map((i) => (
                  <IssueRow key={i.key} c={i} />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Components
            </h2>
            <ul className="glass mt-3 divide-y divide-border rounded-lg">
              {d.components.map((c) => (
                <li key={c.key} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={cn("size-2 shrink-0 rounded-full", STATE[c.state].dot)} />
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                    {c.name}
                  </span>
                  <span className={cn("text-xs font-medium", STATE[c.state].text)}>
                    {STATE[c.state].label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Verdict({
  tone,
  Icon,
  title,
  sub,
  when,
}: {
  tone: string;
  Icon: typeof CheckCircle2;
  title: string;
  sub: string;
  when?: number;
}) {
  return (
    <div className={cn("mt-8 flex items-start gap-4 rounded-lg border p-5", tone)}>
      <Icon className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm text-foreground/80">{sub}</p>
        {when ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Last checked {new Date(when * 1000).toLocaleTimeString()}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function IssueRow({ c }: { c: StatusComponent }) {
  const s = STATE[c.state];
  const Icon = c.state === "off" ? CircleOff : c.state === "down" ? XCircle : AlertTriangle;
  return (
    <li className="glass flex gap-3.5 rounded-lg p-4">
      <Icon className={cn("mt-0.5 size-5 shrink-0", s.text)} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          {c.name}
          <span className={cn("text-xs font-medium", s.text)}>{s.label}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{c.message}</p>
        {c.impact ? (
          <p className="mt-1.5 text-sm text-foreground">
            <span className="font-medium">What this means: </span>
            {c.impact}
          </p>
        ) : null}
      </div>
    </li>
  );
}
