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
import { Hammer, Loader2 } from "lucide-react";
import { errorMessage, toolsApi } from "@/api";
import type { ExecutionStep, WorkflowDefinition, WorkflowStep } from "@/types";
import { handOffRebuild } from "@/lib/rebuildHandoff";
import { Button } from "@/components/ui/button";
import type { StepActions } from "./ExecutionStepTimeline";

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
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Hammer className="size-3" />}
        Fix this activity
      </Button>
    </div>
  );
}

/** Step actions offering a fix on each failed activity step of ``definition``. */
export function fixStepActions(
  definition: WorkflowDefinition | null | undefined,
): StepActions | undefined {
  if (!definition) return undefined;
  return (step) => {
    if (String(step.status).toUpperCase() !== "FAILED" || !step.error) return null;
    const toolStep = toolStepFor(definition, step);
    return toolStep ? <FixStepButton step={step} toolStep={toolStep} /> : null;
  };
}
