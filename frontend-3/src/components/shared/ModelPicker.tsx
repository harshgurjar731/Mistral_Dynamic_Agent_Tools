import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronsUpDown, PencilLine, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** The fields of a catalog card the picker needs. */
export interface PickerModel {
  id: string;
  aliases: string[];
  max_context_length: number | null;
  deprecation: string | null;
  capabilities: Record<string, boolean>;
}

const CAPABILITY_FLAG: Record<string, string> = {
  chat: "completion_chat",
  function_calling: "function_calling",
  moderation: "moderation",
  ocr: "ocr",
  vision: "vision",
};
const CAPABILITY_LABEL: Record<string, string> = {
  chat: "chat",
  function_calling: "tool use",
  moderation: "moderation",
  ocr: "OCR",
  vision: "vision",
};

function fits(m: PickerModel, capability?: string | null) {
  const flag = capability ? CAPABILITY_FLAG[capability] : undefined;
  return !flag || Boolean(m.capabilities[flag]);
}

function ctx(n: number | null) {
  return n ? `${Math.round(n / 1024)}k` : "";
}

function Facts({ m }: { m: PickerModel }) {
  const c = m.capabilities;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 font-mono text-[10px] text-muted-foreground">
      {c["reasoning"] ? <span title="Reasoning">R</span> : null}
      {c["function_calling"] ? <span title="Tool use">T</span> : null}
      {c["vision"] ? <span title="Vision">V</span> : null}
      {m.max_context_length ? (
        <span title="Context window">{ctx(m.max_context_length)}</span>
      ) : null}
    </span>
  );
}

/** A catalog card by id or alias. */
export function findModel(models: PickerModel[], id: string): PickerModel | undefined {
  return models.find((m) => m.id === id || m.aliases.includes(id));
}

/**
 * Searchable model dropdown. Lists pinned models first, then every model the
 * account can call — the ones suited to ``capability`` before the rest — and
 * accepts any typed model id.
 *
 * With ``allowListOnly`` it offers the pinned models (the Settings page's
 * allow list) and nothing else; a current value outside the list is still
 * shown, flagged, so it is never silently swapped out.
 */
