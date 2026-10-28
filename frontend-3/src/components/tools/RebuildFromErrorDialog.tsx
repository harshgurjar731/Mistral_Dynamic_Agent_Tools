/**
 * Rebuild a tool/activity version from an error seen while running it.
 *
 * The user pastes the error (from a workflow run, an agent, or a test), says
 * what to improve, and optionally gives the input it failed on and the output
 * it should have produced. The rebuild runs in the background: the new version
 * must reproduce its examples and run the failing input, or it is rolled back
 * and the current version stays active.
 */
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckCircle2, Hammer, Loader2, Undo2, XCircle } from "lucide-react";
import { errorMessage, QK, runsApi } from "@/api";
import type { Tool } from "@/types";
import { focusRun, trackStartedRun } from "@/lib/runs/connections";
import { useTrackedRun } from "@/lib/runs/useRun";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { RebuildPrefill } from "./ToolTestDialog";
import { LivePercent } from "@/components/activity/LiveProgress";

interface RebuildResult {
  status?: string;
  message?: string;
  tool_id?: number;
  version?: number;
  previous_version?: number;
  rolled_back?: boolean;
  repinned?: Array<{ workflow_name: string; steps: string[]; is_deployed: boolean }>;
}

function parseJson(text: string): { value: unknown; error: string | null } {
  if (!text.trim()) return { value: undefined, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch {
    return { value: undefined, error: "Not valid JSON" };
  }
}

export function RebuildFromErrorDialog({
  tool,
  open,
  onOpenChange,
  prefill,
  detailPath,
}: {
  tool: Tool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: RebuildPrefill | null | undefined;
  detailPath: "/workflows/activities/$id" | "/tools/$id";
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [inputText, setInputText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [updateWorkflows, setUpdateWorkflows] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const run = useTrackedRun(runId);
  const noun = tool.purpose === "activity" ? "activity" : "tool";

  // Each opening starts from the prefill (a failed test, or a failed workflow step).
  useEffect(() => {
    if (!open) return;
    setError(prefill?.error ?? "");
    setInputText(prefill?.failingInput ? JSON.stringify(prefill.failingInput, null, 2) : "");
    setExpectedText(
      prefill?.expectedOutput !== undefined ? JSON.stringify(prefill.expectedOutput, null, 2) : "",
    );
    setComment("");
    setRunId(null);
  }, [open, prefill]);

  useEffect(() => {
    if (!open || !runId) return;
    return focusRun(runId);
  }, [open, runId]);

  const input = parseJson(inputText);
  const expected = parseJson(expectedText);
  const inputIsObject =
    input.value === undefined ||
    (typeof input.value === "object" && input.value !== null && !Array.isArray(input.value));
  const canStart =
    Boolean(error.trim() || comment.trim()) &&
    !input.error &&
    !expected.error &&
    inputIsObject &&
    !starting;

  const start = async () => {
    setStarting(true);
    try {
      const started = await runsApi.startRebuild({
        tool_id: Number(tool.id),
        error: error.trim(),
        comment: comment.trim(),
        failing_input: (input.value as Record<string, unknown> | undefined) ?? null,
        ...(expected.value !== undefined ? { expected_output: expected.value } : {}),
        update_workflows: updateWorkflows,
      });
      trackStartedRun(started);
      setRunId(started.id);
    } catch (err) {
      toast.error(`Could not start the rebuild: ${errorMessage(err)}`);
    } finally {
      setStarting(false);
    }
  };

  const running = run?.status === "running";
  const finished = run && run.status !== "running";
  const result = (run?.result ?? null) as RebuildResult | null;
  const ok = finished && run.status === "completed";

  // A finished rebuild changes the version list and possibly workflows.
  useEffect(() => {
    if (!finished) return;
    void qc.invalidateQueries({ queryKey: QK.tools() });
    void qc.invalidateQueries({ queryKey: QK.toolVersions(tool.name) });
    void qc.invalidateQueries({ queryKey: QK.workflows() });
  }, [finished, qc, tool.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl gap-0 overflow-hidden p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Hammer className="size-4 text-primary" /> Rebuild {tool.name} from an error
            </DialogTitle>
            <DialogDescription className="text-xs">
              Paste the error you saw and say what to improve. A new version of this {noun} is built
              with the same parameters and output, and is checked against its examples and the input
              it failed on — if it still fails it is rolled back and v{tool.version_no ?? 1} stays
              in place.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {runId ? (
              <RebuildProgress
                running={running}
                ok={Boolean(ok)}
                note={run?.progress?.note ?? run?.progress?.label ?? null}
                error={run?.error ?? null}
                result={result}
              />
            ) : (
              <>
                <Field
                  label="Error message"
                  hint="Paste it from the failed workflow step, the agent's tool call, or the test result."
                >
                  <Textarea
                    value={error}
                    onChange={(e) => setError(e.target.value)}
                    rows={5}
                    maxLength={8000}
                    placeholder="e.g. runtime_crash — apply_gst raised an exception — TypeError: can't multiply sequence by non-int of type 'float'"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="What should be improved" hint="Optional if the error says it all.">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder='e.g. subtotal can arrive as a string like "1,200.50" — parse it, and round every amount to 2 decimals.'
                    className="text-xs"
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="Input it failed on (JSON)"
                    hint="Optional. The new version must run this without error."
                    error={input.error ?? (inputIsObject ? null : "Must be a JSON object")}
                  >
                    <Textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      rows={6}
                      placeholder={'{ "subtotal": "1,200.50" }'}
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field
                    label="Expected output (JSON)"
                    hint="Optional. Kept as a worked example the new version must match."
                    error={expected.error}
                  >
                    <Textarea
                      value={expectedText}
                      onChange={(e) => setExpectedText(e.target.value)}
                      rows={6}
                      placeholder={'{ "gst_amount": 216.09, "grand_total": 1416.59 }'}
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={updateWorkflows}
                    onChange={(e) => setUpdateWorkflows(e.target.checked)}
                  />
                  Move workflow steps that run v{tool.version_no ?? 1} to the new version once it
                  passes (deployed workflows then need republishing).
                </label>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 border-t border-border px-6 py-3 sm:space-x-0">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {running ? "Close — keep it running" : "Close"}
            </Button>
            {!runId ? (
              <Button size="sm" disabled={!canStart} onClick={() => void start()}>
                {starting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <LivePercent />
                  </>
                ) : (
                  <Hammer className="size-3.5" />
                )}
                Rebuild
              </Button>
            ) : ok && result?.tool_id != null ? (
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  navigate({ to: detailPath, params: { id: String(result.tool_id) } });
                }}
              >
                Open v{result.version}
              </Button>
            ) : finished ? (
              <Button size="sm" variant="outline" onClick={() => setRunId(null)}>
                Edit and try again
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      {hint ? <p className="mb-1 text-[10px] text-muted-foreground">{hint}</p> : null}
      {children}
      {error ? <p className="mt-0.5 text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}

function RebuildProgress({
  running,
  ok,
  note,
  error,
  result,
}: {
  running: boolean;
  ok: boolean;
  note: string | null;
  error: string | null;
  result: RebuildResult | null;
}) {
  if (running) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-xs">
        <Loader2 className="mt-0.5 size-4 animate-spin text-primary" />
        <div>
          <p className="font-medium text-foreground">Rebuilding…</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {note ?? "Generating the fix and verifying it."} This can take a few minutes; you can
            close this dialog and it keeps going.
          </p>
        </div>
      </div>
    );
  }
  if (ok) {
    const repinned = result?.repinned ?? [];
    return (
      <div className="space-y-2 rounded-xl border border-emerald/30 bg-emerald/5 px-3 py-3 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-emerald">
          <CheckCircle2 className="size-4" />
          {result?.status === "pending_approval"
            ? `Built v${result?.version} — it is waiting for approval before it can run.`
            : `Built and verified v${result?.version}; it is now the active version.`}
        </p>
        {repinned.length > 0 ? (
          <div className="text-[11px] text-muted-foreground">
            Moved to the new version:
            <ul className="mt-0.5 list-disc pl-4">
              {repinned.map((w) => (
                <li key={w.workflow_name}>
                  <span className="font-mono text-foreground">{w.workflow_name}</span> (
                  {w.steps.join(", ")})
                  {w.is_deployed ? " — republish to update the deployed copy" : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <XCircle className="size-4" /> The rebuild did not produce a working version
      </p>
      <p className="text-[11px] text-foreground/90">{result?.message ?? error}</p>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Undo2 className="size-3" />
        Any broken build was rolled back; the version you started from is unchanged.
      </p>
    </div>
  );
}
