import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Check, Loader2, Plus, Trash2, Wand2,
} from 'lucide-react';
import {
  ragApi,
  type OntologyPredicate,
  type OntologyType,
} from '../../api/rag';
import { cn } from '../../lib/utils';
import { nodeStyle } from './graph/UnifiedGraphCanvas';

/**
 * Designing what a library's documents are made of.
 *
 * This is the lever that decides extraction quality, and it sits *before* the
 * work rather than after it. Correcting a schema costs one edit; correcting
 * what a bad schema extracted costs a model call per chunk, per document.
 *
 * The predicate list is the half that matters most and the half that looks
 * least important. Uncontrolled, the same fact came back as "pays" on one run
 * and "pays_invoice_to" on the next — two edges in the graph, so a traversal
 * filtering on either finds half the answer. Closing the list is what fixes it.
 *
 * Nothing here changes what is already in the graph. A draft governs nothing
 * until it is approved, and approving reports which documents are now on an
 * older version rather than silently re-extracting them.
 */

function TypeRow({
  type,
  onChange,
  onRemove,
}: {
  type: OntologyType;
  onChange: (patch: Partial<OntologyType>) => void;
  onRemove: () => void;
}) {
  const style = nodeStyle(type.name);
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: style.color }} />
        <input
          value={type.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="TypeName"
          className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-white hover:border-[var(--color-border-subtle)] focus:border-indigo-400/50 focus:outline-none"
        />
        <input
          value={type.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What counts as this type?"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border-subtle)] focus:border-indigo-400/50 focus:outline-none"
        />
        <button
          onClick={onRemove}
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {type.examples?.length > 0 && (
        <p className="mt-1 pl-5 text-[10px] text-[var(--color-text-muted)]">
          e.g. {type.examples.slice(0, 3).join(', ')}
        </p>
      )}
    </div>
  );
}

