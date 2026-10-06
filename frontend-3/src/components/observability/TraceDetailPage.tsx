import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { ArrowLeft, Clock, RefreshCw } from "lucide-react";
import type { TraceDetail } from "@/api/observability";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";
import { KindPill } from "./logMeta";
import { OpenInMistral, TraceView } from "./TraceView";

const notYetOnMistral = (err: unknown) => (err as AxiosError)?.response?.status === 404;

/**
 * A trace page. A trace reaches Mistral a few seconds after its action ends,
 * so a 404 is retried for a while before it is shown as missing — that is
 * what makes "View trace" right after a run land on the trace, not an error.
 */
export function TraceDetailPage({
  queryKey,
  load,
  subtitle,
}: {
  queryKey: readonly unknown[];
  load: () => Promise<TraceDetail>;
  subtitle?: string;
}) {
  const query = useQuery({
    queryKey,
    queryFn: load,
    retry: (count, err) => notYetOnMistral(err) && count < 10,
    retryDelay: 3000,
  });
  const detail = query.data;
  const t = detail?.trace;
  const running =
    t?.kind === "workflow" && detail?.root?.attributes["app.execution.status"] === "RUNNING";

  return (
    <div className="px-6 py-8">
      <Link
        to="/logs"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Logs
      </Link>

      {query.isLoading ? (
        <div className="mt-6">
          <DetailSkeleton />
        </div>
      ) : query.error ? (
        notYetOnMistral(query.error) ? (
          <EmptyState
            className="mt-6"
            icon={<Clock className="size-6" />}
            title="This trace is not on Mistral yet"
            description="Traces arrive a few seconds after an action finishes. A run that is still going shows up once its first step completes."
            action={
              <button
                type="button"
                onClick={() => query.refetch()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                Check again
              </button>
            }
          />
        ) : (
          <ErrorState className="mt-6" error={query.error} onRetry={() => query.refetch()} />
        )
      ) : detail && t ? (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <KindPill kind={t.kind} />
                <span
                  className={cn(
                    "rounded border px-1.5 text-[10px] font-medium",
                    t.error_count
                      ? "border-red/30 bg-red/10 text-red"
                      : "border-emerald/30 bg-emerald/10 text-emerald",
                  )}
                >
                  {t.error_count
                    ? `${t.error_count} error${t.error_count === 1 ? "" : "s"}`
                    : "No errors"}
                </span>
                {running ? (
                  <span className="text-[11px] text-muted-foreground">
                    dispatched to Mistral — steps appear as the worker runs them
                  </span>
                ) : null}
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight text-foreground">
                {t.name}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTimestamp(t.start_time)}
                {subtitle ? ` · ${subtitle}` : ""}
                {detail.execution_id ? (
                  <>
                    {" "}
                    · execution{" "}
                    <span className="font-mono text-foreground">{detail.execution_id}</span>
                  </>
                ) : null}{" "}
                · trace <span className="font-mono">{t.trace_id}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => query.refetch()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
                Refresh
              </button>
              <OpenInMistral url={t.console_url} />
            </div>
          </div>
          <div className="mt-6">
            <TraceView key={t.trace_id} detail={detail} />
          </div>
        </>
      ) : null}
    </div>
  );
}
