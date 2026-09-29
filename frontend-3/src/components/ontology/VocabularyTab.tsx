import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, ChevronsUpDown, Plus, Trash2, Pencil, Search } from "lucide-react";
import { ontologyApi, QK, errorMessage } from "@/api";
import type { Concept, ConceptScheme } from "@/types";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { BulkActionBar, RowCheckbox } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection, type BulkSelection } from "@/lib/bulkSelection";

function asArray<T>(res: { [k: string]: T[] } | T[] | undefined, key: string): T[] {
  if (!res) return [];
  return Array.isArray(res) ? res : ((res as Record<string, T[]>)[key] ?? []);
}

export function VocabularyTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeScheme, setActiveScheme] = useState<string>("");
  const [conceptDialog, setConceptDialog] = useState<{ mode: "create" | "edit"; concept?: Concept | undefined; parentId?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "scheme" | "concept"; id: string } | null>(null);
  const [schemeDialog, setSchemeDialog] = useState<{ mode: "create" | "edit"; scheme?: ConceptScheme } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const schemesQ = useQuery({
    queryKey: QK.ontologySchemes(),
    queryFn: () => ontologyApi.schemes(),
  });
  const schemes = asArray<ConceptScheme>(schemesQ.data, "schemes");

  const conceptsQ = useQuery({
    queryKey: QK.ontologyConcepts(activeScheme),
    queryFn: () => ontologyApi.concepts(activeScheme || undefined),
  });
  const concepts = asArray<Concept>(conceptsQ.data, "concepts");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return concepts;
    return concepts.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.synonyms?.some((s) => s.toLowerCase().includes(q)),
    );
  }, [concepts, search]);

  const usageQ = useQuery({
    queryKey: QK.ontologyUsage(deleteTarget?.id ?? ""),
    queryFn: () => ontologyApi.usage(deleteTarget!.id),
    enabled: !!deleteTarget && deleteTarget.kind === "concept",
  });

  const createScheme = useMutation({
    mutationFn: (body: { id: string; label: string; description?: string }) => ontologyApi.createScheme(body),
    onSuccess: () => {
      toast.success("Scheme created.");
      setSchemeDialog(null);
      qc.invalidateQueries({ queryKey: QK.ontologySchemes() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const updateScheme = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { label?: string; description?: string } }) =>
      ontologyApi.updateScheme(id, body),
    onSuccess: () => {
      toast.success("Scheme updated.");
      setSchemeDialog(null);
      qc.invalidateQueries({ queryKey: QK.ontologySchemes() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deleteScheme = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) => ontologyApi.deleteScheme(id, cascade),
    onSuccess: () => {
      toast.success("Scheme deleted.");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: QK.ontologySchemes() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const createConcept = useMutation({
    mutationFn: (body: Parameters<typeof ontologyApi.createConcept>[0]) => ontologyApi.createConcept(body),
    onSuccess: () => {
      toast.success("Concept created.");
      setConceptDialog(null);
      qc.invalidateQueries({ queryKey: QK.ontologyConcepts(activeScheme) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const updateConcept = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof ontologyApi.updateConcept>[1] }) =>
      ontologyApi.updateConcept(id, body),
    onSuccess: () => {
      toast.success("Concept updated.");
      setConceptDialog(null);
      qc.invalidateQueries({ queryKey: QK.ontologyConcepts(activeScheme) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deleteConcept = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) => ontologyApi.deleteConcept(id, cascade),
    onSuccess: () => {
      toast.success("Concept deleted.");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: QK.ontologyConcepts(activeScheme) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const conceptCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of concepts) m.set(c.scheme_id, (m.get(c.scheme_id) ?? 0) + 1);
    return m;
  }, [concepts]);

  /** Concepts per scheme, in scheme order; anything unscoped goes last. */
  const groups = useMemo(() => {
    const order = new Map(schemes.map((sc, i) => [sc.id, i]));
    const byScheme = new Map<string, Concept[]>();
    for (const c of filtered) byScheme.set(c.scheme_id, [...(byScheme.get(c.scheme_id) ?? []), c]);
    return [...byScheme.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 1e6) - (order.get(b[0]) ?? 1e6))
      .map(([id, items]) => ({
        id,
        label: schemes.find((sc) => sc.id === id)?.label ?? id,
        items,
      }));
  }, [filtered, schemes]);

  const searching = search.trim().length > 0;
  // Groups start folded when showing everything, so the page opens short.
  const isOpen = (id: string) => searching || groups.length === 1 || (openGroups[id] ?? false);
  const allOpen = groups.length > 0 && groups.every((g) => openGroups[g.id]);
  const activeLabel = schemes.find((sc) => sc.id === activeScheme)?.label ?? activeScheme;

  // Only concepts in expanded groups are on screen, so only they can be selected.
  const shownConcepts = useMemo(
    () => groups.filter((g) => isOpen(g.id)).flatMap((g) => g.items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, openGroups, searching],
  );
  const selection = useBulkSelection(shownConcepts, (c) => c.id, () => true, (c) => c.label);
  const bulkDelete = useBulkDelete({
    noun: "concept",
    // Concepts are graph entities, so deletion cascades: descendants and all
    // their annotations go too (and they leave the Neo4j mirror).
    deleteOne: (id) => ontologyApi.deleteConcept(id, true),
    invalidate: [QK.ontologyConcepts(activeScheme), QK.ontology()],
    selection,
  });

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* ── Schemes rail ── */}
      <GlassPanel className="lg:sticky lg:top-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Schemes</p>
            <p className="text-[11px] text-muted-foreground">Top-level groupings</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSchemeDialog({ mode: "create" })}>
            <Plus className="size-3.5" /> New
          </Button>
        </div>
        <ul className="custom-scrollbar max-h-[60vh] space-y-0.5 overflow-y-auto p-2">
          <SchemeRow
            label="All schemes"
            count={activeScheme === "" ? concepts.length : undefined}
            active={activeScheme === ""}
            onSelect={() => setActiveScheme("")}
          />
          {schemes.map((sc) => (
            <SchemeRow
              key={sc.id}
              label={sc.label}
              sub={sc.id}
              count={activeScheme === "" ? conceptCount.get(sc.id) : undefined}
              active={activeScheme === sc.id}
              onSelect={() => setActiveScheme(sc.id)}
              onEdit={() => setSchemeDialog({ mode: "edit", scheme: sc })}
              onDelete={() => setDeleteTarget({ kind: "scheme", id: sc.id })}
            />
          ))}
        </ul>
      </GlassPanel>

      {/* ── Concepts ── */}
      <GlassPanel className="min-w-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-foreground">Concepts</p>
            <p className="text-[11px] text-muted-foreground">
              {filtered.length} of {concepts.length}
              {activeScheme ? ` in ${activeLabel}` : ""}
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              placeholder="Search terms and synonyms…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {groups.length > 1 && !searching ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpenGroups(Object.fromEntries(groups.map((g) => [g.id, !allOpen])))}
            >
              <ChevronsUpDown className="size-3.5" />
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => setConceptDialog({ mode: "create" })}
            disabled={schemes.length === 0}
          >
            <Plus className="size-3.5" /> New concept
          </Button>
        </div>

        <div className="space-y-2 p-3">
          {conceptsQ.isLoading ? (
            <TableSkeleton />
          ) : conceptsQ.isError ? (
            <ErrorState error={conceptsQ.error} onRetry={() => conceptsQ.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={searching ? "Nothing matches." : "No vocabulary loaded."}
              description={searching ? "Try another term or synonym." : "Create a scheme and add concepts."}
            />
          ) : (
            <>
            <BulkActionBar
              selection={selection}
              noun="concept"
              onDelete={bulkDelete.run}
              deleting={bulkDelete.running}
              warning="Deletion cascades: each concept's descendants and every annotation on them are deleted too, and all of them are removed from the knowledge graph."
            />
            {groups.map((g) => {
              const open = isOpen(g.id);
              return (
                <section key={g.id} className="overflow-hidden rounded-xl border border-border/60">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !open }))}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 bg-background-elevated/60 px-3 py-2.5 text-left transition hover:bg-surface-hover"
                  >
                    <ChevronRight
                      className={cn("size-3.5 text-muted-foreground transition", open && "rotate-90")}
                    />
                    <span className="text-sm font-semibold text-foreground">{g.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{g.id}</span>
                    <span className="ml-auto rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {g.items.length}
                    </span>
                  </button>
                  {open ? (
                    <ul className="grid gap-px border-t border-border/60 bg-border/40 xl:grid-cols-2">
                      {g.items.map((c) => (
                        <ConceptRow
                          key={c.id}
                          concept={c}
                          selection={selection}
                          onAddChild={() => setConceptDialog({ mode: "create", parentId: c.id })}
                          onEdit={() => setConceptDialog({ mode: "edit", concept: c })}
                          onDelete={() => setDeleteTarget({ kind: "concept", id: c.id })}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
            </>
          )}
        </div>
      </GlassPanel>

      <Dialog open={!!schemeDialog} onOpenChange={(o) => !o && setSchemeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{schemeDialog?.mode === "edit" ? "Edit scheme" : "New scheme"}</DialogTitle>
          </DialogHeader>
          <SchemeForm
            scheme={schemeDialog?.scheme}
            onSubmit={(body) => {
              if (schemeDialog?.mode === "edit" && schemeDialog.scheme) {
                updateScheme.mutate({ id: schemeDialog.scheme.id, body });
              } else {
                createScheme.mutate(body as { id: string; label: string; description?: string });
              }
            }}
            pending={createScheme.isPending || updateScheme.isPending}
            editing={schemeDialog?.mode === "edit"}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!conceptDialog} onOpenChange={(o) => !o && setConceptDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{conceptDialog?.mode === "edit" ? "Edit concept" : "New concept"}</DialogTitle>
          </DialogHeader>
          <ConceptForm
            concept={conceptDialog?.concept}
            parentId={conceptDialog?.parentId}
            schemes={schemes}
            defaultScheme={activeScheme}
            onSubmit={(body) => {
              if (conceptDialog?.mode === "edit" && conceptDialog.concept) {
                updateConcept.mutate({ id: conceptDialog.concept.id, body });
              } else {
                createConcept.mutate(body as Parameters<typeof ontologyApi.createConcept>[0]);
              }
            }}
            pending={createConcept.isPending || updateConcept.isPending}
            editing={conceptDialog?.mode === "edit"}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.kind}?</DialogTitle>
          </DialogHeader>
          {deleteTarget?.kind === "concept" && usageQ.data ? (
            <p className="text-sm text-muted-foreground">
              This concept has {usageQ.data.children.length} children, {usageQ.data.annotations} annotation(s)
              affecting {usageQ.data.subjects.length} subject(s). A cascading delete removes all of it.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This may affect linked concepts and annotations. A cascading delete removes them too.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteTarget.kind === "scheme") deleteScheme.mutate({ id: deleteTarget.id, cascade: false });
                else deleteConcept.mutate({ id: deleteTarget.id, cascade: false });
              }}
            >
              Delete (no cascade)
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteTarget.kind === "scheme") deleteScheme.mutate({ id: deleteTarget.id, cascade: true });
                else deleteConcept.mutate({ id: deleteTarget.id, cascade: true });
              }}
            >
              Delete with cascade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchemeForm({
  scheme,
  onSubmit,
  pending,
  editing,
}: {
  scheme?: ConceptScheme | undefined;
  onSubmit: (body: { id: string; label: string; description?: string }) => void;
  pending: boolean;
  editing?: boolean | undefined;
}) {
  const [id, setId] = useState(scheme?.id ?? "");
  const [label, setLabel] = useState(scheme?.label ?? "");
  const [description, setDescription] = useState(scheme?.description ?? "");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ id, label, description });
      }}
    >
      {!editing ? (
        <Input placeholder="id (e.g. domain)" value={id} onChange={(e) => setId(e.target.value)} required />
      ) : null}
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ConceptForm({
  concept,
  parentId,
  schemes,
  defaultScheme,
  onSubmit,
  pending,
  editing,
}: {
  concept?: Concept | undefined;
  parentId?: string | undefined;
  schemes: ConceptScheme[];
  defaultScheme: string;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
  editing?: boolean | undefined;
}) {
  const [id, setId] = useState(concept?.id ?? "");
  const [schemeId, setSchemeId] = useState(concept?.scheme_id ?? defaultScheme ?? schemes[0]?.id ?? "");
  const [label, setLabel] = useState(concept?.label ?? "");
  const [definition, setDefinition] = useState(concept?.definition ?? "");
  const [synonyms, setSynonyms] = useState((concept?.synonyms ?? []).join(", "));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const synonymList = synonyms.split(",").map((s) => s.trim()).filter(Boolean);
        if (editing) {
          onSubmit({ label, definition, synonyms: synonymList });
        } else {
          onSubmit({ id, scheme_id: schemeId, label, definition, synonyms: synonymList, parent_id: parentId ?? null });
        }
      }}
    >
      {!editing ? (
        <>
          <Input placeholder="domain.bfsi.banking" value={id} onChange={(e) => setId(e.target.value)} required />
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
          >
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Textarea placeholder="Definition" value={definition} onChange={(e) => setDefinition(e.target.value)} rows={2} />
      <Input placeholder="Synonyms, comma separated" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SchemeRow({
  label,
  sub,
  count,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  label: string;
  sub?: string;
  count?: number | undefined;
  active: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-lg border transition",
        active ? "border-primary/30 bg-primary/10" : "border-transparent hover:bg-surface-hover",
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-2.5 py-1.5 text-left">
        <span className={cn("block truncate text-xs font-medium", active ? "text-primary" : "text-foreground")}>
          {label}
        </span>
        {sub ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{sub}</span> : null}
      </button>
      {typeof count === "number" ? (
        <span className="px-1 text-[10px] text-muted-foreground tabular-nums">{count}</span>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground focus:opacity-100"
        >
          <Pencil className="size-3" />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${label}`}
          className="mr-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-red focus:opacity-100"
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
    </li>
  );
}

function ConceptRow({
  concept: c,
  selection,
  onAddChild,
  onEdit,
  onDelete,
}: {
  concept: Concept;
  selection: BulkSelection;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={cn(
        "group flex items-center justify-between gap-3 px-3 py-2",
        selection.isSelected(c.id) ? "bg-primary/5" : "bg-background",
      )}
    >
      <RowCheckbox selection={selection} id={c.id} label={c.label} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{c.label}</span>
          {c.level_name ? (
            <span className="shrink-0 rounded-full bg-indigo/10 px-2 py-0.5 text-[10px] text-indigo">
              {c.level_name}
            </span>
          ) : null}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{c.id}</p>
        {c.definition ? <p className="truncate text-xs text-muted-foreground">{c.definition}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
        <Button size="sm" variant="ghost" title="Add a child concept" onClick={onAddChild}>
          <Plus className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" title="Edit" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" title="Delete" className="text-red hover:text-red" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
