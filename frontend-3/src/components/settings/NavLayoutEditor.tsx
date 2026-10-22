/**
 * Settings control for UI_NAV_LAYOUT: reorder the sidebar's pages, choose
 * which are shown, and rename each feature — its sidebar label, page title,
 * page description and browser tab name. Drag a row by its grip or use the
 * arrows; the switch shows or hides the page; the pencil opens its texts.
 * Edits go into the Settings page's draft and save with everything else.
 */
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  PencilLine,
  RotateCcw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  LOCKED_NAV,
  arrangeNav,
  navLabel,
  parseNavLayout,
  serializeNavLayout,
  type NavRow,
  type TextField,
} from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export function NavLayoutEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const rows = useMemo(() => arrangeNav(parseNavLayout(value)), [value]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const commit = (next: NavRow[]) => onChange(serializeNavLayout(next));

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return;
    const next = rows.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    commit(next);
  };

  const setHidden = (index: number, hidden: boolean) =>
    commit(rows.map((r, i) => (i === index ? { ...r, hidden } : r)));

  const setText = (index: number, field: TextField, text: string) =>
    commit(rows.map((r, i) => (i === index ? { ...r, text: { ...r.text, [field]: text } } : r)));

  const resetText = (index: number) =>
    commit(rows.map((r, i) => (i === index ? { ...r, text: {} } : r)));

  const shown = rows.filter((r) => !r.hidden).length;
  const allShown = shown === rows.length;
  const renamed = rows.filter((r) => Object.keys(r.text).length).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{shown}</span> of {rows.length} pages shown
          {renamed ? (
            <>
              {" "}
              · <span className="font-medium text-foreground">{renamed}</span> renamed
            </>
          ) : null}{" "}
          · drag to reorder, <PencilLine className="inline size-3" /> to rename
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || !renamed}
            onClick={() => commit(rows.map((r) => ({ ...r, text: {} })))}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            Restore all names
          </button>
          <button
            type="button"
            disabled={disabled || allShown}
            onClick={() => commit(rows.map((r) => ({ ...r, hidden: false })))}
            className="rounded-md px-2 py-1 text-[11px] text-primary transition hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
          >
            Show all
          </button>
        </div>
      </div>

      <ol
        className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-background/40"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null);
        }}
      >
        {rows.map((row, index) => {
          const Icon = row.item.icon;
          const label = navLabel(row);
          const locked = LOCKED_NAV.has(row.item.to);
          const isDragged = dragFrom === index;
          const isOpen = editing === row.item.to;
          const isRenamed = Object.keys(row.text).length > 0;
          // Where the dragged row would land: a line above or below this one.
          const dropLine =
            dragFrom !== null && dragOver === index && dragOver !== dragFrom
              ? dragFrom < index
                ? "after"
                : "before"
              : null;
          return (
            <li
              key={row.item.to}
              // Not while its texts are open: a draggable parent fights text selection.
              draggable={!disabled && !isOpen}
              onDragStart={(e) => {
                setDragFrom(index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", row.item.to);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== index) setDragOver(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={cn(
                "relative transition-colors",
                row.hidden ? "bg-transparent" : "bg-background-elevated/40",
                isDragged && "opacity-40",
                dropLine === "before" && "shadow-[inset_0_2px_0_0_var(--primary)]",
                dropLine === "after" && "shadow-[inset_0_-2px_0_0_var(--primary)]",
              )}
            >
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded text-muted-foreground",
                    disabled || isOpen
                      ? "opacity-40"
                      : "cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing",
                  )}
                  title={isOpen ? "Close the texts to drag" : "Drag to reorder"}
                >
                  <GripVertical className="size-3.5" />
                </span>
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                  {index + 1}
                </span>
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    row.hidden ? "text-muted-foreground/50" : "text-primary",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 text-xs font-medium",
                      row.hidden
                        ? "text-muted-foreground line-through decoration-muted-foreground/40"
                        : "text-foreground",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    {isRenamed ? (
                      <span className="shrink-0 rounded border border-blue/30 bg-blue/10 px-1 text-[9px] font-semibold tracking-wide text-blue uppercase no-underline">
                        renamed
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                    {row.item.to}
                    {label !== row.item.label ? (
                      <span className="font-sans"> · was “{row.item.label}”</span>
                    ) : null}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setEditing(isOpen ? null : row.item.to)}
                  aria-expanded={isOpen}
                  aria-label={`Rename ${label}`}
                  title="Rename this feature and edit its page texts"
                  className={cn(
                    "rounded p-1 transition disabled:pointer-events-none disabled:opacity-30",
                    isOpen
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <PencilLine className="size-3.5" />
                </button>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={`Move ${label} up`}
                    className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={`Move ${label} down`}
                    className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>

                <div className="flex w-20 shrink-0 items-center justify-end gap-1.5">
                  {locked ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                      title="Settings is always shown, so this menu can always be reached"
                    >
                      <Lock className="size-3" /> Always
                    </span>
                  ) : (
                    <>
                      {row.hidden ? (
                        <EyeOff className="size-3 text-muted-foreground/60" />
                      ) : (
                        <Eye className="size-3 text-emerald" />
                      )}
                      <Switch
                        checked={!row.hidden}
                        disabled={disabled}
                        onCheckedChange={(on) => setHidden(index, !on)}
                        aria-label={`${row.hidden ? "Show" : "Hide"} ${label}`}
                      />
                    </>
                  )}
                </div>
              </div>

              {isOpen ? (
                <TextEditor
                  row={row}
                  disabled={disabled}
                  onChange={(field, text) => setText(index, field, text)}
                  onReset={() => resetText(index)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The four renamable texts of one feature; each placeholder is the built-in text. */
function TextEditor({
  row,
  disabled,
  onChange,
  onReset,
}: {
  row: NavRow;
  disabled: boolean;
  onChange: (field: TextField, text: string) => void;
  onReset: () => void;
}) {
  const { item, text } = row;
  const id = (f: string) => `nav-text-${item.to}-${f}`;
  return (
    <div className="space-y-3 border-t border-border/40 bg-background/50 px-4 py-3 sm:pl-[4.75rem]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id("label")} label="Sidebar label" hint="The name in the navigation menu.">
          <Input
            id={id("label")}
            value={text.label ?? ""}
            placeholder={item.label}
            disabled={disabled}
            maxLength={40}
            onChange={(e) => onChange("label", e.target.value)}
            className="h-8 text-xs"
          />
        </Field>
        <Field
          id={id("tab")}
          label="Browser tab name"
          hint="Shown before the product name in the tab."
        >
          <Input
            id={id("tab")}
            value={text.tab ?? ""}
            placeholder={item.page.tab}
            disabled={disabled}
            maxLength={60}
            onChange={(e) => onChange("tab", e.target.value)}
            className="h-8 text-xs"
          />
        </Field>
      </div>
      <Field
        id={id("title")}
        label="Page title"
        hint="The page heading. The last word — or the last line, if it has two — takes the accent colour."
      >
        <Textarea
          id={id("title")}
          value={text.title ?? ""}
          placeholder={item.page.title}
          disabled={disabled}
          rows={item.page.title.includes("\n") ? 2 : 1}
          maxLength={120}
          onChange={(e) => onChange("title", e.target.value)}
          className="min-h-8 resize-y text-xs"
        />
      </Field>
      {item.page.description !== null ? (
        <Field id={id("description")} label="Page description" hint="The line under the title.">
          <Textarea
            id={id("description")}
            value={text.description ?? ""}
            placeholder={item.page.description}
            disabled={disabled}
            rows={2}
            maxLength={400}
            onChange={(e) => onChange("description", e.target.value)}
            className="resize-y text-xs"
          />
        </Field>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">
          Leave a field empty to keep the built-in text.
        </p>
        <button
          type="button"
          disabled={disabled || !Object.keys(text).length}
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="size-3" /> Restore built-in texts
        </button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11px] font-medium text-foreground">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}
