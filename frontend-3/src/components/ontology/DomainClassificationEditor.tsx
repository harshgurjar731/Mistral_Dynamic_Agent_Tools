import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { ontologyApi, QK } from "@/api";
import type { Concept } from "@/types";
import { DomainCascadeSelect } from "./DomainCascadeSelect";
import { Button } from "@/components/ui/button";

export function DomainClassificationEditor({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[] | null>(null);

  const conceptQuery = useQuery({
    queryKey: QK.ontologyConcepts("domain"),
    queryFn: () => ontologyApi.concepts("domain"),
  });

  const annotationQuery = useQuery({
    queryKey: QK.annotations(subjectType, subjectId),
    queryFn: () => ontologyApi.annotationsFor(subjectType, subjectId),
    enabled: Boolean(subjectId),
  });

  const concepts: Concept[] = useMemo(() => {
    const data = conceptQuery.data;
    if (Array.isArray(data)) return data;
    return data?.concepts ?? [];
  }, [conceptQuery.data]);

  const current: string[] = useMemo(() => {
    const data = annotationQuery.data;
    if (!data) return [];
    if ("annotations" in data && data.annotations) {
      return (data.annotations as Record<string, string[]>)["serves_domain"] ?? [];
    }
    return (data as Record<string, string[]>)["serves_domain"] ?? [];
  }, [annotationQuery.data]);

  const value = selected ?? current;
  const dirty =
    selected !== null &&
    JSON.stringify([...selected].sort()) !== JSON.stringify([...current].sort());

  const save = useMutation({
    mutationFn: () =>
      ontologyApi.setAnnotations({
        subject_type: subjectType,
        subject_id: subjectId,
        predicate: "serves_domain",
        concept_ids: value,
        source: "user",
      }),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: QK.annotations(subjectType, subjectId) });
      qc.invalidateQueries({ queryKey: ["ontology", "annotations"] });
      qc.invalidateQueries({ queryKey: QK.ontology() });
    },
  });

  const add = (conceptId: string) => setSelected([...(selected ?? current), conceptId]);
  const remove = (conceptId: string) =>
    setSelected((selected ?? current).filter((id) => id !== conceptId));

  const isLoading = conceptQuery.isLoading || annotationQuery.isLoading;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading domain vocabulary…
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <DomainCascadeSelect
        concepts={concepts}
        selected={value}
        onAdd={add}
        onRemove={remove}
        disabled={save.isPending}
      />

      {save.isError && (
        <p className="rounded-lg border border-red/30 bg-red/10 px-2.5 py-1.5 text-[11px] text-red">
          Could not save the domain classification.
        </p>
      )}

      {dirty && (
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="h-7 text-xs gap-1.5"
        >
          {save.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          Save Domain Classification
        </Button>
      )}
    </div>
  );
}
