/**
 * The settled build prerequisites, as a timeline card (`prerequisites` and
 * `code_prerequisites` events). Shows how each item was settled — never a
 * credential's value, which these events do not carry.
 */
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  KeyRound,
  MessageSquareText,
  ServerCog,
  ShieldCheck,
  SkipForward,
  type LucideIcon,
} from "lucide-react";
import type { PrerequisiteItem } from "@/api/runs";
import { cn } from "@/lib/utils";

export interface PrerequisitesEvent {
  stage?: "workflow" | "agent" | "code";
  subject?: string;
  choice?: string;
  asked?: boolean;
  reasoning?: string;
  items?: PrerequisiteItem[];
}

const SETTLED: Record<
  string,
  { icon: LucideIcon; tone: string; text: (i: PrerequisiteItem) => string }
> = {
  vault: {
    icon: KeyRound,
    tone: "text-emerald",
    text: (i) =>
      `vault entry ${i.secret_name ?? i.name}${i.auto ? " (matched automatically)" : ""}`,
  },
  environment: { icon: ServerCog, tone: "text-emerald", text: () => "Tool Service environment" },
  answered: { icon: MessageSquareText, tone: "text-emerald", text: (i) => `“${i.value ?? ""}”` },
  skipped: {
    icon: SkipForward,
    tone: "text-amber",
    text: (i) => `proceeding without${i.instruction ? ` — ${i.instruction}` : ""}`,
  },
  deferred: {
    icon: Clock,
    tone: "text-amber",
    text: (i) => `add ${i.name} to the vault — it reports a configuration error until then`,
  },
  pending: { icon: Clock, tone: "text-muted-foreground", text: () => "not settled" },
};

export function PrerequisitesCard({ data }: { data: PrerequisitesEvent }) {
  const items = data.items ?? [];
  const deferred = items.filter((i) => i.status === "deferred");
  return (
    <div className="mt-2.5 rounded-xl border border-border bg-background-elevated/40 p-4 text-xs">
      <p className="eyebrow mb-2 flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-primary" />
        {data.stage === "code"
          ? `Credentials for ${data.subject ?? "this code"}`
          : "What the build needs from you"}
      </p>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-emerald" />
          {data.reasoning || "Nothing — no credentials, service URLs or facts are needed."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => {
            const s = SETTLED[i.status] ?? SETTLED["pending"]!;
            const Icon = s.icon;
            return (
              <li key={i.key} className="flex items-start gap-2">
                <Icon className={cn("mt-px size-3.5 shrink-0", s.tone)} />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{i.label}</span>
                  {i.service ? <span className="text-muted-foreground"> · {i.service}</span> : null}
                  <span className={cn("block text-[11px]", s.tone)}>{s.text(i)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {deferred.length ? (
        <Link
          to="/settings"
          search={{ category: "vault", create: deferred[0]!.name } as never}
          className="mt-2 inline-block text-[11px] text-primary hover:underline"
        >
          Add {deferred.map((d) => d.name).join(", ")} to the vault →
        </Link>
      ) : null}
      {data.reasoning && items.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{data.reasoning}</p>
      ) : null}
    </div>
  );
}
