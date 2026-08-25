import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { conversationsApi, QK } from "@/api";
import { errorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Markdown } from "@/components/chat/Markdown";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/conversations")({
  head: () => ({
    meta: [
      { title: "Conversations — Agentic AI Design Patterns" },
      { name: "description", content: "View and manage conversation threads." },
      { property: "og:title", content: "Conversations — Agentic AI Design Patterns" },
      { property: "og:description", content: "View and manage conversation threads." },
    ],
  }),
  component: ConversationsPage,
});

interface ConversationRow {
  id: string;
  [key: string]: unknown;
}

function asRows(data: unknown): ConversationRow[] {
  if (Array.isArray(data)) return data as ConversationRow[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const list = obj["conversations"] ?? obj["items"] ?? obj["data"];
    if (Array.isArray(list)) return list as ConversationRow[];
  }
  return [];
}

interface HistoryEntry {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

function asEntries(data: unknown): HistoryEntry[] {
  if (Array.isArray(data)) return data as HistoryEntry[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const list = obj["entries"] ?? obj["messages"] ?? obj["history"];
    if (Array.isArray(list)) return list as HistoryEntry[];
  }
  return [];
}

function entryText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : ((c as { text?: string })?.text ?? JSON.stringify(c))))
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content, null, 2);
  return "";
}

function ConversationsPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: QK.conversations(),
    queryFn: conversationsApi.list,
  });

  const rows = useMemo(() => asRows(listQuery.data), [listQuery.data]);

  const historyQuery = useQuery({
    queryKey: QK.history(expanded ?? ""),
    queryFn: () => conversationsApi.history(expanded as string),
    enabled: !!expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => conversationsApi.remove(id),
    onSuccess: (_data, id) => {
      toast.success("Conversation deleted");
      if (expanded === id) setExpanded(null);
      void qc.invalidateQueries({ queryKey: QK.conversations() });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Conversations</h1>
      <p className="mt-1 text-sm text-muted-foreground">View and manage conversation threads.</p>

      <div className="mt-6">
        {listQuery.isLoading ? (
          <TableSkeleton />
        ) : listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-6" />}
            title="No conversations found"
            description="Conversations created via chat and orchestrator sessions will appear here."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const isOpen = expanded === row.id;
              return (
                <GlassPanel key={row.id} tone="default" className="overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-mono text-xs text-foreground">{row.id}</span>
                      {typeof row["name"] === "string" ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {row["name"] as string}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      onClick={() => window.confirm("Delete this conversation?") && deleteMutation.mutate(row.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-xs text-muted-foreground transition hover:border-red/30 hover:bg-red/10 hover:text-red"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {isOpen ? (
                    <div className={cn("border-t border-border px-4 py-4")}>
                      {historyQuery.isLoading ? (
                        <TableSkeleton rows={3} />
                      ) : historyQuery.isError ? (
                        <ErrorState
                          error={historyQuery.error}
                          onRetry={() => void historyQuery.refetch()}
                        />
                      ) : (
                        (() => {
                          const entries = asEntries(historyQuery.data);
                          return entries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No messages in this conversation.</p>
                          ) : (
                            <div className="custom-scrollbar max-h-96 space-y-3 overflow-y-auto">
                              {entries.map((entry, i) => (
                                <div
                                  key={i}
                                  className="rounded-xl border border-border bg-background-elevated px-3 py-2.5"
                                >
                                  <span className="eyebrow text-muted-foreground">
                                    {entry.role ?? "entry"}
                                  </span>
                                  <div className="mt-1 text-xs text-foreground">
                                    <Markdown content={entryText(entry.content)} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  ) : null}
                </GlassPanel>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
