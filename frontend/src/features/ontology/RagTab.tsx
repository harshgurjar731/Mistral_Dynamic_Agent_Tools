import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Combine, Database, FileText,
  GitBranch, Layers, Loader2, Network, RefreshCw, Shapes, Sparkles,
  Tag, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import {
  ragApi,
  type DraftEntity,
  type DraftRelation,
  type LibraryCard,
  type RagDocument,
} from '../../api/rag';
import { cn } from '../../lib/utils';
import UnifiedGraphCanvas, { nodeStyle as entityStyle } from './graph/UnifiedGraphCanvas';
import OntologyDesigner from './OntologyDesigner';
import RagTimeline, { TraceView } from './RagTimeline';

/**
 * Graph RAG — the document side of what an agent knows.
 *
 * The Knowledge tab holds facts we wrote about an industry. This holds facts
 * extracted from documents the user uploaded, and the pipeline is deliberately
 * visible rather than magic: upload, watch it process, read what a model
 * proposed, correct it, and only then commit it to the graph. Nothing an agent
 * can retrieve got there without someone approving it.
 */

const STATUS_TONE: Record<string, string> = {
  uploaded:    'text-slate-300 border-slate-400/30 bg-slate-500/10',
  indexing:    'text-sky-300 border-sky-400/30 bg-sky-500/10',
  extracted:   'text-sky-300 border-sky-400/30 bg-sky-500/10',
  extracting:  'text-indigo-300 border-indigo-400/30 bg-indigo-500/10',
  proposed:    'text-amber-300 border-amber-400/30 bg-amber-500/10',
  graphed:     'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  unsupported: 'text-slate-400 border-slate-500/30 bg-slate-600/10',
  failed:      'text-red-300 border-red-400/30 bg-red-500/10',
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  indexing: 'Indexing',
  extracted: 'Text ready',
  extracting: 'Extracting',
  proposed: 'Needs review',
  graphed: 'In graph',
  unsupported: 'No text',
  failed: 'Failed',
};

/** Statuses that mean work is in flight, so the list should keep polling. */
const LIVE = new Set(['indexing', 'extracted', 'extracting']);

/**
 * The closed entity vocabulary, mirrored from app/rag/prompts.py.
 *
 * A reviewer picks from a list rather than typing free text for the same reason
 * extraction does: an open vocabulary produces "Company", "company" and
 * "Corporation" for one idea, and entity identity is keyed on the type.
 */
const ENTITY_TYPES = [
  'Person', 'Organization', 'Product', 'Process', 'Metric',
  'Regulation', 'System', 'Location', 'Event', 'Concept',
];

type View = 'libraries' | 'graph' | 'timeline';

export default function RagTab() {
  const [view, setView] = useState<View>('libraries');
  const [library, setLibrary] = useState<LibraryCard | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'overview'],
    queryFn: () => ragApi.overview().then((r) => r.data),
    refetchInterval: 15_000,
  });

  const graph = data?.graph;

  const views: { key: View; label: string; icon: typeof Layers }[] = [
    { key: 'libraries', label: 'Libraries', icon: Database },
    { key: 'graph', label: 'Graph', icon: Network },
    { key: 'timeline', label: 'Timeline', icon: GitBranch },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
          Documents become two things an agent can search: the library text
          through{' '}
          <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-indigo-300">
            document_library
          </code>{' '}
          and a knowledge graph through{' '}
          <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-indigo-300">
            search_domain_knowledge
          </code>
          . Ask the library what a passage says; ask the other what we know.
        </p>
        {data && (
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span className="font-mono tabular-nums">{data.totals.entities ?? 0} entities</span>
            <span className="font-mono tabular-nums">{data.totals.relations ?? 0} relations</span>
          </div>
        )}
      </div>

      {graph && !graph.available && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            The knowledge graph is unreachable ({graph.reason ?? 'unknown reason'}). Documents still
            upload and stay searchable through the document library — only the graph half is off.
            Start it with{' '}
            <code className="rounded bg-black/40 px-1 font-mono">docker compose up -d neo4j</code>.
          </span>
        </p>
      )}

      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => { setView(v.key); if (v.key !== 'libraries') setLibrary(null); }}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors',
              view === v.key
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-white',
            )}
          >
            <v.icon size={12} /> {v.label}
          </button>
        ))}
      </div>

      {view === 'libraries' &&
        (library ? (
          <LibraryDetail library={library} onBack={() => setLibrary(null)} />
        ) : (
          <LibraryGrid
            libraries={data?.libraries ?? []}
            loading={isLoading}
            onOpen={setLibrary}
          />
        ))}

      {view === 'graph' && <GraphView libraries={data?.libraries ?? []} />}
      {view === 'timeline' && <RagTimeline />}
    </div>
  );
}

