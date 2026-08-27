import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  Check,
  X,
  Pencil,
  Trash2,
  Radio,
  Send,
  Loader2,
} from "lucide-react";
import { toolsApi, mcpApi, remoteServersApi, QK, errorMessage } from "@/api";
import type { Tool } from "@/types";
import { toolSource, TOOL_SOURCE_IDENTITY } from "@/lib/status";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CodeBlock } from "@/components/shared/CodeBlock";
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

/** Tool Service records carry no top-level description — the schema holds it. */
function toolDescription(tool: Tool): string {
  if (tool.description) return tool.description;
  const fn = schemaEntries(tool)?.["function"] as { description?: string } | undefined;
  return fn?.description ?? "";
}

export function ToolCard({ tool, pending = false }: { tool: Tool; pending?: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(tool.source_code ?? "");
  const [description, setDescription] = useState(toolDescription(tool));
  const [publishOpen, setPublishOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [serverName, setServerName] = useState("");
  const [remoteServerId, setRemoteServerId] = useState("");
  const [remoteResponse, setRemoteResponse] = useState<unknown>(null);

  const src = toolSource(tool.id);
  const editable = src === "dynamic";
  const schema = schemaEntries(tool);
  const summary = toolDescription(tool);

  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: QK.tools() });
    qc.invalidateQueries({ queryKey: QK.pendingTools() });
  };

  const approve = useMutation({
    mutationFn: () => toolsApi.approve(tool.id),
    onSuccess: () => {
      toast.success(`"${tool.name}" approved and moved to Active Tools.`);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => toolsApi.reject(tool.id),
    onSuccess: () => {
      toast.success(`"${tool.name}" rejected.`);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: () => toolsApi.update(tool.id, { source_code: source, description }),
    onSuccess: () => {
      toast.success("Tool updated.");
      setEditing(false);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => toolsApi.remove(tool.id),
    onSuccess: () => {
      toast.success("Tool deleted.");
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const publish = useMutation({
    mutationFn: () => toolsApi.publishMcp(tool.id, serverName),
    onSuccess: () => {
      toast.success(`Published "${tool.name}" to MCP server "${serverName}".`);
      setPublishOpen(false);
      invalidateLists();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sendTool = useMutation({
    mutationFn: () => remoteServersApi.sendTool(remoteServerId, tool.id),
    onSuccess: (res) => setRemoteResponse(res),
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
    : (remoteServers as { items?: { id: string; name: string }[] })?.items ?? [];

  const identity = TOOL_SOURCE_IDENTITY[src];

  return (
    <div className="rounded-2xl border border-border glass">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{tool.name}</p>
            <span className="text-xs text-muted-foreground">v{tool.version ?? 1}</span>
            <StatusPill identity={identity} />
            {tool.status ? (
              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                {tool.status}
              </span>
            ) : null}
          </div>
          {summary ? (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{summary}</p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {editable && editing ? (
            <div className="space-y-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Description"
              />
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
                  {update.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="eyebrow mb-1.5">Tool Definition</p>
              <CodeBlock code={tool.source_code ?? "// no source available"} />
            </div>
          )}

          {schema ? (
            <div>
              <p className="eyebrow mb-1.5">Parameters Schema</p>
              <CodeBlock code={JSON.stringify(schema, null, 2)} language="json" />
            </div>
          ) : null}

          {tool.sandbox_output ? (
            <div>
              <p className="eyebrow mb-1.5">Sandbox Output</p>
              <CodeBlock code={tool.sandbox_output} language="text" />
            </div>
          ) : null}

          {remoteResponse ? (
            <div>
              <p className="eyebrow mb-1.5">Remote Server Response</p>
              <CodeBlock code={JSON.stringify(remoteResponse, null, 2)} language="json" />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {pending ? (
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
            ) : null}
            {editable && !pending ? (
              <>
                {!editing ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red hover:text-red"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </>
            ) : null}
            {!pending ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setPublishOpen(true)}>
                  <Radio className="size-3.5" /> Publish to MCP
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
                  <Send className="size-3.5" /> Send to Remote Server
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

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
    </div>
  );
}
