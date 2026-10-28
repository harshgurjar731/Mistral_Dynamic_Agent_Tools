/**
 * One node of the template map: what applies here, in one sentence, and the
 * one or two things you would do about it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight,
  ChevronRight,
  CornerLeftUp,
  Eye,
  FileText,
  History,
  Loader2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessTemplate } from "@/api/processes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplateDownloadMenu } from "@/components/processes/shared";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { inheritors, LEVEL_LABEL, type MapNode } from "./model";
import { UploadTemplateDialog } from "./UploadTemplateDialog";
import { LivePercent } from "@/components/activity/LiveProgress";

function staleNote(r: Record<string, number> | null | undefined): string {
  const stale = r?.["stale"] ?? 0;
  return stale
    ? `${stale} document(s) no longer fit and are marked stale until fixed.`
    : "Every existing document still fits.";
}

export function TemplateDetail({
  node,
  parent,
  onSelect,
}: {
  node: MapNode;
  /** The node above — what this one would inherit from. */
  parent: MapNode | null;
  onSelect: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<ProcessTemplate | null>(null);

  const detail = useQuery({
    queryKey: QK.processTemplate(`for:${node.id ?? "global"}`),
    queryFn: () => processesApi.templateFor(node.id),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: QK.processes() });

  const view = useMutation({
    mutationFn: (id: number) => processesApi.template(id),
    onSuccess: setViewing,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const inherit = useMutation({
    mutationFn: () => processesApi.clearTemplateScope(node.id!),
    onSuccess: (r) => {
      toast.success(`${node.label} now inherits ${r.now.name} v${r.now.version}.`, {
        description: staleNote(r.revalidated),
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const useVersion = useMutation({
    mutationFn: (id: number) => processesApi.makeDefault(id),
    onSuccess: (t) => {
      toast.success(`${node.label} now uses v${t.version}.`, {
        description: staleNote(t.revalidated),
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => processesApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success("Version deleted.");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const isGlobal = node.id === null;
  const own = node.own;
  const eff = node.effective;
  const earlier = (detail.data?.own_versions ?? []).filter((v) => !v.is_default);
  const below = inheritors(node);
  const active = detail.data && !detail.data.inherited ? detail.data : null;

  return (
    <div className="space-y-5">
      {/* ── Where ── */}
      <div>
        {node.path.length ? (
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {node.path.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {p}
                <ChevronRight className="size-3 opacity-50" />
              </span>
            ))}
          </p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">{node.label}</h3>
          <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {LEVEL_LABEL[node.level]}
          </span>
        </div>
      </div>

      {/* ── What applies, and what to do ── */}
      <div
        className={cn(
          "rounded-2xl border p-5",
          own ? "border-primary/30 bg-primary/5" : "border-border/60 bg-background-elevated/40",
        )}
      >
        {own || isGlobal ? (
          <>
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Star className="size-3.5" />
              {isGlobal
                ? "The default for everything without its own template"
                : "Uses its own template"}
            </p>
            <p className="mt-2 text-base font-semibold text-foreground">
              {eff?.name} <span className="font-normal text-muted-foreground">v{eff?.version}</span>
            </p>
            {active?.description ? (
              <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>
            ) : null}
            {active?.created_at ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {active.kind === "inferred" ? "Inferred from an example" : "JSON Schema"} · saved{" "}
                {formatRelative(active.created_at)}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setUploading(true)}>
                <Upload className="size-3.5" /> Upload a new version
              </Button>
              <TemplateDownloadMenu conceptId={node.id} label="Download" />
              {active?.id ? (
                <Button size="sm" variant="outline" onClick={() => view.mutate(active.id!)}>
                  <Eye className="size-3.5" /> View schema
                </Button>
              ) : null}
            </div>
            {own && !isGlobal ? (
              <button
                type="button"
                disabled={inherit.isPending}
                onClick={() =>
                  window.confirm(
                    `Stop using a template of its own for ${node.label}? It will follow ${
                      parent?.effective?.name ?? "the template above"
                    } from ${parent?.effective?.fromLabel ?? "above"} again. Its versions are kept.`,
                  ) && inherit.mutate()
                }
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {inherit.isPending ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <LivePercent />
                  </>
                ) : (
                  <CornerLeftUp className="size-3" />
                )}
                Stop using its own — inherit {parent?.effective?.name ?? "from above"}
                {parent?.effective ? ` from ${parent.effective.fromLabel}` : ""} instead
              </button>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">Inherits its template</p>
            <p className="mt-2 text-base font-semibold text-foreground">
              {eff?.name} <span className="font-normal text-muted-foreground">v{eff?.version}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Set on{" "}
              <button
                type="button"
                onClick={() => onSelect(eff?.fromId ?? null)}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                {eff?.fromLabel}
                <ArrowUpRight className="size-3" />
              </button>
              . Documents here must follow it until {node.label} has a template of its own.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setUploading(true)}>
                <Upload className="size-3.5" /> Give {node.label} its own template
              </Button>
              <TemplateDownloadMenu conceptId={node.id} label="Download current" />
            </div>
          </>
        )}
      </div>

      {/* ── Reach ── */}
      {own || isGlobal ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FileText className="size-3" /> Documents checked by it
            </p>
            <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
              {own?.documents ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CornerLeftUp className="size-3 rotate-180" /> Also used by, below
            </p>
            <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
              {below.length}
            </p>
            {below.length ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                {below
                  .slice(0, 6)
                  .map((b) => b.label)
                  .join(", ")}
                {below.length > 6 ? ` and ${below.length - 6} more` : ""}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Every node below sets its own.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Earlier versions ── */}
      {earlier.length ? (
        <details className="group rounded-xl border border-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground">
            <History className="size-3.5" />
            Earlier versions ({earlier.length})
            <ChevronRight className="ml-auto size-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="divide-y divide-border/50 border-t border-border/50">
            {earlier.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="text-foreground">
                  {v.name} <span className="text-muted-foreground">v{v.version}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {v.builtin ? "built-in" : v.created_at ? formatRelative(v.created_at) : ""}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => v.id && view.mutate(v.id)}
                  >
                    <Eye className="size-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={useVersion.isPending}
                    onClick={() =>
                      window.confirm(
                        `Use “${v.name}” v${v.version} for ${node.label} again? Documents are re-checked against it.`,
                      ) && useVersion.mutate(v.id!)
                    }
                  >
                    Use this version
                  </Button>
                  {!v.builtin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-red hover:text-red"
                      onClick={() =>
                        window.confirm(`Delete “${v.name}” v${v.version}?`) && remove.mutate(v.id!)
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <UploadTemplateDialog
        open={uploading}
        onOpenChange={setUploading}
        scopeId={node.id}
        scopeLabel={node.label}
        replacing={own || isGlobal ? eff?.name : undefined}
        onSaved={refresh}
      />

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {viewing?.name} v{viewing?.version}
            </DialogTitle>
            <DialogDescription className="text-xs">{viewing?.scope_path}</DialogDescription>
          </DialogHeader>
          <pre className="custom-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background-elevated p-3 font-mono text-[10px]">
            {JSON.stringify(viewing?.schema ?? {}, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
