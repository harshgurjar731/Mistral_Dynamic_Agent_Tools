import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one page heading used across the control plane: eyebrow, title, lede and
 * a right-aligned action slot. Matches the header the hand-written pages
 * (Tools, Agents, Connectors) already render inline.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Compact metric tile — the pattern the execution history sheet already uses. */
export function StatTile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "emerald" | "red" | "amber" | "blue";
  title?: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald"
      : tone === "red"
        ? "text-red"
        : tone === "amber"
          ? "text-amber"
          : tone === "blue"
            ? "text-blue"
            : "text-foreground";
  return (
    <div
      title={title ?? ""}
      className="rounded-lg border border-border bg-background-elevated/60 px-3 py-2.5 text-center"
    >
      <p className={cn("font-display text-lg font-bold", toneClass)}>{value}</p>
      <p className="technical-label mt-0.5">{label}</p>
    </div>
  );
}
