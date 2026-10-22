import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, Building2, Edit2, Network, Plus, Trash2, Workflow } from "lucide-react";
import { processesApi, QK } from "@/api";
import type { ProcessLevel, TreeConcept, TreeProcess } from "@/api/processes";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { deleteNodeFlow, NodeFormDialog } from "@/components/processes/NodeFormDialog";
import { ProcessPanel } from "@/components/processes/ProcessPanel";
import { ProcessTreeNav, type AddRequest } from "@/components/processes/ProcessTreeNav";
import { DocumentStatusBadge, TemplateDownloadMenu } from "@/components/processes/shared";

const searchSchema = z.object({
  /** The node on screen, so a refresh or a shared link lands on it. */
  node: z.string().optional(),
});

export const Route = createFileRoute("/processes/$industryId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Processes — Agentic AI Design Patterns" },
      { name: "description", content: "One industry's domains, processes and process documents." },
      { property: "og:title", content: "Processes — Agentic AI Design Patterns" },
      { property: "og:description", content: "One industry's domains and processes." },
    ],
  }),
  component: IndustryPage,
});

const CHILD_LEVEL: Record<string, ProcessLevel | undefined> = {
  industry: "domain",
  domain: "subdomain",
  subdomain: undefined,
};

function IndustryPage() {
  const { industryId } = Route.useParams();
  const { node: selectedParam } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const selected = selectedParam ?? industryId;

  const tree = useQuery({ queryKey: QK.processTree(), queryFn: processesApi.tree });
  const node = useQuery({
    queryKey: QK.processNode(selected),
    queryFn: () => processesApi.node(selected),
  });

  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [editing, setEditing] = useState<TreeConcept | null>(null);

  const select = (id: string) =>
    void navigate({ search: { node: id === industryId ? undefined : id } });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QK.processes() });
    void qc.invalidateQueries({ queryKey: QK.ontology() });
  };

  if (tree.isError) {
    return (
      <div className="px-6 py-8">
        <ErrorState error={tree.error} onRetry={() => tree.refetch()} />
      </div>
    );
  }
  if (tree.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  const industry = tree.data?.domains.find((d) => d.id === industryId);
  if (!industry) {
    return (
      <div className="px-6 py-8">
        <ErrorState error="Industry not found" />
      </div>
    );
  }

  const current = node.data;
  const isProcess = current?.scheme_id === "process";
  const processesHere = (tree.data?.processes ?? []).filter(
    (p) => !p.parent_id && p.domain_id === current?.id,
  );

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Link
            to="/processes"
            aria-label="Back to processes"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-surface/30 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground">
              <Building2 className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {industry.label}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {industry.definition || "Industry"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TemplateDownloadMenu conceptId={selected} />
          <Button size="sm" variant="outline" asChild>
            <Link to="/ontology" search={{ view: "graph", focus: industryId }}>
              <Network className="size-3.5" /> View in ontology
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          className="custom-scrollbar h-fit max-h-[calc(100vh-12rem)] overflow-y-auto rounded-2xl border border-border/60 p-3 lg:sticky lg:top-6"
          style={{ background: "var(--surface)" }}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="eyebrow">Classification</p>
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald" /> document
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber" /> to fix
              </span>
            </span>
          </div>
          <ProcessTreeNav
            tree={tree.data}
            industryId={industryId}
            selected={selected}
            onSelect={select}
            onAdd={setAdding}
          />
        </aside>

        <section className="min-w-0">
          {node.isLoading ? (
            <DetailSkeleton />
          ) : node.isError || !current ? (
            <ErrorState error={node.error ?? "Not found"} onRetry={() => node.refetch()} />
          ) : isProcess ? (
            <ProcessPanel
              node={current}
              onEdit={() => setEditing(current)}
              onDelete={() =>
                void deleteNodeFlow(current, () => {
                  refresh();
                  select(industryId);
                })
              }
              onAddSubprocess={() => setAdding({ level: "subprocess", parent: current })}
            />
          ) : (
            <DomainPanel
              node={current}
              processes={processesHere}
              childLevel={CHILD_LEVEL[current.level_name ?? ""]}
              onSelect={select}
              onAdd={(level) => setAdding({ level, parent: current })}
              onEdit={() => setEditing(current)}
              onDelete={() =>
                void deleteNodeFlow(current, () => {
                  refresh();
                  if (current.id === industryId) void navigate({ to: "/processes" });
                  else select(industryId);
                })
              }
            />
          )}
        </section>
      </div>

      <NodeFormDialog
        open={Boolean(adding)}
        onOpenChange={(o) => !o && setAdding(null)}
        level={adding?.level ?? "domain"}
        parentId={adding?.parent.id}
        parentLabel={adding?.parent.label}
        onSaved={(n) => select(n.id)}
      />
      <NodeFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        level={(editing?.level_name as ProcessLevel) ?? "domain"}
        node={editing}
        onSaved={() => void node.refetch()}
      />
    </div>
  );
}

function DomainPanel({
  node,
  processes,
  childLevel,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
}: {
  node: TreeConcept & { path?: string; children?: TreeConcept[] };
  processes: TreeProcess[];
  childLevel: ProcessLevel | undefined;
  onSelect: (id: string) => void;
  onAdd: (level: ProcessLevel) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const level = node.level_name ?? "domain";
  const canHoldProcesses = level !== "industry";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-pink">{level}</p>
          <h2 className="mt-0.5 text-lg font-semibold text-foreground">{node.label}</h2>
          {node.path ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{node.path}</p>
          ) : null}
          {node.definition ? (
            <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{node.definition}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {childLevel ? (
            <Button size="sm" variant="outline" onClick={() => onAdd(childLevel)}>
              <Plus className="size-3.5" /> {childLevel === "domain" ? "Domain" : "Subdomain"}
            </Button>
          ) : null}
          {canHoldProcesses ? (
            <Button size="sm" onClick={() => onAdd("process")}>
              <Plus className="size-3.5" /> Process
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

      {node.children?.length ? (
        <div>
          <p className="eyebrow mb-2">{level === "industry" ? "Domains" : "Subdomains"}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {node.children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className="rounded-xl border border-border/60 p-3 text-left text-xs transition hover:border-primary/30 hover:bg-surface-hover"
              >
                <p className="font-medium text-foreground">{c.label}</p>
                {c.definition ? (
                  <p className="mt-0.5 line-clamp-2 text-muted-foreground">{c.definition}</p>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {canHoldProcesses ? (
        <div>
          <p className="eyebrow mb-2">Processes filed here</p>
          {processes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              No process in {node.label} yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {processes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="rounded-xl border border-border/60 p-3 text-left text-xs transition hover:border-indigo/30 hover:bg-surface-hover"
                >
                  <div className="flex items-center gap-1.5">
                    <Workflow className="size-3.5 text-indigo" />
                    <p className="min-w-0 flex-1 truncate font-medium text-foreground">{p.label}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.documents.active_id ? (
                      <DocumentStatusBadge status="valid" />
                    ) : p.documents.total ? (
                      <DocumentStatusBadge status={p.documents.stale ? "stale" : "invalid"} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">no document</span>
                    )}
                    {p.documents.active_version ? (
                      <span className="text-[10px] text-muted-foreground">
                        v{p.documents.active_version}
                      </span>
                    ) : null}
                    {p.usage.agents || p.usage.workflows ? (
                      <span className="text-[10px] text-cyan">
                        {p.usage.agents} agents · {p.usage.workflows} workflows
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Processes are filed under a domain or subdomain — pick one in the tree, or add a domain.
        </p>
      )}
    </div>
  );
}
