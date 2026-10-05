import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Cpu,
  FileKey,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  ScrollText,
  Square,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi, type CommandPreset, type RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import { CommandRunOutput, RemoteWorkflowSelect } from "./remoteShared";

/** Radix Select items cannot have an empty value. */
const DEPLOY_ROOT = "__root__";

const PRESET_ICONS: Record<string, LucideIcon> = {
  worker_status: Activity,
  start_worker: Play,
  restart_worker: RefreshCw,
  stop_worker: Square,
  worker_logs: ScrollText,
  follow_logs: ScrollText,
  bootstrap: Rocket,
  env_keys: FileKey,
  host_info: Cpu,
  list_deployments: FolderOpen,
};

/**
 * Run commands on an SSH server: one-click worker actions for a deployed
 * workflow, and a free-form command box. Output streams from the command's
 * deployment row; long-running commands (following logs) can be stopped.
 */
export function RemoteConsole({ server }: { server: RemoteServer }) {
  const qc = useQueryClient();
  const [where, setWhere] = useState(DEPLOY_ROOT);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const catalog = useQuery({
    queryKey: QK.remoteServerProviders(),
    queryFn: remoteServersApi.providers,
    staleTime: Infinity,
  });

  const workflow = where === DEPLOY_ROOT ? "" : where;
  const presets = Object.entries(catalog.data?.command_presets ?? {});

  const run = useMutation({
    mutationFn: (body: { command?: string; preset?: string }) =>
      remoteServersApi.runCommand(server.id, { ...body, workflow: workflow || undefined }),
    onSuccess: (dep) => {
      setActiveId(dep.id);
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(server.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const cmd = command.trim();
    if (!cmd) return;
    run.mutate({ command: cmd });
    setHistory((h) => [...h.filter((c) => c !== cmd), cmd].slice(-50));
    setHistoryIndex(null);
    setCommand("");
  };

  const recall = (direction: -1 | 1) => {
    if (history.length === 0) return;
    const next =
      historyIndex == null
        ? direction === -1
          ? history.length - 1
          : null
        : historyIndex + direction;
    if (next == null || next >= history.length) {
      setHistoryIndex(null);
      setCommand("");
    } else if (next >= 0) {
      setHistoryIndex(next);
      setCommand(history[next] ?? "");
    }
  };

  const presetButton = ([id, preset]: [string, CommandPreset]) => {
    const Icon = PRESET_ICONS[id] ?? Wrench;
    const needsWorkflow = preset.scope === "workflow" && !workflow;
    return (
      <Button
        key={id}
        size="sm"
        variant="outline"
        disabled={needsWorkflow || run.isPending}
        title={needsWorkflow ? "Choose a deployed workflow first" : preset.command}
        onClick={() => run.mutate({ preset: id })}
      >
        <Icon className="size-3.5" />
        {preset.label}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Run in</Label>
        <RemoteWorkflowSelect
          server={server}
          value={where}
          onChange={setWhere}
          extraItems={
            <SelectItem value={DEPLOY_ROOT}>
              Deploy directory ({String(server.config["deploy_path"] ?? "~/workflow-deployments")})
            </SelectItem>
          }
        />
      </div>

      <div className="space-y-2">
        <p className="eyebrow">Worker</p>
        <div className="flex flex-wrap gap-2">
          {presets.filter(([, p]) => p.scope === "workflow").map(presetButton)}
        </div>
        <p className="eyebrow pt-1">Server</p>
        <div className="flex flex-wrap gap-2">
          {presets.filter(([, p]) => p.scope === "server").map(presetButton)}
        </div>
      </div>

      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Label className="text-xs">Command</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              $
            </span>
            <Input
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setHistoryIndex(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  recall(-1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  recall(1);
                }
              }}
              placeholder="docker compose -f docker-compose.deploy.yml ps"
              spellCheck={false}
              autoComplete="off"
              className="pl-7 font-mono text-xs"
            />
          </div>
          <Button type="submit" disabled={!command.trim() || run.isPending}>
            {run.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <SquareTerminal className="size-3.5" />
            )}
            Run
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Runs over SSH as {String(server.config["username"] ?? "the server's user")} in a login
          shell, without a terminal — interactive programs (nano, top, prompts) won't work. Use ↑/↓
          for history.
        </p>
      </form>

      {activeId != null ? <CommandRunOutput deploymentId={activeId} /> : null}
    </div>
  );
}
