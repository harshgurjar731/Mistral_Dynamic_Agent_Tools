import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { adminApi, authKeys } from "@/api/auth";
import {
  AdminPage,
  describeAction,
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
  component: AuditPage,
});

const PAGE = 50;
const ALL = "__all__";
const CATEGORIES = [
  ["user.login", "Sign-ins"],
  ["user.", "Users"],
  ["admin.", "Admins"],
  ["workspace.", "Workspaces"],
  ["role.", "Roles"],
] as const;

function AuditPage() {
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<string>(ALL);
  const [actor, setActor] = useState("");
  const [actorQ, setActorQ] = useState("");
  const [workspace, setWorkspace] = useState<string>(ALL);
  const [open, setOpen] = useState<number | null>(null);
  const { workspaces } = useWorkspacesAndRoles();
  useEffect(() => {
    const t = setTimeout(() => setActorQ(actor.trim()), 300);
    return () => clearTimeout(t);
  }, [actor]);
  useEffect(() => setOffset(0), [action, actorQ, workspace]);

  const params = {
    limit: PAGE,
    offset,
    action: action === ALL ? undefined : action,
    actor: actorQ || undefined,
    workspace_id: workspace === ALL ? undefined : workspace,
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
        description="Every sign-in, refusal and change to accounts, workspaces and roles — who, what, when and from where."
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
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-9 w-40">
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
        <Select value={workspace} onValueChange={setWorkspace}>
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
              <th className="px-5 py-2.5 text-right font-medium">From</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(q.data?.events ?? []).map((e) => (
              <Fragment key={e.id}>
                <tr
                  className="cursor-pointer transition hover:bg-surface-hover"
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                >
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                    {e.at ? new Date(e.at).toLocaleString() : "—"}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2.5">
                    {e.actor_email ?? <span className="text-muted-foreground">system</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          e.outcome === "ok"
                            ? "bg-emerald"
                            : e.outcome === "denied"
                              ? "bg-amber"
                              : "bg-red",
                        )}
                      />
                      {describeAction(e.action, e.outcome)}
                      <code className="font-mono text-[10px] text-muted-foreground">
                        {e.action}
                      </code>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wsName(e.workspace_id) ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {e.ip ?? "—"}
                  </td>
                </tr>
                {open === e.id && e.detail ? (
                  <tr>
                    <td colSpan={5} className="bg-background-elevated px-5 py-3">
                      <pre className="custom-scrollbar max-h-64 overflow-auto font-mono text-[11px] text-muted-foreground">
                        {JSON.stringify(e.detail, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {q.data && !q.data.events.length ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
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
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            <ChevronLeft /> Newer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
          >
            Older <ChevronRight />
          </Button>
        </div>
      </div>
    </AdminPage>
  );
}
