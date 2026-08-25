import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Play, Wrench } from "lucide-react";
import { mcpApi, QK, errorMessage } from "@/api";
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

  const [selected, setSelected] = useState<string>("");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<unknown>(null);
  const selectedTool = useMemo(() => tools.find((t) => t.name === selected) ?? null, [tools, selected]);

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
      <Button size="sm" variant="ghost" asChild className="mb-4">
        <Link to="/mcp" search={{ tab: "mcp" }}>
          <ArrowLeft className="size-3.5" /> Back to MCP
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{serverName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Execute MCP tools with custom arguments and inspect results.
      </p>

      <Tabs defaultValue="tools" className="mt-6">
        <TabsList>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="playground">Test Playground</TabsTrigger>
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
              <GlassPanelHeader title="Test Playground" description="Invoke a tool with custom arguments." />
              <div className="space-y-3 p-4">
                <Select value={selected} onValueChange={(v) => { setSelected(v); setResult(null); }}>
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
                      code={JSON.stringify(selectedTool.input_schema ?? selectedTool.parameters ?? {}, null, 2)}
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

                <Button size="sm" onClick={() => execute.mutate()} disabled={!selected || execute.isPending}>
                  {execute.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
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
      </Tabs>
    </div>
  );
}
