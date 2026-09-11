import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Code2,
  FileCode,
  Hash,
  Loader2,
  Pencil,
  Play,
  Radio,
  Save,
  Send,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { toolsApi, mcpApi, remoteServersApi, QK, errorMessage } from "@/api";
import type { Tool } from "@/types";
import { toolSource, TOOL_SOURCE_IDENTITY } from "@/lib/status";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Which section the detail page belongs to — drives the back link and wording. */
export type ToolDetailVariant = "tool" | "activity";

function schemaEntries(tool: Tool): Record<string, unknown> | null {
  const schema = tool.schema_json ?? tool.schema;
  if (!schema) return null;
  if (typeof schema === "string") {
    try {
      return JSON.parse(schema) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return schema;
}

function toolDescription(tool: Tool): string {
  if (tool.description) return tool.description;
  const fn = schemaEntries(tool)?.["function"] as { description?: string } | undefined;
  return fn?.description ?? "";
}

function paramCount(tool: Tool): number {
  const schema = schemaEntries(tool);
  if (!schema) return 0;
  const fn = schema["function"] as
    { parameters?: { properties?: Record<string, unknown> } } | undefined;
  const props =
    fn?.parameters?.properties ?? (schema as { properties?: Record<string, unknown> })?.properties;
  return props ? Object.keys(props).length : 0;
}

export function ToolDetail({ id, variant }: { id: string; variant: ToolDetailVariant }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const backTo = variant === "activity" ? "/workflows/activities" : "/tools";
  const noun = variant === "activity" ? "Activity" : "Tool";

  const toolQuery = useQuery({
    queryKey: QK.tool(id),
    queryFn: () => toolsApi.get(id),
    retry: 1,
  });

  const tool = toolQuery.data;
  const src = tool ? toolSource(tool.id) : "dynamic";
  const editable = src === "dynamic";
  const isActivity = (tool?.purpose ?? "tool") === "activity";
  const identity = TOOL_SOURCE_IDENTITY[src];
  const schema = tool ? schemaEntries(tool) : null;
  const summary = tool ? toolDescription(tool) : "";
  const params = tool ? paramCount(tool) : 0;

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editSource, setEditSource] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPurpose, setEditPurpose] = useState("tool");

  // Dialogs
  const [publishOpen, setPublishOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [serverName, setServerName] = useState("");
  const [remoteServerId, setRemoteServerId] = useState("");
  const [remoteResponse, setRemoteResponse] = useState<unknown>(null);

  // Test state
  const [testArgs, setTestArgs] = useState("{}");
  const [testResult, setTestResult] = useState<unknown>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: QK.tools() });
    qc.invalidateQueries({ queryKey: QK.pendingTools() });
    qc.invalidateQueries({ queryKey: QK.tool(id) });
  };

  const update = useMutation({
    mutationFn: () =>
      toolsApi.update(id, {
        source_code: editSource,
        description: editDescription,
        purpose: editPurpose,
      }),
    onSuccess: () => {
      toast.success(`${noun} updated.`);
      setEditing(false);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => toolsApi.remove(id),
    onSuccess: () => {
      toast.success(`${noun} deleted.`);
      invalidateLists();
      navigate({ to: backTo });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const approve = useMutation({
    mutationFn: () => toolsApi.approve(id),
    onSuccess: () => {
      toast.success(`${noun} approved.`);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: () => toolsApi.reject(id),
    onSuccess: () => {
      toast.success(`${noun} rejected.`);
      invalidateLists();
      navigate({ to: backTo });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: () => toolsApi.publishMcp(id, serverName),
    onSuccess: () => {
      toast.success(`Published to MCP server "${serverName}".`);
      setPublishOpen(false);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sendTool = useMutation({
    mutationFn: () => remoteServersApi.sendTool(remoteServerId, id),
    onSuccess: (res) => {
      setRemoteResponse(res);
      toast.success("Sent to remote server.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const { data: mcpServers } = useQuery({
    queryKey: QK.mcpServers(),
    enabled: publishOpen,
    queryFn: () => mcpApi.servers(),
  });
  const mcpServerNames: string[] = (
    Array.isArray(mcpServers)
      ? mcpServers.map((s: { name?: string }) => s?.name)
      : Array.isArray((mcpServers as { servers?: unknown[] })?.servers)
        ? ((mcpServers as { servers: { name?: string }[] }).servers ?? []).map((s) => s?.name)
        : []
  ).filter((n): n is string => Boolean(n));

  const { data: remoteServers } = useQuery({
    queryKey: QK.remoteServers(),
    enabled: sendOpen,
    queryFn: () => remoteServersApi.list(),
  });
  const remoteList: { id: string; name: string }[] = Array.isArray(remoteServers)
    ? (remoteServers as { id: string; name: string }[])
    : ((remoteServers as { items?: { id: string; name: string }[] })?.items ?? []);

  const handleRunTest = async () => {
    if (!tool) return;
    setIsTesting(true);
    setTestError(null);
    try {
      let parsed = {};
      try {
        parsed = testArgs.trim() ? JSON.parse(testArgs) : {};
      } catch {
        setTestError("Arguments must be valid JSON.");
        setIsTesting(false);
        return;
      }
      const res = await toolsApi.execute(tool.name, parsed);
      setTestResult(res);
      toast.success("Execution completed.");
    } catch (err) {
      setTestError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setIsTesting(false);
    }
  };

  const startEditing = () => {
    if (!tool) return;
    setEditSource(tool.source_code ?? "");
    setEditDescription(toolDescription(tool));
    setEditPurpose(tool.purpose ?? "tool");
    setEditing(true);
  };

  const isPending = tool?.status === "pending";

  if (toolQuery.isLoading) return <DetailSkeleton />;
  if (toolQuery.isError)
    return (
      <div className="px-6 py-8">
        <ErrorState error={toolQuery.error} onRetry={() => toolQuery.refetch()} />
      </div>
    );
  if (!tool)
    return (
      <div className="px-6 py-8">
        <ErrorState error={`${noun} not found`} />
      </div>
    );

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link
            to={backTo}
            aria-label={`Back to ${variant === "activity" ? "activities" : "tools"}`}
            className="mt-1 grid size-9 place-items-center rounded-xl border border-border/60 bg-surface/30 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
                  "border-border/60 bg-background-elevated text-muted-foreground",
                )}
              >
                {isActivity ? <Zap className="size-5" /> : <Wrench className="size-5" />}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {tool.name}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {summary || "No description provided"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPending && (
            <>
              <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}>
                <Check className="size-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red hover:text-red"
                onClick={() => reject.mutate()}
                disabled={reject.isPending}
              >
                <X className="size-3.5" /> Reject
              </Button>
            </>
          )}
          {!isPending && (
            <>
              <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
                <Play className="size-3.5 text-primary" /> Test
              </Button>
              {editable && !editing && (
                <Button size="sm" variant="outline" onClick={startEditing}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setPublishOpen(true)}>
                <Radio className="size-3.5" /> Publish to MCP
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
                <Send className="size-3.5" /> Send to Remote
              </Button>
              {editable && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red hover:text-red"
                  onClick={() =>
                    window.confirm(`Delete ${noun.toLowerCase()} "${tool.name}"?`) &&
                    remove.mutate()
                  }
                  disabled={remove.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Badges ── */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <StatusPill identity={identity} />
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
            isActivity
              ? "border-violet-500/25 bg-violet-500/10 text-violet-400"
              : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
          )}
        >
          {isActivity ? <Zap className="size-3" /> : <Wrench className="size-3" />}
          {isActivity ? "Activity" : "Agent Tool"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-blue/20 bg-blue/8 px-2 py-0.5 font-mono text-xs text-blue">
          <Hash className="size-3" />v{tool.version ?? 1}
        </span>
        {params > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-2 py-0.5 text-xs font-medium text-cyan">
            <Code2 className="size-3" />
            {params} param{params !== 1 ? "s" : ""}
          </span>
        )}
        {tool.source_code && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber/20 bg-amber/8 px-2 py-0.5 text-xs font-medium text-amber">
            <FileCode className="size-3" />
            Has Source
          </span>
        )}
        {tool.mcp_published && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald/20 bg-emerald/8 px-2 py-0.5 text-xs font-medium text-emerald">
            <Radio className="size-3" />
            MCP Published
          </span>
        )}
        {tool.status && (
          <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
            {tool.status}
          </span>
        )}
      </div>

      {/* ── Content ── */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Left: Source Code */}
        <GlassPanel>
          <GlassPanelHeader
            title="Source Code"
            description={
              editable ? `Editable dynamic ${noun.toLowerCase()} source.` : "Read-only source."
            }
          />
          <div className="p-4">
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <Textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={2}
                      placeholder="Description"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Purpose</label>
                    <Select value={editPurpose} onValueChange={setEditPurpose}>
                      <SelectTrigger className="mt-1 bg-background text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tool">Agent Tool</SelectItem>
                        <SelectItem value="activity">Workflow Activity</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Source Code</label>
                  <Textarea
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value)}
                    rows={18}
                    className="mt-1 font-mono text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
                    <Save className="size-3.5" />
                    {update.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <CodeBlock code={tool.source_code ?? "// no source available"} />
            )}
          </div>
        </GlassPanel>

        {/* Right: Schema + Sandbox */}
        <div className="space-y-6">
          {schema && (
            <GlassPanel>
              <GlassPanelHeader
                title="Parameters Schema"
                description={`JSON schema for the ${noun.toLowerCase()} parameters.`}
              />
              <div className="p-4">
                <CodeBlock code={JSON.stringify(schema, null, 2)} language="json" />
              </div>
            </GlassPanel>
          )}

          {tool.sandbox_output && (
            <GlassPanel>
              <GlassPanelHeader
                title="Sandbox Output"
                description="Output from sandbox execution."
              />
              <div className="p-4">
                <CodeBlock code={tool.sandbox_output} language="text" />
              </div>
            </GlassPanel>
          )}

          {remoteResponse != null && (
            <GlassPanel>
              <GlassPanelHeader title="Remote Server Response" />
              <div className="p-4">
                <CodeBlock code={JSON.stringify(remoteResponse, null, 2)} language="json" />
              </div>
            </GlassPanel>
          )}
        </div>
      </div>

      {/* ── Dialogs ── */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish "{tool.name}" to MCP</DialogTitle>
          </DialogHeader>
          <Select value={serverName} onValueChange={setServerName}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an MCP server…" />
            </SelectTrigger>
            <SelectContent>
              {mcpServerNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={() => publish.mutate()} disabled={!serverName || publish.isPending}>
              {publish.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send "{tool.name}" to Remote Server</DialogTitle>
          </DialogHeader>
          <Select value={remoteServerId} onValueChange={setRemoteServerId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a remote server…" />
            </SelectTrigger>
            <SelectContent>
              {remoteList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              onClick={() => sendTool.mutate()}
              disabled={!remoteServerId || sendTool.isPending}
            >
              {sendTool.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="size-4 text-primary" /> Test Execution: "{tool.name}"
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Arguments (JSON)</label>
              <Textarea
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
                rows={4}
                className="mt-1 font-mono text-xs"
                placeholder='{ "param": "value" }'
              />
            </div>
            {testError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red">
                {testError}
              </div>
            )}
            {testResult !== null && (
              <div>
                <p className="eyebrow mb-1.5">Execution Result</p>
                <CodeBlock
                  code={
                    typeof testResult === "string"
                      ? testResult
                      : JSON.stringify(testResult, null, 2)
                  }
                  language="json"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              Close
            </Button>
            <Button onClick={handleRunTest} disabled={isTesting}>
              {isTesting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {isTesting ? "Executing…" : "Execute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
