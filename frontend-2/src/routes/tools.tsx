import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wrench, Inbox } from "lucide-react";
import { toolsApi, QK } from "@/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolSynthesizer } from "@/components/tools/ToolSynthesizer";
import { RemoteServersPanel } from "@/components/tools/RemoteServersPanel";
import { GlassPanel } from "@/components/glass/GlassPanel";

export const Route = createFileRoute("/tools")({
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
  const toolsQuery = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });
  const pendingQuery = useQuery({ queryKey: QK.pendingTools(), queryFn: toolsApi.pending });

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tool Lifecycle</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Synthesize, review, and manage dynamic tools.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">Active Tools</TabsTrigger>
              <TabsTrigger value="pending">
                Pending Review
                {pendingQuery.data?.count ? ` (${pendingQuery.data.count})` : ""}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-4 space-y-3">
              {toolsQuery.isLoading ? (
                <TableSkeleton rows={6} />
              ) : toolsQuery.isError ? (
                <ErrorState error={toolsQuery.error} onRetry={() => toolsQuery.refetch()} />
              ) : !toolsQuery.data || toolsQuery.data.length === 0 ? (
                <EmptyState icon={<Wrench className="size-6" />} title="No tools found." />
              ) : (
                toolsQuery.data.map((tool) => <ToolCard key={tool.id} tool={tool} />)
              )}
            </TabsContent>

            <TabsContent value="pending" className="mt-4 space-y-3">
              {pendingQuery.isLoading ? (
                <TableSkeleton rows={4} />
              ) : pendingQuery.isError ? (
                <ErrorState error={pendingQuery.error} onRetry={() => pendingQuery.refetch()} />
              ) : !pendingQuery.data || pendingQuery.data.tools.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-6" />}
                  title="No tools awaiting review."
                  description="Synthesized tools land here until they're approved or rejected."
                />
              ) : (
                pendingQuery.data.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} pending />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <ToolSynthesizer />
          <RemoteServersPanel />
          <GlassPanel className="p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Publishing tools elsewhere</p>
            <p>
              Navigate to <span className="text-foreground">MCP Servers</span> to register a
              server, then come back here and select it from a tool's{" "}
              <span className="text-foreground">Publish to MCP</span> action. To push raw source
              code to a custom runner, register it under{" "}
              <span className="text-foreground">Remote Servers</span> above and use{" "}
              <span className="text-foreground">Send to Remote Server</span>.
            </p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
