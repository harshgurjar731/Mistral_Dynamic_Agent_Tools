import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, ArrowLeft, Loader2, Play, Server, Wrench } from "lucide-react";
import { mcpApi, QK, errorMessage } from "@/api";
import { healthState, serverList } from "@/components/mcp/servers";
import { HealthBadge } from "@/components/shared/ReachabilityBadge";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/shared/CodeBlock";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/mcp/$serverName")({
  head: () => ({
    meta: [
      { title: "MCP Server — Agentic AI Design Patterns" },
      { name: "description", content: "MCP server detail." },
      { property: "og:title", content: "MCP Server — Agentic AI Design Patterns" },
      { property: "og:description", content: "MCP server detail." },
    ],
  }),
  component: McpServernamePage,
});

interface McpTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  [k: string]: unknown;
}

function toolList(data: unknown): McpTool[] {
  if (Array.isArray(data)) return data as McpTool[];
  const obj = data as { tools?: McpTool[] } | undefined;
  return obj?.tools ?? [];
}

function McpServernamePage() {
  const { serverName } = Route.useParams();
  const toolsQuery = useQuery({
    queryKey: QK.mcpServerTools(serverName),
    queryFn: () => mcpApi.tools(serverName),
  });
  const tools = toolList(toolsQuery.data);

  const serversQuery = useQuery({ queryKey: QK.mcpServers(), queryFn: () => mcpApi.servers() });
  const server = serverList(serversQuery.data).find((s) => s.name === serverName) ?? null;

  const [selected, setSelected] = useState<string>("");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<unknown>(null);
  const selectedTool = useMemo(
    () => tools.find((t) => t.name === selected) ?? null,
    [tools, selected],
  );

  const execute = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        throw new Error("Arguments must be valid JSON.");
      }
      return mcpApi.execute(serverName, selected, parsed);
    },
    onSuccess: (res) => setResult(res),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Link
            to="/mcp"
            search={{ tab: "mcp" }}
            aria-label="Back to MCP"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-surface/30 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground">
              <Server className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {serverName}
                </h1>
                {server ? <HealthBadge state={healthState(server)} /> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {server?.description ||
                  "Execute MCP tools with custom arguments and inspect results."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="tools" className="mt-6">
        <TabsList>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="playground">Test Playground</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="tools" className="mt-4">
          {toolsQuery.isLoading ? (
            <DetailSkeleton />
          ) : toolsQuery.isError ? (
            <ErrorState error={toolsQuery.error} onRetry={() => toolsQuery.refetch()} />
          ) : tools.length === 0 ? (
            <EmptyState icon={<Wrench className="size-6" />} title="No tools discovered" />
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <GlassPanel key={tool.name} className="p-4">
                  <p className="text-sm font-semibold text-foreground">{tool.name}</p>
                  {tool.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                  ) : null}
                  {tool.input_schema || tool.parameters ? (
                    <div className="mt-2">
                      <CodeBlock
                        code={JSON.stringify(tool.input_schema ?? tool.parameters, null, 2)}
                        language="json"
                      />
                    </div>
                  ) : null}
                </GlassPanel>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="playground" className="mt-4">
          {tools.length === 0 ? (
            <EmptyState icon={<Wrench className="size-6" />} title="No tools discovered" />
          ) : (
            <GlassPanel>
              <GlassPanelHeader
                title="Test Playground"
                description="Invoke a tool with custom arguments."
              />
              <div className="space-y-3 p-4">
                <Select
                  value={selected}
                  onValueChange={(v) => {
                    setSelected(v);
                    setResult(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Tool" />
                  </SelectTrigger>
                  <SelectContent>
                    {tools.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedTool ? (
                  <div>
                    <p className="eyebrow mb-1.5">Input Schema</p>
                    <CodeBlock
                      code={JSON.stringify(
                        selectedTool.input_schema ?? selectedTool.parameters ?? {},
                        null,
                        2,
                      )}
                      language="json"
                    />
                  </div>
                ) : null}

                <Textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                  placeholder="Arguments (JSON)"
                />

                <Button
                  size="sm"
                  onClick={() => execute.mutate()}
                  disabled={!selected || execute.isPending}
                >
                  {execute.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Execute
                </Button>

                {result != null ? (
                  <div>
                    <p className="eyebrow mb-1.5">Result</p>
                    <CodeBlock code={JSON.stringify(result, null, 2)} language="json" />
                  </div>
                ) : null}
              </div>
            </GlassPanel>
          )}
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          {serversQuery.isLoading ? (
            <DetailSkeleton />
          ) : serversQuery.isError ? (
            <ErrorState error={serversQuery.error} onRetry={() => serversQuery.refetch()} />
          ) : !server ? (
            <EmptyState icon={<Activity className="size-6" />} title="Server not in the registry" />
          ) : (
            <GlassPanel>
              <GlassPanelHeader
                title="Server health info"
                description="The registry record for this server, exactly as the backend reports it."
              />
              <div className="p-4">
                <CodeBlock code={JSON.stringify(server, null, 2)} language="json" />
              </div>
            </GlassPanel>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
