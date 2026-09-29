/**
 * Select-all / delete bar and selectable card wrapper for list pages.
 * State and deletion live in lib/bulkSelection (useBulkSelection, useBulkDelete).
 */
import { useState, type ReactNode } from "react";
import { Check, Loader2, Minus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { plural, type BulkSelection } from "@/lib/bulkSelection";
import { cn } from "@/lib/utils";

function TriStateBox({
  state,
  onClick,
  label,
  disabled,
  className,
}: {
  state: boolean | "mixed";
  onClick: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const on = state !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] border transition-colors duration-150",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40 bg-background-elevated hover:border-primary/70",
        className,
      )}
    >
      {state === "mixed" ? (
        <Minus className="size-3" strokeWidth={3.5} />
      ) : on ? (
        <Check className="size-3" strokeWidth={3.5} />
      ) : null}
    </button>
  );
}

/** "Select all" + count + delete, with a confirmation that names what goes. */
export function BulkActionBar({
  selection,
  noun,
  onDelete,
  deleting = false,
  warning,
  className,
}: {
  selection: BulkSelection;
  noun: string;
  onDelete: () => void | Promise<void>;
  deleting?: boolean;
  /** Extra consequence to state in the confirmation (e.g. what deleting also removes). */
  warning?: string;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const total = selection.selectable.length;
  if (total === 0) return null;
  const n = selection.count;
  const names = selection.selected.slice(0, 8).map(selection.labelOf);

  return (
    // Quiet until something is picked; then a compact pill that stays in reach
    // while the list scrolls. Same height either way, so the grid never jumps.
    <div className={cn("flex h-10 items-center", n > 0 && "sticky top-3 z-30", className)}>
      <div
        className={cn(
          "flex h-10 items-center gap-1 rounded-full border text-xs transition-[background-color,border-color,box-shadow] duration-200",
          n
            ? "border-border-strong bg-background-elevated/90 pr-1 pl-3.5 shadow-[var(--shadow-panel)] backdrop-blur-xl"
            : "border-transparent pl-0.5 text-muted-foreground",
        )}
      >
        <label className="group/all flex h-full cursor-pointer items-center gap-2.5 pr-2 select-none">
          <TriStateBox
            state={selection.allSelected ? true : selection.someSelected ? "mixed" : false}
            onClick={selection.toggleAll}
            label={selection.allSelected ? "Deselect all" : "Select all"}
            disabled={deleting}
          />
          {n ? (
            <span className="text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{n}</span> of {total} selected
            </span>
          ) : (
            <span className="transition-colors group-hover/all:text-foreground">
              Select all <span className="text-muted-foreground/70 tabular-nums">· {total}</span>
            </span>
          )}
        </label>
        {n > 0 && (
          <>
            <span className="mr-1 h-4 w-px bg-border" aria-hidden />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={selection.clear}
              disabled={deleting}
            >
              <X className="size-3.5" /> Clear
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 rounded-full bg-destructive/15 px-3.5 text-xs font-medium text-destructive hover:bg-destructive/25 hover:text-destructive"
              onClick={() => setConfirming(true)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {deleting ? "Deleting…" : `Delete ${n} ${plural(noun, n)}`}
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {n} {plural(noun, n)}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>This cannot be undone.{warning ? ` ${warning}` : ""}</p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 font-mono text-xs">
                  {names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {n > names.length && <li>…and {n - names.length} more</li>}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void onDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Wraps any card: a checkbox in its bottom-right corner and an outline while selected. */
export function SelectableItem({
  selection,
  id,
  label,
  children,
  className,
  checkboxClassName,
}: {
  selection: BulkSelection;
  id: string | number;
  label: string;
  children: ReactNode;
  className?: string;
  /** Nudges the checkbox to line up with a card's footer row. */
  checkboxClassName?: string;
}) {
  const key = String(id);
  const selectable = selection.canSelect(key);
  const checked = selection.isSelected(key);
  return (
    <div
      data-selectable={selectable || undefined}
      className={cn(
        // Column flex so the card fills its grid cell and the corner is its corner.
        "group/select relative flex flex-col rounded-2xl transition-shadow duration-200 [&>:first-child]:flex-1",
        checked && "shadow-[0_0_0_1px_var(--primary),0_0_24px_-12px_var(--primary)]",
        className,
      )}
    >
      {children}
      {checked && (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-2xl bg-primary/[0.04]"
          aria-hidden
        />
      )}
      {selectable && (
        // In the bottom-right corner; footers marked data-card-footer make room.
        <TriStateBox
          state={checked}
          onClick={() => selection.toggle(key)}
          label={`${checked ? "Deselect" : "Select"} ${label}`}
          className={cn(
            "select-box absolute right-5 bottom-5 z-20 transition-[opacity,border-color,background-color] duration-150",
            checked || selection.count > 0
              ? "opacity-100"
              : "opacity-0 group-hover/select:opacity-100 focus-visible:opacity-100",
            checkboxClassName,
          )}
        />
      )}
    </div>
  );
}

/** Inline checkbox for list rows (where SelectableItem's card corner does not fit). */
export function RowCheckbox({
  selection,
  id,
  label,
}: {
  selection: BulkSelection;
  id: string | number;
  label: string;
}) {
  const key = String(id);
  if (!selection.canSelect(key)) return <span className="size-[18px] shrink-0" aria-hidden />;
  const checked = selection.isSelected(key);
  return (
    <TriStateBox
      state={checked}
      onClick={() => selection.toggle(key)}
      label={`${checked ? "Deselect" : "Select"} ${label}`}
    />
  );
}
