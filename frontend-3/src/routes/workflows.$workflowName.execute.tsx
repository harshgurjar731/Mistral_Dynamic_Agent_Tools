import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import type { InputField } from "@/types";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { ExecutionMonitor } from "@/components/workflows/ExecutionMonitor";
import { DeployBadge } from "@/components/workflows/WorkflowCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workflows/$workflowName/execute")({
  validateSearch: (search: Record<string, unknown>): { execId?: string } => {
    const execId = search["execId"];
    return typeof execId === "string" && execId ? { execId } : {};
  },
  head: ({ params }) => ({
    meta: [
      { title: `Run ${params.workflowName} — Agentic AI Design Patterns` },
      { name: "description", content: `Execute ${params.workflowName} and watch the run live.` },
      { property: "og:title", content: `Run ${params.workflowName} — Agentic AI Design Patterns` },
      {
        property: "og:description",
        content: `Execute ${params.workflowName} and watch the run live.`,
      },
    ],
  }),
  component: ExecuteWorkflowPage,
});

/** Coerces a form string back to the type the input schema declares. */
function coerce(value: string, type: string): unknown {
  if (type === "number") {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (type === "boolean") return value === "true";
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(value || (type === "array" ? "[]" : "{}"));
    } catch {
      return value;
    }
  }
  return value;
}

function ExecuteWorkflowPage() {
  const { workflowName } = Route.useParams();
  const { execId } = Route.useSearch();
  const navigate = useNavigate();

  const [values, setValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState("{}");
  const [rawError, setRawError] = useState<string | null>(null);
  const [activeExec, setActiveExec] = useState<string | null>(execId ?? null);

  useEffect(() => {
    if (execId) setActiveExec(execId);
  }, [execId]);

  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });

  const fields = useMemo(() => (wf.data?.input_schema ?? []) as InputField[], [wf.data]);
  const usesSchema = fields.length > 0;

  const buildInput = (): Record<string, unknown> | null => {
    if (!usesSchema) {
      try {
        const parsed = JSON.parse(rawJson || "{}");
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setRawError("Input must be a JSON object.");
          return null;
        }
        setRawError(null);
        return parsed as Record<string, unknown>;
      } catch {
        setRawError("Invalid JSON.");
        return null;
      }
    }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name] ?? "";
      if (raw === "" && f.required === false) continue;
      out[f.name] = coerce(raw, f.type);
    }
    return out;
  };

  const run = useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      workflowsApi.execute(workflowName, { input, wait_for_result: false }),
    onSuccess: (res) => {
      const id = String(res["execution_id"] ?? "");
      if (!id) {
        toast.error("The backend accepted the run but returned no execution id.");
        return;
      }
      setActiveExec(id);
      navigate({
        to: "/workflows/$workflowName/execute",
        params: { workflowName },
        search: { execId: id },
        replace: true,
      });
      toast.success(`Run started (${String(res["source"] ?? "mistral")}).`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const missingRequired = usesSchema
    ? fields.some((f) => f.required !== false && !(values[f.name] ?? "").trim())
    : false;

  return (
    <div className="space-y-5 px-6 py-8">
      <PageHeader
        eyebrow="Execution"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="break-all">{workflowName}</span>
            {wf.data ? <DeployBadge workflow={wf.data} /> : null}
          </span>
        }
        description="A run starts on the Mistral server when the workflow is published, and falls back to the local DAG engine otherwise."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows/$workflowName" params={{ workflowName }}>
              <ArrowLeft className="size-3.5" /> Overview
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <GlassPanel className="h-fit">
          <GlassPanelHeader
            title="Inputs"
            description={usesSchema ? `${fields.length} declared` : "Free-form JSON payload"}
          />
          <div className="space-y-4 p-4">
            {wf.isLoading ? (
              <DetailSkeleton />
            ) : wf.isError ? (
              <ErrorState error={wf.error} onRetry={() => wf.refetch()} />
            ) : usesSchema ? (
              fields.map((f) => (
                <div key={f.name}>
                  <label className="eyebrow mb-1.5 block">
                    {f.name}
                    {f.required === false ? (
                      <span className="ml-1 text-muted-foreground/70 normal-case">optional</span>
                    ) : null}
                  </label>
                  {f.type === "boolean" ? (
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
                      value={values[f.name] ?? "false"}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : f.type === "object" || f.type === "array" ? (
                    <Textarea
                      rows={4}
                      spellCheck={false}
                      value={values[f.name] ?? ""}
                      placeholder={f.type === "array" ? "[]" : "{}"}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="font-mono text-xs"
                    />
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : "text"}
                      value={values[f.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="text-xs"
                    />
                  )}
                  {f.description ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{f.description}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <div>
                <label className="eyebrow mb-1.5 block">Payload</label>
                <Textarea
                  rows={10}
                  spellCheck={false}
                  value={rawJson}
                  onChange={(e) => {
                    setRawJson(e.target.value);
                    setRawError(null);
                  }}
                  className={cn("font-mono text-xs", rawError && "border-red/60")}
                />
                {rawError ? <p className="mt-1 text-[11px] text-red">{rawError}</p> : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This workflow declares no input schema, so the object is passed through as the
                  run's variables.
                </p>
              </div>
            )}

            <Button
              className="w-full"
              disabled={run.isPending || wf.isLoading || missingRequired}
              onClick={() => {
                const input = buildInput();
                if (input) run.mutate(input);
              }}
            >
              {run.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run workflow
            </Button>
            {missingRequired ? (
              <p className="text-[11px] text-amber">Fill every required input to run.</p>
            ) : null}
          </div>
        </GlassPanel>

        <div className="min-h-[540px]">
          <ExecutionMonitor executionId={activeExec} />
        </div>
      </div>
    </div>
  );
}
