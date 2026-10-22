/**
 * Settings → Process knowledge → Templates, one per node of the classification.
 *
 * Every industry, domain, subdomain, process and subprocess can have its own
 * template. A document is checked against the nearest one above it —
 *
 *     subprocess › process › subdomain › domain › industry › global default
 *
 * — so setting a template on an industry covers all of its processes until one
 * of them sets its own. Any change re-checks the stored documents; those that
 * no longer fit are marked stale (never deleted) until fixed.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownToLine,
  Eye,
  FileJson,
  Globe,
  Layers,
  Loader2,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
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
import { ProcessCascadePicker } from "@/components/processes/ProcessCascadePicker";
import { FileDrop, TemplateDownloadMenu } from "@/components/processes/shared";

function revalidatedText(r: Record<string, number> | null | undefined): string {
  if (!r) return "";
  const parts = [`${r["checked"] ?? 0} document(s) re-checked`];
  if (r["stale"]) parts.push(`${r["stale"]} no longer fit and are marked stale`);
  return parts.join("; ") + ".";
}

export function ProcessTemplatesPanel({ initialScope }: { initialScope?: string | undefined }) {
  const qc = useQueryClient();
  /** The node being configured; null: the global default. */
  const [scope, setScope] = useState<string | null>(initialScope ?? null);
  const [pickerKey, setPickerKey] = useState(0);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [viewing, setViewing] = useState<ProcessTemplate | null>(null);

  const tree = useQuery({ queryKey: QK.processTree(), queryFn: processesApi.tree });
  const effective = useQuery({
    queryKey: QK.processTemplate(`for:${scope ?? "global"}`),
    queryFn: () => processesApi.templateFor(scope),
  });
  const scopes = useQuery({
    queryKey: QK.processTemplateScopes(),
    queryFn: processesApi.templateScopes,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: QK.processes() });
  const choose = (id: string | null) => {
    setScope(id);
    setPickerKey((k) => k + 1);
  };

  const read = useMutation({
    mutationFn: (file: File) => processesApi.previewTemplate(file),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const activate = useMutation({
    mutationFn: (id: number) => processesApi.makeDefault(id),
    onSuccess: (t) => {
      toast.success(`“${t.name}” v${t.version} is now active for ${t.scope_path}.`, {
        description: revalidatedText(t.revalidated),
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const clear = useMutation({
    mutationFn: (id: string) => processesApi.clearTemplateScope(id),
    onSuccess: (r) => {
      toast.success(`Now inherits ${r.now.name} v${r.now.version} from ${r.now.scope_path}.`, {
        description: revalidatedText(r.revalidated),
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => processesApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success("Template version deleted.");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const view = useMutation({
    mutationFn: (id: number) => processesApi.template(id),
    onSuccess: setViewing,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const t = effective.data;
  const own = t?.own_versions ?? [];
  const overriding = own.some((v) => v.is_default);

  return (
    <section
      id="section-backend-process_templates"
      className="rounded-2xl border border-border/60 p-5"
      style={{ background: "var(--surface)" }}
    >
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileJson className="size-4 text-primary" /> Process document templates
        </h3>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Set the exact format process documents must follow for each industry, domain, subdomain,
          process or subprocess. A document is checked against the nearest template above it —
          subprocess › process › subdomain › domain › industry › global default — on the Processes
          page, and on the orchestration pages against the template of where the upload is
          classified.
        </p>
      </div>

      {/* ── Scope ── */}
      <div className="mt-4 rounded-xl border border-border/60 p-3">
        <p className="eyebrow mb-2">Configure the template for</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={scope === null ? "secondary" : "outline"}
            onClick={() => choose(null)}
          >
            <Globe className="size-3.5" /> All industries (global)
          </Button>
          <span className="text-[11px] text-muted-foreground">or</span>
          <ProcessCascadePicker
            key={pickerKey}
            tree={tree.data}
            value={scope ?? ""}
            onChange={(id) => setScope(id || null)}
            anyLevel
            showDocuments={false}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* ── In effect here ── */}
          {effective.isError ? (
            <ErrorState error={effective.error} onRetry={() => effective.refetch()} />
          ) : !t ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <div
              className={cn(
                "rounded-xl border p-4",
                t.inherited ? "border-border/60" : "border-primary/30 bg-primary/5",
              )}
            >
              <p className="eyebrow">{t.applies_to_path}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {t.name} <span className="font-normal text-muted-foreground">v{t.version}</span>
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    t.inherited
                      ? "bg-background-elevated text-muted-foreground"
                      : "bg-primary/15 text-primary",
                  )}
                >
                  {t.inherited ? (
                    <>
                      <ArrowDownToLine className="size-2.5" /> Inherited from {t.scope_path}
                    </>
                  ) : (
                    <>
                      <Star className="size-2.5" /> Set here
                    </>
                  )}
                </span>
                <div className="ml-auto flex flex-wrap gap-1">
                  {t.id ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => view.mutate(t.id!)}
                    >
                      <Eye className="size-3" /> Schema
                    </Button>
                  ) : null}
                  <TemplateDownloadMenu
                    conceptId={scope}
                    label="Download"
                    variant="ghost"
                    className="h-7"
                  />
                  {scope && overriding ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={clear.isPending}
                      onClick={() =>
                        window.confirm(
                          `Stop using a template of its own for ${t.applies_to_path}? It will inherit the one above it again. Its versions are kept.`,
                        ) && clear.mutate(scope)
                      }
                    >
                      <Undo2 className="size-3" /> Inherit instead
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t.inherited
                  ? `No template is set for ${t.applies_to_path} itself, so documents here follow ${t.scope_path}'s. Upload one to give it its own.`
                  : t.description ||
                    "Documents here, and below it unless they set their own, follow this template."}
              </p>
            </div>
          )}

          {/* ── Versions set here ── */}
          <div>
            <p className="eyebrow mb-2">Versions set for this {scope ? "node" : "global scope"}</p>
            {own.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
                None yet — it inherits. Upload a template on the right to set one.
              </p>
            ) : (
              <ul className="space-y-2">
                {own.map((v) => (
                  <li
                    key={v.id ?? v.name}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs",
                      v.is_default ? "border-primary/30 bg-primary/5" : "border-border/60",
                    )}
                  >
                    <span className="font-medium text-foreground">{v.name}</span>
                    <span className="text-muted-foreground">v{v.version}</span>
                    {v.is_default ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <Star className="size-2.5" /> Active
                      </span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      {v.builtin
                        ? "built-in"
                        : v.kind === "inferred"
                          ? "inferred from an example"
                          : "JSON Schema"}
                      {v.created_at ? ` · ${formatRelative(v.created_at)}` : ""}
                    </span>
                    <div className="ml-auto flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => v.id && view.mutate(v.id)}
                      >
                        <Eye className="size-3" />
                      </Button>
                      {v.id ? (
                        <TemplateDownloadMenu
                          templateId={v.id}
                          label=""
                          variant="ghost"
                          className="h-7 px-2"
                        />
                      ) : null}
                      {!v.is_default && v.id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={activate.isPending}
                          onClick={() =>
                            window.confirm(
                              `Make “${v.name}” v${v.version} active for ${v.scope_path}? Documents that follow it are re-checked; any that no longer fit are marked stale until fixed.`,
                            ) && activate.mutate(v.id!)
                          }
                        >
                          Make active
                        </Button>
                      ) : null}
                      {!v.builtin && v.id && !(v.is_default && v.concept_id === null) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-red hover:text-red"
                          onClick={() =>
                            window.confirm(`Delete “${v.name}” v${v.version}?`) &&
                            remove.mutate(v.id!)
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

          {/* ── Everywhere ── */}
          <div>
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              <Layers className="size-3" /> Templates set across the classification
            </p>
            {scopes.data?.length ? (
              <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
                {scopes.data.map((row) => (
                  <li key={row.concept_id ?? "global"}>
                    <button
                      type="button"
                      onClick={() => choose(row.concept_id)}
                      className={cn(
                        "flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-surface-hover",
                        (row.concept_id ?? null) === scope && "bg-primary/5",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {row.scope_path}
                      </span>
                      <span className="text-muted-foreground">
                        {row.template.name} v{row.template.version}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {row.documents} document{row.documents === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <FileDrop
            onFile={(f) => read.mutate(f)}
            busy={read.isPending}
            label={`Upload a template for ${t?.applies_to_path ?? "this scope"}`}
            hint="A JSON Schema, or an example document"
          />
          <p className="text-[10px] text-muted-foreground">
            It applies here and to everything below that has no template of its own.
          </p>
        </div>
      </div>

      <SaveTemplateDialog
        preview={preview}
        scope={scope}
        scopePath={t?.applies_to_path ?? ""}
        onClose={() => setPreview(null)}
        onSaved={refresh}
      />

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {viewing?.name} v{viewing?.version}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {viewing?.scope_path}
              {viewing?.description ? ` — ${viewing.description}` : ""}
            </DialogDescription>
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
  scope,
  scopePath,
  onClose,
  onSaved,
}: {
  preview: TemplatePreview | null;
  scope: string | null;
  scopePath: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activate, setActivate] = useState(true);
  const [lastKey, setLastKey] = useState<TemplatePreview | null>(null);
  if (preview !== lastKey) {
    setLastKey(preview);
    setName(preview?.suggested_name ?? "");
    setDescription("");
    setActivate(true);
  }

  const save = useMutation({
    mutationFn: () =>
      processesApi.createTemplate({
        name: name.trim(),
        schema: preview!.schema,
        example: preview!.example ?? undefined,
        kind: preview!.kind,
        description,
        make_default: activate,
        concept_id: scope,
      }),
    onSuccess: (t) => {
      toast.success(`Saved “${t.name}” v${t.version} for ${t.scope_path}.`, {
        description: activate ? revalidatedText(t.revalidated) : "Not active yet.",
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
          <DialogTitle className="text-base">Save template for {scopePath}</DialogTitle>
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
              Saving under a name already used here adds a new version of it.
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
              checked={activate}
              onChange={(e) => setActivate(e.target.checked)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              Make it active for {scopePath}.{" "}
              <span className="text-muted-foreground">
                Documents that follow it are re-checked; any that no longer fit are marked stale and
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
