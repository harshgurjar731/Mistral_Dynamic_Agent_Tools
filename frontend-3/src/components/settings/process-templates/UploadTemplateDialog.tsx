/**
 * Give a node a template, in two steps: choose a file, then check what it will
 * enforce and save. A JSON Schema is used as is; an example document has a
 * schema inferred from it, which the review step says in plain words.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { errorMessage, processesApi } from "@/api";
import type { TemplatePreview } from "@/api/processes";
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
import { Label } from "@/components/ui/label";
import { FileDrop, TemplateDownloadMenu } from "@/components/processes/shared";
import { cn } from "@/lib/utils";

/** The top-level fields a schema requires, for the plain-words summary. */
function requiredFields(schema: Record<string, unknown>): string[] {
  const req = schema["required"];
  return Array.isArray(req) ? req.map(String) : [];
}

export function UploadTemplateDialog({
  open,
  onOpenChange,
  scopeId,
  scopeLabel,
  replacing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeId: string | null;
  scopeLabel: string;
  /** Saving a new version of the template this node already has. */
  replacing?: string | undefined;
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [name, setName] = useState("");
  const [showSchema, setShowSchema] = useState(false);

  useEffect(() => {
    if (open) return;
    setPreview(null);
    setName("");
    setShowSchema(false);
  }, [open]);

  const read = useMutation({
    mutationFn: (file: File) => processesApi.previewTemplate(file),
    onSuccess: (p) => {
      setPreview(p);
      setName(replacing ?? p.suggested_name);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: () =>
      processesApi.createTemplate({
        name: name.trim(),
        schema: preview!.schema,
        example: preview!.example ?? undefined,
        kind: preview!.kind,
        make_default: true,
        concept_id: scopeId,
      }),
    onSuccess: (t) => {
      const stale = t.revalidated?.["stale"] ?? 0;
      toast.success(`${scopeLabel} now uses “${t.name}” v${t.version}.`, {
        description: stale
          ? `${stale} existing document(s) no longer fit and are marked stale until fixed.`
          : "Every existing document still fits.",
      });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const problems = preview?.problems ?? [];
  const required = preview ? requiredFields(preview.schema) : [];
  const step = preview ? 2 : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {replacing ? "Upload a new version" : "Give it its own template"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            For <span className="text-foreground">{scopeLabel}</span>
            {scopeId ? " and everything under it that has no template of its own." : "."}
          </DialogDescription>
        </DialogHeader>

        {/* Steps */}
        <ol className="flex items-center gap-2 text-[11px]">
          {["Choose a file", "Review and save"].map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[10px] font-semibold",
                  step > i + 1
                    ? "border-emerald/40 bg-emerald/15 text-emerald"
                    : step === i + 1
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground",
                )}
              >
                {step > i + 1 ? <CheckCircle2 className="size-3" /> : i + 1}
              </span>
              <span className={step === i + 1 ? "text-foreground" : "text-muted-foreground"}>
                {label}
              </span>
              {i === 0 ? <span className="h-px w-8 bg-border" /> : null}
            </li>
          ))}
        </ol>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {step === 1 ? (
            <>
              <FileDrop
                onFile={(f) => read.mutate(f)}
                busy={read.isPending}
                label="Drop a template file, or click to choose"
                hint="A JSON Schema — or an example document, and the format is worked out from it"
              />
              <div className="flex items-center justify-between gap-2 rounded-lg bg-background-elevated/60 px-3 py-2 text-[11px] text-muted-foreground">
                <span>Start from the template that applies now:</span>
                <TemplateDownloadMenu conceptId={scopeId} label="Download it" variant="ghost" />
              </div>
            </>
          ) : (
            <>
              {problems.length ? (
                <div className="rounded-lg border border-red/30 bg-red/5 p-3 text-xs text-red">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5" /> This file cannot be used as a template
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-emerald">
                    <CheckCircle2 className="size-3.5" />
                    {preview!.kind === "inferred"
                      ? "Read as an example document"
                      : "Read as a JSON Schema"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {preview!.kind === "inferred"
                      ? "Every field in your example becomes required, with the type it had."
                      : "It will be used exactly as uploaded."}{" "}
                    Documents must contain{" "}
                    {required.length ? (
                      <span className="text-foreground">{required.join(", ")}</span>
                    ) : (
                      "the fields it describes"
                    )}
                    .
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name" className="text-xs">
                  Template name
                </Label>
                <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button
                type="button"
                onClick={() => setShowSchema((v) => !v)}
                className="text-[11px] text-primary hover:underline"
              >
                {showSchema ? "Hide" : "Show"} the full schema
              </button>
              {showSchema ? (
                <pre className="custom-scrollbar max-h-56 overflow-auto rounded-lg border border-border bg-background-elevated p-2 font-mono text-[10px]">
                  {JSON.stringify(preview!.schema, null, 2)}
                </pre>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                Saving makes it active straight away. Existing documents are re-checked — any that
                no longer fit are marked stale, never deleted.
              </p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 2 ? (
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
              Choose another file
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {step === 2 ? (
            <Button
              size="sm"
              disabled={!name.trim() || problems.length > 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save and use it
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
