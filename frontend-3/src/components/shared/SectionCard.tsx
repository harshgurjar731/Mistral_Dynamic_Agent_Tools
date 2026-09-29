import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The card every remote-server section sits in: icon + title header, then a body. */
export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  className,
  bodyClassName,
  children,
}: {
  icon?: LucideIcon | undefined;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border/60 backdrop-blur-md",
        className,
      )}
      style={{ background: "var(--surface)" }}
    >
      <header className="flex items-start gap-3 border-b border-border/40 px-5 py-4">
        {Icon ? (
          <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background-elevated text-muted-foreground">
            <Icon className="size-4" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("flex-1 p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A small headline number with a label, for the stat row at the top of a page. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  valueClassName,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  valueClassName?: string | undefined;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-border/60 p-4 backdrop-blur-md"
      style={{ background: "var(--surface)" }}
    >
      <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          {label}
        </p>
        <div
          className={cn("mt-0.5 truncate text-base font-semibold text-foreground", valueClassName)}
        >
          {value}
        </div>
        {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