// ── Library cards ──────────────────────────────────────────────────────────

function LibraryGrid({
  libraries,
  loading,
  onOpen,
}: {
  libraries: LibraryCard[];
  loading: boolean;
  onOpen: (library: LibraryCard) => void;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading libraries…
      </p>
    );
  }

  if (!libraries.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-10 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No document libraries yet.</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Create one in the Libraries page, then upload documents here to build its graph.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {libraries.map((library) => {
        const total = library.tracked_documents || library.document_count || 0;
        const progress = total ? Math.round((library.graphed_documents / total) * 100) : 0;
        return (
          <button
            key={library.id}
            onClick={() => onOpen(library)}
            className="group rounded-xl border border-[var(--color-border-subtle)] bg-black/20 p-4 text-left transition-colors hover:border-indigo-400/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{library.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-text-muted)]">
                  {library.description || 'No description'}
                </p>
              </div>
              <ChevronRight
                size={14}
                className="mt-1 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5"
              />
            </div>

            <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1">
                <FileText size={11} /> {total}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles size={11} /> {library.entities}
              </span>
              <span className="flex items-center gap-1">
                <Network size={11} /> {library.relations}
              </span>
              {library.ontology_version ? (
                <span
                  title={`Content schema v${library.ontology_version}: ${library.content_types.join(', ')}`}
                  className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1 text-[9px] text-emerald-300"
                >
                  schema v{library.ontology_version}
                </span>
              ) : (
                <span className="rounded border border-[var(--color-border-subtle)] px-1 text-[9px] text-[var(--color-text-muted)]">
                  generic
                </span>
              )}
              {library.has_rules && (
                <span className="rounded border border-indigo-400/25 bg-indigo-500/10 px-1 text-[9px] text-indigo-300">
                  rules
                </span>
              )}
            </div>

            {/* How much of the library an agent can actually traverse. */}
            <div className="mt-3 h-1 rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-emerald-500/60"
                style={{ width: `${progress}%` }}
              />
            </div>
            {library.content_types?.length > 0 && (
              <p className="mt-1.5 truncate text-[10px] text-[var(--color-text-muted)]">
                {library.content_types.slice(0, 5).join(' · ')}
              </p>
            )}

            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              {library.graphed_documents} of {total} in the graph
              {library.pending_documents ? ` · ${library.pending_documents} pending` : ''}
              {library.failed_documents ? ` · ${library.failed_documents} failed` : ''}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ── One library: documents, rules, upload ──────────────────────────────────

function LibraryDetail({ library, onBack }: { library: LibraryCard; onBack: () => void }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [reviewing, setReviewing] = useState<RagDocument | null>(null);
  const [showRules, setShowRules] = useState(false);
  // A file chosen but not yet uploaded — the rules step happens in between.
  const [pending, setPending] = useState<File | null>(null);
  // A document being re-extracted, so new rules can be supplied first.
  const [reextracting, setReextracting] = useState<RagDocument | null>(null);
  const [designing, setDesigning] = useState(false);
  const [assigningDomain, setAssigningDomain] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'documents', library.id],
    queryFn: () => ragApi.documents(library.id).then((r) => r.data),
    // Poll only while something is actually processing.
    refetchInterval: (query) =>
      (query.state.data?.documents ?? []).some((d) => LIVE.has(d.status)) ? 3000 : false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rag', 'documents', library.id] });
    qc.invalidateQueries({ queryKey: ['rag', 'overview'] });
  };

  const upload = useMutation({
    mutationFn: ({ file, rules, autoExtract }: { file: File; rules: string; autoExtract: boolean }) =>
      ragApi.upload(library.id, file, rules, autoExtract),
    onSuccess: () => { setPending(null); refresh(); },
  });

  const extract = useMutation({
    mutationFn: ({ id, rules }: { id: number; rules: string }) => ragApi.extract(id, rules),
    onSuccess: () => { setReextracting(null); refresh(); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => ragApi.deleteDocument(id),
    onSuccess: refresh,
  });

  const documents = data?.documents ?? [];

  if (designing) {
    return (
      <OntologyDesigner
        libraryId={library.id}
        libraryName={library.name}
        onBack={() => { setDesigning(false); refresh(); }}
      />
    );
  }

  if (reviewing) {
    return (
      <DraftReview
        document={reviewing}
        onClose={() => { setReviewing(null); refresh(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-white"
        >
          <ArrowLeft size={12} /> All libraries
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAssigningDomain(true)}
            title="Which business domain this library serves — what lets a planner pick it"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
          >
            <Tag size={12} /> Domain
          </button>
          <button
            onClick={() => setDesigning(true)}
            title="The entity types and predicates everything extracted from this library must use"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
          >
            <Shapes size={12} /> Content schema
          </button>
          <button
            onClick={() => setShowRules(true)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
          >
            Rules
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Hold the file; the rules step decides what happens to it.
              if (file) setPending(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload document
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-white">{library.name}</h3>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {library.entities} entities · {library.relations} relations ·{' '}
          {library.ontology_version
            ? `content schema v${library.ontology_version}`
            : 'no content schema — extraction uses the generic vocabulary'}
          {library.serves_domain?.length
            ? ` · serves ${library.serves_domain.join(', ')}`
            : ' · no domain assigned'}
        </p>
        {!library.ontology_version && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-200/90">
            <Wand2 size={12} className="mt-px shrink-0" />
            Designing a content schema first gives this library types and
            predicates that fit its documents, instead of ten generic buckets.
          </p>
        )}
      </div>

      {upload.isError && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Upload failed: {(upload.error as { message?: string })?.message ?? 'unknown error'}
        </p>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={12} className="animate-spin" /> Loading documents…
        </p>
      ) : !documents.length ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">No documents in this library.</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Upload one to build its knowledge graph.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              onReview={() => setReviewing(doc)}
              onExtract={() => setReextracting(doc)}
              onDelete={() => remove.mutate(doc.id)}
              busy={extract.isPending || remove.isPending}
            />
          ))}
        </div>
      )}

      {showRules && <RulesEditor libraryId={library.id} onClose={() => { setShowRules(false); refresh(); }} />}

      {assigningDomain && (
        <DomainEditor
          libraryId={library.id}
          libraryName={library.name}
          onClose={() => { setAssigningDomain(false); refresh(); }}
        />
      )}

      {pending && (
        <ExtractionDialog
          mode="upload"
          filename={pending.name}
          libraryId={library.id}
          initialRules={data?.rules ?? ''}
          busy={upload.isPending}
          onCancel={() => setPending(null)}
          onConfirm={(rules, autoExtract) =>
            upload.mutate({ file: pending, rules, autoExtract })
          }
        />
      )}

      {reextracting && (
        <ExtractionDialog
          mode="reextract"
          filename={reextracting.filename}
          libraryId={library.id}
          initialRules={reextracting.rules || data?.rules || ''}
          busy={extract.isPending}
          onCancel={() => setReextracting(null)}
          onConfirm={(rules) => extract.mutate({ id: reextracting.id, rules })}
        />
      )}
    </div>
  );
}

function DocumentRow({
  document,
  onReview,
  onExtract,
  onDelete,
  busy,
}: {
  document: RagDocument;
  onReview: () => void;
  onExtract: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [openTrace, setOpenTrace] = useState(false);
  const [openGraph, setOpenGraph] = useState(false);
  const live = LIVE.has(document.status);

  // The document's own slice of the graph: what this file alone contributed.
  // Fetched only when opened — a library of fifty documents should not make
  // fifty graph queries to render a list.
  const { data: docGraph } = useQuery({
    queryKey: ['rag', 'graph', 'unified', 'document', document.id],
    queryFn: () =>
      ragApi.unifiedGraph({ document_id: document.id, entity_limit: 200 })
        .then((r) => r.data),
    enabled: openGraph,
  });

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <FileText size={13} className="shrink-0 text-[var(--color-text-muted)]" />
        <span className="min-w-0 flex-1 truncate text-xs text-white">{document.filename}</span>

        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[10px]',
            STATUS_TONE[document.status] ?? STATUS_TONE.uploaded,
          )}
        >
          {live && <Loader2 size={9} className="animate-spin" />}
          {STATUS_LABEL[document.status] ?? document.status}
        </span>

        {document.chunk_count > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
            {document.chunk_count} excerpts
          </span>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {document.status === 'graphed' && (
            <button
              onClick={() => setOpenGraph((v) => !v)}
              title="Show the graph this document contributed"
              className={cn(
                'rounded p-1 hover:bg-white/5 hover:text-white',
                openGraph ? 'text-indigo-300' : 'text-[var(--color-text-muted)]',
              )}
            >
              <Network size={12} />
            </button>
          )}
          {document.trace_id && (
            <button
              onClick={() => setOpenTrace((v) => !v)}
              title="Show what happened, stage by stage"
              className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-white"
            >
              <GitBranch size={12} />
            </button>
          )}
          {(document.status === 'proposed' || document.status === 'graphed') && (
            <button
              onClick={onReview}
              className="rounded border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-200 hover:bg-indigo-500/20"
            >
              {document.status === 'graphed' ? 'View graph draft' : 'Review'}
            </button>
          )}
          <button
            onClick={onExtract}
            disabled={busy || live}
            title="Extract again — the existing graph stands until you commit the new draft"
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            title="Delete the document, its draft and everything it alone contributed to the graph"
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {document.error && (
        <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-[11px] text-amber-300/90">
          {document.error}
        </p>
      )}

      {openGraph && (
        <div className="space-y-2 border-t border-[var(--color-border-subtle)] p-2">
          {docGraph ? (
            <UnifiedGraphCanvas
              graph={docGraph}
              height={380}
              clusterBy="type"
              title={document.filename}
            />
          ) : (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={12} className="animate-spin" /> Loading this document's graph…
            </p>
          )}
        </div>
      )}

      {openTrace && document.trace_id && (
        <div className="border-t border-[var(--color-border-subtle)] p-2">
          <TraceView traceId={document.trace_id} />
        </div>
      )}
    </div>
  );
}

// ── Extraction rules ───────────────────────────────────────────────────────

function RulesEditor({ libraryId, onClose }: { libraryId: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['rag', 'rules', libraryId],
    queryFn: () => ragApi.rules(libraryId).then((r) => r.data),
  });
  const [text, setText] = useState<string | null>(null);
  const value = text ?? data?.rules ?? '';

  const save = useMutation({
    mutationFn: () => ragApi.setRules(libraryId, value),
    onSuccess: onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated,#0b1120)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-white">Extraction rules</h3>
            <p className="mt-1 max-w-lg text-xs text-[var(--color-text-muted)]">
              What to pull out of documents in this library. These extend the built-in
              contract below — they narrow or add to it, and never replace the
              evidence requirement or the output format.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-text-muted)] hover:text-white">
            <X size={14} />
          </button>
        </div>

        <textarea
          value={value}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={'e.g. "Only extract parties, obligations and dates. Treat each numbered clause as a Regulation entity."'}
          className="mt-4 w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-400/50 focus:outline-none"
        />

        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-[var(--color-text-muted)] hover:text-white">
            Show the built-in contract every extraction follows
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            {data?.default_instructions ?? '…'}
          </pre>
        </details>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save rules
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The rules step, shown before anything is extracted.
 *
 * Extraction is one LLM pass over the whole document and the rules are the
 * only lever on what it looks for. Starting it the instant a file is picked
 * takes that lever away — by the time the user sees the draft, the call is
 * already paid for and the only fix is to re-extract. So the file is chosen,
 * the rules are confirmed, and only then does the work start.
 *
 * Pre-filled with the library default, because a library is usually one kind
 * of document and the useful rule is the same for every file in it.
 */
function ExtractionDialog({
  mode,
  filename,
  libraryId,
  initialRules,
  busy,
  onCancel,
  onConfirm,
}: {
  mode: 'upload' | 'reextract';
  filename: string;
  libraryId: string;
  initialRules: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (rules: string, autoExtract: boolean) => void;
}) {
  const [rules, setRules] = useState(initialRules);
  const [autoExtract, setAutoExtract] = useState(true);

  const { data } = useQuery({
    queryKey: ['rag', 'rules', libraryId],
    queryFn: () => ragApi.rules(libraryId).then((r) => r.data),
    staleTime: 300_000,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated,#0b1120)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-white">
              {mode === 'upload' ? 'Extraction rules' : 'Re-extract with new rules'}
            </h3>
            <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
              {filename}
            </p>
          </div>
          <button onClick={onCancel} className="rounded p-1 text-[var(--color-text-muted)] hover:text-white">
            <X size={14} />
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Tell the extractor what matters in this document. Leave it empty to use
          the built-in contract alone — that already extracts typed entities and
          evidence-backed relations.
          {mode === 'reextract' && ' The existing graph stands until you commit the new draft.'}
        </p>

        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={5}
          autoFocus
          placeholder={'e.g. "Treat each numbered clause as a source of obligations. Capture parties, subcontractors and named standards."'}
          className="mt-3 w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-400/50 focus:outline-none"
        />

        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-[var(--color-text-muted)] hover:text-white">
            Show the built-in contract these rules extend
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            {data?.default_instructions ?? '…'}
          </pre>
        </details>

        {mode === 'upload' && (
          <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={autoExtract}
              onChange={(e) => setAutoExtract(e.target.checked)}
              className="accent-indigo-500"
            />
            Extract entities now
            <span className="text-[var(--color-text-muted)]">
              — uncheck to upload only; the document stays searchable through the
              document library and can be extracted later.
            </span>
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(rules, autoExtract)}
            disabled={busy}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {mode === 'upload'
              ? autoExtract ? 'Upload and extract' : 'Upload only'
              : 'Re-extract'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Draft review ───────────────────────────────────────────────────────────

/**
 * The approval gate.
 *
 * Everything here is editable before it becomes graph. Deleting an entity takes
 * its relations with it — the server re-derives that on save, and the response
 * says how many edges went, so a reviewer is never surprised by what commit
 * actually wrote.
 */
function DraftReview({ document, onClose }: { document: RagDocument; onClose: () => void }) {
  const qc = useQueryClient();
  const [entities, setEntities] = useState<DraftEntity[] | null>(null);
  const [relations, setRelations] = useState<DraftRelation[] | null>(null);
  const [tab, setTab] = useState<'entities' | 'relations'>('entities');
  // Which entity is being merged away, by normalised name.
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rag', 'draft', document.id],
    queryFn: () => ragApi.draft(document.id).then((r) => r.data),
  });

  const draft = data?.draft;
  const currentEntities = entities ?? draft?.entities ?? [];
  const currentRelations = relations ?? draft?.relations ?? [];
  const dirty = entities !== null || relations !== null;

  const save = useMutation({
    mutationFn: () => ragApi.saveDraft(document.id, currentEntities, currentRelations),
    onSuccess: (res) => {
      setEntities(res.data.draft.entities);
      setRelations(res.data.draft.relations);
      qc.invalidateQueries({ queryKey: ['rag', 'draft', document.id] });
    },
  });

  const commit = useMutation({
    mutationFn: async () => {
      if (dirty) await ragApi.saveDraft(document.id, currentEntities, currentRelations);
      return ragApi.commit(document.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rag'] });
      onClose();
    },
  });

  /**
   * Fold one entity into another.
   *
   * Extraction splits the same thing across spellings more often than it
   * invents things — "Northwind", "Northwind Trading" and "Northwind Trading
   * Ltd" arriving as three nodes is the single most common defect in a draft,
   * and no automatic rule catches all of it. The loser's name becomes an alias
   * of the winner (so full-text search still finds it), its evidence is kept,
   * and every relation that pointed at it is repointed.
   */
  const mergeEntities = (fromNormalized: string, intoNormalized: string) => {
    const from = currentEntities.find((e) => e.normalized === fromNormalized);
    const into = currentEntities.find((e) => e.normalized === intoNormalized);
    if (!from || !into || from === into) return;

    const aliases = [...into.aliases];
    for (const alias of [from.name, ...from.aliases]) {
      if (alias && !aliases.includes(alias) && alias !== into.name) aliases.push(alias);
    }

    const merged: DraftEntity = {
      ...into,
      aliases: aliases.slice(0, 8),
      description: into.description || from.description,
      confidence: Math.max(into.confidence ?? 0, from.confidence ?? 0),
      mentions: [...(into.mentions ?? []), ...(from.mentions ?? [])].slice(0, 10),
    };

    setEntities(
      currentEntities
        .filter((e) => e.normalized !== fromNormalized)
        .map((e) => (e.normalized === intoNormalized ? merged : e)),
    );

    setRelations(
      currentRelations
        .map((r) => ({
          ...r,
          source: r.source_normalized === fromNormalized ? into.name : r.source,
          source_normalized:
            r.source_normalized === fromNormalized ? intoNormalized : r.source_normalized,
          source_type: r.source_normalized === fromNormalized ? into.type : r.source_type,
          target: r.target_normalized === fromNormalized ? into.name : r.target,
          target_normalized:
            r.target_normalized === fromNormalized ? intoNormalized : r.target_normalized,
          target_type: r.target_normalized === fromNormalized ? into.type : r.target_type,
        }))
        // Repointing can make a relation point at itself, which says nothing.
        .filter((r) => r.source_normalized !== r.target_normalized),
    );
    setMergeFrom(null);
  };

  const dropEntity = (normalized: string) => {
    setEntities(currentEntities.filter((e) => e.normalized !== normalized));
    // Mirrored client-side so the count updates immediately; the server is
    // still the authority and re-derives it on save.
    setRelations(
      currentRelations.filter(
        (r) => r.source_normalized !== normalized && r.target_normalized !== normalized,
      ),
    );
  };

  const patchEntity = (index: number, patch: Partial<DraftEntity>) => {
    const next = [...currentEntities];
    next[index] = { ...next[index], ...patch };
    setEntities(next);
  };

  const patchRelation = (index: number, patch: Partial<DraftRelation>) => {
    const next = [...currentRelations];
    next[index] = { ...next[index], ...patch };
    setRelations(next);
  };

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading draft…
      </p>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-3">
        <button onClick={onClose} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-white">
          <ArrowLeft size={12} /> Back
        </button>
        <p className="rounded-lg border border-dashed border-[var(--color-border-subtle)] px-4 py-8 text-center text-xs text-[var(--color-text-muted)]">
          Nothing extracted from this document yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onClose} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-white">
          <ArrowLeft size={12} /> Back to documents
        </button>
        <div className="flex items-center gap-2">
          {save.data && (
            <span className="text-[11px] text-[var(--color-text-muted)]">
              Saved
              {save.data.data.dropped_relations
                ? ` · ${save.data.data.dropped_relations} relation(s) dropped — an endpoint was removed`
                : ''}
            </span>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-40"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save edits'}
          </button>
          <button
            onClick={() => commit.mutate()}
            disabled={commit.isPending || !currentEntities.length}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {commit.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Commit to graph
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-white">{document.filename}</h3>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Proposed by {draft.model ?? 'the extractor'} · {currentEntities.length} entities,{' '}
          {currentRelations.length} relations
          {document.status === 'graphed' ? ' · already committed — recommitting replaces the current slice' : ''}
        </p>
      </div>

      {commit.isError && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {(commit.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            'Commit failed.'}
        </p>
      )}

      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {(['entities', 'relations'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'border-b-2 px-3 py-2 text-xs capitalize transition-colors',
              tab === key
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-white',
            )}
          >
            {key} ({key === 'entities' ? currentEntities.length : currentRelations.length})
          </button>
        ))}
      </div>

      {tab === 'entities' ? (
        <div className="space-y-1.5">
          {currentEntities.map((entity, index) => {
            const style = entityStyle(entity.type);
            return (
              <div
                key={`${entity.normalized}-${index}`}
                className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={entity.name}
                    onChange={(e) => patchEntity(index, { name: e.target.value })}
                    className="min-w-[160px] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-white hover:border-[var(--color-border-subtle)] focus:border-indigo-400/50 focus:outline-none"
                  />
                  <select
                    value={entity.type}
                    onChange={(e) => patchEntity(index, { type: e.target.value })}
                    style={{ color: style.color }}
                    className="rounded border border-[var(--color-border-subtle)] bg-black/40 px-1.5 py-0.5 text-[10px] focus:outline-none"
                  >
                    {ENTITY_TYPES.map((type) => (
                      <option key={type} value={type} className="text-white">
                        {type}
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                    {entity.confidence?.toFixed(2)}
                  </span>
                  <button
                    onClick={() =>
                      setMergeFrom(mergeFrom === entity.normalized ? null : entity.normalized)
                    }
                    title="Merge this entity into another — the same thing extracted twice"
                    className={cn(
                      'rounded p-1 hover:bg-white/5 hover:text-white',
                      mergeFrom === entity.normalized
                        ? 'text-indigo-300'
                        : 'text-[var(--color-text-muted)]',
                    )}
                  >
                    <Combine size={11} />
                  </button>
                  <button
                    onClick={() => dropEntity(entity.normalized)}
                    title="Remove this entity and any relation that uses it"
                    className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <input
                  value={entity.description}
                  onChange={(e) => patchEntity(index, { description: e.target.value })}
                  placeholder="Description"
                  className="mt-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border-subtle)] focus:border-indigo-400/50 focus:outline-none"
                />

                {mergeFrom === entity.normalized && (
                  <div className="mt-2 rounded border border-indigo-400/25 bg-indigo-500/5 p-2">
                    <p className="mb-1.5 text-[10px] text-indigo-200">
                      Merge “{entity.name}” into — it becomes an alias of whichever you pick:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {currentEntities
                        .filter((other) => other.normalized !== entity.normalized)
                        .map((other) => (
                          <button
                            key={other.normalized}
                            onClick={() => mergeEntities(entity.normalized, other.normalized)}
                            className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
                          >
                            {other.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Evidence is read-only: it is the document's words, not the reviewer's. */}
                {entity.mentions?.[0]?.quote && (
                  <p className="mt-1 border-l-2 border-[var(--color-border-subtle)] pl-2 text-[10px] italic text-[var(--color-text-muted)]">
                    “{entity.mentions[0].quote}”
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {currentRelations.map((relation, index) => (
            <div
              key={`${relation.source_normalized}-${relation.predicate}-${relation.target_normalized}-${index}`}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-white">{relation.source}</span>
                <input
                  value={relation.predicate}
                  onChange={(e) => patchRelation(index, { predicate: e.target.value })}
                  className="w-40 rounded border border-[var(--color-border-subtle)] bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 focus:border-indigo-400/50 focus:outline-none"
                />
                <span className="text-white">{relation.target}</span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {relation.confidence?.toFixed(2)}
                </span>
                <button
                  onClick={() => setRelations(currentRelations.filter((_, i) => i !== index))}
                  className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              {relation.evidence && (
                <p className="mt-1 border-l-2 border-[var(--color-border-subtle)] pl-2 text-[10px] italic text-[var(--color-text-muted)]">
                  “{relation.evidence}”
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Graph views ────────────────────────────────────────────────────────────

function GraphView({ libraries }: { libraries: LibraryCard[] }) {
  const [libraryId, setLibraryId] = useState<string>('');

  const { data, isFetching } = useQuery({
    queryKey: ['rag', 'graph', 'unified', libraryId || 'all'],
    queryFn: () =>
      ragApi.unifiedGraph({
        library_id: libraryId || undefined,
        entity_limit: libraryId ? 600 : 300,
      }).then((r) => r.data),
  });

  const graphed = libraries.filter((library) => library.entities > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setLibraryId('')}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs transition-colors',
            !libraryId
              ? 'border-indigo-400/40 bg-indigo-500/10 text-white'
              : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
          )}
        >
          Everything
        </button>
        {graphed.map((library) => (
          <button
            key={library.id}
            onClick={() => setLibraryId(library.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              libraryId === library.id
                ? 'border-indigo-400/40 bg-indigo-500/10 text-white'
                : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
            )}
          >
            {library.name}
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">
              {library.entities}
            </span>
          </button>
        ))}
        {isFetching && <Loader2 size={12} className="animate-spin text-[var(--color-text-muted)]" />}
      </div>

      <p className="text-[11px] text-[var(--color-text-muted)]">
        {libraryId
          ? 'This library: the domains it serves, its documents, and the entities extracted from them.'
          : 'Everything: the domain taxonomy, every library beneath it, their documents and entities.'}
        {' '}Entities are grouped by type — click any node to isolate what it
        connects to, and use the control at the top right for full screen.
      </p>

      {data && (
        <UnifiedGraphCanvas
          graph={data}
          height={620}
          clusterBy={libraryId ? 'type' : 'kind'}
          title={
            libraryId
              ? graphed.find((l) => l.id === libraryId)?.name
              : 'Platform knowledge graph'
          }
        />
      )}

      {data?.counts && (
        <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-text-muted)]">
          {Object.entries(data.counts).map(([kind, count]) => (
            <span key={kind} className="font-mono tabular-nums">
              {count} {kind}
              {count === 1 ? '' : 's'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Assigning the domain a library serves — the link to the platform taxonomy. */
function DomainEditor({
  libraryId,
  libraryName,
  onClose,
}: {
  libraryId: string;
  libraryName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[] | null>(null);

  const { data } = useQuery({
    queryKey: ['rag', 'domains', libraryId],
    queryFn: () => ragApi.domains(libraryId).then((r) => r.data),
  });

  const current = selected ?? data?.domains ?? [];

  const classify = useMutation({
    mutationFn: () => ragApi.classifyDomain(libraryId),
    onSuccess: (res) => setSelected(res.data.domains),
  });

  const save = useMutation({
    mutationFn: () => ragApi.setDomains(libraryId, current),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rag'] });
      onClose();
    },
  });

  const toggle = (id: string) =>
    setSelected(
      current.includes(id) ? current.filter((d) => d !== id) : [...current, id],
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated,#0b1120)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-white">Domain — {libraryName}</h3>
            <p className="mt-1 max-w-lg text-xs text-[var(--color-text-muted)]">
              What this library is about. A planner uses it to pick this library
              for a matching goal, and the validator uses it to catch an agent
              reading documents from the wrong domain.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-text-muted)] hover:text-white">
            <X size={14} />
          </button>
        </div>

        <button
          onClick={() => classify.mutate()}
          disabled={classify.isPending}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white disabled:opacity-50"
        >
          {classify.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          Work it out from the documents
        </button>

        <div className="mt-3 max-h-64 space-y-0.5 overflow-y-auto">
          {(data?.available ?? []).map((concept) => (
            <button
              key={concept.id}
              onClick={() => toggle(concept.id)}
              style={{ paddingLeft: `${8 + (concept.level ?? 0) * 14}px` }}
              className={cn(
                'flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-xs transition-colors',
                current.includes(concept.id)
                  ? 'bg-indigo-500/15 text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/5',
              )}
            >
              {current.includes(concept.id) ? (
                <Check size={11} className="shrink-0 text-indigo-300" />
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span className="truncate">{concept.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--color-text-muted)]">
                {concept.id}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
