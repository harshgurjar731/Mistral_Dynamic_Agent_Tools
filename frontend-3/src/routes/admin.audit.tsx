import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { adminApi, authKeys } from "@/api/auth";
import {
  AdminPage,
  describeAction,
  OutcomeDot,
  PageHeader,
  useWorkspacesAndRoles,
} from "@/components/admin/parts";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit log — Admin console" }] }),
  validateSearch: z.object({
    action: z.string().optional(),
    actor: z.string().optional(),
    workspace: z.string().optional(),
    target: z.string().optional(),
    offset: z.number().int().min(0).optional(),
  }),
  component: AuditPage,
});

const PAGE = 50;
const ALL = "__all__";
const CATEGORIES = [
  ["auth", "Authentication"],
  ["user.login", "User sign-ins"],
  ["admin.login", "Admin sign-ins"],
  ["user.", "Users"],
  ["admin.", "Admins"],
  ["workspace.", "Workspaces"],
  ["role.", "Roles"],
] as const;

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/audit" });
  const offset = search.offset ?? 0;
  const action = search.action ?? ALL;
  const workspace = search.workspace ?? ALL;
  const [actor, setActor] = useState(search.actor ?? "");
  const { workspaces } = useWorkspacesAndRoles();

  const setSearch = (patch: Record<string, string | number | undefined>) =>
    navigate({
      search: {
        ...search,
        offset: undefined,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, v === ALL || v === "" ? undefined : v]),
        ),
      },
      replace: true,
    });

  useEffect(() => {
    const next = actor.trim();
    if (next === (search.actor ?? "")) return;
    const t = setTimeout(() => setSearch({ actor: next }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  const params = {
    limit: PAGE,
    offset,
    action: action === ALL ? undefined : action,
    actor: search.actor || undefined,
    workspace_id: workspace === ALL ? undefined : workspace,
    target_id: search.target || undefined,
  };
  const q = useQuery({
    queryKey: authKeys.admin.audit(params),
    queryFn: () => adminApi.audit(params),
    placeholderData: keepPreviousData,
  });
  const total = q.data?.total ?? 0;
  const wsName = (id: string | null) => workspaces.find((w) => w.id === id)?.name;

  return (
    <AdminPage>
      <PageHeader
        title="Audit log"
        description="Every sign-in, refusal and change to accounts, workspaces and roles — who, what, when and from where. Visible to platform admins only; passwords are never recorded, and sign-ins are not sent to Mistral. Open an event for its full detail."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Filter by who (email)"
            className="h-9 pl-9"
          />
        </div>
        <Select value={action} onValueChange={(v) => setSearch({ action: v })}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            {CATEGORIES.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={workspace} onValueChange={(v) => setSearch({ workspace: v })}>
          <SelectTrigger className="h-9 w-44">
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
        {search.target ? (
          <button
            type="button"
            onClick={() => setSearch({ target: undefined })}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            Target <span className="font-mono text-foreground">{search.target.slice(0, 12)}</span>
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}

      <div className="glass overflow-x-auto rounded-lg">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">When</th>
              <th className="px-3 py-2.5 font-medium">Who</th>
              <th className="px-3 py-2.5 font-medium">What</th>
              <th className="px-3 py-2.5 font-medium">Workspace</th>
              <th className="px-3 py-2.5 text-right font-medium">From</th>
              <th className="w-8 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(q.data?.events ?? []).map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer transition hover:bg-surface-hover"
                onClick={() =>
                  navigate({ to: "/admin/audit/$eventId", params: { eventId: String(e.id) } })
                }
              >
                <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                  {e.at ? new Date(e.at).toLocaleString() : "—"}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2.5">
                  {e.actor_email ?? <span className="text-muted-foreground">system</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <OutcomeDot outcome={e.outcome} />
                    {describeAction(e.action, e.outcome)}
                    <code className="font-mono text-[10px] text-muted-foreground">{e.action}</code>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {wsName(e.workspace_id) ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                  {e.ip ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  <ChevronRight className="size-4" />
                </td>
              </tr>
            ))}
            {q.data && !q.data.events.length ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  No events match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : "0 events"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setSearch({ offset: Math.max(0, offset - PAGE) || undefined })}
          >
            <ChevronLeft /> Newer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + PAGE >= total}
            onClick={() => setSearch({ offset: offset + PAGE })}
          >
            Older <ChevronRight />
          </Button>
        </div>
      </div>
    </AdminPage>
  );
}
