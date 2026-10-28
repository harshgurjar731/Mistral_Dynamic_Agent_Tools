import { cn } from "@/lib/utils";

/**
 * A progress bar that only fills as far as something measured says. With no
 * measure (`value` null) it shows a travelling segment instead of guessing.
 */
export function LiveBar({
  value,
  tone = "bg-primary",
  className,
}: {
  value: number | null;
  tone?: string;
  className?: string | undefined;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-border/60", className)}
    >
      {value === null ? (
        <div className={cn("progress-indeterminate absolute inset-y-0 w-1/4 rounded-full", tone)} />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", tone)}
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  );
}
