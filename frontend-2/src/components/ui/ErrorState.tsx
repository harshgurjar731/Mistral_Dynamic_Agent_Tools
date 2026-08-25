import { AlertTriangle, RefreshCw } from "lucide-react";
import { errorMessage } from "@/api/client";
import { cn } from "@/lib/utils";

export function ErrorState({
  error,
  onRetry,
  className,
  title = "Something went wrong",
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-2xl border border-red/25 bg-red/5 px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {errorMessage(error)}
          </p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border glass px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-hover"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ error, className }: { error: unknown; className?: string }) {
  return (
    <p className={cn("text-xs text-red", className)}>{errorMessage(error)}</p>
  );
}
