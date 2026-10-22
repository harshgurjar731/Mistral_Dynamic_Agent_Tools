/**
 * What is wrong with a process document and how to fix it — the same dialog
 * at every place a document is uploaded. Offers the four ways out: fix it with
 * AI, re-upload a corrected file, download the template, or download the
 * report itself to work through offline.
 */
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Sparkles, Upload } from "lucide-react";
import type { ValidationIssue, ValidationReport } from "@/api/processes";
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
import { cn } from "@/lib/utils";
import { StatsLine, TemplateDownloadMenu } from "./shared";

export function IssueRow({ issue }: { issue: ValidationIssue }) {
  const error = issue.severity === "error";
  return (
    <li
      className={cn(
        "rounded-lg border p-2.5 text-xs",
        error ? "border-red/25 bg-red/5" : "border-amber/25 bg-amber/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {error ? (
          <AlertTriangle className="size-3.5 shrink-0 text-red" />
        ) : (
          <Info className="size-3.5 shrink-0 text-amber" />
        )}
        <code className="rounded bg-background px-1.5 py-px font-mono text-[10px] text-foreground">
          {issue.path}
        </code>
        <span className="font-mono text-[10px] text-muted-foreground">{issue.code}</span>
      </div>
      <p className="mt-1.5 text-foreground">{issue.message}</p>
      {issue.expected || issue.found ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {issue.expected ? (
            <>
              <dt className="text-muted-foreground">Expected</dt>
              <dd className="font-mono break-all text-emerald">{issue.expected}</dd>
            </>
          ) : null}
          {issue.found ? (
            <>
              <dt className="text-muted-foreground">Found</dt>
              <dd className="font-mono break-all text-red">{issue.found}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {issue.fix ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">How to fix: </span>
          {issue.fix}
        </p>
      ) : null}
    </li>
  );
}

export function ReportView({ report, max = 60 }: { report: ValidationReport; max?: number }) {
  const [showAll, setShowAll] = useState(false);
  const issues = [...report.errors, ...report.warnings];
  const shown = showAll ? issues : issues.slice(0, max);
  return (
    <div>
      <div
        className={cn(
          "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
          report.valid
            ? "border-emerald/30 bg-emerald/5 text-emerald"
            : "border-red/30 bg-red/5 text-red",
        )}
      >
        {report.valid ? (
          <CheckCircle2 className="mt-px size-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-px size-4 shrink-0" />
        )}
        <div>
          <p className="font-medium">{report.summary}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Checked against{" "}
            <span className="text-foreground">{report.template?.name ?? "the template"}</span> v
            {report.template?.version ?? 1}
            {report.template?.scope_path ? (
              <>
                {" — "}
                {report.template.inherited ? "inherited from " : "set for "}
                {report.template.scope_path}
              </>
            ) : null}
            {report.stats ? " · " : ""}
            <StatsLine stats={report.stats} />
          </p>
          {report.classification ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {report.classification.concept_id ? (
                <>
                  Classified as{" "}
                  <span className="text-foreground">{report.classification.path}</span> —{" "}
                  {report.classification.detail}.
                </>
              ) : (
                <>
                  Not classified ({report.classification.detail}), so the global template applied.
                </>
              )}
            </p>
          ) : null}
        </div>
      </div>
      {issues.length ? (
        <ul className="custom-scrollbar max-h-[46vh] space-y-2 overflow-y-auto pr-1">
          {shown.map((issue, i) => (
            <IssueRow key={`${issue.path}-${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      ) : null}
      {issues.length > shown.length ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          Show all {issues.length} issues
        </button>
      ) : null}
    </div>
  );
}

export function ValidationReportDialog({
  open,
  onOpenChange,
  report,
  fileName,
  onFixWithAi,
  onReupload,
  busy,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ValidationReport | null;
  fileName?: string | undefined;
  onFixWithAi?: (() => void) | undefined;
  onReupload?: ((file: File) => void) | undefined;
  busy?: boolean | undefined;
  title?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (!report) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {title ??
              (report.valid
                ? "The document matches the template"
                : "The document does not match the template")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {fileName ? <span className="font-mono">{fileName}</span> : null}
            {fileName ? " — " : ""}
            {report.valid
              ? "It can be used. Warnings are worth a look but do not stop it."
              : "It is kept, but nothing will use it until every error is fixed."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ReportView report={report} />
        </div>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <TemplateDownloadMenu
              {...(report.template?.id
                ? { templateId: report.template.id }
                : { conceptId: report.template?.concept_id ?? null })}
              label="Template"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadJson(
                  report,
                  `${(fileName ?? "process").replace(/\.json$/i, "")}_report.json`,
                )
              }
            >
              <Download className="size-3.5" /> Report
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {onReupload ? (
              <>
                <input
                  ref={input}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onReupload(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Upload className="size-3.5" /> Re-upload
                </Button>
              </>
            ) : null}
            {onFixWithAi && !report.valid ? (
              <Button size="sm" disabled={busy} onClick={onFixWithAi}>
                <Sparkles className="size-3.5" /> Fix with AI
              </Button>
            ) : null}
            {report.valid ? (
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
