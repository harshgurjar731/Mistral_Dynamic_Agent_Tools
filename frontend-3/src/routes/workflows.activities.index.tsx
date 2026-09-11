import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Zap,
  Inbox,
  Search,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toolsApi, QK, errorMessage } from "@/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { ToolCard } from "@/components/tools/ToolCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/workflows/activities/")({
  head: () => ({
    meta: [
      { title: "Activity Gallery — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Isolated, retryable units of work a workflow can run directly.",
      },
      { property: "og:title", content: "Activity Gallery — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Isolated, retryable units of work a workflow can run directly.",
      },
    ],
  }),
  component: ActivityGalleryPage,
});

export function toolPurpose(tool: Record<string, unknown>): "activity" | "tool" {
  const explicit = tool["purpose"];
  if (explicit === "activity" || explicit === "tool") return explicit;
  const kind = tool["kind"];
  if (kind === "activity") return "activity";
  return "tool";
}

function ActivityGalleryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "pending">("active");
  const [search, setSearch] = useState("");
  const [synthesizeOpen, setSynthesizeOpen] = useState(false);
  const [task, setTask] = useState("");

  const toolsQuery = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });
  const pendingQuery = useQuery({ queryKey: QK.pendingTools(), queryFn: toolsApi.pending });

  const activeActivities = useMemo(() => {
    const list = toolsQuery.data ?? [];
    return list.filter((t) => toolPurpose(t as unknown as Record<string, unknown>) === "activity");
  }, [toolsQuery.data]);

  const pendingActivities = useMemo(() => {
    const list = pendingQuery.data?.tools ?? [];
    return list.filter((t) => toolPurpose(t as unknown as Record<string, unknown>) === "activity");
  }, [pendingQuery.data?.tools]);

  const filteredActive = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeActivities;
    return activeActivities.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [activeActivities, search]);

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pendingActivities;
    return pendingActivities.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [pendingActivities, search]);

  const synthesizeMut = useMutation({
    mutationFn: () => toolsApi.synthesize(task.trim()),
    onSuccess: () => {
      toast.success("Activity synthesized and sent to Pending Review.");
      setTask("");
      setSynthesizeOpen(false);
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
      qc.invalidateQueries({ queryKey: QK.tools() });
      setTab("pending");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Zap className="size-6 text-pink-400" /> Activity Gallery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Isolated, retryable units of work a workflow can run directly — no LLM in the loop.
          </p>
        </div>
        <Button
          onClick={() => setSynthesizeOpen(true)}
          className="bg-primary hover:bg-primary/90 self-start sm:self-auto gap-1.5"
        >
          <Sparkles className="size-4" /> Synthesize Activity
        </Button>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "pending")} className="w-fit">
          <TabsList>
            <TabsTrigger value="active">
              Active Activities ({activeActivities.length})
            </TabsTrigger>
            <TabsTrigger value="pending">
              Pending Review ({pendingActivities.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search activities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-6">
        {tab === "active" ? (
          toolsQuery.isLoading ? (
            <TableSkeleton rows={4} />
          ) : toolsQuery.isError ? (
            <ErrorState error={toolsQuery.error} onRetry={() => toolsQuery.refetch()} />
          ) : filteredActive.length === 0 ? (
            <EmptyState
              icon={<Zap className="size-6 text-pink-400" />}
              title="No active activities."
              description="Activities are tools tagged for standalone workflow use."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredActive.map((activity) => (
                <ToolCard key={activity.id} tool={activity} variant="activity" />
              ))}
            </div>
          )
        ) : pendingQuery.isLoading ? (
          <TableSkeleton rows={3} />
        ) : pendingQuery.isError ? (
          <ErrorState error={pendingQuery.error} onRetry={() => pendingQuery.refetch()} />
        ) : filteredPending.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6 text-muted-foreground" />}
            title="No activities awaiting review."
            description="Newly synthesized activities land here for review before activation."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredPending.map((activity) => (
              <ToolCard key={activity.id} tool={activity} variant="activity" pending />
            ))}
          </div>
        )}
      </div>

      {/* Synthesize Activity Dialog */}
      <Dialog open={synthesizeOpen} onOpenChange={setSynthesizeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-pink-400" /> Synthesize Activity
            </DialogTitle>
            <DialogDescription>
              Describe what the activity should do. Codestral will generate Python code and parameters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="e.g. Fetch the latest stock price for a ticker using Yahoo Finance and return the open, high, low, close..."
              rows={4}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSynthesizeOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!task.trim() || synthesizeMut.isPending}
              onClick={() => synthesizeMut.mutate()}
              className="gap-2"
            >
              {synthesizeMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Synthesize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
