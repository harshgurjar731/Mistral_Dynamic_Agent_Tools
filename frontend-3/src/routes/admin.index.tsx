import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { adminApi, authKeys } from "@/api/auth";
import { AdminPage, describeAction, PageHeader, Panel, StatCard } from "@/components/admin/parts";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/lib/auth";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Overview — Admin console" }] }),
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const { data: session } = useAuthSession();
  const q = useQuery({ queryKey: authKeys.admin.overview(), queryFn: adminApi.overview });
  const d = q.data;

  return (
    <AdminPage>
      <PageHeader
        title={`Welcome, ${session?.admin?.name.split(" ")[0] ?? "admin"}`}
        description="The state of the platform: who can sign in, which workspaces are healthy, and what changed recently."
        actions={
          <>
            <Link
              to="/admin/workspaces"
              search={{ create: true }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background-elevated px-3 text-sm font-medium transition hover:bg-surface-hover"
            >
              <Building2 className="size-4" /> New workspace
            </Link>
            <Link
              to="/admin/users"
              search={{ invite: true }}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/88"
            >
              <UserPlus className="size-4" /> Invite user
            </Link>
          </>
        }
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}

      {d && d.workspaces.key_problems.length ? (
        <div className="mb-6 rounded-lg border border-red/30 bg-red/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red">
            <AlertTriangle className="size-4" /> Mistral rejected{" "}
            {d.workspaces.key_problems.length === 1
              ? "a workspace key"
              : `${d.workspaces.key_problems.length} workspace keys`}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {d.workspaces.key_problems.map((p) => (
              <li key={p.id}>
                <Link
                  to="/admin/workspaces/$id"
                  params={{ id: p.id }}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {p.name}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  — {p.error ?? "key rejected"}. Its members can't use Mistral until the key is
                  replaced.
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {d ? (
          <>
            <StatCard
              icon={Users}
              label="Users"
              value={d.users.total}
              sub={`${d.users.active} active · ${d.users.invited} invited · ${d.users.disabled} disabled`}
            />
            <StatCard
              icon={Building2}
              label="Workspaces"
              value={d.workspaces.total}
              sub={d.workspaces.disabled ? `${d.workspaces.disabled} disabled` : "all enabled"}
            />
            <StatCard
              icon={Activity}
              label="Sign-ins, last 24 h"
              value={d.last_24h.sign_ins}
              sub={`${d.active_sessions} active sessions`}
            />
            <StatCard
              icon={ShieldAlert}
              label="Failed sign-ins, last 24 h"
              value={d.last_24h.failed_sign_ins}
              tone={d.last_24h.failed_sign_ins > 10 ? "warn" : "default"}
              sub={`${d.admins} admin${d.admins === 1 ? "" : "s"} · ${d.roles} roles`}
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-lg" />
          ))
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Recent activity"
          actions={
            <Link
              to="/admin/audit"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Audit log <ArrowRight className="size-3" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {(d?.recent ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    e.outcome === "ok"
                      ? "bg-emerald"
                      : e.outcome === "denied"
                        ? "bg-amber"
                        : "bg-red",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium text-foreground">{e.actor_email ?? "System"}</span>{" "}
                  <span className="text-muted-foreground">
                    {describeAction(e.action, e.outcome)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(e.at)}
                </span>
              </li>
            ))}
            {d && !d.recent.length ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet.</li>
            ) : null}
          </ul>
        </Panel>

        <Panel title="Getting set up">
          <ol className="space-y-4">
            {[
              {
                done: (d?.workspaces.total ?? 0) > 1,
                title: "Add a workspace",
                body: "Give a team its own Mistral API key. The Default workspace uses the platform key.",
                to: "/admin/workspaces",
              },
              {
                done: (d?.roles ?? 0) > 5,
                title: "Review roles",
                body: "Five built-in roles cover most teams. Create a custom role for anything else.",
                to: "/admin/roles",
              },
              {
                done: (d?.users.total ?? 0) > 0,
                title: "Invite people",
                body: "Choose their workspaces and role; send them the one-time link.",
                to: "/admin/users",
              },
              {
                done: (d?.admins ?? 0) > 1,
                title: "Add a second admin",
                body: "So the platform is never locked out if one admin is away.",
                to: "/admin/admins",
              },
            ].map((s) => (
              <li key={s.title} className="flex gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                    s.done
                      ? "border-emerald/40 bg-emerald/15 text-emerald"
                      : "border-border-strong",
                  )}
                >
                  {s.done ? <ShieldCheck className="size-3" /> : null}
                </span>
                <span>
                  <Link
                    to={s.to}
                    className="text-sm font-medium text-foreground hover:text-primary"
                  >
                    {s.title}
                  </Link>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </AdminPage>
  );
}
