import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Building2, ScrollText, UserRound } from "lucide-react";
import { adminApi, authKeys, type ActivityTraceDetail } from "@/api/auth";
import { AdminPage, Chip } from "@/components/admin/parts";
import { TraceDetailPage } from "@/components/observability/TraceDetailPage";

export const Route = createFileRoute("/admin/logs_/$workspaceId/$traceId")({
  head: () => ({ meta: [{ title: "Activity — Admin console" }] }),
  component: ActivityTracePage,
});

function ActivityTracePage() {
  const { workspaceId, traceId } = Route.useParams();
  return (
    <AdminPage>
      <TraceDetailPage<ActivityTraceDetail>
        className=""
        queryKey={authKeys.admin.activityTrace(workspaceId, traceId)}
        load={() => adminApi.activityTrace(workspaceId, traceId)}
        back={
          <Link
            to="/admin/logs"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Activity logs
          </Link>
        }
        header={(d) => <WhoAndWhere detail={d} />}
      />
    </AdminPage>
  );
}

function WhoAndWhere({ detail }: { detail: ActivityTraceDetail }) {
  const a = detail.actor;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Chip>
        <UserRound className="size-3" />
        {a ? (
          a.kind === "user" && a.status !== "unknown" ? (
            <Link
              to="/admin/users/$id"
              params={{ id: a.id }}
              className="text-foreground hover:underline"
            >
              {a.name || a.email}
              {a.email && a.name ? (
                <span className="ml-1 text-muted-foreground">({a.email})</span>
              ) : null}
            </Link>
          ) : (
            <span>{a.name || a.email || `${a.kind} ${a.id}`}</span>
          )
        ) : (
          <span className="text-muted-foreground">system</span>
        )}
      </Chip>
      <Chip>
        <Building2 className="size-3" />
        <Link
          to="/admin/workspaces/$id"
          params={{ id: detail.workspace.id }}
          className="text-foreground hover:underline"
        >
          {detail.workspace.name}
        </Link>
      </Chip>
      {a?.kind === "user" ? (
        <Link
          to="/admin/logs"
          search={{ user: a.id }}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <ScrollText className="size-3" /> All activity by this user
        </Link>
      ) : null}
    </div>
  );
}
