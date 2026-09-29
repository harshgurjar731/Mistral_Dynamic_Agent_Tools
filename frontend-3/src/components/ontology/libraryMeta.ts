import type { LibraryCard } from "@/types";

export const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  uploaded: { bg: "bg-muted/30", text: "text-muted-foreground" },
  indexing: { bg: "bg-blue/15", text: "text-blue" },
  extracted: { bg: "bg-cyan/10", text: "text-cyan" },
  extracting: { bg: "bg-indigo/15", text: "text-indigo" },
  proposed: { bg: "bg-amber/15", text: "text-amber" },
  graphed: { bg: "bg-emerald/15", text: "text-emerald" },
  unsupported: { bg: "bg-muted/20", text: "text-muted-foreground" },
  failed: { bg: "bg-red/15", text: "text-red" },
};

/** Statuses with ingestion still in flight — these show their timeline unprompted. */
export const LIVE = new Set(["indexing", "extracted", "extracting"]);

export const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.html,.csv";

/** Mistral's own document count lags behind; what this app ingested is exact. */
export const docCount = (lib: LibraryCard) => lib.tracked_documents || lib.document_count || 0;

/** A library's one-word state, for the dot beside it. */
export function libraryState(lib: LibraryCard): { label: string; dot: string; text: string } {
  if (lib.pending_documents > 0)
    return { label: "Ingesting", dot: "bg-amber animate-pulse", text: "text-amber" };
  if (lib.failed_documents > 0) return { label: "Has failures", dot: "bg-red", text: "text-red" };
  if (lib.entities > 0) return { label: "Graphed", dot: "bg-emerald", text: "text-emerald" };
  if (docCount(lib) > 0) return { label: "Documents only", dot: "bg-cyan", text: "text-cyan" };
  return { label: "Empty", dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
}

export type LibraryPane = "documents" | "graph";
