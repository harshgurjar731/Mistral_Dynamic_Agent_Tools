import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Check, Loader2, Plug, Plus, Search, Sparkles, Trash2, X,
} from 'lucide-react';
import {
  ontologyApi,
  type Concept,
  type KnowledgeEntry,
} from '../../api/ontology';
import { cn } from '../../lib/utils';

/**
 * Industry knowledge — the corpus agents actually read at runtime.
 *
 * The Vocabulary tab says *which* industries exist. This says what they
 * involve, and it is the difference between an agent that knows it is a
 * mortgage agent and one that knows what a stress test is.
 *
 * The search box is deliberately the same code path the agent tool uses, so
 * what you see here is exactly what an agent would be handed — not an
 * approximation of it.
 */

const KIND_TONE: Record<string, string> = {
  definition: 'text-sky-300 border-sky-400/30 bg-sky-500/10',
  regulation: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
  process: 'text-indigo-300 border-indigo-400/30 bg-indigo-500/10',
  metric: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  risk: 'text-red-300 border-red-400/30 bg-red-500/10',
  best_practice: 'text-purple-300 border-purple-400/30 bg-purple-500/10',
  glossary: 'text-slate-300 border-slate-400/30 bg-slate-500/10',
};

const KINDS = [
  'definition', 'regulation', 'process', 'metric', 'risk', 'best_practice', 'glossary',
];

export default function KnowledgeTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [domain, setDomain] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const { data: conceptData } = useQuery({
    queryKey: ['ontology', 'concepts', 'domain'],
    queryFn: () => ontologyApi.concepts('domain').then((r) => r.data),
    staleTime: 300_000,
  });
  const domains = useMemo(
    () => ((conceptData?.concepts ?? []) as Concept[]).slice().sort((a, b) => a.id.localeCompare(b.id)),
    [conceptData],
  );

  const { data: all, isLoading } = useQuery({
    queryKey: ['ontology', 'knowledge', domain],
    queryFn: () =>
      ontologyApi.knowledge({ concept_id: domain || undefined, limit: 1000 }).then((r) => r.data),
  });

  // The agent tool's own retrieval, run on demand.
  const { data: preview, isFetching: searching } = useQuery({
    queryKey: ['ontology', 'knowledge', 'search', applied, domain],
    queryFn: () =>
      ontologyApi
        .searchKnowledge({ query: applied, domains: domain || undefined, limit: 6 })
        .then((r) => r.data),
    enabled: applied.trim().length > 1,
  });

  const attach = useMutation({
    mutationFn: () => ontologyApi.attachKnowledgeTool(),
  });

  const remove = useMutation({
    mutationFn: (id: number) => ontologyApi.deleteKnowledge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ontology', 'knowledge'] }),
  });

  const entries = (preview?.results ?? all?.entries ?? []) as KnowledgeEntry[];
  const isSearch = !!preview && applied.trim().length > 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
          What each industry actually involves. Agents retrieve from here at runtime through the{' '}
          <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-indigo-300">
            query_industry_knowledge
          </code>{' '}
          tool, scoped automatically to the domain they are annotated with.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => attach.mutate()}
            disabled={attach.isPending}
            title="Attach the tool where the agent's industry has knowledge, detach where it does not"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-50"
          >
            {attach.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
            Sync tool to agents
          </button>
          <button
            onClick={() => setShowEditor(true)}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
          >
            <Plus size={12} /> Add knowledge
          </button>
        </div>
      </div>

      {attach.data && (
        <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <Check size={12} />
          Checked {attach.data.data.checked} agents — {attach.data.data.attached} attached,{' '}
          {attach.data.data.detached} detached (their industry has no knowledge),{' '}
          {attach.data.data.unchanged} unchanged
          {attach.data.data.failed ? `, ${attach.data.data.failed} failed` : ''}.
        </p>
      )}

      {/* Retrieval preview — the same path the tool takes. */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
          <Sparkles size={12} className="text-indigo-400" />
          Rehearse a retrieval
        </p>
        <div className="flex flex-wrap gap-2">
          <form
            className="relative min-w-[220px] flex-1"
            onSubmit={(e) => { e.preventDefault(); setApplied(query.trim()); }}
          >
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask what an agent would ask, then press Enter…"
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/25 py-2 pl-8 pr-8 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
            />
            {applied && (
              <button
                type="button"
                onClick={() => { setQuery(''); setApplied(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </form>
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="minimal-input rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">Every industry</option>
            {domains.map((c) => (
              <option key={c.id} value={c.id}>
                {' '.repeat((c.level ?? 0) * 3)}{c.label}
              </option>
            ))}
          </select>
          {searching && <Loader2 size={14} className="mt-2 animate-spin text-[var(--color-text-muted)]" />}
        </div>
        {isSearch && (
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
            {preview!.count} entries would be handed to the agent
            {preview!.domains.length ? ` (scoped to ${preview!.domains.join(', ')})` : ' (unscoped)'}.
            Higher scores rank first.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Loading knowledge…
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] py-14 text-center">
          <BookOpen size={22} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {isSearch ? 'Nothing matched that query.' : 'No knowledge recorded yet.'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">
            {isSearch
              ? 'An agent asking this would fall back to general knowledge.'
              : 'Add an entry, or check the seed file loaded on startup.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="group rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                    KIND_TONE[entry.kind] ?? KIND_TONE.definition,
                  )}
                >
                  {entry.kind.replace('_', ' ')}
                </span>
                <h3 className="text-sm font-semibold text-white">{entry.title}</h3>
                <code className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {entry.concept_id}
                </code>
                {entry.as_of && (
                  <span
                    title="When this content was last known good"
                    className="rounded border border-amber-400/25 bg-amber-500/10 px-1.5 font-mono text-[9px] text-amber-300"
                  >
                    as of {entry.as_of}
                  </span>
                )}
                {entry.score != null && (
                  <span className="rounded bg-indigo-500/15 px-1.5 font-mono text-[10px] text-indigo-300">
                    {entry.score}
                  </span>
                )}
                <button
                  onClick={() => remove.mutate(entry.id)}
                  title="Delete this entry"
                  className="ml-auto rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {entry.body}
              </p>
              {entry.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {entry.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {showEditor && (
        <KnowledgeEditor
          domains={domains}
          defaultConcept={domain}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false);
            qc.invalidateQueries({ queryKey: ['ontology', 'knowledge'] });
          }}
        />
      )}
    </div>
  );
}

function KnowledgeEditor({
  domains, defaultConcept, onClose, onSaved,
}: {
  domains: Concept[];
  defaultConcept: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [conceptId, setConceptId] = useState(defaultConcept || domains[0]?.id || '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('definition');
  const [tags, setTags] = useState('');

  const save = useMutation({
    mutationFn: () =>
      ontologyApi.createKnowledge({
        concept_id: conceptId,
        title: title.trim(),
        body: body.trim(),
        kind,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: onSaved,
  });

  const detail = (save.error as any)?.response?.data?.detail;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Add industry knowledge</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Industry
              </span>
              <select
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
                className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
              >
                {domains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {' '.repeat((c.level ?? 0) * 3)}{c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Kind
              </span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k.replace('_', ' ')}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Affordability stress testing"
              className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Body
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder="The actual knowledge. Keep it compact — this goes into a live prompt."
              className="minimal-input w-full resize-none rounded-lg px-2.5 py-1.5 text-xs custom-scrollbar"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Tags
            </span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma separated — the words someone would search for"
              className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
            />
          </label>
        </div>

        {detail && (
          <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {detail}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary rounded-lg px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim() || !body.trim() || !conceptId}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {save.isPending && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
