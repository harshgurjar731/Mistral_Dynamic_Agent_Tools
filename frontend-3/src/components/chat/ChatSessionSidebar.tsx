import { MessageSquare, Plus, Trash2, Clock } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/types";

export function ChatSessionSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  open,
  onClose,
  className,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute left-0 top-full z-50 mt-1.5 w-80 rounded-2xl border border-border bg-popover shadow-panel backdrop-blur-xl",
        "animate-in fade-in-0 slide-in-from-top-2 duration-200",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Chat Sessions</span>
          {sessions.length > 0 && (
            <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        >
          <Plus className="size-3" />
          New
        </button>
      </div>

      {/* Session list */}
      <div className="custom-scrollbar max-h-72 overflow-y-auto p-1.5">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="grid size-9 place-items-center rounded-xl border border-border/60 bg-surface/40">
              <Clock className="size-4 text-muted-foreground/50" />
            </div>
            <p className="mt-2.5 text-xs font-medium text-muted-foreground">No sessions yet</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/50">
              Send a message to start one automatically.
            </p>
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeId;
            const msgCount = s.messages?.length ?? 0;
            return (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-2.5 rounded-xl px-3 py-2 transition-all duration-150",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <div
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-lg transition",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "bg-surface-elevated text-muted-foreground",
                    )}
                  >
                    <MessageSquare className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {s.title || "New session"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/50">
                      {msgCount === 0 ? "Empty" : `${msgCount} msg${msgCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Delete session"
                  onClick={() => onDelete(s.id)}
                  className="shrink-0 rounded-md p-1 opacity-0 transition hover:bg-red/10 hover:text-red group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
