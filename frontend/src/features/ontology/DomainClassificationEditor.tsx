import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { ontologyApi, type SubjectType } from '../../api/ontology';
import { QK } from '../../lib/queryClient';
import DomainCascadeSelect from './DomainCascadeSelect';

/**
 * Show + edit one subject's domain classification (`serves_domain`).
 *
 * Chrome-light on purpose — the cascade select, plus a Save button that
 * appears once something changed. That's what lets the exact same component
 * sit inside three different hosts: the taxonomy "what uses them" editor, an
 * agent's detail-page card, and a workflow's classification modal — each
 * supplies its own surrounding title and layout.
 */
export default function DomainClassificationEditor({
  subjectType,
  subjectId,
}: {
  subjectType: SubjectType;
  subjectId: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[] | null>(null);

  const { data: conceptData, isLoading: loadingConcepts } = useQuery({
    queryKey: QK.ontologyConcepts('domain'),
    queryFn: () => ontologyApi.concepts('domain').then((r) => r.data),
  });

  const { data: annotationData, isLoading: loadingAnnotations } = useQuery({
    queryKey: QK.annotations(subjectType, subjectId),
    queryFn: () => ontologyApi.annotations(subjectType, subjectId).then((r) => r.data),
    enabled: !!subjectId,
  });

  const concepts = useMemo(() => conceptData?.concepts ?? [], [conceptData]);

  const current = annotationData?.annotations?.serves_domain ?? [];
  const value = selected ?? current;
  const dirty =
    selected !== null &&
    JSON.stringify([...selected].sort()) !== JSON.stringify([...current].sort());

  const save = useMutation({
    mutationFn: () =>
      ontologyApi.setAnnotations({
        subject_type: subjectType,
        subject_id: subjectId,
        predicate: 'serves_domain',
        concept_ids: value,
        source: 'user',
      }),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: QK.annotations(subjectType, subjectId) });
      // Prefix match — also refreshes the bulk lookups AgentStudio/
      // WorkflowDashboard use for their domain filters, and the taxonomy
      // tab's unannotated-count badge.
      qc.invalidateQueries({ queryKey: ['ontology', 'annotations', subjectType, 'bulk'] });
      qc.invalidateQueries({ queryKey: QK.ontology() });
    },
  });

  const add = (conceptId: string) => setSelected([...(selected ?? current), conceptId]);
  const remove = (conceptId: string) =>
    setSelected((selected ?? current).filter((id) => id !== conceptId));

  const isLoading = loadingConcepts || loadingAnnotations;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading domain vocabulary…
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
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
          Could not save the classification.
        </p>
      )}

      {dirty && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-primary flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] disabled:opacity-50"
        >
          {save.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          Save
        </button>
      )}
    </div>
  );
}
