/**
 * Settings → Process knowledge → Templates.
 *
 * The template every process document is checked against. Upload a JSON Schema,
 * or an example document to infer one from; making a template the default
 * re-checks every stored document, and any that no longer fit are marked stale
 * (never deleted) so they can be fixed.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Eye, FileJson, Loader2, Star, Trash2 } from "lucide-react";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessTemplate, TemplatePreview } from "@/api/processes";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { FileDrop, TemplateDownloadMenu } from "@/components/processes/shared";

function revalidatedText(r: Record<string, number> | null | undefined): string {
  if (!r) return "";
  const parts = [`${r["checked"] ?? 0} document(s) re-checked`];
  if (r["stale"]) parts.push(`${r["stale"]} no longer fit and are marked stale`);
  return parts.join("; ") + ".";
}

export function ProcessTemplatesPanel() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: QK.processTemplates(), queryFn: processesApi.templates });
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [viewing, setViewing] = useState<ProcessTemplate | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: QK.processes() });

  const read = useMutation({
    mutationFn: (file: File) => processesApi.previewTemplate(file),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const makeDefault = useMutation({
    mutationFn: (id: number) => processesApi.makeDefault(id),
    onSuccess: (t) => {
      toast.success(`“${t.name}” v${t.version} is now the default.`, {
        description: revalidatedText(t.revalidated),
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => processesApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success("Template deleted.");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const view = useMutation({
    mutationFn: (id: number) => processesApi.template(id),
    onSuccess: setViewing,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section
      id="section-backend-process_templates"
      className="rounded-2xl border border-border/60 p-5"
      style={{ background: "var(--surface)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileJson className="size-4 text-primary" /> Process document templates
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            The exact format a process document must follow — checked on the Processes page and on
            both orchestration pages. Upload a JSON Schema, or an example document and a schema is
            inferred from it.
          </p>
        </div>
        <TemplateDownloadMenu label="Download default" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <ul className="space-y-2">
              {(list.data ?? []).map((t) => (
                <li
                  key={t.id ?? t.name}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs",
                    t.is_default ? "border-primary/30 bg-primary/5" : "border-border/60",
                  )}
                >
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="text-muted-foreground">v{t.version}</span>
                  {t.is_default ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      <Star className="size-2.5" /> Default
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    {t.builtin
                      ? "built-in"
                      : t.kind === "inferred"
                        ? "inferred from an example"
                        : "JSON Schema"}
                    {t.created_at ? ` · ${formatRelative(t.created_at)}` : ""}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => t.id && view.mutate(t.id)}
                    >
                      <Eye className="size-3" /> Schema
                    </Button>
                    {t.id ? (
                      <TemplateDownloadMenu
                        templateId={t.id}
                        label=""
                        variant="ghost"
                        className="h-7 px-2"
                      />
                    ) : null}
                    {!t.is_default && t.id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={makeDefault.isPending}
                        onClick={() =>
                          window.confirm(
                            `Make “${t.name}” v${t.version} the default? Every stored process document is re-checked against it; any that no longer fit are marked stale until fixed.`,
                          ) && makeDefault.mutate(t.id!)
                        }
                      >
                        Make default
                      </Button>
                    ) : null}
                    {!t.builtin && !t.is_default && t.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-red hover:text-red"
                        onClick={() =>
                          window.confirm(`Delete “${t.name}” v${t.version}?`) &&
                          remove.mutate(t.id!)
                        }
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <FileDrop
            onFile={(f) => read.mutate(f)}
            busy={read.isPending}
            label="Upload a template"
            hint="A JSON Schema, or an example document"
          />
        </div>
      </div>

      <SaveTemplateDialog preview={preview} onClose={() => setPreview(null)} onSaved={refresh} />

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {viewing?.name} v{viewing?.version}
            </DialogTitle>
            <DialogDescription className="text-xs">{viewing?.description}</DialogDescription>
          </DialogHeader>
          <pre className="custom-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background-elevated p-3 font-mono text-[10px]">
            {JSON.stringify(viewing?.schema ?? {}, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SaveTemplateDialog({
  preview,
  onClose,
  onSaved,
}: {
  preview: TemplatePreview | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [lastKey, setLastKey] = useState<TemplatePreview | null>(null);
  if (preview !== lastKey) {
    setLastKey(preview);
    setName(preview?.suggested_name ?? "");
    setDescription("");
    setMakeDefault(false);
  }

  const save = useMutation({
    mutationFn: () =>
      processesApi.createTemplate({
        name: name.trim(),
        schema: preview!.schema,
        example: preview!.example ?? undefined,
        kind: preview!.kind,
        description,
        make_default: makeDefault,
      }),
    onSuccess: (t) => {
      toast.success(`Saved “${t.name}” v${t.version}.`, {
        description: makeDefault ? revalidatedText(t.revalidated) : undefined,
      });
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const problems = preview?.problems ?? [];
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Save template</DialogTitle>
          <DialogDescription className="text-xs">
            {preview?.kind === "inferred"
              ? "This was an example document, so a schema was inferred from it: every field it contains becomes required, with the type it had. Check it says what you mean."
              : "Read as a JSON Schema and used exactly as uploaded."}
          </DialogDescription>
        </DialogHeader>
        <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {problems.length ? (
            <div className="rounded-lg border border-red/30 bg-red/5 p-3 text-xs text-red">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" /> This cannot be used as a template
              </p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name" className="text-xs">
              Name
            </Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">
              Saving under an existing name adds a new version of it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="tpl-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(e) => setMakeDefault(e.target.checked)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              Make it the default.{" "}
              <span className="text-muted-foreground">
                Every stored document is re-checked; any that no longer fit are marked stale and
                stop being used until fixed.
              </span>
            </span>
          </label>
          <div>
            <p className="eyebrow mb-1.5">Schema</p>
            <pre className="custom-scrollbar max-h-64 overflow-auto rounded-lg border border-border bg-background-elevated p-2 font-mono text-[10px]">
              {JSON.stringify(preview?.schema ?? {}, null, 2)}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || problems.length > 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