export function ModelPicker({
  value,
  onChange,
  models,
  pinned = [],
  capability,
  allowNone = false,
  allowListOnly = false,
  disabled = false,
  className,
  placeholder = "Choose a model",
}: {
  value: string;
  onChange: (value: string) => void;
  models: PickerModel[];
  pinned?: { value: string; label: string }[];
  capability?: string | null;
  allowNone?: boolean;
  allowListOnly?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { pinnedRows, suited, other, byId } = useMemo(() => {
    const byId = new Map<string, PickerModel>();
    for (const m of models) {
      byId.set(m.id, m);
      for (const a of m.aliases) if (!byId.has(a)) byId.set(a, m);
    }
    if (allowListOnly) return { byId, pinnedRows: pinned, suited: [], other: [] };
    const pinnedIds = new Set(pinned.map((p) => p.value));
    const rest = models.filter((m) => !pinnedIds.has(m.id));
    return {
      byId,
      pinnedRows: pinned,
      suited: rest.filter((m) => fits(m, capability) && !m.deprecation),
      other: rest.filter((m) => !fits(m, capability) || m.deprecation),
    };
  }, [models, pinned, capability, allowListOnly]);

  const outsideAllowList =
    allowListOnly && !!value && value !== "none" && !pinned.some((p) => p.value === value);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  const typed = search.trim();
  const isKnown =
    allowListOnly || typed === "" || byId.has(typed) || pinned.some((p) => p.value === typed);
  const pinnedLabel = pinned.find((p) => p.value === value)?.label;
  const capLabel = capability ? CAPABILITY_LABEL[capability] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-xs shadow-sm transition",
            "hover:border-border-strong focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
        >
          {value ? (
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-foreground">{value}</span>
              {pinnedLabel && pinnedLabel !== value ? (
                <span className="ml-2 text-muted-foreground">{pinnedLabel}</span>
              ) : null}
              {outsideAllowList ? (
                <span className="ml-2 text-[10px] text-amber">not on allow list</span>
              ) : null}
            </span>
          ) : (
            <span className="flex-1 text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: "max(var(--radix-popover-trigger-width), 340px)" }}
      >
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={
              allowListOnly ? "Search allowed models…" : "Search models or type any model id…"
            }
          />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No models match.</CommandEmpty>
            {outsideAllowList ? (
              <CommandGroup heading="Current">
                <CommandItem value={value} onSelect={() => pick(value)}>
                  <Check className="size-3.5 opacity-100" />
                  <span className="font-mono">{value}</span>
                  <span className="text-[10px] text-amber">not on allow list</span>
                  {byId.get(value) ? <Facts m={byId.get(value)!} /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {!isKnown ? (
              <CommandGroup heading="Custom">
                <CommandItem value={`custom:${typed}`} onSelect={() => pick(typed)}>
                  <PencilLine className="size-3.5" />
                  Use <span className="font-mono">{typed}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {allowNone ? (
              <CommandGroup>
                <CommandItem value="none" onSelect={() => pick("none")}>
                  <Check
                    className={cn("size-3.5", value === "none" ? "opacity-100" : "opacity-0")}
                  />
                  None
                </CommandItem>
              </CommandGroup>
            ) : null}
            {pinnedRows.length ? (
              <CommandGroup heading={allowListOnly ? "Allowed models" : "Pinned"}>
                {pinnedRows.map((p) => {
                  const card = byId.get(p.value);
                  return (
                    <CommandItem
                      key={`p-${p.value}`}
                      value={p.value}
                      keywords={[p.label]}
                      onSelect={() => pick(p.value)}
                    >
                      <Check
                        className={cn("size-3.5", value === p.value ? "opacity-100" : "opacity-0")}
                      />
                      <span className="font-mono">{p.value}</span>
                      {card ? <Facts m={card} /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {suited.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading={capLabel ? `Suited to ${capLabel}` : "Mistral models"}>
                  {suited.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      keywords={m.aliases}
                      onSelect={() => pick(m.id)}
                    >
                      <Check
                        className={cn("size-3.5", value === m.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="font-mono">{m.id}</span>
                      <Facts m={m} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            {other.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Other models">
                  {other.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      keywords={m.aliases}
                      onSelect={() => pick(m.id)}
                    >
                      <Check
                        className={cn("size-3.5", value === m.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="font-mono">{m.id}</span>
                      <span className="text-[10px] text-amber">
                        {m.deprecation ? "deprecated" : capLabel ? `no ${capLabel}` : ""}
                      </span>
                      <Facts m={m} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
        <p className="border-t border-border/60 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          R reasoning · T tool use · V vision · context window
          {allowListOnly ? (
            <span className="mt-0.5 block font-sans">
              Allow list is set on Settings → Models → Pinned models.
            </span>
          ) : null}
        </p>
      </PopoverContent>
    </Popover>
  );
}

const CAPABILITY_ROWS: { flag: string; label: string }[] = [
  { flag: "completion_chat", label: "Chat" },
  { flag: "function_calling", label: "Tool use" },
  { flag: "vision", label: "Vision" },
  { flag: "reasoning", label: "Reasoning" },
  { flag: "ocr", label: "OCR" },
];

/**
 * What the selected model can do, read from the catalog — so a model change
 * shows at once which agent features it gains or loses. ``warnings`` are the
 * caller's own consequences (e.g. "tools are attached but…").
 */
export function ModelCapabilities({
  model,
  models,
  warnings = [],
  className,
}: {
  model: string;
  models: PickerModel[];
  warnings?: string[];
  className?: string;
}) {
  const card = findModel(models, model);
  return (
    <div className={cn("space-y-2", className)}>
      {card ? (
        <div className="flex flex-wrap items-center gap-1">
          {CAPABILITY_ROWS.map(({ flag, label }) => {
            const on = Boolean(card.capabilities[flag]);
            return (
              <span
                key={flag}
                title={
                  on ? `${model} supports ${label.toLowerCase()}` : `No ${label.toLowerCase()}`
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  on
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-border/60 text-muted-foreground/60 line-through decoration-muted-foreground/40",
                )}
              >
                {on ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                {label}
              </span>
            );
          })}
          {card.max_context_length ? (
            <span className="rounded-full border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {ctx(card.max_context_length)} context
            </span>
          ) : null}
          {card.deprecation ? (
            <span className="rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber">
              deprecated
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          {models.length
            ? `${model} is not in the Mistral model catalog — capabilities unknown.`
            : "Capabilities unknown until the model catalog is fetched (Settings → Models)."}
        </p>
      )}
      {warnings.map((w) => (
        <p
          key={w}
          className="flex gap-1.5 rounded-lg border border-amber/25 bg-amber/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber"
        >
          <AlertTriangle className="mt-px size-3 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}

/** Whether ``model`` has ``flag``; unknown models are given the benefit of the doubt. */
export function modelSupports(models: PickerModel[], model: string, flag: string): boolean {
  const card = findModel(models, model);
  return card ? Boolean(card.capabilities[flag]) : true;
}
