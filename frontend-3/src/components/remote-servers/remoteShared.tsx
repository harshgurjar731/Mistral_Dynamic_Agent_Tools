import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Square, Trash2 } from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi, type RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeploymentLog } from "./Deployments";

/** Workflows unpacked on an SSH server, with how many of their containers are up. */
export function RemoteWorkflowSelect({
  server,
  value,
  onChange,
  placeholder = "Choose a deployed workflow…",
  extraItems,
}: {
  server: RemoteServer;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra leading options, e.g. the deploy directory. */
  extraItems?: React.ReactNode;
}) {
  const workflows = useQuery({
    queryKey: QK.remoteServerWorkflows(String(server.id)),
    queryFn: () => remoteServersApi.remoteWorkflows(server.id),
  });
  const items = workflows.data?.items ?? [];

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={workflows.isLoading ? "Loading workflows…" : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {extraItems}
          {items.map((w) => (
            <SelectItem key={w.name} value={w.name}>
              {w.name}
              <span className="ml-2 text-[10px] text-muted-foreground">
                {w.containers.filter((c) => c.status.startsWith("Up")).length}/{w.containers.length}{" "}
                up
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {workflows.data?.error ? (
        <p className="text-[11px] text-red">{workflows.data.error}</p>
      ) : items.length === 0 && !workflows.isLoading ? (
        <p className="text-[11px] text-muted-foreground">
          No deployed workflows on this server yet — deploy one first.
        </p>
      ) : null}
    </div>
  );
}

/** Live output of a console/build run, with Stop while it is still running. */
export function CommandRunOutput({ deploymentId }: { deploymentId: number }) {
  const qc = useQueryClient();
  // Same key DeploymentLog polls, so this reads the status it already fetches.
  const active = useQuery({
    queryKey: QK.remoteDeployment(deploymentId),
    queryFn: () => remoteServersApi.deployment(deploymentId),
    refetchInterval: (q) =>
      !q.state.data || q.state.data.status === "running" || q.state.data.status === "queued"
        ? 1500
        : false,
  });
  const running = active.data?.status === "running" || active.data?.status === "queued";
  const stop = useMutation({
    mutationFn: () => remoteServersApi.cancelCommand(deploymentId),
    onError: (e) => toast.error(errorMessage(e)),
    // Either way, re-read the run: it may have ended already.
    onSettled: () => qc.invalidateQueries({ queryKey: QK.remoteDeployment(deploymentId) }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={String(active.data?.options?.["command"] ?? "")}
        >
          {String(active.data?.options?.["command"] ?? "")}
        </p>
        {running ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-red hover:bg-red/10"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            <Square className="size-3.5" /> Stop
          </Button>
        ) : null}
      </div>
      <DeploymentLog deploymentId={deploymentId} />
    </div>
  );
}

export type KeyValueRow = { key: string; value: string };

/** Editable KEY=VALUE rows (build args, .env overrides). */
export function KeyValueRows({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  secretValues = false,
  addLabel,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  /** Mask values (API keys in .env). */
  secretValues?: boolean;
  addLabel: string;
}) {
  const set = (i: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={r.key}
            onChange={(e) => set(i, { key: e.target.value.trim() })}
            placeholder={keyPlaceholder}
            className="w-2/5 font-mono text-xs"
            spellCheck={false}
          />
          <Input
            type={secretValues ? "password" : "text"}
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className="flex-1 font-mono text-xs"
            autoComplete={secretValues ? "new-password" : "off"}
            spellCheck={false}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label="Remove"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Plus className="size-3.5" /> {addLabel}
      </Button>
    </div>
  );
}
