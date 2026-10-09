import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, Play } from "lucide-react";
import { QK, errorMessage, workflowsApi } from "@/api";
import { remoteServersApi, type RemoteRunResponse, type RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExecutionMonitor } from "@/components/workflows/ExecutionMonitor";
import { WorkflowRunForm } from "@/components/workflows/runForm/WorkflowRunForm";
import { rememberRunInput } from "@/components/workflows/runForm/fieldModel";
import { RemoteWorkflowSelect } from "./remoteShared";

/**
 * Run a deployed workflow on this server's worker. Uses the app's full run
 * form when the workflow is defined here; otherwise raw JSON input. The run
 * is routed by the DEPLOYMENT_NAME in the workflow's .env on the server.
 * With ``workflow`` set the panel runs that workflow and hides its picker.
 */
export function RunOnServerPanel({
  server,
  workflow: fixedWorkflow,
}: {
  server: RemoteServer;
  workflow?: string | undefined;
}) {
  const [pickedWorkflow, setWorkflow] = useState("");
  const workflow = fixedWorkflow ?? pickedWorkflow;
  const [deploymentName, setDeploymentName] = useState("");
  const [jsonText, setJsonText] = useState("{}");
  const [result, setResult] = useState<RemoteRunResponse | null>(null);

  const definition = useQuery({
    queryKey: QK.workflow(workflow),
    queryFn: () => workflowsApi.get(workflow),
    enabled: Boolean(workflow),
    retry: false,
  });

  const run = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      remoteServersApi.runWorkflow(server.id, {
        workflow,
        input,
        deployment_name: deploymentName.trim() || undefined,
      }),
    onSuccess: (res, input) => {
      setResult(res);
      rememberRunInput(workflow, input);
      toast.success(`Started on ${server.name} (queue "${res.deployment_name}").`);
      for (const w of res.warnings) toast.warning(w);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const runJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        toast.error("Input must be a JSON object.");
        return;
      }
      run.mutate(parsed as Record<string, unknown>);
    } catch {
      toast.error("Input is not valid JSON.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fixedWorkflow == null ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Workflow</Label>
            <RemoteWorkflowSelect
              server={server}
              value={workflow}
              onChange={(w) => {
                setWorkflow(w);
                setResult(null);
              }}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label className="text-xs">Worker queue (optional)</Label>
          <Input
            value={deploymentName}
            onChange={(e) => setDeploymentName(e.target.value)}
            placeholder="Read from DEPLOYMENT_NAME in the server's .env"
            className="font-mono text-xs"
          />
        </div>
      </div>

      {!workflow ? null : definition.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading the workflow's inputs…
        </p>
      ) : definition.data ? (
        <WorkflowRunForm
          definition={definition.data}
          running={run.isPending}
          onRun={(input) => run.mutate(input)}
        />
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs">Input (JSON)</Label>
          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={5}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            This workflow isn't defined in this app, so there is no input form — pass its inputs as
            a JSON object.
          </p>
          <div className="flex justify-end">
            <Button onClick={runJson} disabled={run.isPending}>
              {run.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run on {server.name}
            </Button>
          </div>
        </div>
      )}

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Queue <code className="font-mono text-foreground">{result.deployment_name}</code>
            </span>
            <span>·</span>
            <code className="font-mono">{result.execution_id}</code>
            <Button size="sm" variant="ghost" asChild className="ml-auto">
              <Link
                to="/workflows/$workflowName/execute"
                params={{ workflowName: result.workflow_name }}
                search={{ execId: result.execution_id }}
              >
                <ExternalLink className="size-3.5" /> Open run page
              </Link>
            </Button>
          </div>
          {result.warnings.map((w) => (
            <p
              key={w}
              className="flex gap-2 rounded-lg border border-amber/30 bg-amber/10 p-2.5 text-[11px] text-amber"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </p>
          ))}
          <ExecutionMonitor executionId={result.execution_id} title={`Run on ${server.name}`} />
        </div>
      ) : null}
    </div>
  );
}
