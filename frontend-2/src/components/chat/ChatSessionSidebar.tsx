import { Plus, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/types";

export function ChatSessionSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  className,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <span className="eyebrow text-muted-foreground">Sessions</span>
        <button
          type="button"
          onClick={onCreate}
          aria-label="New session"
          className="inline-flex size-7 items-center justify-center rounded-lg border border-border glass text-foreground transition hover:bg-surface-hover"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No sessions yet. Start a new one.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition",
                s.id === activeId
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquare className="size-3.5 shrink-0" />
                <span className="truncate">{s.title || "New session"}</span>
              </button>
              <button
                type="button"
                aria-label="Delete session"
                onClick={() => onDelete(s.id)}
                className="shrink-0 opacity-0 transition hover:text-red group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