function PredicateRow({
  predicate,
  types,
  onChange,
  onRemove,
}: {
  predicate: OntologyPredicate;
  types: string[];
  onChange: (patch: Partial<OntologyPredicate>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={predicate.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="verb_phrase"
          className="w-52 rounded border border-[var(--color-border-subtle)] bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300 focus:border-indigo-400/50 focus:outline-none"
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {(predicate.source_types?.length ? predicate.source_types.join('/') : 'any')} →{' '}
          {(predicate.target_types?.length ? predicate.target_types.join('/') : 'any')}
        </span>
        <input
          value={predicate.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What does this relation assert?"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border-subtle)] focus:border-indigo-400/50 focus:outline-none"
        />
        <button
          onClick={onRemove}
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {types.length > 0 && (
        <p className="mt-1 hidden text-[10px] text-[var(--color-text-muted)]">
          {types.length} types available
        </p>
      )}
    </div>
  );
}

export default function OntologyDesigner({
  libraryId,
  libraryName,
  onBack,
}: {
  libraryId: string;
  libraryName: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [types, setTypes] = useState<OntologyType[] | null>(null);
  const [predicates, setPredicates] = useState<OntologyPredicate[] | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'ontology', libraryId],
    queryFn: () => ragApi.ontology(libraryId).then((r) => r.data),
  });

  // The draft is what is edited; the approved version is what governs
  // extraction today and is shown for comparison.
  const draft = data?.draft;
  const approved = data?.approved;
  const source = draft ?? approved;

  useEffect(() => {
    setTypes(null);
    setPredicates(null);
    setPrompt(null);
  }, [draft?.version, approved?.version]);

  const currentTypes = types ?? source?.entity_types ?? [];
  const currentPredicates = predicates ?? source?.predicates ?? [];
  const currentPrompt = prompt ?? source?.prompt ?? '';
  const dirty = types !== null || predicates !== null || prompt !== null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rag', 'ontology', libraryId] });
    qc.invalidateQueries({ queryKey: ['rag', 'overview'] });
  };

  const propose = useMutation({
    mutationFn: () => ragApi.proposeOntology(libraryId),
    onSuccess: refresh,
  });

  const save = useMutation({
    mutationFn: () =>
      ragApi.saveOntology(libraryId, {
        entity_types: currentTypes,
        predicates: currentPredicates,
        prompt: currentPrompt,
        summary: source?.summary ?? '',
      }),
    onSuccess: refresh,
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await ragApi.saveOntology(libraryId, {
          entity_types: currentTypes,
          predicates: currentPredicates,
          prompt: currentPrompt,
          summary: source?.summary ?? '',
        });
      }
      return ragApi.approveOntology(libraryId);
    },
    onSuccess: refresh,
  });

  const discard = useMutation({
    mutationFn: () => ragApi.discardOntologyDraft(libraryId),
    onSuccess: refresh,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading ontology…
      </p>
    );
  }

  const stale = data?.stale_documents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-white"
        >
          <ArrowLeft size={12} /> Back to {libraryName}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => propose.mutate()}
            disabled={propose.isPending}
            title="Have the Ontology Architect read a sample of this library and propose a schema"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-50"
          >
            {propose.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {source ? 'Propose again' : 'Propose from documents'}
          </button>
          {draft && (
            <button
              onClick={() => discard.mutate()}
              disabled={discard.isPending}
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-white"
            >
              Discard draft
            </button>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || !currentTypes.length}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-40"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save draft'}
          </button>
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending || !currentTypes.length || (!draft && !dirty)}
            title="Make this the schema every new extraction in this library runs under"
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {approve.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Approve
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-white">
          Content schema — {libraryName}
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          {approved
            ? `v${approved.version} governs extraction now.`
            : 'No schema yet — extraction uses the generic vocabulary.'}
          {draft ? ` Draft v${draft.version} is waiting for review.` : ''}
          {' '}Entity types and predicates are closed lists: an extractor may use
          nothing else, which is what keeps two documents describing the same
          thing the same way.
        </p>
      </div>

      {propose.isError && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {(propose.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? 'Could not propose a schema.'}
        </p>
      )}

      {approve.data && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <Check size={13} className="mt-px shrink-0" />
          <span>
            v{approve.data.data.ontology.version} approved.
            {approve.data.data.stale_documents.length
              ? ` ${approve.data.data.stale_documents.length} document(s) were extracted under an
                 older version — re-extract them to bring the graph in line.`
              : ' Every graphed document is on this version.'}
          </span>
        </p>
      )}

      {stale.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            {stale.length} document(s) in the graph were extracted under an older
            schema: {stale.map((d) => d.filename).slice(0, 3).join(', ')}
            {stale.length > 3 ? '…' : ''}. Their types may not match the current
            vocabulary. Re-extract and re-commit them when convenient — nothing
            is broken until you rely on those types.
          </span>
        </p>
      )}

      {source?.summary && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            What the architect understood this library to be
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{source.summary}</p>
        </div>
      )}

      {!source && !propose.isPending && (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            This library has no content schema.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-text-muted)]">
            Extraction will use the generic vocabulary — ten broad types and
            uncontrolled predicates. Proposing a schema reads a few documents and
            designs types and relations that fit what is actually in them.
          </p>
        </div>
      )}

      {source && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white">
                Entity types ({currentTypes.length})
              </p>
              <button
                onClick={() =>
                  setTypes([...currentTypes, { name: '', description: '', examples: [] }])
                }
                className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-white"
              >
                <Plus size={10} /> add
              </button>
            </div>
            {currentTypes.map((type, index) => (
              <TypeRow
                key={index}
                type={type}
                onChange={(patch) => {
                  const next = [...currentTypes];
                  next[index] = { ...next[index], ...patch };
                  setTypes(next);
                }}
                onRemove={() => setTypes(currentTypes.filter((_, i) => i !== index))}
              />
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white">
                Predicates ({currentPredicates.length})
              </p>
              <button
                onClick={() =>
                  setPredicates([
                    ...currentPredicates,
                    { name: '', description: '', source_types: [], target_types: [] },
                  ])
                }
                className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-white"
              >
                <Plus size={10} /> add
              </button>
            </div>
            {currentPredicates.map((predicate, index) => (
              <PredicateRow
                key={index}
                predicate={predicate}
                types={currentTypes.map((t) => t.name)}
                onChange={(patch) => {
                  const next = [...currentPredicates];
                  next[index] = { ...next[index], ...patch };
                  setPredicates(next);
                }}
                onRemove={() =>
                  setPredicates(currentPredicates.filter((_, i) => i !== index))
                }
              />
            ))}
          </div>
        </div>
      )}

      {source && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-white">
            Extraction prompt for this library
          </p>
          <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
            What to look for and what to ignore. It extends the built-in
            contract — it cannot change the output format or relax the evidence
            requirement.
          </p>
          <textarea
            value={currentPrompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 text-xs text-white focus:border-indigo-400/50 focus:outline-none"
          />
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="mt-2 text-[11px] text-[var(--color-text-muted)] hover:text-white"
          >
            {showPrompt ? 'Hide' : 'Show'} the full instruction the extractor receives
          </button>
          {showPrompt && (
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
              {data?.effective_prompt}
            </pre>
          )}
        </div>
      )}

      {(data?.history?.length ?? 0) > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-3">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Versions
          </span>
          {data!.history.map((version) => (
            <span
              key={version.version}
              className={cn(
                'rounded border px-1.5 py-px text-[10px]',
                version.status === 'approved'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                  : version.status === 'draft'
                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                    : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)]',
              )}
            >
              v{version.version} · {version.status}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
