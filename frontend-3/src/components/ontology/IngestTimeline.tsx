import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDot, Loader2, MinusCircle } from "lucide-react";
import { ragApi } from "@/api";
import { formatDuration } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface TimelineEvent {
  id: number;
  trace_id: string;
  stage: string;
  status: "running" | "completed" | "failed" | "skipped";
  seq: number;
  duration_ms?: number | null;
  message?: string | null;
  meta?: Record<string, unknown>;
}

const STAGE_LABELS: Record<string, string> = {
  ingest: "Processing document",
  library_indexing: "Mistral is indexing file",
  fetch_text: "Retrieving extracted text",
  chunk: "Splitting into excerpts",
  extract: "Extracting entities & relations",
  extract_chunk: "Chunk extraction",
  merge: "Merging & deduplicating",
  commit: "Committing to graph",
  sanitize: "Validating schema",
  graph_write: "Writing to Neo4j",
  propose_ontology: "Designing content schema",
  sample_documents: "Reading sample",
  design_schema: "Choosing types & predicates",
};

export function IngestTimeline({
  traceId,
  filename,
  onFinished,
}: {
  traceId: string | null;
  filename?: string;
  onFinished?: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [done, setDone] = useState(false);
  const finishedOnce = useRef(false);

  useEffect(() => {
    if (!traceId) return;
    setEvents([]);
    setDone(false);
    finishedOnce.current = false;

    const source = new EventSource(ragApi.timelineStreamUrl(traceId));

    source.addEventListener("stage", (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data) as TimelineEvent;
        setEvents((prev) => {
          const merged = prev.filter((e) => e.id !== event.id);
          merged.push(event);
          merged.sort((a, b) => a.seq - b.seq);
          return merged;
        });
      } catch {
        /* frame parse err */
      }
    });

    const close = () => {
      setDone(true);
      source.close();
    };
    source.addEventListener("done", close);
    source.onerror = close;

    return () => source.close();
  }, [traceId]);

  useEffect(() => {
    if (done && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [done, onFinished]);

  const rows = useMemo(() => {
    return events.filter((e) => e.stage !== "extract_chunk");
  }, [events]);

  if (!traceId) return null;

  return (
    <div className="rounded-xl border border-border bg-background-elevated/70 p-4 space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <span className="text-xs font-semibold text-foreground">
            {filename ? `Ingesting "${filename}"` : "Ingestion Timeline"}
          </span>
          <p className="text-[11px] font-mono text-muted-foreground">{traceId}</p>
        </div>
        {!done ? (
          <div className="flex items-center gap-1.5 text-xs text-cyan">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Processing…</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald">
            <CheckCircle2 className="size-3.5" />
            <span>Completed</span>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.map((e) => {
          const isRunning = e.status === "running";
          const isCompleted = e.status === "completed";
          const isFailed = e.status === "failed";
          const label = STAGE_LABELS[e.stage] ?? e.stage.replace(/_/g, " ");

          return (
            <div key={e.id} className="flex items-start gap-2.5 text-xs">
              <div className="mt-0.5 shrink-0">
                {isRunning && <CircleDot className="size-3.5 text-cyan animate-pulse" />}
                {isCompleted && <CheckCircle2 className="size-3.5 text-emerald" />}
                {isFailed && <AlertCircle className="size-3.5 text-red" />}
                {e.status === "skipped" && <MinusCircle className="size-3.5 text-muted-foreground" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "font-medium",
                      isRunning ? "text-cyan" : isCompleted ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                  {e.duration_ms !== undefined && e.duration_ms !== null && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatDuration(e.duration_ms)}
                    </span>
                  )}
                </div>
                {e.message && <p className="mt-0.5 text-[11px] text-muted-foreground">{e.message}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
