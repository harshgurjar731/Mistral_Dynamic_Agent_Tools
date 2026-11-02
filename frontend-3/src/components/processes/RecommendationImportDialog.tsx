/**
 * Import a transformation-recommendation file. Each recommendation becomes a
 * process document filed on its L3 node (created under the chosen domain when
 * missing). Preview first: it shows, per recommendation, which attributes a
 * build needs to choose an agent type and the file does not say.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileJson, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, recommendationsApi } from "@/api";
import type { ImportedRecommendation, ImportReport } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function RecommendationImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [domainId, setDomainId] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [saved, setSaved] = useState(false);

  const run = useMutation({
    mutationFn: (save: boolean) =>
      recommendationsApi.import({ file: file!, save, ...(domainId.trim() ? { domain_id: domainId.trim() } : {}) }),
    onSuccess: (r, save) => {
      setReport(r);
      setSaved(save);
      if (save) {
        toast.success(r.summary);
        void qc.invalidateQueries({ queryKey: QK.processes() });
        void qc.invalidateQueries({ queryKey: QK.ontology() });
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const close = (next: boolean) => {
    if (!next) {
      setFile(null);
      setReport(null);
      setSaved(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import recommendations</DialogTitle>
          <DialogDescription>
            A recommendation export (a list with “L0 Process”…“L3 Process”, or the structured format). Each one
            becomes a process document under its L3 process, which builds then use to choose agent types,
            integrations and human oversight.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <input ref={input} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
              e.target.value = "";
            }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <FileJson className="size-4" /> {file ? file.name : "Choose a JSON file"}
            </Button>
            <Input value={domainId} onChange={(e) => setDomainId(e.target.value)} className="h-9 max-w-xs text-xs"
              placeholder="Domain id (blank: matched from L0)" />
          </div>
        </div>

        {report ? <ReportView report={report} saved={saved} /> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>Close</Button>
          <Button variant="secondary" disabled={!file || run.isPending} onClick={() => run.mutate(false)}>
            {run.isPending && !saved ? <Loader2 className="size-4 animate-spin" /> : null} Preview
          </Button>
          <Button disabled={!file || run.isPending || saved} onClick={() => run.mutate(true)}>
            {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportView({ report, saved }: { report: ImportReport; saved: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">
        {saved ? "Imported" : "Preview"} — {report.summary}{" "}
        <span className="text-xs font-normal text-muted-foreground">({report.shape} format)</span>
      </p>
      {report.needs_domain.length ? (
        <p className="rounded-lg border border-amber/40 bg-amber/5 p-2 text-xs text-amber">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {report.needs_domain.length} recommendation(s) matched no domain
          {report.needs_domain[0]?.candidates?.length
            ? ` (closest: ${report.needs_domain[0].candidates.map((c) => c.concept_id).join(", ")})`
            : ""}
          . Enter a domain id and run again.
        </p>
      ) : null}
      {report.errors.map((e, i) => (
        <p key={i} className="text-xs text-destructive">{e.recommendation_id}: {e.error}</p>
      ))}
      <ul className="space-y-2">
        {[...report.imported, ...report.needs_domain].map((r, i) => (
          <RecommendationRow key={`${r.recommendation_id}-${i}`} rec={r} />
        ))}
      </ul>
    </div>
  );
}

function RecommendationRow({ rec }: { rec: ImportedRecommendation }) {
  const valid = rec.status === "valid";
  return (
    <li className="rounded-lg border border-border/60 p-2.5 text-xs">
      <p className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
        {valid ? <CheckCircle2 className="size-3.5 text-success" /> : <AlertTriangle className="size-3.5 text-amber" />}
        {rec.recommendation_id} · {rec.title}
        <span className="font-normal text-muted-foreground">→ {(rec.path ?? [rec.l3]).join(" › ")}</span>
      </p>
      {rec.missing.length ? (
        <p className="mt-1 text-muted-foreground">
          <span className="text-amber">Missing for agent-type mapping:</span>{" "}
          {rec.missing.map((m) => (
            <span key={m.path} title={m.why} className="mr-1 rounded border border-border/60 px-1 font-mono text-[10px]">
              {m.path}
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-1 text-success">Everything a build needs to choose an agent type is stated.</p>
      )}
      {rec.inferred.length ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">Inferred: {rec.inferred.join(", ")}</p>
      ) : null}
      {(rec.issues ?? []).filter((i) => i.severity === "warning").slice(0, 3).map((i, n) => (
        <p key={n} className="mt-0.5 text-[10px] text-amber">{i.message}</p>
      ))}
    </li>
  );
}
