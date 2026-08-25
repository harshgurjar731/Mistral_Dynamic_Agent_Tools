import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Search } from "lucide-react";
import { ontologyApi, QK, errorMessage } from "@/api";
import type { Concept, ConceptScheme } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
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

  return (
    <div className="space-y-4">
      <GlassPanel>
        <GlassPanelHeader
          title="Schemes"
          description="Top-level concept schemes."
          actions={
            <Button size="sm" onClick={() => setSchemeDialog({ mode: "create" })}>
              <Plus className="size-3.5" /> New scheme
            </Button>
          }
        />
        <div className="flex flex-wrap gap-2 p-4">
          <Button size="sm" variant={activeScheme === "" ? "default" : "outline"} onClick={() => setActiveScheme("")}>
            All
          </Button>
          {schemes.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant={activeScheme === s.id ? "default" : "outline"}
                onClick={() => setActiveScheme(s.id)}
              >
                {s.label}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSchemeDialog({ mode: "edit", scheme: s })}>
                <Pencil className="size-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red hover:text-red"
                onClick={() => setDeleteTarget({ kind: "scheme", id: s.id })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel>
        <GlassPanelHeader
          title="Concepts"
          description="CRUD over the vocabulary."
          actions={
            <Button size="sm" onClick={() => setConceptDialog({ mode: "create" })} disabled={schemes.length === 0}>
              <Plus className="size-3.5" /> New concept
            </Button>
          }
        />
        <div className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search terms and synonyms…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {conceptsQ.isLoading ? (
            <TableSkeleton />
          ) : conceptsQ.isError ? (
            <ErrorState error={conceptsQ.error} onRetry={() => conceptsQ.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState title="No vocabulary loaded." description="Create a scheme and add concepts." />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {filtered.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {c.label}{" "}
                      <span className="ml-1 text-xs text-muted-foreground">{c.id}</span>
                      {c.level_name ? (
                        <span className="ml-2 rounded-full bg-indigo/10 px-2 py-0.5 text-[10px] text-indigo">
                          {c.level_name}
                        </span>
                      ) : null}
                    </p>
                    {c.definition ? (
                      <p className="truncate text-xs text-muted-foreground">{c.definition}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Add a child concept"
                      onClick={() => setConceptDialog({ mode: "create", parentId: c.id })}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => setConceptDialog({ mode: "edit", concept: c })}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete"
                      className="text-red hover:text-red"
                      onClick={() => setDeleteTarget({ kind: "concept", id: c.id })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
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
