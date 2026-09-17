import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { errorMessage, ragApi } from "@/api";
import type { DraftEntity, DraftRelation, ExtractionDraft, LibraryCard, RagDocument } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IngestTimeline } from "./IngestTimeline";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  uploaded: { bg: "bg-muted/30", text: "text-muted-foreground" },
  indexing: { bg: "bg-sky-500/15", text: "text-sky-300" },
  extracted: { bg: "bg-cyan/10", text: "text-cyan" },
  extracting: { bg: "bg-indigo/15", text: "text-indigo" },
  proposed: { bg: "bg-amber/15", text: "text-amber" },
  graphed: { bg: "bg-emerald/15", text: "text-emerald" },
  unsupported: { bg: "bg-muted/20", text: "text-muted-foreground" },
  failed: { bg: "bg-red/15", text: "text-red" },
};

/** Statuses with ingestion still in flight — these show their timeline unprompted. */
const LIVE = new Set(["indexing", "extracted", "extracting"]);

export function RagTab() {
  const qc = useQueryClient();
  const [selectedLibrary, setSelectedLibrary] = useState<LibraryCard | null>(null);
  const [reviewDoc, setReviewDoc] = useState<RagDocument | null>(null);
  const [openTraces, setOpenTraces] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["rag", "overview"],
    queryFn: ragApi.overview,
    refetchInterval: 15_000,
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["rag", "documents", selectedLibrary?.id],
    queryFn: () => (selectedLibrary ? ragApi.documents(selectedLibrary.id) : null),
    enabled: Boolean(selectedLibrary),
    refetchInterval: 8_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedLibrary) throw new Error("No library selected");
      return ragApi.uploadDocument(selectedLibrary.id, file, "", true);
    },
    onSuccess: () => {
      toast.success("Document uploaded; extraction initiated.");
      qc.invalidateQueries({ queryKey: ["rag", "documents", selectedLibrary?.id] });
      qc.invalidateQueries({ queryKey: ["rag", "overview"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const libraries = overview?.libraries ?? [];
  const documents = docsData?.documents ?? [];
  const liveDocs = documents.filter((d) => LIVE.has(d.status) && d.trace_id);

  const refreshDocuments = () => {
    qc.invalidateQueries({ queryKey: ["rag", "documents", selectedLibrary?.id] });
    qc.invalidateQueries({ queryKey: ["rag", "overview"] });
  };

  const toggleTrace = (id: number) =>
    setOpenTraces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold text-foreground">
              Graph RAG & Document Knowledge Pipeline
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Documents are indexed by Mistral for dense semantic retrieval, and structured
              entities/relations are extracted and committed to Neo4j.
            </p>
          </div>
          {overview && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{overview.totals["entities"] ?? 0} entities</span>
              <span className="font-mono tabular-nums">{overview.totals["relations"] ?? 0} relations</span>
            </div>
          )}
        </div>
      </GlassPanel>

      {selectedLibrary ? (
        /* Library documents drilldown */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelectedLibrary(null)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" /> Back to all libraries
            </button>
            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                }}
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="flex items-center gap-1.5"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Upload Document
              </Button>
            </div>
          </div>

          <GlassPanel>
            <GlassPanelHeader
              title={selectedLibrary.name}
              description={selectedLibrary.description || "Library document extraction & review"}
              actions={
                <span className="font-mono text-xs text-muted-foreground">
                  {documents.length} documents
                </span>
              }
            />
            <div className="p-4">
              {docsLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin mx-auto mb-2" /> Loading documents…
                </div>
              ) : documents.length === 0 ? (
                <EmptyState
                  title="No documents yet"
                  description="Upload PDF, DOCX or TXT files to extract entities and relations into the graph."
                />
              ) : (
                <div className="space-y-3">
                  {/* Anything in flight shows its progress unprompted — that is
                    the moment the detail is wanted. */}
                  {liveDocs.map((doc) => (
                    <IngestTimeline
                      key={`live-${doc.id}-${doc.trace_id}`}
                      traceId={doc.trace_id}
                      filename={doc.filename}
                      onFinished={refreshDocuments}
                    />
                  ))}
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {documents.map((doc) => {
                      const fallbackTone = { bg: "bg-muted/30", text: "text-muted-foreground" };
                      const tone =
                        STATUS_TONE[doc.status] ?? STATUS_TONE["uploaded"] ?? fallbackTone;
                      const canReview = doc.status === "proposed" || doc.status === "graphed";
                      const live = LIVE.has(doc.status);
                      const traceOpen = openTraces.has(doc.id) && !live;

                      return (
                        <div key={doc.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-surface-hover/50 transition-colors">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <FileText className="size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-foreground">
                                  {doc.filename}
                                </p>
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <span>{doc.char_count?.toLocaleString()} chars</span>
                                  <span>·</span>
                                  <span>{doc.chunk_count} excerpts</span>
                                  {doc.trace_id && !live && (
                                    <>
                                      <span>·</span>
                                      <button
                                        type="button"
                                        onClick={() => toggleTrace(doc.id)}
                                        aria-expanded={traceOpen}
                                        className="flex items-center gap-0.5 font-mono text-[10px] text-cyan hover:underline"
                                      >
                                        <ChevronRight
                                          className={cn(
                                            "size-3 transition-transform",
                                            traceOpen && "rotate-90",
                                          )}
                                        />
                                        {traceOpen ? "Hide timeline" : "View timeline"}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                                  tone.bg,
                                  tone.text,
                                )}
                              >
                                {doc.status}
                              </span>

                              {canReview && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setReviewDoc(doc)}
                                  className="h-7 text-xs flex items-center gap-1"
                                >
                                  <Sparkles className="size-3 text-cyan" /> Review Draft
                                </Button>
                              )}
                            </div>
                          </div>
                          {traceOpen && doc.trace_id ? (
                            <div className="border-t border-border bg-background-elevated/30 p-3">
                              <IngestTimeline traceId={doc.trace_id} filename={doc.filename} bare />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </GlassPanel>
        </div>
      ) : (
        /* Libraries gallery grid */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overviewLoading ? (
            <div className="col-span-full py-12 text-center text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" /> Loading libraries…
            </div>
          ) : libraries.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                title="No libraries found"
                description="Libraries group documents and seed domain knowledge."
              />
            </div>
          ) : (
            libraries.map((lib) => (
              <GlassPanel
                key={lib.id}
                className="cursor-pointer p-4 transition-all hover:border-primary/50 hover:bg-surface-hover"
                onClick={() => setSelectedLibrary(lib)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="size-4 text-cyan" />
                    <span className="font-semibold text-xs text-foreground truncate">{lib.name}</span>
                  </div>
                  <span className="technical-label">{lib.document_count} docs</span>
                </div>
                {lib.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {lib.description}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span>{lib.entities ?? 0} entities</span>
                  <span>{lib.relations ?? 0} relations</span>
                </div>
              </GlassPanel>
            ))
          )}
        </div>
      )}

      {/* Draft Review Modal */}
      {reviewDoc && (
        <DraftReviewModal
          document={reviewDoc}
          open={Boolean(reviewDoc)}
          onOpenChange={(open) => !open && setReviewDoc(null)}
          onCommitted={() => {
            setReviewDoc(null);
            qc.invalidateQueries({ queryKey: ["rag", "documents", selectedLibrary?.id] });
            qc.invalidateQueries({ queryKey: ["rag", "overview"] });
          }}
        />
      )}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-border bg-background-elevated/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-cyan" />
            <DialogTitle className="text-sm font-semibold text-foreground">
              Review Extraction: {document.filename}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Review model-extracted entities and relationships before committing to the Neo4j knowledge graph.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin mx-auto mb-2" /> Loading proposed draft…
          </div>
        ) : !draft ? (
          <EmptyState title="No extraction draft available" />
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
