/**
 * "Fix this activity" on a failed workflow step.
 *
 * Finds the activity the step ran (the pinned version, else the active one),
 * hands the step's error and input to its page, and opens it — where
 * "Rebuild from an error" starts prefilled with them.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Hammer, Loader2, Sparkles } from "lucide-react";
import { errorMessage, toolsApi } from "@/api";
import type { ExecutionStep, WorkflowDefinition, WorkflowStep } from "@/types";
import { handOffRebuild } from "@/lib/rebuildHandoff";
import { Button } from "@/components/ui/button";
import type { StepActions } from "./ExecutionStepTimeline";
import { LivePercent } from "@/components/activity/LiveProgress";

/** The definition step a reported step ran, when it is an activity (tool) step. */
function toolStepFor(definition: WorkflowDefinition, step: ExecutionStep): WorkflowStep | null {
  const attrs = step.attributes ?? {};
  const candidates = new Set(
    [step.name, step.id, step.id.split(":")[0], attrs["step_id"], attrs["app.step.id"]].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );
  const match = definition.steps.find((s) => candidates.has(s.id));
  return match && match.type === "tool" && match.config?.["tool_name"] ? match : null;
}

function parseInput(preview: string | null | undefined): Record<string, unknown> | null {
  if (!preview) return null;
  try {
    const value: unknown = JSON.parse(preview);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null; // a truncated preview — the user can paste the input themselves
  }
}

export function FixStepButton({ step, toolStep }: { step: ExecutionStep; toolStep: WorkflowStep }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const name = String(toolStep.config?.["tool_name"]);
  const pinned = toolStep.config?.["tool_version"];

  const open = async () => {
    setBusy(true);
    try {
      const versions = await toolsApi.versions(name);
      const list = Array.isArray(versions)
        ? versions
        : ((versions as { tools?: typeof versions }).tools ?? []);
      const target =
        list.find((v) => pinned != null && v.version_no === Number(pinned)) ??
        list.find((v) => v.is_active) ??
        list[0];
      if (!target) {
        toast.error(`'${name}' no longer exists — rebuild it from the workflow's prerequisites.`);
        return;
      }
      handOffRebuild(name, {
        error: step.error ?? "",
        failingInput: parseInput(step.input_preview),
      });
      navigate({
        to: target.purpose === "tool" ? "/tools/$id" : "/workflows/activities/$id",
        params: { id: String(target.id) },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        This step ran <span className="font-mono text-foreground">{name}</span>
        {pinned != null ? ` v${String(pinned)}` : ""}. Rebuild it from this error.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-[11px]"
        onClick={open}
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            <LivePercent />
          </>
        ) : (
          <Hammer className="size-3" />
        )}
        Fix this activity
      </Button>
    </div>
  );
}

/**
 * "Fix with AI" on any failed step: opens Refine with AI on this run. It reads
 * the failure, plans the fix — workflow edits and, where the activity's own
 * code is at fault, a rebuild of that code — and shows each item as it runs.
 */
export function FixWithAiButton({
  workflowName,
  executionId,
}: {
  workflowName: string;
  executionId: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        Let the assistant find the cause and fix the workflow or the activity code.
      </p>
      <Button
        size="sm"
        className="h-7 gap-1 bg-gradient-brand text-[11px] text-primary-foreground hover:opacity-90"
        onClick={() =>
          void navigate({
            to: "/workflows/$workflowName/refine",
            params: { workflowName },
            search: { execution: executionId },
          })
        }
      >
        <Sparkles className="size-3" /> Fix with AI
      </Button>
    </div>
  );
}

/**
 * Step actions on each failed step of ``definition``: "Fix with AI" (when the
 * run is known) and, on an activity step, "Fix this activity".
 */
export function fixStepActions(
  definition: WorkflowDefinition | null | undefined,
  run?: { executionId?: string | null | undefined } | undefined,
): StepActions | undefined {
  if (!definition) return undefined;
  return (step) => {
    if (String(step.status).toUpperCase() !== "FAILED" || !step.error) return null;
    const toolStep = toolStepFor(definition, step);
    const executionId = run?.executionId;
    if (!toolStep && !executionId) return null;
    return (
      <div className="space-y-2">
        {executionId ? (
          <FixWithAiButton workflowName={definition.name} executionId={executionId} />
        ) : null}
        {toolStep ? <FixStepButton step={step} toolStep={toolStep} /> : null}
      </div>
    );
  };
}
