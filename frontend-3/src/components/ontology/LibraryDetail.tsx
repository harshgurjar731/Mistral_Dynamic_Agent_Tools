import { useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Database,
  FileText,
  FileUp,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { errorMessage, ragApi } from "@/api";
import type { ExtractionDraft, LibraryCard, RagDocument } from "@/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreatedAt } from "@/components/shared/CreatedAt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { IngestTimeline } from "./IngestTimeline";
import { EntityGraph, type EntityEdge, type EntityNode } from "./EntityGraph";
import { ACCEPT, docCount, LIVE, STATUS_TONE, type LibraryPane } from "./libraryMeta";

/**
 * Everything about one library on its own page: documents and their ingest
 * status, uploads, the draft review, and the knowledge graph they produced.
 */
export function LibraryWorkspace({
  library,
  pane,
  onPane,
}: {
  library: LibraryCard;
  pane: LibraryPane;
  onPane: (pane: LibraryPane) => void;
}) {
  const qc = useQueryClient();
  const [reviewDoc, setReviewDoc] = useState<RagDocument | null>(null);
  /** A committed document drawn on its own, instead of the whole library. */
  const [graphDoc, setGraphDoc] = useState<RagDocument | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["rag", "documents", library.id] });
    qc.invalidateQueries({ queryKey: ["rag", "overview"] });
  };

  return (
    <>
      <LibraryDetail
        library={library}
        pane={pane}
        onPane={onPane}
        graphDoc={graphDoc}
        onGraphDoc={(doc) => {
          setGraphDoc(doc);
          if (doc) onPane("graph");
        }}
        onReview={setReviewDoc}
        onChanged={refresh}
      />
      {reviewDoc ? (
        <DraftReviewModal
          document={reviewDoc}
          open
          onOpenChange={(open) => !open && setReviewDoc(null)}
          onCommitted={() => {
            setReviewDoc(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function LibraryDetail({
  library,
  pane,
  onPane,
  graphDoc,
  onGraphDoc,
  onReview,
  onChanged,
}: {
  library: LibraryCard;
  pane: LibraryPane;
  onPane: (pane: LibraryPane) => void;
  graphDoc: RagDocument | null;
  onGraphDoc: (doc: RagDocument | null) => void;
  onReview: (doc: RagDocument) => void;
  onChanged: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [openTraces, setOpenTraces] = useState<Set<number>>(new Set());

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["rag", "documents", library.id],
    queryFn: () => ragApi.documents(library.id),
    refetchInterval: 8_000,
  });
  const documents = docsData?.documents ?? [];
  const liveDocs = documents.filter((d) => LIVE.has(d.status) && d.trace_id);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await ragApi.uploadDocument(library.id, file, "", true);
      return files.length;
    },
    onSuccess: (n) => {
      toast.success(
        n === 1
          ? "Document uploaded; extraction started."
          : `${n} documents uploaded; extraction started.`,
      );
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const send = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length) upload.mutate(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    send(e.dataTransfer.files);
  };

  const toggleTrace = (id: number) =>
    setOpenTraces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Counted from the document list once it loads: it also holds files that sit in
  // the Mistral library but were never ingested here, which the overview omits.
  const byStatus = (pred: (s: string) => boolean) => documents.filter((d) => pred(d.status)).length;
  const loaded = Boolean(docsData);
  const notIngested = byStatus((s) => s === "uploaded");
  const stats = [
    {
      label: "Documents",
      value: loaded ? documents.length : docCount(library),
      tone: "text-foreground",
    },
    {
      label: "Graphed",
      value: loaded ? byStatus((s) => s === "graphed") : library.graphed_documents,
      tone: "text-emerald",
    },
    {
      label: notIngested ? `Pending · ${notIngested} not ingested` : "Pending",
      value: loaded ? byStatus((s) => LIVE.has(s) || s === "proposed") : library.pending_documents,
      tone: "text-amber",
    },
    {
      label: "Failed",
      value: loaded
        ? byStatus((s) => s === "failed" || s === "unsupported")
        : library.failed_documents,
      tone: "text-red",
    },
    { label: "Entities", value: library.entities, tone: "text-cyan" },
    { label: "Relations", value: library.relations, tone: "text-purple" },
  ];

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-border/60 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-cyan/30 bg-cyan/10 text-cyan">
          <Database className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{library.name}</h2>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {library.description ||
              "Documents here are indexed for search and extracted into the knowledge graph."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <CreatedAt value={library.created_at} />
            {(library.serves_domain ?? []).map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full border border-purple/30 bg-purple/10 px-2 py-0.5 font-mono text-[10px] text-purple"
                title="Domain this library serves"
              >
                <Tags className="size-2.5" />
                {d}
              </span>
            ))}
            {library.content_types?.length ? (
              <span
                className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                title={library.content_types.join(", ")}
              >
                {library.content_types.length} entity types
                {library.ontology_version ? ` · ontology v${library.ontology_version}` : ""}
              </span>
            ) : null}
          </div>
        </div>
        <input
          type="file"
          multiple
          accept={ACCEPT}
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            send(e.target.files);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Upload documents
        </Button>
      </header>

      {/* ── Numbers ── */}
      <div className="grid grid-cols-3 gap-px border-b border-border/60 bg-border/40 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-background-elevated/70 px-3 py-2.5">
            <p
              className={cn(
                "font-display text-lg font-bold tabular-nums",
                s.value ? s.tone : "text-muted-foreground/50",
              )}
            >
              {s.value}
            </p>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Pane switch ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5">
          {(
            [
              { value: "documents", label: "Documents", icon: FileText, count: documents.length },
              { value: "graph", label: "Knowledge graph", icon: Network, count: library.entities },
            ] as const
          ).map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onPane(p.value)}
              aria-pressed={pane === p.value}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                pane === p.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <p.icon className="size-3.5" />
              {p.label}
              <span className="rounded-full bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                {p.count}
              </span>
            </button>
          ))}
        </div>
        {pane === "graph" && graphDoc ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/10 py-0.5 pr-1 pl-2.5 text-[11px] text-emerald">
            <FileText className="size-3" />
            {graphDoc.filename}
            <button
              type="button"
              onClick={() => onGraphDoc(null)}
              aria-label="Show the whole library"
              title="Show the whole library"
              className="grid size-4 place-items-center rounded-full hover:bg-emerald/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : null}
      </div>

      {/* ── Pane ── */}
      {pane === "graph" ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <LibraryGraphPane library={library} document={graphDoc} />
        </div>
      ) : (
        <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-left transition",
              dragging
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:border-primary/40 hover:bg-surface-hover/40",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              {upload.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">
                {upload.isPending ? "Uploading…" : "Drop files here, or click to choose"}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                PDF, DOCX, TXT or Markdown. Each is indexed for search, then its entities and
                relations are extracted for review.
              </span>
            </span>
          </button>

          {liveDocs.map((doc) => (
            <IngestTimeline
              key={`live-${doc.id}-${doc.trace_id}`}
              traceId={doc.trace_id}
              filename={doc.filename}
              onFinished={onChanged}
            />
          ))}

          {docsLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              <Loader2 className="mx-auto mb-2 size-4 animate-spin" /> Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No documents yet — upload one to start building this library's graph.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border/60">
              {documents.map((doc) => {
                const tone = STATUS_TONE[doc.status] ?? STATUS_TONE["uploaded"]!;
                const canReview = doc.status === "proposed" || doc.status === "graphed";
                const live = LIVE.has(doc.status);
                const traceOpen = openTraces.has(doc.id) && !live;
                return (
                  <li key={doc.id} className="border-b border-border/50 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-3 px-3 py-3 transition hover:bg-surface-hover/40">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground">
                        <FileText className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {doc.filename}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="tabular-nums">
                            {doc.char_count?.toLocaleString()} chars
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">{doc.chunk_count} excerpts</span>
                          {doc.created_at ? (
                            <>
                              <span>·</span>
                              <CreatedAt value={doc.created_at} label="Added" />
                            </>
                          ) : null}
                          {doc.trace_id && !live ? (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => toggleTrace(doc.id)}
                                aria-expanded={traceOpen}
                                className="inline-flex items-center gap-0.5 text-cyan hover:underline"
                              >
                                <ChevronRight
                                  className={cn(
                                    "size-3 transition-transform",
                                    traceOpen && "rotate-90",
                                  )}
                                />
                                {traceOpen ? "Hide timeline" : "Timeline"}
                              </button>
                            </>
                          ) : null}
                        </div>
                        {doc.error ? (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-red">
                            <AlertCircle className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-2">{doc.error}</span>
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          tone.bg,
                          tone.text,
                        )}
                        title={
                          doc.status === "uploaded"
                            ? "In the Mistral library, but never indexed or extracted here. Upload it through this page to add it to the graph."
                            : undefined
                        }
                      >
                        {live ? <Loader2 className="size-2.5 animate-spin" /> : null}
                        {doc.status === "uploaded" ? "not ingested" : doc.status}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {doc.status === "graphed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onGraphDoc(doc)}
                            className="h-7 text-xs"
                          >
                            <Network className="size-3 text-emerald" /> Graph
                          </Button>
                        ) : null}
                        {canReview ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReview(doc)}
                            className="h-7 text-xs"
                          >
                            <Sparkles className="size-3 text-cyan" />
                            {doc.status === "proposed" ? "Review draft" : "View extraction"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {traceOpen && doc.trace_id ? (
                      <div className="border-t border-border/50 bg-background/40 p-3">
                        <IngestTimeline traceId={doc.trace_id} filename={doc.filename} bare />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <FileUp className="size-4" /> Drop to upload to {library.name}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DraftReviewModal({
  document,
  open,
  onOpenChange,
  onCommitted,
}: {
  document: RagDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => void;
}) {
  const qc = useQueryClient();

  const { data: draftData, isLoading } = useQuery({
    queryKey: ["rag", "draft", document.id],
    queryFn: () => ragApi.draft(document.id),
  });

  const commitMutation = useMutation({
    mutationFn: () => ragApi.commit(document.id),
    onSuccess: (res) => {
      toast.success(
        `Committed ${res.entities} entities and ${res.relations} relations to Neo4j graph!`,
      );
      onCommitted();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const draft = draftData?.draft;
  const [view, setView] = useState<"graph" | "list">("graph");
  const draftGraph = useMemo(() => draftToGraph(draft), [draft]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl border-border bg-background-elevated/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-cyan" />
            <DialogTitle className="text-sm font-semibold text-foreground">
              Review Extraction: {document.filename}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Review model-extracted entities and relationships before committing to the Neo4j
            knowledge graph.
          </DialogDescription>
          {draft ? (
            <div className="mt-2 inline-flex w-fit rounded-lg border border-border/60 bg-background p-0.5">
              {(
                [
                  { value: "graph", label: "Graph", icon: Network },
                  { value: "list", label: "List", icon: FileText },
                ] as const
              ).map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setView(v.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    view === v.value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <v.icon className="size-3.5" />
                  {v.label}
                </button>
              ))}
            </div>
          ) : null}
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin mx-auto mb-2" /> Loading proposed draft…
          </div>
        ) : !draft ? (
          <EmptyState title="No extraction draft available" />
        ) : view === "graph" ? (
          <EntityGraph nodes={draftGraph.nodes} edges={draftGraph.edges} className="h-[62vh]" />
        ) : (
          <div className="custom-scrollbar max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {/* Entities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground">
                  Proposed Entities ({draft.entities?.length ?? 0})
                </span>
              </div>
              <div className="space-y-1.5">
                {draft.entities?.map((e, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-background-elevated/50 p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{e.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="technical-label">{e.type}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {(e.confidence * 100).toFixed(0)}% conf
                        </span>
                      </div>
                    </div>
                    {e.description && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{e.description}</p>
                    )}
                    {e.mentions?.[0]?.quote && (
                      <p className="mt-1 rounded bg-muted/20 p-1.5 text-[10px] font-mono text-muted-foreground/80 italic">
                        "{e.mentions[0].quote}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Relations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground">
                  Proposed Relations ({draft.relations?.length ?? 0})
                </span>
              </div>
              <div className="space-y-1.5">
                {draft.relations?.map((r, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-background-elevated/50 p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-semibold text-foreground">{r.source}</span>
                      <span className="technical-label text-[9px] uppercase">{r.predicate}</span>
                      <span className="font-semibold text-foreground">{r.target}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {(r.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {r.evidence && (
                      <p className="mt-1 rounded bg-muted/20 p-1.5 text-[10px] font-mono text-muted-foreground/80 italic">
                        "{r.evidence}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending || !draft}
            className="flex items-center gap-1.5"
          >
            {commitMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitBranch className="size-3.5" />
            )}
            Commit to Knowledge Graph
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A draft's entities and relations in graph form — reviewable before anything is committed. */
function draftToGraph(draft: ExtractionDraft | null | undefined): {
  nodes: EntityNode[];
  edges: EntityEdge[];
} {
  if (!draft) return { nodes: [], edges: [] };
  const key = (normalized: string, type: string) => `${normalized}::${type}`;
  const nodes = new Map<string, EntityNode>();
  for (const e of draft.entities ?? []) {
    nodes.set(key(e.normalized, e.type), {
      id: key(e.normalized, e.type),
      label: e.name,
      type: e.type,
      description: e.description,
      confidence: e.confidence,
    });
  }
  const edges: EntityEdge[] = [];
  for (const r of draft.relations ?? []) {
    const source = key(r.source_normalized, r.source_type);
    const target = key(r.target_normalized, r.target_type);
    // A relation can name an entity the list left out; draw it rather than drop the relation.
    if (!nodes.has(source)) nodes.set(source, { id: source, label: r.source, type: r.source_type });
    if (!nodes.has(target)) nodes.set(target, { id: target, label: r.target, type: r.target_type });
    edges.push({
      source,
      target,
      predicate: r.predicate,
      evidence: r.evidence,
      confidence: r.confidence,
    });
  }
  return { nodes: [...nodes.values()], edges };
}

/** The committed knowledge graph for a library, or for one document in it — fills its pane. */
function LibraryGraphPane({
  library,
  document,
}: {
  library: LibraryCard;
  document: RagDocument | null;
}) {
  const params = document
    ? { document_id: document.id, limit: 2000 }
    : { library_id: library.id, limit: 2000 };
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["rag", "graph", params],
    queryFn: () => ragApi.graph(params),
  });

  const graph = useMemo(
    () => ({
      nodes: (data?.nodes ?? []).map<EntityNode>((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        description: n.description,
        confidence: n.confidence,
      })),
      edges: (data?.edges ?? []).map<EntityEdge>((e) => ({
        source: e.source,
        target: e.target,
        predicate: e.predicate,
        evidence: e.evidence,
        confidence: e.confidence,
      })),
    }),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading graph…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center gap-2 p-2 text-xs text-red">
        <AlertCircle className="size-4" /> {errorMessage(error)}
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="size-3" /> Retry
        </Button>
      </div>
    );
  }
  if (data && !data.available) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 p-3.5 text-xs text-amber">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">The knowledge graph (Neo4j) is not reachable.</p>
          <p className="mt-1 text-amber/80">
            Start it with <code className="font-mono">docker compose up -d neo4j</code> from the
            project root; the backend reconnects on its own within 30 seconds.
          </p>
        </div>
      </div>
    );
  }
  return (
    <EntityGraph
      nodes={graph.nodes}
      edges={graph.edges}
      truncated={data?.truncated ?? false}
      className="min-h-[24rem] flex-1"
    />
  );
}
