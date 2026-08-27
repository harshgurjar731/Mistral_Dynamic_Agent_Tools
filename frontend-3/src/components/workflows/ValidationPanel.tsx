import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ValidationIssue, ValidationResult } from "@/types";
import { cn } from "@/lib/utils";

export function ValidationSummary({
  result,
  pending,
  className,
}: {
  result: ValidationResult | undefined;
  pending?: boolean;
  className?: string;
}) {
  if (pending) {
    return <span className={cn("technical-label", className)}>Validating…</span>;
  }
  if (!result) return null;
  if (result.valid && result.warning_count === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-emerald/30 bg-emerald/10 px-2 py-1 font-mono text-[10px] font-bold text-emerald uppercase",
          className,
        )}
      >
        <CheckCircle2 className="size-3" /> Valid
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {result.error_count > 0 ? (
        <span className="inline-flex items-center gap-1 rounded border border-red/30 bg-red/10 px-2 py-1 font-mono text-[10px] font-bold text-red uppercase">
          <AlertTriangle className="size-3" /> {result.error_count} error
          {result.error_count === 1 ? "" : "s"}
        </span>
      ) : null}
      {result.warning_count > 0 ? (
        <span className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-2 py-1 font-mono text-[10px] font-bold text-amber uppercase">
          <Info className="size-3" /> {result.warning_count} warning
          {result.warning_count === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}

export function IssueList({
  issues,
  onSelectStep,
  emptyLabel = "No issues — the definition is structurally sound.",
}: {
  issues: ValidationIssue[];
  onSelectStep?: (stepId: string) => void;
  emptyLabel?: string;
}) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-emerald">
        <CheckCircle2 className="size-3.5" /> {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => {
        const isError = issue.severity === "error";
        return (
          <li
            key={`${issue.code}-${issue.step_id ?? ""}-${i}`}
            className={cn(
              "rounded-lg border px-3 py-2",
              isError ? "border-red/25 bg-red/5" : "border-amber/25 bg-amber/5",
            )}
          >
            <div className="flex items-start gap-2">
              {isError ? (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red" />
              ) : (
                <Info className="mt-0.5 size-3.5 shrink-0 text-amber" />
              )}
              <div className="min-w-0">
                <p className="text-xs text-foreground">{issue.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="technical-label">{issue.code}</span>
                  {issue.step_id ? (
                    onSelectStep ? (
                      <button
                        type="button"
                        onClick={() => onSelectStep(issue.step_id as string)}
                        className="font-mono text-[10px] text-primary hover:underline"
                      >
                        {issue.step_id}
                      </button>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {issue.step_id}
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
