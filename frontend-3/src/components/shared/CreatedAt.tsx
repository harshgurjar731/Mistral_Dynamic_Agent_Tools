import { CalendarClock } from "lucide-react";
import { formatCreated, formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

/** The creation date and time of a listed item, with the relative age on hover. */
export function CreatedAt({
  value,
  label = "Created",
  className,
}: {
  value: unknown;
  label?: string;
  className?: string | undefined;
}) {
  const text = formatCreated(value);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground", className)}
      title={text ? `${label} ${formatRelative(value as string)}` : `${label} date not recorded`}
    >
      <CalendarClock className="size-3 shrink-0" />
      <span className="truncate tabular-nums">
        {label} {text ?? "—"}
      </span>
    </span>
  );
}
