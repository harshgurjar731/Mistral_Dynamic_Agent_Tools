import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CheckCircle2, Loader2, Minus } from "lucide-react";
import { ragApi } from "@/api";
import type { TimelineEvent } from "@/types";
import { formatDuration } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * What is happening to a document, while it happens.
 *
 * Ingestion runs for tens of seconds to minutes across a Mistral-side index, a
 * text fetch, N chunk extractions, a merge and a graph write — a progress bar
 * would say nothing about which of those is slow or which one failed. A
 * vertical timeline that grows as stages arrive does.
 *
 * Fed by the SSE stream, which ends itself once nothing is running.
 */

/** Stage handles are snake_case; this is what a person reads. */
const STAGE_LABELS: Record<string, string> = {
  ingest: "Processing document",
  library_indexing: "Mistral is indexing the file",
  fetch_text: "Retrieving the extracted text",
  chunk: "Splitting into excerpts",
  extract: "Reading entities and relations",
  extract_chunk: "Excerpt",
  merge: "Merging and deduplicating",
  commit: "Committing to the graph",
  sanitize: "Re-checking the draft",
  graph_write: "Writing to Neo4j",
  propose_ontology: "Designing the content schema",
  sample_documents: "Reading a sample of the library",
  design_schema: "Choosing types and predicates",
};

const label = (stage: string) => STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");

type RowState = "running" | "done" | "failed" | "skipped";

function stateOf(e: TimelineEvent): RowState {
  if (e.status === "running") return "running";
  if (e.status === "failed") return "failed";
  if (e.status === "skipped") return "skipped";
  return "done";
}

const DOT: Record<RowState, string> = {
  running: "border-cyan/50 bg-cyan/15 text-cyan",
  done: "border-emerald/40 bg-emerald/15 text-emerald",
  failed: "border-red/40 bg-red/15 text-red",
  skipped: "border-border bg-background-elevated text-muted-foreground",
};

/** The one line worth showing under a stage name. */
function detail(event: TimelineEvent): string | null {
  const meta = (event.meta ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const num = (key: string) => (typeof meta[key] === "number" ? (meta[key] as number) : null);

  const chars = num("chars");
  if (chars !== null) parts.push(`${chars.toLocaleString()} characters`);
  const chunks = num("chunks");
  if (chunks !== null) parts.push(`${chunks} excerpts`);
  const entities = num("entities");
  if (entities !== null) parts.push(`${entities} entities`);
  const relations = num("relations");
  if (relations !== null) parts.push(`${relations} relations`);
  if (num("polls") !== null && typeof meta["state"] === "string") parts.push(meta["state"]);
  const unmapped = meta["unmapped_types"];
  if (Array.isArray(unmapped) && unmapped.length) {
    parts.push(`outside the schema: ${unmapped.join(", ")}`);
  }

  if (event.message) parts.unshift(event.message);
  return parts.length ? parts.join(" · ") : null;
}

function useIngestStream(traceId: string | null) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    setEvents([]);
    setDone(false);

    const source = new EventSource(ragApi.timelineStreamUrl(traceId));

    source.addEventListener("stage", (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data) as TimelineEvent;
        // Each stage arrives twice — opening, then closing with its duration —
        // so merge by id or a running row sits next to its finished copy.
        setEvents((prev) => {
          const merged = prev.filter((e) => e.id !== event.id);
          merged.push(event);
          merged.sort((a, b) => a.seq - b.seq);
          return merged;
        });
      } catch {
        // One malformed frame should cost that frame, not the stream.
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

  return { events, done };
}

export function IngestTimeline({
  traceId,
  filename,
  onFinished,
  bare = false,
}: {
  traceId: string | null;
  filename?: string;
  onFinished?: () => void;
  /** Drop the outer frame when nested inside another panel. */
  bare?: boolean;
}) {
  const { events, done } = useIngestStream(traceId);
  const finishedOnce = useRef(false);

  useEffect(() => {
    finishedOnce.current = false;
  }, [traceId]);

  useEffect(() => {
    if (done && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [done, onFinished]);

  // Per-chunk extraction is collapsed into its parent: forty sibling rows for
  // one document is noise, and the count is the only part worth seeing.
  const { rows, chunkProgress, failed } = useMemo(() => {
    const chunks = events.filter((e) => e.stage === "extract_chunk");
    const top = events.filter((e) => e.stage !== "extract_chunk");
    return {
      rows: top,
      failed: top.some((e) => e.status === "failed"),
      chunkProgress: chunks.length
        ? { total: chunks.length, finished: chunks.filter((c) => c.status !== "running").length }
        : null,
    };
  }, [events]);

  if (!traceId) return null;

  const statusTone = failed ? "text-red" : done ? "text-emerald" : "text-cyan";

  return (
    <div
      className={cn(
        "space-y-3",
        !bare && "rounded-xl border border-border bg-background-elevated/70 p-4",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">
            {filename ? `Processing “${filename}”` : "Ingestion timeline"}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{traceId}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", statusTone)}>
          {failed ? (
            <AlertTriangle className="size-3.5" />
          ) : done ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          {failed ? "Failed" : done ? "Finished" : "Working…"}
        </span>
      </div>

      {!rows.length ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-cyan" />
          {done ? "No stages were recorded for this run." : "Starting…"}
        </p>
      ) : (
        <ol className="relative space-y-3.5 pl-7">
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-cyan/50 via-border to-transparent"
          />
          <AnimatePresence initial={false}>
            {rows.map((event) => {
              const state = stateOf(event);
              const line = detail(event);
              return (
                <motion.li
                  key={event.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="relative"
                >
                  <span
                    className={cn(
                      "absolute top-0 -left-7 grid size-[22px] place-items-center rounded-full border transition-colors duration-300",
                      DOT[state],
                    )}
                  >
                    {state === "running" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : state === "failed" ? (
                      <AlertTriangle className="size-3" />
                    ) : state === "skipped" ? (
                      <Minus className="size-3" />
                    ) : (
                      <Check className="size-3" />
                    )}
                  </span>

                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "text-xs",
                        state === "failed"
                          ? "font-medium text-red"
                          : state === "running"
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {label(event.stage)}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {state === "running" ? "…" : formatDuration(event.duration_ms)}
                    </span>
                  </div>

                  {line ? (
                    <p
                      className={cn(
                        "mt-0.5 text-[11px]",
                        state === "failed" ? "text-red/80" : "text-muted-foreground",
                      )}
                    >
                      {line}
                    </p>
                  ) : null}

                  {/* The one stage worth a progress bar, because it is the slow one. */}
                  {event.stage === "extract" && chunkProgress ? (
                    <div className="mt-1.5 max-w-xs">
                      <div className="h-1 overflow-hidden rounded-full bg-border/60">
                        <motion.div
                          className="h-full rounded-full bg-gradient-brand"
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(chunkProgress.finished / chunkProgress.total) * 100}%`,
                          }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {chunkProgress.finished} of {chunkProgress.total} excerpts read
                      </p>
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}
