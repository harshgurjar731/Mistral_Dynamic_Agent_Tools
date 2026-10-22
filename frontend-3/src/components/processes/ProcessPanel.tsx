/**
 * The right-hand panel of the Processes page for a process or subprocess: its
 * active document, every version with its status, and what was built with it.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Cpu,
  Download,
  Edit2,
  GitBranch,
  GitCompare,
  Network,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Wrench,
} from "lucide-react";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessDocument, ProcessNode, UsageRow } from "@/api/processes";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  DiffView,
  DocumentStatusBadge,
  FileDrop,
  prettyJson,
  RefChip,
  StatsLine,
  TemplateDownloadMenu,
  TemplateLine,
} from "./shared";
import { useDocumentIngest } from "./useDocumentIngest";

interface PStage {
  id?: string;
  name?: string;
  purpose?: string;
  actor_type?: string;
  controls?: string[];
  decision?: { outcomes?: Array<{ label?: string }> };
}
interface PControl {
  id?: string;
  description?: string;
  mandatory?: boolean;
}
interface PRisk {
  id?: string;
  description?: string;
}
interface PException {
  id?: string;
  condition?: string;
  handling?: string;
}
/** The fields of the built-in template this view knows how to show. */
interface PContent {
  objective?: string;
  stages?: PStage[];
  controls?: PControl[];
  risks?: PRisk[];
  exceptions?: PException[];
}

const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

