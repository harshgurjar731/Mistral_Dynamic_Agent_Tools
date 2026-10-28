/**
 * Fix a process document with AI, or draft one from prose — then review.
 *
 * The model's result is never saved on its own: this shows what changed (a
 * line diff and the model's own list), which values it had to leave as TODO
 * placeholders, and the result's fresh validation, and only "Accept" stores it.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2, Sparkles } from "lucide-react";
import { errorMessage, processesApi } from "@/api";
import type { FixResult } from "@/api/processes";
import { downloadJson } from "@/api/processes";
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
import { DiffView, prettyJson } from "./shared";
import { ReportView } from "./ValidationReportDialog";
import { LivePercent } from "@/components/activity/LiveProgress";

export type AiSource =
  | {
      mode: "fix";
      documentId?: number | undefined;
      raw?: unknown;
      conceptId?: string | null | undefined;
    }
  | {
      mode: "draft";
      conceptId?: string | null | undefined;
      /** Unfiled: the node whose template the draft follows. */
      classifyAs?: string | null | undefined;
    };

export function AiFixDialog({
  open,
  onOpenChange,
  source,
  originalText,
  onAccept,
  accepting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: AiSource | null;
  /** What the user uploaded, for the diff. */
  originalText?: string | undefined;
  onAccept: (document: Record<string, unknown>, result: FixResult) => void;
  accepting?: boolean | undefined;
}) {
  const [prose, setProse] = useState("");
  const [result, setResult] = useState<FixResult | null>(null);

  const run = useMutation({
    mutationFn: () => {
      if (!source) throw new Error("Nothing to work on.");
      if (source.mode === "draft") {
        return processesApi.draft({
          text: prose,
          concept_id: source.conceptId ?? null,
          classify_as: source.classifyAs ?? null,
        });
      }
      return processesApi.fix({
        ...(source.documentId ? { document_id: source.documentId } : {}),
        ...(source.raw !== undefined ? { raw: source.raw } : {}),
        concept_id: source.conceptId ?? null,
      });
    },
    onSuccess: setResult,
  });

  // A fix starts as soon as the dialog opens; a draft waits for the prose.
  useEffect(() => {
    if (!open) {
      setResult(null);
      run.reset();
      return;
    }
    if (source?.mode === "fix" && !result && !run.isPending) run.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  const drafting = source?.mode === "draft";
  const after = result?.document ? prettyJson(result.document) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            {drafting ? "Draft a process document with AI" : "Fix with AI"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {drafting
              ? "Paste an SOP, a policy or notes. The AI structures it into the template's format; it does not add stages or controls your text does not support."
              : "The AI restructures your document to match the template, keeping your content. Anything it cannot know is left as a TODO for you to fill in. Nothing is saved until you accept."}
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {drafting && !result ? (
            <Textarea
              value={prose}
              onChange={(e) => setProse(e.target.value)}
              rows={12}
              placeholder="e.g. Mortgage applications are received by the intake team, who check completeness. Identity is verified against the bureau before any credit decision…"
              className="text-xs"
            />
          ) : null}

          {run.isPending ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-xs text-primary">
              <Loader2 className="size-4 animate-spin" />
              {drafting
                ? "Drafting the document…"
                : "Restructuring the document and re-checking it…"}
            </div>
          ) : null}

          {run.isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red/30 bg-red/5 px-3 py-2.5 text-xs text-red">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <div>
                <p className="font-medium">The AI could not complete this.</p>
                <p className="mt-0.5 text-muted-foreground">{errorMessage(run.error)}</p>
              </div>
            </div>
          ) : null}

          {result ? (
            <>
              <div
                className={
                  result.valid
                    ? "flex items-center gap-2 text-xs text-emerald"
                    : "flex items-center gap-2 text-xs text-amber"
                }
              >
                {result.valid ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
                {result.valid
                  ? `The result matches the template (${result.attempts} attempt${result.attempts === 1 ? "" : "s"}).`
                  : "The result still has problems — review them below, or accept and fix by hand."}
              </div>
              {result.notes ? (
                <p className="text-xs text-muted-foreground">{result.notes}</p>
              ) : null}

              {result.placeholders.length ? (
                <div className="rounded-lg border border-amber/30 bg-amber/5 p-3">
                  <p className="text-xs font-medium text-amber">
                    {result.placeholders.length} value(s) left as TODO — fill these in before
                    relying on the document
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {result.placeholders.map((p) => (
                      <li
                        key={p}
                        className="rounded border border-amber/30 bg-background px-1.5 py-px font-mono text-[10px] text-amber"
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.changes.length ? (
                <div>
                  <p className="eyebrow mb-1.5">What changed</p>
                  <ul className="space-y-1">
                    {result.changes.slice(0, 80).map((c, i) => (
                      <li key={i} className="flex gap-2 text-[11px]">
                        {c.path ? (
                          <code className="shrink-0 rounded bg-background px-1 font-mono text-[10px]">
                            {c.path}
                          </code>
                        ) : null}
                        <span className="text-muted-foreground">{c.change}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!drafting && originalText !== undefined ? (
                <div>
                  <p className="eyebrow mb-1.5">Before → after</p>
                  <DiffView before={prettyJson(originalText)} after={after} />
                </div>
              ) : (
                <div>
                  <p className="eyebrow mb-1.5">Result</p>
                  <pre className="custom-scrollbar max-h-72 overflow-auto rounded-lg border border-border bg-background-elevated p-2 font-mono text-[10px]">
                    {after}
                  </pre>
                </div>
              )}

              <div>
                <p className="eyebrow mb-1.5">Validation of the result</p>
                <ReportView report={result.report} max={20} />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {result?.document ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadJson(result.document, "process_document_ai.json")}
              >
                <Download className="size-3.5" /> Download result
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {drafting && !result ? (
              <Button
                size="sm"
                disabled={prose.trim().length < 20 || run.isPending}
                onClick={() => run.mutate()}
              >
                <Sparkles className="size-3.5" /> Draft
              </Button>
            ) : null}
            {result && !run.isPending && source?.mode === "fix" ? (
              <Button size="sm" variant="outline" onClick={() => run.mutate()}>
                Try again
              </Button>
            ) : null}
            {result?.document ? (
              <Button
                size="sm"
                disabled={accepting}
                onClick={() => onAccept(result.document!, result)}
              >
                {accepting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <LivePercent />
                  </>
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Accept and save
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
