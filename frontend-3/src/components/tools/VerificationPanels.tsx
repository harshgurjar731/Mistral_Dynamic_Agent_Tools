/**
 * Panels that show how a synthesized tool/activity was verified and versioned:
 * the test cases it passed, the output contract later workflow steps rely on,
 * and its version history with rollback.
 */
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toolsApi, QK, errorMessage } from "@/api";
import type { Tool, ToolCaseReport, ToolReport } from "@/types";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { cn } from "@/lib/utils";

const EXPECTATION_LABEL: Record<string, string> = {
  success: "must succeed",
  envelope: "must not crash",
  error: "must reject",
};

const ORIGIN_LABEL: Record<string, string> = {
  example: "worked example",
  llm: "realistic input",
  fixture: "API fixture",
  schema_full: "all parameters",
  required_only: "required only",
  boundary: "edge value",
  missing_required: "missing input",
};

function short(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function CaseRow({ c }: { c: ToolCaseReport }) {
  return (
    <li className="rounded-lg border border-border/50 bg-background-elevated/40 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        {c.ok ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-label="passed" />
        ) : (
          <XCircle className="size-3.5 shrink-0 text-red" aria-label="failed" />
        )}
        <span className="font-mono text-foreground">{c.case_id}</span>
        <span className="text-muted-foreground">
          {ORIGIN_LABEL[c.origin] ?? c.origin} · {EXPECTATION_LABEL[c.expectation] ?? c.expectation}
        </span>
      </div>
      {c.input !== undefined && (
        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
          in: {short(c.input)}
        </p>
      )}
      {c.expected != null && (
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          expected: {short(c.expected)}
        </p>
      )}
      {!c.ok && c.detail && <p className="mt-1 text-[11px] text-red">{short(c.detail, 300)}</p>}
    </li>
  );
}

/** Test cases, attempts, model and any worked examples the tool service corrected. */
export function VerificationReportPanel({ report }: { report: ToolReport }) {
  const cases = report.cases ?? [];
  const passed = cases.filter((c) => c.ok).length;
  const attempts = (report.attempts ?? []).filter((a) => a.mode !== "recheck");
  const corrections = report.corrected_examples ?? [];
  const warnings = (report.warnings ?? []).filter((w) => !w.includes(" corrected: "));
  const attemptText = attempts.length
    ? ` · ${attempts.length} attempt${attempts.length !== 1 ? "s" : ""}`
    : "";
  const modelText = report.model ? ` · ${report.model}` : "";

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Verification"
        description={
          cases.length
            ? `${passed}/${cases.length} test cases passed in the sandbox${attemptText}${modelText}`
            : report.history || "No verification report for this version."
        }
      />
      <div className="space-y-3 p-4">
        {report.weak_plan && (
          <p className="flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/8 p-2.5 text-xs text-amber">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            No input was known to be valid, so the tests only show the code does not crash.
          </p>
        )}
        {corrections.map((c) => (
          <p
            key={c.case_id}
            className="rounded-lg border border-blue/20 bg-blue/8 p-2.5 text-xs text-blue"
          >
            <span className="font-medium">{c.case_id} corrected</span>: the specification said{" "}
            <span className="font-mono">{short(c.was, 120)}</span>; an independent reference
            implementation and the generated code both compute{" "}
            <span className="font-mono">{short(c.now, 120)}</span>.
          </p>
        ))}
        {warnings.map((w) => (
          <p key={w} className="text-xs text-muted-foreground">
            ⚠ {w}
          </p>
        ))}
        {cases.length > 0 && (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto custom-scrollbar">
            {cases.map((c) => (
              <CaseRow key={c.case_id} c={c} />
            ))}
          </ul>
        )}
        {report.review?.reason && (
          <p className="text-xs text-muted-foreground">Approval: {report.review.reason}</p>
        )}
      </div>
    </GlassPanel>
  );
}

/** The output schema — the fields later workflow steps may reference. */
export function OutputContractPanel({ schema }: { schema: Record<string, unknown> }) {
  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Output Contract"
        description="Shape of `data` on success. Workflow steps may only reference these fields."
      />
      <div className="p-4">
        <CodeBlock code={JSON.stringify(schema, null, 2)} language="json" />
      </div>
    </GlassPanel>
  );
}

/** Every version of this tool, with rollback to any approved one. */
export function VersionHistoryPanel({
  tool,
  detailPath,
}: {
  tool: Tool;
  detailPath: "/tools/$id" | "/workflows/activities/$id";
}) {
  const qc = useQueryClient();
  const versionsQuery = useQuery({
    queryKey: QK.toolVersions(tool.name),
    queryFn: () => toolsApi.versions(tool.name),
  });

  const activate = useMutation({
    mutationFn: (id: number | string) => toolsApi.activate(id),
    onSuccess: (res) => {
      toast.success(res?.message ?? "Version activated.");
      qc.invalidateQueries({ queryKey: QK.tools() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const versions = Array.isArray(versionsQuery.data) ? versionsQuery.data : [];
  if (versionsQuery.isLoading || versions.length === 0) return null;

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Versions"
        description="Workflows pin the version they were planned with; the active version runs otherwise."
      />
      <ul className="divide-y divide-border/50">
        {versions.map((v) => {
          const current = String(v.id) === String(tool.id);
          return (
            <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <History className="size-3.5 shrink-0 text-muted-foreground" />
                {current ? (
                  <span className="font-mono font-semibold text-foreground">v{v.version_no}</span>
                ) : (
                  <Link
                    to={detailPath}
                    params={{ id: String(v.id) }}
                    className="font-mono text-primary hover:underline"
                  >
                    v{v.version_no}
                  </Link>
                )}
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5",
                    v.is_active
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                      : "border-border/60 bg-muted/30 text-muted-foreground",
                  )}
                >
                  {v.is_active ? "active" : v.status === "approved" ? "superseded" : v.status}
                </span>
                {v.created_at && (
                  <span className="truncate text-muted-foreground">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                )}
              </div>
              {v.status === "approved" && !v.is_active && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => activate.mutate(v.id)}
                  disabled={activate.isPending}
                >
                  {activate.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  Make active
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </GlassPanel>
  );
}
