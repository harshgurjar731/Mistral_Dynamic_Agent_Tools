/**
 * ConceptBrowser — the vocabulary, and the annotations that use it.
 *
 * Two jobs. The Vocabulary tab shows what terms exist. The Annotations tab is
 * the one that matters operationally: the backfill guesses annotations from
 * agent names and instructions, gets most right and some confidently wrong,
 * and a wrong annotation fails silently — the agent simply stops being offered
 * to the planner for requests it should have served. This is where that gets
 * corrected without editing YAML and restarting.
 *
 * Inferred annotations are called out for exactly that reason.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, ChevronRight, Layers, Loader2, Network, Search, Sparkles, Tag,
} from 'lucide-react';
import {
  ontologyApi,
  PREDICATE_LABELS,
  PREDICATE_SCHEME,
  type AnnotationMap,
  type Concept,
  type Predicate,
} from '../../api/ontology';
import { agentsApi } from '../../api/agents';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

type Tab = 'vocabulary' | 'annotations' | 'scope';

const AGENT_PREDICATES: Predicate[] = [
  'has_tier',
  'serves_domain',
  'requires_capability',
  'provides_capability',
  'handles_data_class',
];

export default function ConceptBrowser() {
  const [tab, setTab] = useState<Tab>('vocabulary');

  const { data: overview, isLoading } = useQuery({
    queryKey: QK.ontology(),
    queryFn: () => ontologyApi.overview().then((r) => r.data),
  });

  const tabs: { key: Tab; label: string; icon: typeof Layers }[] = [
    { key: 'vocabulary', label: 'Vocabulary', icon: Layers },
    { key: 'annotations', label: 'Annotations', icon: Tag },
    { key: 'scope', label: 'Scope preview', icon: Network },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Ontology
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            The vocabulary that narrows what the planner considers, and the constraints the
            builder checks before you publish.
          </p>
        </div>
        {overview && (
          <div className="flex items-center gap-5 text-right">
            <Stat n={overview.counts.concepts} k="concepts" />
            <Stat n={overview.counts.annotations} k="annotations" />
          </div>
        )}
      </div>

      {!isLoading && overview && !overview.seeded && (
        <div className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.06)]">
          <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-amber-300 font-medium">No vocabulary loaded.</p>
            <p className="text-[var(--color-text-muted)] mt-1">
              The seed file did not load, so scoping and constraint checks are inactive. The
              planner falls back to the full inventory.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit mb-8">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2',
              tab === t.key
                ? 'bg-white text-[var(--color-bg-base)]'
                : 'text-[var(--color-text-muted)] hover:text-white',
            )}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vocabulary' && <VocabularyTab />}
      {tab === 'annotations' && <AnnotationsTab />}
      {tab === 'scope' && <ScopeTab />}
    </div>
  );
}

function Stat({ n, k }: { n: number; k: string }) {
  return (
    <div>
      <p className="text-xl font-semibold text-white tabular-nums">{n}</p>
      <p className="text-[11px] text-[var(--color-text-muted)]">{k}</p>
    </div>
  );
}

/* ── Vocabulary ───────────────────────────────────────────────────────────── */

