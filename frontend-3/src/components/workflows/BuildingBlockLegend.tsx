import { BLOCK, type BuildingBlock } from "@/lib/terminology";
import { cn } from "@/lib/utils";

const SHOWN: BuildingBlock[] = ["activity", "agent_tool"];

/**
 * The two things planners most often confuse, defined once above the timeline
 * so every card below can use the words without re-explaining them.
 */
export function BuildingBlockLegend({ className }: { className?: string | undefined }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {SHOWN.map((block) => {
        const meta = BLOCK[block];
        const Icon = meta.icon;
        return (
          <div
            key={block}
            className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2", meta.box)}
          >
            <span
              className={cn(
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border",
                meta.chip,
              )}
            >
              <Icon className="size-3" />
            </span>
            <div className="min-w-0">
              <p className={cn("text-[11px] font-semibold", meta.text)}>{meta.label}</p>
              <p className="text-[10px] leading-relaxed text-foreground/80">{meta.placement}</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">{meta.definition}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
