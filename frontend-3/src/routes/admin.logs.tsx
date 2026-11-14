import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { adminApi, authKeys, type ActivityRow } from "@/api/auth";
import { AdminPage, PageHeader, useWorkspacesAndRoles } from "@/components/admin/parts";
import { KindPill, TIME_RANGES } from "@/components/observability/logMeta";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration, formatRelative, formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/logs")({
  head: () => ({ meta: [{ title: "Activity logs — Admin console" }] }),
  validateSearch: z.object({
    user: z.string().optional(),
    workspace: z.string().optional(),
  }),
  component: ActivityLogsPage,
});

const ALL = "__all__";
const KINDS = [
  [ALL, "All actions"],
  ["http", "API actions"],
  ["workflow", "Workflow runs"],
  ["run", "Background runs"],
] as const;
const STATUSES = [
  [ALL, "Any outcome"],
  ["error", "Failed"],
  ["ok", "Succeeded"],
] as const;

function actorLabel(row: Pick<ActivityRow, "actor">): string {
  const a = row.actor;
  if (!a) return "system";
  return a.name || a.email || `${a.kind} ${a.id.slice(0, 8)}`;
}

function failed(row: ActivityRow): boolean {
  return row.status_code === "Error" || (row.http_status ?? 0) >= 400;
}

function ActivityLogsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/logs" });
  const { workspaces } = useWorkspacesAndRoles();
  const users = useQuery({ queryKey: authKeys.admin.users(), queryFn: () => adminApi.users() });

  const user = search.user ?? ALL;
  const workspace = search.workspace ?? ALL;
  const [kind, setKind] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [hours, setHours] = useState(24);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const setSearch = (patch: { user?: string; workspace?: string }) =>
    navigate({
      search: {
        ...search,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, v === ALL ? undefined : v]),
        ),
      },
      replace: true,
    });

  const params = {
    user_id: user === ALL ? undefined : user,
    workspace_id: workspace === ALL ? undefined : workspace,
    kind: kind === ALL ? undefined : kind,
    status: status === ALL ? undefined : status,
    q: q || undefined,
    hours,
  };
  const feed = useInfiniteQuery({
    queryKey: authKeys.admin.activity(params),
    queryFn: ({ pageParam }) => adminApi.activity({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? (last.cursor ?? undefined) : undefined),
  });
  const pages = feed.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.items);
  const errors = pages[0]?.errors ?? [];
  const disabled = pages[0] && !pages[0].enabled;

  return (
    <AdminPage>
      <PageHeader
        title="Activity logs"
        description="What every user did — API actions, workflow runs and background runs — read from each workspace's Mistral observability. Open a row for every step, rule verdict, tool call and model call. Sign-ins are in the audit log."
        actions={
          <Button variant="outline" size="sm" onClick={() => feed.refetch()}>
            <RefreshCw className={cn(feed.isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter by action (e.g. workflows)"
            className="h-9 pl-9"
          />
        </div>
        <Select value={user} onValueChange={(v) => setSearch({ user: v })}>
          <SelectTrigger className="h-9 w-48" aria-label="User">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every user</SelectItem>
            {(users.data?.users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name || u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={workspace} onValueChange={(v) => setSearch({ workspace: v })}>
          <SelectTrigger className="h-9 w-44" aria-label="Workspace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All workspaces</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-40" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36" aria-label="Outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
          <SelectTrigger className="h-9 w-36" aria-label="Time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((r) => (
              <SelectItem key={r.value} value={String(r.value)}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {disabled ? (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          Tracing is off on the backend (OBSERVABILITY_ENABLED=false), so no activity is recorded.
        </div>
      ) : null}
      {errors.map((e) => (
        <div
          key={e.workspace_id}
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 px-4 py-2.5 text-xs text-amber"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-semibold">{e.workspace_name}:</span> {e.error}
          </span>
        </div>
      ))}
      {feed.isError ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : null}

      <div className="glass overflow-x-auto rounded-lg">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">When</th>
              <th className="px-3 py-2.5 font-medium">Who</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
              <th className="px-3 py-2.5 font-medium">Workspace</th>
              <th className="px-3 py-2.5 text-right font-medium">Took</th>
              <th className="w-8 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {feed.isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr
                key={`${r.read_from}:${r.trace_id}`}
                className="cursor-pointer transition hover:bg-surface-hover"
                onClick={() =>
                  navigate({
                    to: "/admin/logs/$workspaceId/$traceId",
                    params: { workspaceId: r.read_from, traceId: r.trace_id },
                  })
                }
              >
                <td
                  className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground"
                  title={formatTimestamp(r.start_time)}
                >
                  {formatRelative(r.start_time)}
                </td>
                <td className="max-w-[200px] px-3 py-2.5">
                  {r.actor ? (
                    <div className="min-w-0">
                      <div className="truncate text-foreground">{actorLabel(r)}</div>
                      {r.actor.email && r.actor.name ? (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {r.actor.email}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">system</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        failed(r) ? "bg-red" : "bg-emerald",
                      )}
                    />
                    <KindPill kind={r.kind} />
                    <span className="truncate font-mono text-xs text-foreground">{r.name}</span>
                    {r.http_status ? (
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          r.http_status >= 400 ? "text-red" : "text-muted-foreground",
                        )}
                      >
                        {r.http_status}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.workspace_name}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                  {formatDuration(r.duration_ms)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  <ChevronRight className="size-4" />
                </td>
              </tr>
            ))}
            {feed.isSuccess && !rows.length ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  No activity matches. Traces reach Mistral a few seconds after an action ends.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} action{rows.length === 1 ? "" : "s"} shown
        </span>
        {feed.hasNextPage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={feed.isFetchingNextPage}
            onClick={() => feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Load older
          </Button>
        ) : null}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Sign-ins, sign-outs and password changes are never sent to Mistral — see the{" "}
        <Link to="/admin/audit" className="text-primary hover:underline">
          audit log
        </Link>
        .
      </p>
    </AdminPage>
  );
}
