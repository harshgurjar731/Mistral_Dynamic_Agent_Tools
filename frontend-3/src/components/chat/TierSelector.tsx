import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ontologyApi, QK } from "@/api";
import { tierIdentity } from "@/lib/status";
import { cn } from "@/lib/utils";

const FALLBACK_TIERS = [
  { value: "foundation", label: "Foundation" },
  { value: "domain", label: "Domain" },
  { value: "use_case", label: "Use-Case" },
];

export function TierSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (tier: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: QK.ontologyTiers(),
    queryFn: ontologyApi.tiers,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const tiers = (data?.tiers?.length ? data.tiers : FALLBACK_TIERS).map((t) => ({
    value: (t as { value?: string; id?: string }).value ?? (t as { id?: string }).id ?? "",
    label: (t as { label?: string }).label ?? "",
  }));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = tierIdentity(value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
          active.bg,
          active.border,
          active.text,
        )}
      >
        <Layers className="size-3.5" />
        {active.label}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-44 overflow-hidden rounded-xl border border-border bg-popover shadow-panel">
          {tiers.map((t) => {
            const id = tierIdentity(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  onChange(t.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-surface-hover",
                  t.value === value ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", id.bg, id.text, "bg-current")} />
                {t.label || id.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
