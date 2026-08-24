import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronDown, ChevronRight, Circle, Loader2, MinusCircle,
} from 'lucide-react';
import { formatDuration } from '../../api/executions';
import { ragApi, type TimelineEvent } from '../../api/rag';
import { cn } from '../../lib/utils';

/**
 * What actually happened, stage by stage.
 *
 * Ingestion runs for minutes across a Mistral-side index, a text fetch, N chunk
 * extractions and a merge; a RAG answer is assembled from an optimiser, an
 * entity match, a traversal and a library search. Neither is visible in its
 * result, which is what this is for — a wrong answer is nearly always one bad
 * stage, and this is where you see which.
 *
 * Rendered as a tree with proportional bars, because the two questions are
 * "what nested inside what" and "where did the wall clock go". Per-chunk
 * extraction nests under the extraction stage rather than flattening into
 * forty sibling rows.
 */

const STATUS_STYLE: Record<string, { dot: string; bar: string; text: string }> = {
  ok:      { dot: 'text-emerald-400', bar: 'bg-emerald-500/50', text: 'text-emerald-300' },
  running: { dot: 'text-sky-400',     bar: 'bg-sky-500/50',     text: 'text-sky-300' },
  failed:  { dot: 'text-red-400',     bar: 'bg-red-500/60',     text: 'text-red-300' },
  skipped: { dot: 'text-slate-500',   bar: 'bg-slate-500/40',   text: 'text-slate-400' },
};

/** Stage names are snake_case handles; this is what a person reads. */
const STAGE_LABELS: Record<string, string> = {
  ingest: 'Ingest document',
  library_indexing: 'Mistral indexing',
  fetch_text: 'Fetch extracted text',
  chunk: 'Split into excerpts',
  extract: 'Extract entities & relations',
  extract_chunk: 'Excerpt',
  merge: 'Merge and deduplicate',
  commit: 'Commit to graph',
  sanitize: 'Re-check draft',
  graph_write: 'Write to Neo4j',
  optimize_query: 'Optimise query',
  entity_match: 'Match entities',
  graph_traverse: 'Traverse graph',
  entity_passages: 'Fetch source passages',
  knowledge_graph_tool: 'Knowledge graph lookup',
};

function label(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
}

interface TreeNode {
  event: TimelineEvent;
  children: TreeNode[];
  depth: number;
}

/** Build the parent/child tree, keeping each level in the order stages opened. */
function buildTree(events: TimelineEvent[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const event of events) {
    byId.set(event.id, { event, children: [], depth: 0 });
  }

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.event.parent_id != null ? byId.get(node.event.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      // A stage whose parent was pruned still has to appear, or a truncated
      // timeline would silently lose whole subtrees.
      roots.push(node);
    }
  }

  const assignDepth = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      node.depth = depth;
      node.children.sort((a, b) => a.event.seq - b.event.seq);
      assignDepth(node.children, depth + 1);
    }
  };
  roots.sort((a, b) => a.event.seq - b.event.seq);
  assignDepth(roots, 0);
  return roots;
}

/** Metadata worth showing inline; the rest stays in the expander. */
const INLINE_META = ['chunks', 'entities', 'relations', 'chars', 'matched', 'backend', 'passages'];

function MetaChips({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta).filter(
    ([key, value]) =>
      INLINE_META.includes(key) && value !== null && value !== undefined && value !== '',
  );
  if (!entries.length) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="rounded border border-[var(--color-border-subtle)] bg-black/20 px-1.5 py-px font-mono text-[10px] text-[var(--color-text-muted)]"
        >
          {key} {Array.isArray(value) ? value.length : String(value).slice(0, 40)}
        </span>
      ))}
    </span>
  );
}

function StageRow({ node, maxDuration }: { node: TreeNode; maxDuration: number }) {
  const [open, setOpen] = useState(false);
  const { event } = node;
  const style = STATUS_STYLE[event.status] ?? STATUS_STYLE.skipped;

  // Bars are proportional to the slowest stage in the trace, so a 40-chunk
  // extraction reads as the thing that took the time rather than one row of many.
  const width = maxDuration > 0 ? Math.max(2, ((event.duration_ms ?? 0) / maxDuration) * 100) : 2;
  const detail =
    Object.keys(event.meta ?? {}).length > 0 || event.message ? true : false;

  return (
    <>
      <div
        className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/[0.03]"
        style={{ paddingLeft: `${8 + node.depth * 18}px` }}
      >
        <button
          onClick={() => detail && setOpen((v) => !v)}
          className={cn('shrink-0', detail ? 'cursor-pointer' : 'cursor-default opacity-0')}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {event.status === 'running' ? (
          <Loader2 size={11} className={cn('shrink-0 animate-spin', style.dot)} />
        ) : event.status === 'failed' ? (
          <AlertTriangle size={11} className={cn('shrink-0', style.dot)} />
        ) : event.status === 'skipped' ? (
          <MinusCircle size={11} className={cn('shrink-0', style.dot)} />
        ) : (
          <Circle size={9} className={cn('shrink-0 fill-current', style.dot)} />
        )}

        <span className="w-52 shrink-0 truncate text-xs text-[var(--color-text-secondary)]">
          {label(event.stage)}
          {event.stage === 'extract_chunk' && event.meta?.chunk ? ` ${event.meta.chunk}` : ''}
        </span>

        <div className="h-1.5 min-w-[40px] flex-1 rounded-full bg-white/5">
          <div className={cn('h-full rounded-full', style.bar)} style={{ width: `${width}%` }} />
        </div>

        <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
          {event.status === 'running' ? '…' : formatDuration(event.duration_ms)}
        </span>

        <div className="hidden w-72 shrink-0 justify-end md:flex">
          <MetaChips meta={event.meta ?? {}} />
        </div>
      </div>

      {open && (
        <div
          className="mb-1 space-y-1 rounded border border-[var(--color-border-subtle)] bg-black/20 px-3 py-2 text-[11px]"
          style={{ marginLeft: `${34 + node.depth * 18}px` }}
        >
          {event.message && (
            <p className={cn('font-mono', style.text)}>{event.message}</p>
          )}
          {Object.entries(event.meta ?? {}).map(([key, value]) => (
            <p key={key} className="flex gap-2 text-[var(--color-text-muted)]">
              <span className="w-32 shrink-0 font-mono text-[10px]">{key}</span>
              <span className="min-w-0 flex-1 break-words font-mono text-[10px] text-[var(--color-text-secondary)]">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </p>
          ))}
        </div>
      )}

      {node.children.map((child) => (
        <StageRow key={child.event.id} node={child} maxDuration={maxDuration} />
      ))}
    </>
  );
}

