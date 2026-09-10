import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Server, Trash2, ArrowRight } from "lucide-react";
import { remoteServersApi, QK, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeletons";
import { ReachabilityBadge, type ReachState } from "@/components/shared/ReachabilityBadge";

interface RemoteServer {
  id: string;
  name: string;
  url: string;
  description?: string;
}

export function RemoteServersPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [reach, setReach] = useState<Record<string, ReachState>>({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: QK.remoteServers(),
    queryFn: async () => {
      const res = await remoteServersApi.list();
      return (Array.isArray(res) ? res : (res as { items?: RemoteServer[] })?.items ?? []) as RemoteServer[];
    },
  });

  const create = useMutation({
    mutationFn: () => remoteServersApi.create({ name, url, description }),
    onSuccess: () => {
      toast.success("Remote server added.");
      setName("");
      setUrl("");
      setDescription("");
      setShowForm(false);
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => remoteServersApi.remove(id),
    onSuccess: () => {
      toast.success("Remote server removed.");
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const check = useMutation({
    mutationFn: async (server: RemoteServer) => {
      setReach((r) => ({ ...r, [server.id]: "checking" }));
      return remoteServersApi.check(server.url);
    },
    onSuccess: (res, server) => {
      setReach((r) => ({ ...r, [server.id]: res.reachable ? "reachable" : "unreachable" }));
    },
    onError: (_e, server) => setReach((r) => ({ ...r, [server.id]: "unreachable" })),
  });

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Remote Servers"
        description="Custom code-push targets for dynamic tools."
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowForm((s) => !s)}>
            <Plus className="size-3.5" /> Add Server
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {showForm ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && url.trim()) create.mutate();
            }}
            className="space-y-2 rounded-xl border border-border bg-background-elevated/60 p-3"
          >
            <Input
              placeholder="Server Name (e.g. my-remote-runner)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Server URL (https://my-server.com/receive-tool)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-red">{errorMessage(error)}</p>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={<Server className="size-6" />}
            title="No remote servers configured."
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {data.map((server) => (
              <li
                key={server.id}
                className="rounded-xl border border-border bg-background-elevated/50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{server.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{server.url}</p>
                  </div>
                  <ReachabilityBadge state={reach[server.id] ?? "unknown"} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => check.mutate(server)}
                    disabled={check.isPending}
                  >
                    Check
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/remote-servers/$id" params={{ id: server.id }}>
                      Open <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-red hover:text-red"
                    onClick={() => remove.mutate(server.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
