import { cn } from "@/lib/utils";
import type { StatusIdentity } from "@/lib/status";

export function StatusPill({
  identity,
  label,
  className,
  size = "sm",
}: {
  identity: StatusIdentity;
  label?: string;
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border font-mono font-bold uppercase whitespace-nowrap",
        size === "xs" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
        identity.bg,
        identity.border,
        identity.text,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          identity.pulse && "animate-pulse",
        )}
      />
      {label ?? identity.label}
    </span>
  );
}
