import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Blocks, Bot, GripVertical, Plus, Search, Sparkles, X } from "lucide-react";
import type { BuilderCatalog, CatalogAgent, CatalogTool, StepType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";
import { MAX_STEPS } from "./builderModel";

/**
 * Anything the palette can drop onto the canvas. Serialised as-is for drag and drop.
 * Agents and activities are the building blocks; tools and connectors are
 * configured on the agent, so they are not offered as steps.
 */
export type PaletteItem =
  | { kind: "type"; type: StepType }
  | { kind: "agent"; agent: CatalogAgent }
  | { kind: "activity"; activity: CatalogTool };

/** Control-flow steps; agents and activities come from their own lists. */
const LOGIC_TYPES: StepType[] = ["condition", "transform"];

export const PALETTE_MIME = "application/x-workflow-item";

export function parsePaletteItem(payload: string): PaletteItem | null {
  try {
    const item = JSON.parse(payload) as PaletteItem;
    return item && typeof item === "object" && "kind" in item ? item : null;
  } catch {
    return null;
  }
}

/** The round button that opens the palette; lives in the canvas' top-left corner. */
export function PaletteToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? "Close palette (P)" : "Open palette (P)"}
      aria-label={open ? "Close palette" : "Open palette"}
      aria-expanded={open}
      className={cn(
        "pointer-events-auto grid size-10 shrink-0 place-items-center rounded-full border shadow-lg backdrop-blur-md transition-all duration-200 ease-out hover:scale-105 active:scale-95",
        open
          ? "border-border-strong bg-background-elevated text-foreground"
          : "border-primary/40 bg-primary text-primary-foreground shadow-primary/25",
      )}
    >
      <span className="relative grid size-4 place-items-center">
        <Blocks
          className={cn(
            "absolute size-4 transition-all duration-200",
            open ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100",
          )}
        />
        <X
          className={cn(
            "absolute size-4 transition-all duration-200",
            open ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0",
          )}
        />
      </span>
    </button>
  );
}

export function BuilderPalette({
  open,
  onClose,
  catalog,
  stepCount,
  onAdd,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  catalog: BuilderCatalog | undefined;
  stepCount: number;
  onAdd: (item: PaletteItem) => void;
  onCreate: (kind: "agent" | "activity") => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => f?.toLowerCase().includes(q));

  const filtered = useMemo(
    () => ({
      agents: (catalog?.agents ?? []).filter((a) => matches(a.name, a.description)),
      activities: (catalog?.activities ?? []).filter((t) => matches(t.name, t.description)),
      logic: LOGIC_TYPES.filter((t) => matches(t, STEP_TYPE_IDENTITY[t].label)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, q],
  );

  const nothingFound =
    q && filtered.agents.length + filtered.activities.length + filtered.logic.length === 0;

  const full = stepCount >= MAX_STEPS;

  return (
    <aside
      aria-label="Palette"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        "glass-elevated pointer-events-auto absolute bottom-3 left-3 top-16 flex w-72 origin-top-left flex-col overflow-hidden rounded-xl border border-border-strong shadow-2xl backdrop-blur-xl transition-all duration-200 ease-out",
        open
          ? "translate-x-0 scale-100 opacity-100"
          : "pointer-events-none -translate-x-2 scale-95 opacity-0",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-foreground">Palette</p>
          <p className={cn("font-mono text-[10px]", full ? "text-red" : "text-muted-foreground")}>
            {stepCount} / {MAX_STEPS} steps
            {catalog
              ? ` · ${catalog.agents.length} agents · ${catalog.activities?.length ?? 0} activities`
              : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={onClose}
          title="Close palette (Esc)"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents and activities…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-3">
        {!q && (
          <Section title="Create new">
            <div className="grid grid-cols-2 gap-1.5">
              <CreateButton
                icon={<Bot className="size-3.5 text-primary" />}
                label="Agent"
                hint="with tools & connectors"
                onClick={() => onCreate("agent")}
              />
              <CreateButton
                icon={<Sparkles className="size-3.5 text-cyan" />}
                label="Activity"
                hint="synthesised function"
                onClick={() => onCreate("activity")}
              />
            </div>
          </Section>
        )}

        {filtered.agents.length > 0 && (
          <Section title="Agents" count={filtered.agents.length}>
            {filtered.agents.map((a) => (
              <PaletteTile
                key={a.id}
                item={{ kind: "agent", agent: a }}
                onAdd={onAdd}
                title={a.description || a.name}
              >
                <Bot className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-foreground">
                    {a.name}
                  </span>
                  {a.tools.length + a.connectors.length > 0 ? (
                    <span className="block truncate font-mono text-[9px] text-muted-foreground">
                      {a.tools.length} tools · {a.connectors.length} connectors
                    </span>
                  ) : null}
                </span>
              </PaletteTile>
            ))}
          </Section>
        )}

        {filtered.activities.length > 0 && (
          <Section title="Activities" count={filtered.activities.length}>
            {filtered.activities.map((t) => (
              <PaletteTile
                key={`${t.source}:${t.name}`}
                item={{ kind: "activity", activity: t }}
                onAdd={onAdd}
                title={t.description || t.name}
              >
                <Sparkles className="size-3.5 shrink-0 text-cyan" />
                <span className="flex-1 truncate font-mono text-[11px] text-foreground">
                  {t.name}
                </span>
              </PaletteTile>
            ))}
          </Section>
        )}

        {!q && catalog && (catalog.activities?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-muted-foreground">No activities yet — create one above.</p>
        ) : null}

        {filtered.logic.length > 0 && (
          <Section title="Logic">
            <div className="grid grid-cols-2 gap-1.5">
              {filtered.logic.map((type) => {
                const identity = STEP_TYPE_IDENTITY[type];
                return (
                  <PaletteTile
                    key={type}
                    item={{ kind: "type", type }}
                    onAdd={onAdd}
                    title={`Add a ${identity.label.toLowerCase()} step`}
                    className="justify-start px-2 py-2"
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full border",
                        identity.bg,
                        identity.border,
                      )}
                    />
                    <span className="flex-1 truncate text-xs font-medium text-foreground">
                      {identity.label}
                    </span>
                  </PaletteTile>
                );
              })}
            </div>
          </Section>
        )}

        {nothingFound ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        ) : null}
      </div>

      <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        Click to add, or drag onto the canvas.
      </p>
    </aside>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5 text-[10px]">
        {title}
        {count !== undefined ? <span className="ml-1 text-muted-foreground">({count})</span> : null}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function PaletteTile({
  item,
  onAdd,
  title,
  className,
  children,
}: {
  item: PaletteItem;
  onAdd: (item: PaletteItem) => void;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => onAdd(item)}
      title={title}
      className={cn(
        "group flex w-full cursor-grab items-center gap-2 rounded-md border border-border/70 bg-background-elevated/50 px-2 py-1.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-border-strong hover:bg-surface-hover hover:shadow-sm active:cursor-grabbing",
        className,
      )}
    >
      {children}
      <GripVertical className="size-3 shrink-0 text-muted-foreground/50 transition-opacity group-hover:opacity-0" />
      <Plus className="-ml-5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function CreateButton({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-md border border-dashed border-border px-1 py-2 text-[11px] text-muted-foreground transition hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
    >
      {icon}
      <span className="font-medium text-foreground">+ {label}</span>
      <span className="text-[9px]">{hint}</span>
    </button>
  );
}
