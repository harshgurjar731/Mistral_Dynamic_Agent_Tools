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
  AlertCircle, BookOpen, Check, Loader2, Network, Search, Sparkles, Tag, Layers, Wand2,
} from 'lucide-react';
import {
  ontologyApi,
  PREDICATE_LABELS,
  PREDICATE_SCHEME,
  type AnnotationMap,
  type Predicate,
} from '../../api/ontology';
import { agentsApi } from '../../api/agents';
import OverviewTab from './OverviewTab';
import VocabularyTab from './VocabularyTab';
import KnowledgeTab from './KnowledgeTab';
import OntologyGraphCanvas, { GraphLegend } from './graph/OntologyGraphCanvas';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

type Tab = 'overview' | 'vocabulary' | 'knowledge' | 'annotations' | 'scope';

const AGENT_PREDICATES: Predicate[] = [
  'has_tier',
  'serves_domain',
  'requires_capability',
  'provides_capability',
  'handles_data_class',
];

export default function ConceptBrowser() {
  const [tab, setTab] = useState<Tab>('overview');

  const { data: overview, isLoading } = useQuery({
    queryKey: QK.ontology(),
    queryFn: () => ontologyApi.overview().then((r) => r.data),
  });

  const tabs: { key: Tab; label: string; icon: typeof Layers }[] = [
    { key: 'overview', label: 'Overview', icon: Network },
    { key: 'vocabulary', label: 'Vocabulary', icon: Layers },
    { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
    { key: 'annotations', label: 'Annotations', icon: Tag },
    { key: 'scope', label: 'Scope preview', icon: Sparkles },
  ];

  return (
    // The overview graph needs the width; the other tabs read better narrow.
    <div className={cn('p-8 mx-auto', tab === 'overview' ? 'max-w-[1600px]' : 'max-w-5xl')}>
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

      {tab === 'overview' && <OverviewTab />}
      {tab === 'vocabulary' && <VocabularyTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
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

/* ── Annotations ──────────────────────────────────────────────────────────── */

/** How many agents to pull for the picker. One page, deliberately generous. */
const AGENT_PAGE_SIZE = 200;

function AnnotationsTab() {
  const [query, setQuery] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: agentData, isLoading, isError, refetch } = useQuery({
    queryKey: QK.agentsPage(0, AGENT_PAGE_SIZE),
    queryFn: () => agentsApi.list(0, AGENT_PAGE_SIZE).then((r) => r.data),
  });

  const agents = useMemo(() => {
    const items = agentData?.items ?? [];
    // The upstream listing can repeat an agent across pages; a duplicate id
    // would collide as a React key and render as a ghost row.
    const byId = new Map(items.map((a) => [a.id, a]));
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }, [agentData]);

  // One round trip for every agent's annotations, so the list can show which
  // ones are still unreviewed — the whole reason to open this tab.
  const { data: bulk } = useQuery({
    queryKey: ['ontology', 'annotations', 'agent', 'bulk', agents.map((a) => a.id).join(',')],
    queryFn: () =>
      ontologyApi.annotationsBulk('agent', agents.map((a) => a.id)).then((r) => r.data),
    enabled: agents.length > 0,
  });

  const annotationsById = bulk?.annotations ?? {};
  const countFor = (id: string) =>
    Object.values(annotationsById[id] ?? {}).reduce((sum, ids) => sum + (ids?.length ?? 0), 0);

  // Names are not unique — two agents called "TestAgent" are indistinguishable
  // in a bare list, so those rows get their id as a subtitle.
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of agents) {
      const key = a.name.toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name));
  }, [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (onlyGaps && countFor(a.id) > 0) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.tier ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, query, onlyGaps, annotationsById]);

  const unannotated = agents.filter((a) => countFor(a.id) === 0).length;

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6 items-start">
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

        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
            {filtered.length} of {agents.length}
          </span>
          {unannotated > 0 && (
            <button
              onClick={() => setOnlyGaps((v) => !v)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                onlyGaps
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
              )}
              title="Show only agents with no annotations"
            >
              {unannotated} unannotated
            </button>
          )}
        </div>

        <div className="flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-6 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={13} className="animate-spin" />
              Loading agents…
            </div>
          ) : isError ? (
            <div className="px-2.5 py-6 text-xs">
              <p className="text-red-300">Could not load agents.</p>
              <button
                onClick={() => refetch()}
                className="mt-1 text-[var(--color-text-muted)] underline hover:text-white"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-xs text-[var(--color-text-muted)]">
              {agents.length === 0
                ? 'No agents exist yet. Create one in the Agent Studio.'
                : 'No agents match this filter.'}
            </p>
          ) : (
            filtered.map((a) => {
              const count = countFor(a.id);
              const ambiguous = duplicateNames.has(a.name.toLowerCase());
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={cn(
                    'text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                    selected === a.id
                      ? 'bg-[rgba(99,102,241,0.15)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                  )}
                  title={`${a.name}\n${a.id}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate flex-1 min-w-0">{a.name}</span>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums text-[10px] px-1 rounded',
                        count > 0
                          ? 'text-[var(--color-text-muted)]'
                          : 'bg-amber-500/15 text-amber-300',
                      )}
                      title={count > 0 ? `${count} annotations` : 'No annotations recorded'}
                    >
                      {count > 0 ? count : '—'}
                    </span>
                  </span>
                  {ambiguous && (
                    <code className="block truncate text-[9px] font-mono text-[var(--color-text-muted)] opacity-70">
                      {a.id}
                    </code>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected ? (
        <AnnotationEditor
          subjectId={selected}
          subjectName={agents.find((a) => a.id === selected)?.name ?? selected}
        />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] p-12 text-sm text-[var(--color-text-muted)]">
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

  // Ask a model to classify this agent against the vocabulary and write the
  // result. Distinct from the lexical guesses: it is shown the actual concept
  // list and picks from it, which is what catches an agent whose instructions
  // describe mortgage work without ever using the word.
  const classify = useMutation({
    mutationFn: () =>
      ontologyApi.classify({
        name: subjectName,
        subject_kind: 'agent',
        subject_type: 'agent',
        subject_id: subjectId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.annotations('agent', subjectId) });
      qc.invalidateQueries({ queryKey: ['ontology'] });
    },
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
      // Refresh the picker's coverage counts, so an agent stops showing as
      // unannotated the moment its first concept is saved.
      qc.invalidateQueries({ queryKey: ['ontology', 'annotations', 'agent', 'bulk'] });
      qc.invalidateQueries({ queryKey: QK.ontology() });
    },
  });

  if (isLoading) return <Loading label="Loading annotations…" />;

  const annotations: AnnotationMap = data?.annotations ?? {};
  const concepts = conceptData?.concepts ?? [];

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-white truncate">{subjectName}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {save.isPending && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}
          <button
            onClick={() => classify.mutate()}
            disabled={classify.isPending}
            title="Ask a model to classify this agent against the vocabulary"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-indigo-300 disabled:opacity-40"
          >
            {classify.isPending
              ? <Loader2 size={11} className="animate-spin" />
              : <Wand2 size={11} />}
            Classify with AI
          </button>
        </div>
      </div>
      {classify.data?.data && (
        <p className="mt-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-indigo-200">
          {classify.data.data.classified
            ? classify.data.data.result?.reasoning || 'Classification applied.'
            : classify.data.data.detail}
        </p>
      )}
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
  const [selected, setSelected] = useState<any>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ontology', 'scope', goal],
    queryFn: () => ontologyApi.scope(goal).then((r) => r.data),
    enabled: goal.trim().length > 2,
  });

  // The same scope, as the subgraph the planner would actually see. The score
  // list says *which* concepts matched; this says what that admits — which is
  // the question you are really asking when a workflow picked odd agents.
  const { data: graph, isFetching: graphLoading } = useQuery({
    queryKey: ['ontology', 'scope', 'graph', goal],
    queryFn: () => ontologyApi.scopeGraph(goal).then((r) => r.data),
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

      {/* The scope as a picture: the matched subtree and everything it admits. */}
      {data?.scoped && (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
              <Network size={12} className="text-indigo-400" />
              What this scope admits
            </span>
            {graph && (
              <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                {graph.totals.nodes} nodes · {graph.totals.edges} edges
              </span>
            )}
          </div>
          <div className="h-[440px]">
            <OntologyGraphCanvas
              graph={graph}
              isLoading={graphLoading}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              rootLabel="Scope"
              emptyHint="This goal matched a domain, but nothing is annotated under it yet."
            />
          </div>
          {graph && (
            <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-2">
              <GraphLegend counts={graph.counts} />
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