export function TimelineTree({ events }: { events: TimelineEvent[] }) {
  const tree = useMemo(() => buildTree(events), [events]);
  const maxDuration = useMemo(
    () => Math.max(1, ...events.map((e) => e.duration_ms ?? 0)),
    [events],
  );

  if (!events.length) {
    return (
      <p className="px-2 py-3 text-xs text-[var(--color-text-muted)]">
        No stages recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <StageRow key={node.event.id} node={node} maxDuration={maxDuration} />
      ))}
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * Follow one trace over SSE.
 *
 * Each stage arrives twice — once when it opens, once when it closes with its
 * duration — so events are merged by id rather than appended, or a running
 * stage would sit in the list forever next to its own finished copy.
 *
 * The stream ends itself with `done` once nothing is running, which is what
 * stops a finished ingest holding a connection open for the life of the tab.
 */
function useTraceStream(traceId: string) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    setEvents([]);
    setLive(false);

    const source = new EventSource(`${API_BASE}${ragApi.traceStreamUrl(traceId)}`);

    const onStage = (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data) as TimelineEvent;
        setEvents((previous) => {
          const merged = previous.filter((e) => e.id !== event.id);
          merged.push(event);
          merged.sort((a, b) => a.seq - b.seq);
          return merged;
        });
        setLive(true);
      } catch {
        // A malformed frame should cost that frame, not the stream.
      }
    };

    const close = () => {
      setLive(false);
      source.close();
    };

    source.addEventListener('stage', onStage as EventListener);
    source.addEventListener('done', close);
    // Fires for a server-sent `error` frame and for a dropped connection alike;
    // the snapshot below is what keeps the view populated either way.
    source.onerror = close;

    return () => source.close();
  }, [traceId]);

  return { events, live };
}

/**
 * One trace: a snapshot for what already happened, the stream for what is
 * happening now.
 *
 * Both, rather than either. The stream alone would leave the panel empty if
 * EventSource cannot connect through a proxy; the snapshot alone would need
 * polling to stay current. Streamed stages win where the two overlap, because
 * they are by definition newer.
 */
export function TraceView({ traceId }: { traceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'timeline', traceId],
    queryFn: () => ragApi.trace(traceId).then((r) => r.data),
  });

  const { events: streamed, live } = useTraceStream(traceId);

  const events = useMemo(() => {
    const byId = new Map<number, TimelineEvent>();
    for (const event of data?.events ?? []) byId.set(event.id, event);
    for (const event of streamed) byId.set(event.id, event);
    return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
  }, [data, streamed]);

  if (isLoading && !events.length) {
    return (
      <p className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading timeline…
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {live && (
        <p className="flex items-center gap-1.5 px-2 text-[10px] text-sky-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
          live
        </p>
      )}
      <TimelineTree events={events} />
    </div>
  );
}

/** The tab-level view: recent runs on the left, the selected one expanded. */
export default function RagTimeline({ subject }: { subject?: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'traces', subject ?? 'all'],
    queryFn: () => ragApi.traces({ subject, limit: 30 }).then((r) => r.data),
    refetchInterval: (query) =>
      (query.state.data?.traces ?? []).some((t) => t.status === 'running') ? 3000 : false,
  });

  const traces = data?.traces ?? [];
  const active = selected ?? traces[0]?.trace_id ?? null;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading runs…
      </p>
    );
  }

  if (!traces.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-8 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No processing runs yet.</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Upload a document or run a graph search — every stage of both is recorded here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-1">
        {traces.map((trace) => {
          const style = STATUS_STYLE[trace.status] ?? STATUS_STYLE.skipped;
          return (
            <button
              key={trace.trace_id}
              onClick={() => setSelected(trace.trace_id)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                active === trace.trace_id
                  ? 'border-indigo-400/40 bg-indigo-500/10'
                  : 'border-[var(--color-border-subtle)] hover:border-indigo-400/25',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white">
                  {label(trace.root_stage ?? trace.scope)}
                </span>
                <span className={cn('shrink-0 text-[10px]', style.text)}>
                  {trace.status === 'running' ? 'running' : trace.status}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                  {trace.subject}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {trace.stages} stages
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2">
        {active ? <TraceView traceId={active} /> : null}
      </div>
    </div>
  );
}
