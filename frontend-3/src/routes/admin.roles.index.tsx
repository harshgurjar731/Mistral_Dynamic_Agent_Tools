import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Lock, Plus, Sparkles } from "lucide-react";
import { adminApi, authKeys } from "@/api/auth";
import { AdminPage, PageHeader } from "@/components/admin/parts";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/admin/roles/")({
  head: () => ({ meta: [{ title: "Roles — Admin console" }] }),
  component: RolesPage,
});

function RolesPage() {
  const roles = useQuery({ queryKey: authKeys.admin.roles(), queryFn: adminApi.roles });
  const perms = useQuery({ queryKey: authKeys.admin.permissions(), queryFn: adminApi.permissions });
  const total = perms.data?.permissions.length ?? 0;
  const system = roles.data?.roles.filter((r) => r.system) ?? [];
  const custom = roles.data?.roles.filter((r) => !r.system) ?? [];

  return (
    <AdminPage>
      <PageHeader
        title="Roles & permissions"
        description="A role is a set of permissions a user holds inside a workspace. The built-in roles can't be changed — duplicate one to start a custom role."
        actions={
          <Link
            to="/admin/roles/$id"
            params={{ id: "new" }}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/88"
          >
            <Plus className="size-4" /> New role
          </Link>
        }
      />
      {roles.isError ? <ErrorState error={roles.error} onRetry={() => roles.refetch()} /> : null}
      {roles.isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <div className="space-y-8">
          <RoleGroup title="Built-in" icon={Lock} roles={system} total={total} />
          <RoleGroup
            title="Custom"
            icon={Sparkles}
            roles={custom}
            total={total}
            empty="No custom roles yet. Create one when a built-in role gives too much or too little."
          />
        </div>
      )}
    </AdminPage>
  );
}

function RoleGroup({
  title,
  icon: Icon,
  roles,
  total,
  empty,
}: {
  title: string;
  icon: typeof Lock;
  roles: import("@/api/auth").Role[];
  total: number;
  empty?: string;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h2>
      {roles.length ? (
        <div className="glass overflow-hidden rounded-lg">
          <ul className="divide-y divide-border">
            {roles.map((r) => (
              <li key={r.id}>
                <Link
                  to="/admin/roles/$id"
                  params={{ id: r.id }}
                  className="flex items-center gap-4 px-5 py-4 transition hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {r.description || "No description."}
                    </p>
                  </div>
                  <div className="hidden w-40 sm:block">
                    <div className="h-1.5 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${total ? (r.permissions.length / total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {r.permissions.length} of {total} permissions
                    </p>
                  </div>
                  <span className="w-20 text-right text-xs text-muted-foreground">
                    {r.members} member{r.members === 1 ? "" : "s"}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}
