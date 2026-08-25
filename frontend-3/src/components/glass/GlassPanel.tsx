import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "raised" | "sunken" | "accent";

const TONES: Record<Tone, string> = {
  default: "glass",
  raised: "glass-elevated",
  sunken: "border-border bg-background-elevated/60",
  accent: "bg-primary/10 border-primary/25",
};

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  inset?: boolean;
}

export function GlassPanel({
  tone = "default",
  inset = false,
  className,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "rounded-lg border backdrop-blur-md transition-colors duration-200 hover:border-border-strong",
        TONES[tone],
        inset && "p-5",
        className,
      )}
      {...props}
    />
  );
}

export function GlassPanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate font-display text-sm font-bold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