function VocabularyTab() {
  const { data, isLoading } = useQuery({
    queryKey: QK.ontologyConcepts(),
    queryFn: () => ontologyApi.concepts().then((r) => r.data),
  });

  const bySchemeThenTree = useMemo(() => {
    const concepts = data?.concepts ?? [];
    const grouped = new Map<string, Concept[]>();
    for (const c of concepts) {
      grouped.set(c.scheme_id, [...(grouped.get(c.scheme_id) ?? []), c]);
    }
    return grouped;
  }, [data]);

  if (isLoading) return <Loading label="Loading vocabulary…" />;

  return (
    <div className="space-y-6">
      {[...bySchemeThenTree.entries()].map(([schemeId, concepts]) => {
        const roots = concepts.filter((c) => !c.parent_id);
        const childrenOf = (id: string) => concepts.filter((c) => c.parent_id === id);
        return (
          <section
            key={schemeId}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5"
          >
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              {schemeId.replace('_', ' ')} · {concepts.length}
            </h2>
            <div className="space-y-1">
              {roots.map((root) => (
                <div key={root.id}>
                  <ConceptRow concept={root} />
                  {childrenOf(root.id).map((child) => (
                    <div key={child.id} className="pl-5">
                      <ConceptRow concept={child} nested />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ConceptRow({ concept, nested }: { concept: Concept; nested?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      {nested && <ChevronRight size={11} className="text-[var(--color-text-muted)] shrink-0" />}
      <span className="text-sm text-white shrink-0">{concept.label}</span>
      <code className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0">
        {concept.id}
      </code>
      {concept.definition && (
        <span className="text-xs text-[var(--color-text-muted)] truncate">
          {concept.definition}
        </span>
      )}
    </div>
  );
}

/* ── Annotations ──────────────────────────────────────────────────────────── */

function AnnotationsTab() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: agentData } = useQuery({
    queryKey: QK.agents(),
    queryFn: () => agentsApi.list(0, 200).then((r) => r.data),
  });

  const agents = agentData?.items ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? agents.filter((a) => a.name.toLowerCase().includes(q)) : agents;
  }, [agents, query]);

  return (
    <div className="grid grid-cols-[260px_1fr] gap-6">
      <div className="flex flex-col gap-2 min-h-0">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an agent…"
            className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-xs text-white focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
          />
        </div>
        <div className="flex flex-col gap-0.5 max-h-[62vh] overflow-y-auto custom-scrollbar">
          {filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={cn(
                'text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors truncate',
                selected === a.id
                  ? 'bg-[rgba(99,102,241,0.15)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
              )}
              title={a.name}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <AnnotationEditor
          subjectId={selected}
          subjectName={agents.find((a) => a.id === selected)?.name ?? selected}
        />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
          Pick an agent to review its annotations.
        </div>
      )}
    </div>
  );
}

function AnnotationEditor({ subjectId, subjectName }: { subjectId: string; subjectName: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QK.annotations('agent', subjectId),
    queryFn: () => ontologyApi.annotations('agent', subjectId).then((r) => r.data),
  });

  const { data: conceptData } = useQuery({
    queryKey: QK.ontologyConcepts(),
    queryFn: () => ontologyApi.concepts().then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (body: { predicate: Predicate; concept_ids: string[] }) =>
      ontologyApi.setAnnotations({
        subject_type: 'agent',
        subject_id: subjectId,
        // Saving from here is a human decision, so it is recorded as such —
        // which is what promotes a capability gap from advisory to blocking.
        source: 'user',
        ...body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.annotations('agent', subjectId) });
      qc.invalidateQueries({ queryKey: QK.builderCatalog() });
      qc.invalidateQueries({ queryKey: QK.agents() });
    },
  });

  if (isLoading) return <Loading label="Loading annotations…" />;

  const annotations: AnnotationMap = data?.annotations ?? {};
  const concepts = conceptData?.concepts ?? [];

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-white truncate">{subjectName}</h2>
        {save.isPending && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}
      </div>
      <code className="text-[10px] font-mono text-[var(--color-text-muted)]">{subjectId}</code>

      <div className="mt-5 space-y-5">
        {AGENT_PREDICATES.map((predicate) => {
          const scheme = PREDICATE_SCHEME[predicate];
          const options = concepts.filter((c) => c.scheme_id === scheme);
          const current = annotations[predicate] ?? [];
          const single = predicate === 'has_tier';

          return (
            <div key={predicate}>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                {PREDICATE_LABELS[predicate]}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {options.map((option) => {
                  const on = current.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      disabled={save.isPending}
                      onClick={() => {
                        const next = single
                          ? [option.id]
                          : on
                            ? current.filter((c) => c !== option.id)
                            : [...current, option.id];
                        save.mutate({ predicate, concept_ids: next });
                      }}
                      title={option.definition || option.id}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors disabled:opacity-50',
                        on
                          ? 'bg-[rgba(99,102,241,0.15)] border-[rgba(99,102,241,0.45)] text-[#a5b4fc]'
                          : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
                      )}
                    >
                      {on && <Check size={9} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-2 mt-6 pt-4 border-t border-[var(--color-border-subtle)] text-[11px] text-[var(--color-text-muted)] leading-relaxed">
        <Sparkles size={12} className="shrink-0 mt-0.5 text-amber-400" />
        <span>
          Annotations from the backfill are guesses. Confirming one here marks it as
          human-reviewed, which is what lets the builder treat a missing capability as an error
          rather than a warning.
        </span>
      </p>
    </div>
  );
}

/* ── Scope preview ────────────────────────────────────────────────────────── */

function ScopeTab() {
  const [goal, setGoal] = useState('Assess a residential mortgage application');

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ontology', 'scope', goal],
    queryFn: () => ontologyApi.scope(goal).then((r) => r.data),
    enabled: goal.trim().length > 2,
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[var(--color-text-muted)] mb-3 max-w-2xl">
          What the planner would narrow to for a given goal. If a workflow proposes the wrong
          agents, this is the first place to look — an unexpected scope usually means an
          annotation is wrong, not that the model chose badly.
        </p>
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && refetch()}
            placeholder="Describe a workflow goal…"
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-sm text-white focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
          />
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg bg-white text-[var(--color-bg-base)] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {isFetching ? <Loader2 size={14} className="animate-spin" /> : 'Preview'}
          </button>
        </div>
      </div>

      {data && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 space-y-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Resolved scope
            </span>
            <p className={cn('text-sm mt-1', data.scoped ? 'text-emerald-400' : 'text-amber-400')}>
              {data.label}
            </p>
            {!data.scoped && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                No domain matched, so the planner sees the full inventory. Add a synonym to the
                right domain if this goal should have narrowed.
              </p>
            )}
          </div>

          {data.scores.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Match scores
              </span>
              <div className="mt-2 space-y-1">
                {data.scores.map(([id, score]) => (
                  <div key={id} className="flex items-center justify-between text-xs">
                    <code className="font-mono text-[var(--color-text-secondary)]">{id}</code>
                    <span className="tabular-nums text-[var(--color-text-muted)]">
                      {score.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-12 justify-center">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}
