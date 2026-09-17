import { Link } from "@tanstack/react-router";
import { Edit2, FileText, Library as LibraryIcon, Loader2, Trash2 } from "lucide-react";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Library } from "@/types";

/** One library on the Libraries page — click anywhere to open its documents. */
export function LibraryCard({
  library,
  onRename,
  onDelete,
  deleting,
}: {
  library: Library;
  onRename: (library: Library) => void;
  onDelete: (library: Library) => void;
  deleting?: boolean;
}) {
  const docs = library.document_count ?? 0;

  return (
    <div
      className="group relative flex h-full flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)",
        }}
      />

      <Link
        to="/libraries/$id"
        params={{ id: library.id }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={library.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
              "border-border/60 bg-background-elevated text-muted-foreground",
              "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
            )}
          >
            <LibraryIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{library.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {library.description || "No description provided"}
            </p>
          </div>
        </div>

        {/* Contents badge */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
            <FileText className="size-2.5" />
            {docs} document{docs !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Footer — actions + timestamp, pinned to the bottom so rows line up */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-border/40 pt-3.5">
          <div className="pointer-events-auto relative z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRename(library)}
              aria-label={`Edit ${library.name}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground"
            >
              <Edit2 className="size-3" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(library)}
              disabled={deleting}
              aria-label={`Delete ${library.name}`}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-red/10 hover:text-red disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/35">
            {formatRelative(library.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
