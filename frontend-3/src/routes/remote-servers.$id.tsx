import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, Send, Server, Wrench } from "lucide-react";
import { remoteServersApi, toolsApi, QK, errorMessage } from "@/api";
import type { Tool } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { ReachabilityBadge, type ReachState } from "@/components/shared/ReachabilityBadge";
import { CodeBlock } from "@/components/shared/CodeBlock";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/remote-servers/$id")({
  head: () => ({
    meta: [
      { title: "Remote Server — Agentic AI Design Patterns" },
      { name: "description", content: "Remote MCP server detail." },
      { property: "og:title", content: "Remote Server — Agentic AI Design Patterns" },
      { property: "og:description", content: "Remote MCP server detail." },
    ],
  }),
  component: RemoteServerDetailPage,
});

interface RemoteServer {
  id: string;
  name: string;
  url: string;
  description?: string;
  tools?: Array<{ id: string; name: string }>;
  [k: string]: unknown;
}

function RemoteServerDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [reach, setReach] = useState<ReachState>("unknown");
  const [toolId, setToolId] = useState("");
  const [sendResponse, setSendResponse] = useState<unknown>(null);

  const query = useQuery({
    queryKey: QK.remoteServer(id),
    queryFn: () => remoteServersApi.get(id) as Promise<RemoteServer>,
  });

  useEffect(() => {
    if (query.data) {
      setName(query.data.name ?? "");
      setUrl(query.data.url ?? "");
      setDescription(query.data.description ?? "");
    }
  }, [query.data]);

  const toolsQuery = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });

  const save = useMutation({
    mutationFn: () => remoteServersApi.update(id, { name, url, description }),
    onSuccess: () => {
      toast.success("Remote server updated.");
      qc.invalidateQueries({ queryKey: QK.remoteServer(id) });
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const check = useMutation({
    mutationFn: () => {
      setReach("checking");
      return remoteServersApi.check(url);
    },
    onSuccess: (res) => setReach(res.reachable ? "reachable" : "unreachable"),
    onError: () => setReach("unreachable"),
  });

  const send = useMutation({
    mutationFn: () => remoteServersApi.sendTool(id, toolId),
    onSuccess: (res) => setSendResponse(res),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="px-6 py-8">
      <Button size="sm" variant="ghost" asChild className="mb-4">
        <Link to="/mcp" search={{ tab: "remote" }}>
          <ArrowLeft className="size-3.5" /> Return to Registry
        </Link>
      </Button>

      {query.isLoading ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} title="Remote Server not found." onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <EmptyState
          icon={<Server className="size-6" />}
          title="Remote Server not found."
          action={
            <Button size="sm" asChild>
              <Link to="/mcp" search={{ tab: "remote" }}>
                Return to Registry
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <GlassPanel>
            <GlassPanelHeader
              title="Server Details"
              actions={<ReachabilityBadge state={reach} />}
            />
            <div className="space-y-2 p-4">
              <Input placeholder="Server Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="Server URL" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
              {reach === "unreachable" ? (
                <p className="text-xs text-red">Server is unreachable.</p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
                  {check.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Check reachability
                </Button>
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save
                </Button>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader title="Deployed Tools" description="Deployed dynamically." />
            <div className="p-4">
              {!query.data.tools || query.data.tools.length === 0 ? (
                <EmptyState icon={<Wrench className="size-6" />} title="No tools deployed" />
              ) : (
                <ul className="space-y-2">
                  {query.data.tools.map((t) => (
                    <li key={t.id} className="rounded-xl border border-border bg-background-elevated/50 p-3 text-sm text-foreground">
                      {t.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader title="Push a Tool" description="Send source code from the tool registry to this server." />
            <div className="space-y-3 p-4">
              <Select value={toolId} onValueChange={setToolId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a tool..." />
                </SelectTrigger>
                <SelectContent>
                  {(toolsQuery.data ?? []).map((t: Tool) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => send.mutate()} disabled={!toolId || send.isPending}>
                {send.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Send to Remote Server
              </Button>

              {sendResponse ? (
                <div>
                  <p className="eyebrow mb-1.5">
                    {(sendResponse as { status?: string })?.status === "error" ? "Send failed" : "Send result"}
                  </p>
                  <CodeBlock code={JSON.stringify(sendResponse, null, 2)} language="json" />
                </div>
              ) : null}
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