function DocumentSummary({ content: raw }: { content: Record<string, unknown> }) {
  const content = raw as PContent;
  const stages = arr(content.stages);
  const controls = arr(content.controls);
  const risks = arr(content.risks);
  const exceptions = arr(content.exceptions);
  return (
    <div className="space-y-4 text-xs">
      {content.objective ? (
        <p className="leading-relaxed text-foreground">{String(content.objective)}</p>
      ) : null}
      {stages.length ? (
        <div>
          <p className="eyebrow mb-1.5">Stages</p>
          <ol className="space-y-1.5">
            {stages.map((s, i) => (
              <li
                key={s.id ?? i}
                className="rounded-lg border border-border/60 bg-background px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="rounded bg-indigo/10 px-1.5 text-[10px] text-indigo">
                    {s.actor_type}
                  </span>
                  {arr(s.controls).length ? (
                    <span className="text-[10px] text-amber">
                      controls: {arr(s.controls).join(", ")}
                    </span>
                  ) : null}
                </div>
                {s.purpose ? <p className="mt-0.5 text-muted-foreground">{s.purpose}</p> : null}
                {s.decision?.outcomes?.length ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Outcomes: {s.decision.outcomes.map((o) => o.label).join(" / ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {controls.length ? (
        <div>
          <p className="eyebrow mb-1.5">Controls</p>
          <ul className="space-y-1">
            {controls.map((c, i) => (
              <li key={c.id ?? i} className="flex gap-2">
                <RefChip refId={`control:${c.id ?? i}`} label={c.id ?? String(i)} />
                <span className="text-muted-foreground">
                  {c.mandatory === true ? <span className="text-amber">Mandatory · </span> : null}
                  {c.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks.length || exceptions.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {risks.length ? (
            <div>
              <p className="eyebrow mb-1.5">Risks</p>
              <ul className="space-y-1 text-muted-foreground">
                {risks.map((r, i) => (
                  <li key={r.id ?? i}>• {r.description}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {exceptions.length ? (
            <div>
              <p className="eyebrow mb-1.5">Exceptions</p>
              <ul className="space-y-1 text-muted-foreground">
                {exceptions.map((x, i) => (
                  <li key={x.id ?? i}>
                    • {x.condition} → {x.handling}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UsageList({ rows }: { rows: UsageRow[] }) {
  const subjects = useMemo(() => {
    const map = new Map<string, { row: UsageRow; elements: UsageRow[] }>();
    for (const r of rows) {
      const key = `${r.subject_type}:${r.subject_id}`;
      const entry = map.get(key) ?? { row: r, elements: [] };
      if (!r.element.startsWith("document:")) entry.elements.push(r);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [rows]);
  if (!subjects.length) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Nothing has been built with this process yet. Turn on Process knowledge on the Orchestrator
        or the workflow planner.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {subjects.map(({ row, elements }) => (
        <li
          key={`${row.subject_type}:${row.subject_id}`}
          className="rounded-lg border border-border/60 p-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            {row.subject_type === "agent" ? (
              <Cpu className="size-3.5 text-emerald" />
            ) : (
              <GitBranch className="size-3.5 text-blue" />
            )}
            {row.subject_type === "agent" ? (
              <Link
                to="/agents/$id"
                params={{ id: row.subject_id }}
                className="font-medium text-foreground hover:text-primary"
              >
                {row.subject_name || row.subject_id}
              </Link>
            ) : (
              <Link
                to="/workflows/$workflowName"
                params={{ workflowName: row.subject_id }}
                className="font-medium text-foreground hover:text-primary"
              >
                {row.subject_name || row.subject_id}
              </Link>
            )}
            <span className="text-[10px] text-muted-foreground">
              v{row.document_version ?? "?"} ·{" "}
              {row.created_at ? formatRelative(row.created_at) : ""}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {elements.length} element{elements.length === 1 ? "" : "s"} used
            </span>
          </div>
          {elements.length ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                Where and how
              </summary>
              <ul className="mt-1.5 space-y-1">
                {elements.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-1.5 text-[11px]">
                    <RefChip refId={e.element} />
                    <span className="font-mono text-[10px] text-muted-foreground">{e.layer}</span>
                    <span className="min-w-0 flex-1 text-muted-foreground">{e.how}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ProcessPanel({
  node,
  onEdit,
  onDelete,
  onAddSubprocess,
}: {
  node: ProcessNode;
  onEdit: () => void;
  onDelete: () => void;
  onAddSubprocess: () => void;
}) {
  const qc = useQueryClient();
  const docs = node.documents ?? [];
  const active = docs.find((d) => d.is_active) ?? null;
  const ingest = useDocumentIngest({ conceptId: node.id });
  const [compare, setCompare] = useState<number | null>(null);

  const activeFull = useQuery({
    queryKey: QK.processDocument(active?.id ?? 0),
    queryFn: () => processesApi.document(active!.id),
    enabled: Boolean(active),
  });
  const compareFull = useQuery({
    queryKey: QK.processDocument(compare ?? 0),
    queryFn: () => processesApi.document(compare!),
    enabled: compare != null,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: QK.processes() });
  const activate = useMutation({
    mutationFn: (id: number) => processesApi.activate(id),
    onSuccess: (d) => {
      toast.success(`Version ${d.version} is now active.`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async (doc: ProcessDocument) => {
    if (!window.confirm(`Delete version ${doc.version} of "${doc.title}"?`)) return;
    try {
      await processesApi.deleteDocument(doc.id);
    } catch (e) {
      const msg = errorMessage(e);
      if (!/force/i.test(msg)) {
        toast.error(msg);
        return;
      }
      // Builds were recorded using it: say which, and ask once more.
      const users = msg.replace(/ Delete with force=true.*/, "");
      if (!window.confirm(`${users}\n\nDelete it and its usage history anyway?`)) return;
      try {
        await processesApi.deleteDocument(doc.id, true);
      } catch (e2) {
        toast.error(errorMessage(e2));
        return;
      }
    }
    toast.success("Deleted.");
    refresh();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-indigo">{node.level_name}</p>
          <h2 className="mt-0.5 text-lg font-semibold text-foreground">{node.label}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{node.path}</p>
          {node.definition ? (
            <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{node.definition}</p>
          ) : null}
          {node.synonyms.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {node.synonyms.map((s) => (
                <span
                  key={s}
                  className="rounded border border-border/60 px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/ontology" search={{ view: "graph", focus: node.id }}>
              <Network className="size-3.5" /> View in ontology
            </Link>
          </Button>
          {node.level_name === "process" ? (
            <Button size="sm" variant="outline" onClick={onAddSubprocess}>
              <Plus className="size-3.5" /> Subprocess
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Edit2 className="size-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red hover:text-red"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Upload */}
      <div
        className="rounded-2xl border border-border/60 p-4"
        style={{ background: "var(--surface)" }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              {active ? "Upload a new version" : "Upload the process document"}
            </p>
            <p className="mt-0.5">
              <TemplateLine template={node.template} />{" "}
              <Link
                to="/settings"
                search={{ category: "process", scope: node.id }}
                className="text-[11px] text-primary hover:underline"
                title="Templates are set per industry, domain, process and subprocess in Settings"
              >
                change
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <TemplateDownloadMenu conceptId={node.id} />
            <Button size="sm" variant="ghost" onClick={ingest.draft}>
              <Sparkles className="size-3.5" /> Draft from text with AI
            </Button>
          </div>
        </div>
        <FileDrop
          onFile={(f) => void ingest.upload(f)}
          busy={ingest.busy}
          compact={Boolean(active)}
          hint="Checked against the default template, and that it describes this process"
        />
      </div>

      <Tabs defaultValue="document">
        <TabsList>
          <TabsTrigger value="document">Document</TabsTrigger>
          <TabsTrigger value="versions">Versions ({docs.length})</TabsTrigger>
          <TabsTrigger value="usage">Used by</TabsTrigger>
          {node.children.length ? (
            <TabsTrigger value="subprocesses">Subprocesses ({node.children.length})</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="document" className="pt-3">
          {!active ? (
            <p className="rounded-xl border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              {docs.length
                ? "No valid version yet — fix one in Versions, or upload a corrected file."
                : "No document yet. Download the template, fill it in and upload it above."}
            </p>
          ) : (
            <div className="rounded-2xl border border-border/60 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald" />
                <span className="text-sm font-medium text-foreground">
                  {active.title} <span className="text-muted-foreground">v{active.version}</span>
                </span>
                <StatsLine stats={active.stats} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void processesApi.downloadDocument(active.id)}
                >
                  <Download className="size-3.5" /> JSON
                </Button>
              </div>
              {activeFull.data?.content ? (
                <DocumentSummary content={activeFull.data.content} />
              ) : (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="versions" className="space-y-3 pt-3">
          {docs.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs",
                    d.is_active ? "border-emerald/30 bg-emerald/5" : "border-border/60",
                  )}
                >
                  <span className="font-medium text-foreground">
                    {d.status === "invalid" ? "Draft" : `v${d.version}`}
                  </span>
                  <DocumentStatusBadge status={d.status} />
                  {d.is_active ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald">
                      <Star className="size-2.5" /> active
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    {d.source.replace("_", " ")} · {d.filename ?? ""} ·{" "}
                    {d.created_at ? formatRelative(d.created_at) : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {d.error_count ? `${d.error_count} errors` : ""}
                    {d.warning_count ? ` ${d.warning_count} warnings` : ""}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    {d.status !== "valid" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={() => void ingest.review(d)}
                      >
                        <Wrench className="size-3" /> Fix
                      </Button>
                    ) : null}
                    {d.status === "valid" && !d.is_active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => activate.mutate(d.id)}
                      >
                        Make active
                      </Button>
                    ) : null}
                    {active && d.id !== active.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setCompare(compare === d.id ? null : d.id)}
                      >
                        <GitCompare className="size-3" /> {compare === d.id ? "Hide" : "Compare"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => void processesApi.downloadDocument(d.id)}
                    >
                      <Download className="size-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-red hover:text-red"
                      onClick={() => void remove(d)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {compare != null && activeFull.data && compareFull.data ? (
            <div>
              <p className="eyebrow mb-1.5">
                v{compareFull.data.version} → active v{activeFull.data.version}
              </p>
              <DiffView
                before={prettyJson(compareFull.data.content ?? compareFull.data.raw)}
                after={prettyJson(activeFull.data.content ?? activeFull.data.raw)}
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="usage" className="pt-3">
          <UsageList rows={node.usage ?? []} />
        </TabsContent>

        <TabsContent value="subprocesses" className="pt-3">
          <ul className="space-y-1.5">
            {node.children.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-border/60 px-3 py-2 text-xs text-foreground"
              >
                {c.label}
                {c.definition ? (
                  <span className="text-muted-foreground"> — {c.definition}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {ingest.dialogs}
    </div>
  );
}
