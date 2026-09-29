import { useMemo, useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
import type { Concept } from "@/types";
import { DomainCascadeSelect } from "./DomainCascadeSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DomainFilterDropdown({
  concepts,
  selected,
  onChange,
}: {
  concepts: Concept[];
  selected?: Set<string> | string[] | string | null;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => {
    if (!selected) return new Set<string>();
    if (selected instanceof Set) return selected;
    if (Array.isArray(selected)) return new Set(selected);
    if (typeof selected === "string") return new Set([selected]);
    return new Set<string>();
  }, [selected]);

  const add = (id: string) => onChange(new Set(selectedSet).add(id));
  const remove = (id: string) => {
    const next = new Set(selectedSet);
    next.delete(id);
    onChange(next);
  };

  // Portalled to the body so the panel isn't clipped or covered by the
  // stacking context of a blurred filter bar.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition",
            selectedSet.size > 0
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border bg-background-elevated/60 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Tag className="size-3.5" />
          <span>Domain</span>
          {selectedSet.size > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] text-primary">
              {selectedSet.size}
            </span>
          )}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={16}
        className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border-border bg-background-elevated p-3.5 text-foreground shadow-2xl"
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-border pb-2">
          <span className="text-xs font-semibold text-foreground">Filter by domain</span>
          {selectedSet.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="text-[11px] text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <DomainCascadeSelect
          concepts={concepts}
          selected={[...selectedSet]}
          onAdd={add}
          onRemove={remove}
        />
      </PopoverContent>
    </Popover>
  );
}
