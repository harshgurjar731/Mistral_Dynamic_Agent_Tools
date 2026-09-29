import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Trash2 } from "lucide-react";
import { errorMessage, ontologyApi, QK } from "@/api";
import type { AnnotationRow, OntologyOverview } from "@/types";
import { PREDICATE_LABELS, type Predicate } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { BulkActionBar, RowCheckbox } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground";

function asRows(res: { annotations: AnnotationRow[] } | AnnotationRow[] | undefined) {
  if (!res) return [];
  return Array.isArray(res) ? res : res.annotations;
}

export function AnnotationsTab({ overview }: { overview: OntologyOverview | undefined }) {
  const qc = useQueryClient();
  const [subjectType, setSubjectType] = useState("");
  const [predicate, setPredicate] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (subjectType) p["subject_type"] = subjectType;
    if (predicate) p["predicate"] = predicate;
    if (source) p["source"] = source;
    return p;
  }, [predicate, source, subjectType]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.annotationsList(params),
    queryFn: () => ontologyApi.annotations(params),
  });

  const remove = useMutation({
    mutationFn: (row: AnnotationRow) =>
      ontologyApi.deleteAnnotation({
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        predicate: row.predicate,
        concept_id: row.concept_id,
      }),
    onSuccess: () => {
      toast.success("Annotation removed.");
      qc.invalidateQueries({ queryKey: ["ontology", "annotations"] });
      qc.invalidateQueries({ queryKey: QK.ontology() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const all = asRows(data);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.subject_id.toLowerCase().includes(q) ||
        r.concept_id.toLowerCase().includes(q) ||
        r.predicate.toLowerCase().includes(q),
    );
  }, [data, search]);

  const rowsById = useMemo(() => new Map(rows.map((r) => [String(r.id), r])), [rows]);
  const selection = useBulkSelection(
    rows,
    (r) => r.id,
    () => true,
    (r) => `${r.subject_id} → ${r.concept_id}`,
  );
  const bulkDelete = useBulkDelete({
    noun: "annotation",
    deleteOne: (id) => {
      const row = rowsById.get(id);
      if (!row) return Promise.reject(new Error("no longer listed"));
      return ontologyApi.deleteAnnotation({
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        predicate: row.predicate,
        concept_id: row.concept_id,
      });
    },
    invalidate: [["ontology", "annotations"], QK.ontology()],
    selection,
  });

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Annotations"
        description="Every (subject, predicate, concept) triple recorded against a platform resource."
        actions={<span className="technical-label">{rows.length} shown</span>}
      />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by subject, concept or predicate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value)}
          >
            <option value="">All subjects</option>
            {(overview?.subject_types ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className={SELECT_CLASS}
            value={predicate}
            onChange={(e) => setPredicate(e.target.value)}
          >
            <option value="">All predicates</option>
            {(overview?.predicates ?? []).map((p) => (
              <option key={p} value={p}>
                {PREDICATE_LABELS[p as Predicate] ?? p}
              </option>
            ))}
          </select>
          <select
            className={SELECT_CLASS}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Any source</option>
            {["seed", "auto", "llm", "user"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No annotations match this view."
            description="Classification writes these automatically; you can also set them from an agent's detail page."
          />
        ) : (
          <div className="space-y-3">
            <BulkActionBar
              selection={selection}
              noun="annotation"
              onDelete={bulkDelete.run}
              deleting={bulkDelete.running}
              warning="Agents and workflows lose these domain classifications; filters and knowledge scoping that rely on them change."
            />
            <div className="custom-scrollbar max-h-[560px] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-background-elevated">
                  <tr>
                    <th className="w-8 px-2 py-2" aria-label="Select" />
                    {["Subject", "Type", "Predicate", "Concept", "Source", ""].map((h) => (
                      <th key={h} className="technical-label px-2 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={
                        selection.isSelected(String(r.id))
                          ? "border-t border-border bg-primary/5"
                          : "border-t border-border"
                      }
                    >
                      <td className="px-2 py-2">
                        <RowCheckbox
                          selection={selection}
                          id={r.id}
                          label={`${r.subject_id} ${r.concept_id}`}
                        />
                      </td>
                      <td className="max-w-[240px] truncate px-2 py-2 font-mono text-[11px] text-foreground">
                        {r.subject_id}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-muted-foreground">
                        {r.subject_type}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-muted-foreground">
                        {PREDICATE_LABELS[r.predicate as Predicate] ?? r.predicate}
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] text-cyan">{r.concept_id}</td>
                      <td className="px-2 py-2">
                        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase">
                          {r.source}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-red"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(r)}
                          title="Remove this triple"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
