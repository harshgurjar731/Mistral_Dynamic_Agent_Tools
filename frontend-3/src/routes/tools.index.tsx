import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench, Inbox, Sparkles, Plus, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toolsApi, QK, errorMessage } from "@/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { ToolCard } from "@/components/tools/ToolCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/tools/")({
  head: () => ({
    meta: [
      { title: "Tool Lifecycle — Agentic AI Design Patterns" },
      { name: "description", content: "Synthesize, review, and manage dynamic tools." },
      { property: "og:title", content: "Tool Lifecycle — Agentic AI Design Patterns" },
      { property: "og:description", content: "Synthesize, review, and manage dynamic tools." },
    ],
  }),
  component: ToolsPage,
});

function ToolsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<string>("all");
  const [synthesizeOpen, setSynthesizeOpen] = useState(false);
  const [task, setTask] = useState("");

  const toolsQuery = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });
  const pendingQuery = useQuery({ queryKey: QK.pendingTools(), queryFn: toolsApi.pending });

  const synthesize = useMutation({
    mutationFn: () => toolsApi.synthesize(task.trim()),
    onSuccess: () => {
      toast.success("Tool synthesized and sent to Pending Review.");
      setTask("");
      setSynthesizeOpen(false);
      qc.invalidateQueries({ queryKey: QK.tools() });
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const filterTool = (t: { name: string; description?: string; purpose?: string }) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !(t.description ?? "").toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (purposeFilter === "tool" && (t.purpose ?? "tool") !== "tool") return false;
    if (purposeFilter === "activity" && t.purpose !== "activity") return false;
    return true;
  };

  const activeTools = (toolsQuery.data ?? []).filter(filterTool);
  const pendingTools = (pendingQuery.data?.tools ?? []).filter(filterTool);
  const totalTools = (toolsQuery.data ?? []).length;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Tool <span className="text-gradient-brand">Lifecycle</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Synthesize, review, and manage dynamic tools.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSynthesizeOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Sparkles className="size-4" />
          Synthesize Tool
        </button>
      </div>

      {/* ── Stats Bar ── */}
      {totalTools > 0 && (
        <div className="mt-5 flex items-center gap-4 rounded-xl border border-border/40 bg-surface/30 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
              <Wrench className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{totalTools}</span>
            <span className="text-[10px] text-muted-foreground/60">active tools</span>
          </div>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-amber/10 text-amber">
              <Inbox className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{(pendingQuery.data?.tools ?? []).length}</span>
            <span className="text-[10px] text-muted-foreground/60">pending review</span>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={purposeFilter}
          onChange={(e) => setPurposeFilter(e.target.value)}
          className="rounded-lg border border-border/60 bg-background-elevated px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All purposes</option>
          <option value="tool">Agent Tools only</option>
          <option value="activity">Workflow Activities only</option>
        </select>

        {totalTools > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
            {activeTools.length} of {totalTools} tool{totalTools !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Tabs + Grid ── */}
      <div className="mt-8">
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active Tools ({activeTools.length})</TabsTrigger>
            <TabsTrigger value="pending">
              Pending Review ({pendingTools.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            {toolsQuery.isLoading ? (
              <TableSkeleton rows={6} />
            ) : toolsQuery.isError ? (
              <ErrorState error={toolsQuery.error} onRetry={() => toolsQuery.refetch()} />
            ) : activeTools.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
                <div className="relative mb-5">
                  <div
                    className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                    style={{ background: "var(--gradient-brand)" }}
                  />
                  <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                    <Wrench className="size-6 text-primary" />
                  </div>
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  No tools found
                </h2>
                <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                  {search || purposeFilter !== "all"
                    ? "Try adjusting your filters or search query."
                    : "Synthesize your first tool to get started."}
                </p>
                {!search && purposeFilter === "all" && (
                  <button
                    type="button"
                    onClick={() => setSynthesizeOpen(true)}
                    className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    <Sparkles className="size-4" />
                    Synthesize Tool
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {activeTools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pending" className="mt-4">
            {pendingQuery.isLoading ? (
              <TableSkeleton rows={4} />
            ) : pendingQuery.isError ? (
              <ErrorState error={pendingQuery.error} onRetry={() => pendingQuery.refetch()} />
            ) : pendingTools.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-6" />}
                title="No tools awaiting review."
                description="Synthesized tools land here until they're approved or rejected."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pendingTools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} pending />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Synthesize Tool Dialog ── */}
      <Dialog open={synthesizeOpen} onOpenChange={setSynthesizeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Synthesize Tool
            </DialogTitle>
            <DialogDescription>
              Describe a capability in plain language and let Codestral write the tool for you.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="e.g. A function that fetches the weather for a given city using an API and returns the temperature, humidity, and conditions."
              rows={4}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="resize-none"
              disabled={synthesize.isPending}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSynthesizeOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!task.trim() || synthesize.isPending}
              onClick={() => synthesize.mutate()}
              className="gap-2"
            >
              {synthesize.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {synthesize.isPending ? "Synthesizing…" : "Synthesize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
