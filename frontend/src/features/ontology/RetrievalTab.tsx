import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Loader2, Plug, Search, Sparkles,
} from 'lucide-react';
import { ragApi, type LibraryCard } from '../../api/rag';
import { ontologyApi, type Concept } from '../../api/ontology';
import { cn } from '../../lib/utils';
import { nodeStyle } from './graph/UnifiedGraphCanvas';

/**
 * The retrieval bench — ask what an agent would ask, and watch it happen.
 *
 * This runs the *same* path `search_domain_knowledge` runs: the query optimiser,
 * entity matching, graph traversal, and the curated industry knowledge for the
 * domain, merged and rendered under one attribution contract.
 *
 * The most useful thing on the page is the last section: the exact block the
 * model receives. When an answer is wrong, what the model was handed is nearly
 * always the explanation, and this is the only place it can be read.
 */

export default function RetrievalTab() {
  const [query, setQuery] = useState('');
  const [libraryId, setLibraryId] = useState('');
  const [domain, setDomain] = useState('');
  const [showRendered, setShowRendered] = useState(true);

  const { data: overview } = useQuery({
    queryKey: ['rag', 'overview'],
    queryFn: () => ragApi.overview().then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: conceptData } = useQuery({
    queryKey: ['ontology', 'concepts', 'domain'],
    queryFn: () => ontologyApi.concepts('domain').then((r) => r.data),
    staleTime: 300_000,
  });

  const search = useMutation({
    mutationFn: () =>
      ragApi.search({
        query,
        library_ids: libraryId ? [libraryId] : undefined,
        domains: domain ? [domain] : undefined,
        hops: 2,
        limit: 12,
      }),
  });

  const syncAgents = useMutation({ mutationFn: () => ragApi.syncAgents() });

  const libraries: LibraryCard[] = overview?.libraries ?? [];
  const domains = ((conceptData?.concepts ?? []) as Concept[])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const result = search.data?.data;
  const graph = result?.graph;
  const knowledge = result?.knowledge;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
          The retrieval an agent actually performs. One tool,{' '}
          <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-indigo-300">
            search_domain_knowledge
          </code>
          , searches the graph built from a library's documents and the curated
          industry knowledge for its domain, and returns both under one
          attribution contract.
        </p>
        <button
          onClick={() => syncAgents.mutate()}
          disabled={syncAgents.isPending}
          title="Attach the tool where an agent has something to search, remove it where it does not"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-50"
        >
          {syncAgents.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
          Sync tool to agents
        </button>
      </div>

      {syncAgents.data && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {syncAgents.data.data.skipped
            ? `Skipped — ${syncAgents.data.data.skipped}.`
            : `Checked ${syncAgents.data.data.checked} agents — ${syncAgents.data.data.attached} attached, ` +
              `${syncAgents.data.data.detached} detached (nothing to search), ` +
              `${syncAgents.data.data.unchanged} unchanged.`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query.trim() && search.mutate()}
            placeholder="Ask what an agent would ask — e.g. which suppliers is Contoso bound to?"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 py-2 pl-8 pr-3 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-400/50 focus:outline-none"
          />
        </div>
        <select
          value={libraryId}
          onChange={(e) => setLibraryId(e.target.value)}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-2 py-2 text-xs text-white focus:outline-none"
        >
          <option value="">All libraries</option>
          {libraries.map((library) => (
            <option key={library.id} value={library.id}>{library.name}</option>
          ))}
        </select>
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="max-w-[200px] rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-2 py-2 text-xs text-white focus:outline-none"
        >
          <option value="">All domains</option>
          {domains.map((concept) => (
            <option key={concept.id} value={concept.id}>{concept.label}</option>
          ))}
        </select>
        <button
          onClick={() => search.mutate()}
          disabled={!query.trim() || search.isPending}
          className="btn-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs disabled:opacity-50"
        >
          {search.isPending ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {!result && !search.isPending && (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Run a query to see every stage of retrieval.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-text-muted)]">
            The optimiser's rewrite, which entities matched, what the traversal
            found, the industry notes, and the exact prompt block the model
            receives.
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* ── The optimiser ─────────────────────────────────────────── */}
          {graph?.plan && (
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Query optimiser · {graph.plan.backend}
                {graph.plan.cached ? ' · cached' : ''}
              </p>
              <p className="mt-1 text-xs text-white">{graph.plan.rewritten}</p>
              {graph.plan.entity_hints?.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {graph.plan.entity_hints.map((hint) => (
                    <span
                      key={hint}
                      className="rounded border border-indigo-400/25 bg-indigo-500/10 px-1.5 py-px text-[10px] text-indigo-200"
                    >
                      {hint}
                    </span>
                  ))}
                </p>
              )}
              {graph.plan.sub_queries?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {graph.plan.sub_queries.map((sub) => (
                    <li key={sub} className="text-[11px] text-[var(--color-text-muted)]">↳ {sub}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!result.found && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              Nothing matched in either source. The agent would say so rather
              than answer from its own knowledge unmarked.
            </p>
          )}

          {/* ── From the documents ────────────────────────────────────── */}
          {graph?.entities && graph.entities.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                From the documents — matched entities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {graph.entities.map((entity) => {
                  const style = nodeStyle(entity.type);
                  return (
                    <span
                      key={`${entity.normalized}-${entity.type}`}
                      style={{ color: style.color, borderColor: `${style.color}44`, background: style.bg }}
                      className="rounded border px-2 py-0.5 text-[11px]"
                    >
                      {entity.name}
                      <span className="ml-1.5 font-mono text-[9px] opacity-70">
                        {entity.score?.toFixed(2)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {graph?.relations && graph.relations.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                From the documents — how they connect
              </p>
              <div className="space-y-1.5">
                {graph.relations.map((relation, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 px-3 py-2"
                  >
                    <p className="text-xs text-white">
                      {relation.source_name}{' '}
                      <span className="font-mono text-[10px] text-indigo-300">
                        —{relation.predicate}→
                      </span>{' '}
                      {relation.target_name}
                      {relation.hops > 1 && (
                        <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">
                          {relation.hops} hops
                        </span>
                      )}
                    </p>
                    {relation.evidence && (
                      <p className="mt-0.5 text-[10px] italic text-[var(--color-text-muted)]">
                        “{relation.evidence}”
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {relation.sources?.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Industry knowledge ────────────────────────────────────── */}
          {knowledge?.entries && knowledge.entries.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <Sparkles size={10} /> Industry knowledge
              </p>
              <div className="space-y-1.5">
                {knowledge.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 px-3 py-2"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-xs text-white">
                      {entry.title}
                      <span className="rounded border border-[var(--color-border-subtle)] px-1 text-[9px] text-[var(--color-text-muted)]">
                        {entry.kind}
                      </span>
                      {entry.as_of && (
                        <span className="text-[9px] text-[var(--color-text-muted)]">
                          as of {entry.as_of}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-3 text-[11px] text-[var(--color-text-secondary)]">
                      {entry.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── What the model actually receives ──────────────────────── */}
          <div>
            <button
              onClick={() => setShowRendered((v) => !v)}
              className={cn(
                'text-[11px] transition-colors',
                showRendered ? 'text-white' : 'text-[var(--color-text-muted)] hover:text-white',
              )}
            >
              {showRendered ? 'Hide' : 'Show'} exactly what the agent receives
            </button>
            {showRendered && (
              <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                {result.rendered}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
