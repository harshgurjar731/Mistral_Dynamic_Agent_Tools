import { toast } from "sonner";
import { Copy, Loader2, MoreHorizontal, Pencil, PlugZap, Trash2 } from "lucide-react";
import type { CheckReport, RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PurposeBadge,
  STATE_TONE,
  ServerStatusBadge,
  providerIconFor,
  timeAgo,
  type ServerState,
} from "../status";
import { cn } from "@/lib/utils";

/**
 * One compact card for who the server is and how it's doing: identity,
 * address, a one-line health summary and the server-level actions.
 */
export function ServerHeader({
  server,
  report,
  state,
  checking,
  onCheck,
  onEdit,
  onRemove,
}: {
  server: RemoteServer;
  report: CheckReport | null | undefined;
  state: ServerState;
  checking: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const Icon = providerIconFor(server.provider);
  const tone = STATE_TONE[state];
  const checks = report?.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass").length;
  const issue = checks.find((c) => c.status === "fail") ?? checks.find((c) => c.status === "warn");

  const summary = [
    checks.length ? `${passed}/${checks.length} checks passed` : "Not checked yet",
    report?.latency_ms != null ? `${report.latency_ms} ms` : null,
    `checked ${timeAgo(report?.checked_at ?? server.last_checked_at)}`,
  ].filter(Boolean);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/60 backdrop-blur-md"
      style={{ background: "var(--surface)" }}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r to-transparent", tone.stripe)} />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="relative shrink-0">
            <div className="grid size-12 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Icon className="size-6" />
            </div>
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px] ring-[var(--surface)]",
                tone.dot,
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {server.name}
              </h1>
              <ServerStatusBadge state={state} size="xs" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PurposeBadge purpose={server.purpose} />
              <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {server.provider_label}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(server.url);
                  toast.success("Address copied.");
                }}
                title="Copy address"
                className="group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border/50 bg-background-elevated/60 px-1.5 py-0.5 transition hover:border-primary/30"
              >
                <span className="truncate font-mono text-[11px] text-foreground/90">
                  {server.url}
                </span>
                <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
            </div>
            {/* One line: the full detail is in Overview → Needs attention and in Diagnostics. */}
            <p
              className="mt-2 truncate text-xs text-muted-foreground"
              title={issue ? `${issue.label}: ${issue.detail}` : undefined}
            >
              {summary.join(" · ")}
              {issue ? (
                <span className={issue.status === "fail" ? "text-red" : "text-amber"}>
                  {" "}
                  — {issue.label}: {issue.detail}
                </span>
              ) : null}
            </p>
            {server.description ? (
              <p className="mt-1.5 line-clamp-2 max-w-3xl text-xs text-muted-foreground/80">
                {server.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onCheck} disabled={checking}>
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlugZap className="size-3.5" />
            )}
            Run diagnostics
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(server.url);
                  toast.success("Address copied.");
                }}
              >
                <Copy className="size-3.5" /> Copy address
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove} className="text-red focus:text-red">
                <Trash2 className="size-3.5" /> Remove server
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
