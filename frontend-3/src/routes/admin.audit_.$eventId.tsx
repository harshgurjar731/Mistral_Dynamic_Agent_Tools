import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { adminApi, authKeys, type AuditEvent, type AuditSubject } from "@/api/auth";
import {
  AdminPage,
  describeAction,
  OutcomeDot,
  PageHeader,
  Panel,
  UserStatusBadge,
} from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/audit_/$eventId")({
  head: () => ({ meta: [{ title: "Audit event — Admin console" }] }),
  component: AuditEventPage,
});

const OUTCOME_TEXT: Record<string, { label: string; tone: string }> = {
  ok: { label: "Succeeded", tone: "border-emerald/30 bg-emerald/10 text-emerald" },
  denied: { label: "Refused", tone: "border-amber/30 bg-amber/10 text-amber" },
  failed: { label: "Failed", tone: "border-red/30 bg-red/10 text-red" },
};

function AuditEventPage() {
  const { eventId } = Route.useParams();
  const id = Number(eventId);
  const navigate = useNavigate();
  const router = useRouter();
  const q = useQuery({
    queryKey: authKeys.admin.auditEvent(id),
    queryFn: () => adminApi.auditEvent(id),
    enabled: Number.isFinite(id),
  });
  const e = q.data;
  const open = (to: number) =>
    navigate({ to: "/admin/audit/$eventId", params: { eventId: String(to) } });

  const back = (
    <button
      type="button"
      onClick={() =>
        window.history.length > 1 ? router.history.back() : navigate({ to: "/admin/audit" })
      }
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> Audit log
    </button>
  );

  if (q.isError)
    return (
      <AdminPage>
        <PageHeader title="Audit event" back={back} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </AdminPage>
    );
  if (!e)
    return (
      <AdminPage>
        <PageHeader title="Audit event" back={back} />
        <Skeleton className="h-64 w-full" />
      </AdminPage>
    );

  const outcome = OUTCOME_TEXT[e.outcome] ?? OUTCOME_TEXT["failed"]!;
  const when = e.at ? new Date(e.at) : null;

  return (
    <AdminPage>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.actor_email ?? "System"} {describeAction(e.action, e.outcome)}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                outcome.tone,
              )}
            >
              {outcome.label}
            </span>
            <code className="font-mono text-xs">{e.action}</code>
            <span>·</span>
            <span>{when ? `${when.toLocaleString()} (${formatRelative(e.at)})` : "—"}</span>
            <span>·</span>
            <span className="font-mono text-xs">event #{e.id}</span>
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!e.newer_id}
              onClick={() => e.newer_id && open(e.newer_id)}
            >
              <ChevronLeft /> Newer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!e.older_id}
              onClick={() => e.older_id && open(e.older_id)}
            >
              Older <ChevronRight />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Who">
          <Fields>
            <Field label="Account">
              <SubjectLink subject={e.actor} fallback={e.actor_email ?? "System"} />
            </Field>
            <Field label="Kind">{e.actor_kind ?? "system"}</Field>
            <Field label="Email">{e.actor_email ?? "—"}</Field>
            <Field label="Account id">
              <span className="font-mono text-xs">{e.actor_id ?? "—"}</span>
            </Field>
            {e.actor?.status ? (
              <Field label="Status now">
                <UserStatusBadge status={e.actor.exists ? e.actor.status : "deleted"} />
              </Field>
            ) : null}
          </Fields>
          {e.actor_email || e.actor_id ? (
            <div className="mt-4 flex flex-col gap-1.5 text-xs">
              {e.actor_email ? (
                <Link
                  to="/admin/audit"
                  search={{ actor: e.actor_email }}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ScrollText className="size-3" /> Every audit event by this account
                </Link>
              ) : null}
              {e.actor_kind === "user" && e.actor_id ? (
                <Link
                  to="/admin/logs"
                  search={{ user: e.actor_id }}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ScrollText className="size-3" /> This user's activity logs
                </Link>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <Panel title="What">
          <Fields>
            <Field label="Event">{describeAction(e.action, e.outcome)}</Field>
            <Field label="Action">
              <code className="font-mono text-xs">{e.action}</code>
            </Field>
            <Field label="Outcome">
              <span className="inline-flex items-center gap-1.5">
                <OutcomeDot outcome={e.outcome} /> {outcome.label}
              </span>
            </Field>
            <Field label="Target">
              {e.target_type || e.target_id ? (
                <span className="flex flex-col">
                  <span className="text-muted-foreground">{e.target_type ?? "—"}</span>
                  <SubjectLink subject={e.target} fallback={e.target_id ?? "—"} />
                </span>
              ) : (
                "—"
              )}
            </Field>
          </Fields>
          {e.target_id ? (
            <Link
              to="/admin/audit"
              search={{ target: e.target_id }}
              className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ScrollText className="size-3" /> Every audit event on this{" "}
              {e.target_type ?? "target"}
            </Link>
          ) : null}
        </Panel>

        <Panel title="Where">
          <Fields>
            <Field label="Workspace">
              {e.workspace ? (
                <Link
                  to="/admin/workspaces/$id"
                  params={{ id: e.workspace.id }}
                  className="text-foreground hover:underline"
                >
                  {e.workspace.name}
                </Link>
              ) : e.workspace_id ? (
                <span className="font-mono text-xs">{e.workspace_id}</span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="IP address">
              <span className="font-mono text-xs">{e.ip ?? "—"}</span>
            </Field>
            <Field label="Time (UTC)">
              <span className="font-mono text-xs">{e.at ?? "—"}</span>
            </Field>
          </Fields>
        </Panel>
      </div>

      <Panel
        title="Details"
        description="Everything recorded with this event. Passwords and keys are never part of it."
        className="mt-4"
      >
        {e.detail && Object.keys(e.detail).length ? (
          <>
            <Fields>
              {Object.entries(e.detail).map(([k, v]) => (
                <Field key={k} label={k.replace(/_/g, " ")}>
                  {typeof v === "object" && v !== null ? (
                    <pre className="custom-scrollbar max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                      {JSON.stringify(v, null, 2)}
                    </pre>
                  ) : (
                    <span className="break-all font-mono text-xs">{String(v)}</span>
                  )}
                </Field>
              ))}
            </Fields>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">Raw JSON</summary>
              <pre className="custom-scrollbar mt-2 max-h-64 overflow-auto rounded-md bg-background-elevated p-3 font-mono text-[11px] text-muted-foreground">
                {JSON.stringify(rawEvent(e), null, 2)}
              </pre>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No further detail was recorded.</p>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RelatedEvents
          title="Other recent events by this account"
          events={e.by_actor}
          onOpen={open}
        />
        <RelatedEvents
          title={`Other recent events on this ${e.target_type ?? "target"}`}
          events={e.on_target}
          onOpen={open}
        />
      </div>
    </AdminPage>
  );
}

function rawEvent(e: AuditEvent): AuditEvent {
  const { id, at, actor_kind, actor_id, actor_email, action, target_type, target_id } = e;
  const { workspace_id, outcome, detail, ip } = e;
  return {
    id,
    at,
    actor_kind,
    actor_id,
    actor_email,
    action,
    target_type,
    target_id,
    workspace_id,
    outcome,
    detail,
    ip,
  };
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">{children}</dl>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs capitalize text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

function SubjectLink({ subject, fallback }: { subject: AuditSubject | null; fallback: string }) {
  if (!subject) return <span>{fallback}</span>;
  const label = subject.name || subject.email || fallback;
  const cls = "text-foreground hover:underline";
  if (subject.exists) {
    if (subject.type === "user")
      return (
        <Link to="/admin/users/$id" params={{ id: subject.id }} className={cls}>
          {label}
        </Link>
      );
    if (subject.type === "workspace")
      return (
        <Link to="/admin/workspaces/$id" params={{ id: subject.id }} className={cls}>
          {label}
        </Link>
      );
    if (subject.type === "role")
      return (
        <Link to="/admin/roles/$id" params={{ id: subject.id }} className={cls}>
          {label}
        </Link>
      );
    if (subject.type === "admin")
      return (
        <Link to="/admin/admins" className={cls}>
          {label}
        </Link>
      );
  }
  return (
    <span>
      {label}
      {!subject.exists ? (
        <span className="ml-1 text-xs text-muted-foreground">(removed)</span>
      ) : null}
    </span>
  );
}

function RelatedEvents({
  title,
  events,
  onOpen,
}: {
  title: string;
  events: AuditEvent[];
  onOpen: (id: number) => void;
}) {
  return (
    <Panel title={title} bodyClassName="p-0">
      {events.length ? (
        <ul className="divide-y divide-border">
          {events.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => onOpen(ev.id)}
                className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm transition hover:bg-surface-hover"
              >
                <OutcomeDot outcome={ev.outcome} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{ev.actor_email ?? "System"}</span>{" "}
                  {describeAction(ev.action, ev.outcome)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(ev.at)}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">None.</p>
      )}
    </Panel>
  );
}
