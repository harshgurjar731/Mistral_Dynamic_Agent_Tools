import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hammer, Loader2 } from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi, type BuildService, type RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  CommandRunOutput,
  KeyValueRows,
  RemoteWorkflowSelect,
  type KeyValueRow,
} from "./remoteShared";

// A package runs one service: tool and activity code is bundled into the worker.
const SERVICES: { id: BuildService; label: string; hint: string }[] = [
  {
    id: "backend",
    label: "Worker",
    hint: "Mistral worker with the workflow's bundled tool & activity code",
  },
];

const OPTIONS = [
  { key: "start", label: "Start after building", hint: "docker compose up -d" },
  {
    key: "run_bootstrap",
    label: "Run bootstrap on the host",
    hint: "Create the agents first (the worker also does this on start)",
  },
  { key: "no_cache", label: "No cache", hint: "Rebuild every layer (--no-cache)" },
  { key: "pull", label: "Pull base images", hint: "--pull; also refreshes neo4j" },
  { key: "force_recreate", label: "Force recreate", hint: "Recreate containers even if unchanged" },
  { key: "remove_orphans", label: "Remove orphans", hint: "Drop containers no longer in the file" },
] as const;

type OptionKey = (typeof OPTIONS)[number]["key"];

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.value]));
}

/**
 * Build a deployed workflow's Docker stack on the server, with every
 * docker compose option the package supports, then optionally start it.
 * With ``workflow`` set the panel works on that workflow and hides its picker.
 */
export function BuildWorkflowPanel({
  server,
  workflow: fixedWorkflow,
}: {
  server: RemoteServer;
  workflow?: string | undefined;
}) {
  const qc = useQueryClient();
  const [pickedWorkflow, setWorkflow] = useState("");
  const workflow = fixedWorkflow ?? pickedWorkflow;
  const [services, setServices] = useState<BuildService[]>(["backend"]);
  const [options, setOptions] = useState<Record<OptionKey, boolean>>({
    start: true,
    run_bootstrap: false,
    no_cache: false,
    pull: false,
    force_recreate: false,
    remove_orphans: false,
  });
  const [buildArgs, setBuildArgs] = useState<KeyValueRow[]>([]);
  const [env, setEnv] = useState<KeyValueRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  const build = useMutation({
    mutationFn: () =>
      remoteServersApi.build(server.id, {
        workflow,
        services,
        ...options,
        build_args: rowsToRecord(buildArgs),
        env: rowsToRecord(env),
      }),
    onSuccess: (dep) => {
      setActiveId(dep.id);
      // Values may be secrets; don't keep them in the form after sending.
      setEnv((rows) => rows.map((r) => ({ ...r, value: "" })));
      toast.success(`Building "${workflow}" on ${server.name}…`);
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(server.id)) });
      qc.invalidateQueries({ queryKey: QK.remoteServerWorkflows(String(server.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggleService = (id: BuildService, on: boolean) =>
    setServices((s) => (on ? [...s, id] : s.filter((x) => x !== id)));

  return (
    <div className="space-y-4">
      {fixedWorkflow == null ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Workflow</Label>
          <RemoteWorkflowSelect server={server} value={workflow} onChange={setWorkflow} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-1">Services</legend>
          {SERVICES.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-start gap-2">
              <Checkbox
                checked={services.includes(s.id)}
                onCheckedChange={(v) => toggleService(s.id, v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs text-foreground">{s.label}</span>
                <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="eyebrow mb-1">Options</legend>
          {OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-2">
              <Checkbox
                checked={options[o.key]}
                onCheckedChange={(v) => setOptions((p) => ({ ...p, [o.key]: v === true }))}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs text-foreground">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Build arguments</Label>
        <KeyValueRows
          rows={buildArgs}
          onChange={setBuildArgs}
          keyPlaceholder="ARG_NAME"
          valuePlaceholder="value"
          addLabel="Add build argument"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">.env overrides</Label>
        <KeyValueRows
          rows={env}
          onChange={setEnv}
          keyPlaceholder="DEPLOYMENT_NAME"
          valuePlaceholder="value (masked)"
          secretValues
          addLabel="Add .env value"
        />
        <p className="text-[11px] text-muted-foreground">
          Merged into the workflow's .env on the server before building — e.g. MISTRAL_API_KEY or
          DEPLOYMENT_NAME. Only the names are recorded in the build history.
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => build.mutate()}
          disabled={!workflow || services.length === 0 || build.isPending}
        >
          {build.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Hammer className="size-3.5" />
          )}
          {options.start ? "Build & start" : "Build"}
        </Button>
      </div>

      {activeId != null ? <CommandRunOutput deploymentId={activeId} /> : null}
    </div>
  );
}
