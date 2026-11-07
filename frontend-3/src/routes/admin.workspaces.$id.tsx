import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Loader2, Power, RefreshCw, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi, authKeys, type Workspace } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AdminPage,
  Chip,
  Confirm,
  KeyStatusBadge,
  PageHeader,
  Panel,
  UserStatusBadge,
  WorkerBadge,
} from "@/components/admin/parts";
import { FormError } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/admin/workspaces/$id")({
  head: () => ({ meta: [{ title: "Workspace — Admin console" }] }),
  component: WorkspaceDetailPage,
});

function errorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

function WorkspaceDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: authKeys.admin.workspace(id),
    queryFn: () => adminApi.workspace(id),
  });
  const members = useQuery({
    queryKey: authKeys.admin.members(id),
    queryFn: () => adminApi.workspaceMembers(id),
  });

  const refresh = (w?: Workspace) => {
    if (w)
      qc.setQueryData(authKeys.admin.workspace(id), (old: Workspace | undefined) => ({
        ...old,
        ...w,
      }));
    void qc.invalidateQueries({ queryKey: authKeys.admin.workspaces() });
    void qc.invalidateQueries({ queryKey: authKeys.admin.overview() });
  };

  if (q.isError)
    return (
      <AdminPage>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </AdminPage>
    );
  const w = q.data;

  return (
    <AdminPage>
      <PageHeader
        back={
          <Link
            to="/admin/workspaces"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Workspaces
          </Link>
        }
        title={
          w ? (
            <span className="flex flex-wrap items-center gap-2.5">
              {w.name}
              {w.is_default ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Default
                </span>
              ) : null}
              {w.disabled ? (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Disabled
                </span>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-8 w-56" />
          )
        }
        description={
          w
            ? `Created ${formatRelative(w.created_at)}${w.created_by ? ` by ${w.created_by}` : ""}.`
            : undefined
        }
      />

      {w ? (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            <DetailsPanel w={w} onSaved={refresh} />
            <KeyPanel w={w} onSaved={refresh} />
            <WorkerPanel w={w} />
          </div>
          <div className="space-y-6">
            <Panel
              title="Members"
              description="Add or remove people from a user's page."
              actions={
                <Link
                  to="/admin/users"
                  search={{ workspace: w.id }}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Users className="size-3.5" /> Manage
                </Link>
              }
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-border">
                {(members.data?.members ?? []).map((m) => (
                  <li key={m.user_id}>
                    <Link
                      to="/admin/users/$id"
                      params={{ id: m.user_id }}
                      className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {m.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.email}
                        </span>
                      </span>
                      <Chip>{m.role_name}</Chip>
                      <UserStatusBadge status={m.status} />
                    </Link>
                  </li>
                ))}
                {members.data && !members.data.members.length ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No members yet.
                  </li>
                ) : null}
              </ul>
            </Panel>
            {w.data && Object.keys(w.data).length ? (
              <Panel
                title="Data owned"
                description="Rows this workspace owns in the platform database."
              >
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(w.data).map(([table, n]) => (
                    <li key={table} className="flex justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{table}</span>
                      <span className="font-medium">{n}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            <DangerPanel w={w} onSaved={refresh} />
          </div>
        </div>
      ) : (
        <Skeleton className="h-96 rounded-lg" />
      )}
    </AdminPage>
  );
}

function DetailsPanel({ w, onSaved }: { w: Workspace; onSaved: (w: Workspace) => void }) {
  const [name, setName] = useState(w.name);
  const [description, setDescription] = useState(w.description);
  useEffect(() => {
    setName(w.name);
    setDescription(w.description);
  }, [w.name, w.description]);
  const m = useMutation({
    mutationFn: () => adminApi.updateWorkspace(w.id, { name: name.trim(), description }),
    onSuccess: (r) => {
      toast.success("Saved");
      onSaved(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = name !== w.name || description !== w.description;
  return (
    <Panel title="Details">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <Button type="submit" size="sm" disabled={!dirty || !name.trim() || m.isPending}>
          {m.isPending ? <Loader2 className="animate-spin" /> : null} Save changes
        </Button>
      </form>
    </Panel>
  );
}

function KeyPanel({ w, onSaved }: { w: Workspace; onSaved: (w: Workspace) => void }) {
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [otherWorkspace, setOtherWorkspace] = useState(false);

  const recheck = useMutation({
    mutationFn: () => adminApi.recheckKey(w.id),
    onSuccess: (r) => {
      onSaved(r);
      if (r.key_status === "valid") toast.success("Mistral accepted the key");
      else toast.error(r.key_error ?? "Mistral rejected the key");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotate = useMutation({
    mutationFn: (allow: boolean) => adminApi.rotateKey(w.id, key.trim(), allow),
    onSuccess: (r) => {
      onSaved(r);
      toast.success(
        r.same_mistral_workspace
          ? "Key replaced — same Mistral workspace confirmed"
          : "Key replaced",
      );
      setReplacing(false);
      setOtherWorkspace(false);
      setKey("");
      setError(null);
    },
    onError: (e) => {
      if (errorCode(e) === "other_workspace") setOtherWorkspace(true);
      else setError(errorMessage(e));
    },
  });

  const platform = w.key_source === "platform";
  return (
    <Panel
      title="Mistral API key"
      description={
        platform
          ? "The Default workspace uses the platform's MISTRAL_API_KEY. Change it in Platform settings."
          : "Every Mistral call this workspace's members make uses this key."
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => recheck.mutate()}
          disabled={recheck.isPending}
        >
          {recheck.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background-elevated p-4">
        <span className="grid size-9 place-items-center rounded-md bg-secondary">
          <KeyRound className="size-4 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-sm text-foreground">{w.key_hint ?? "—"}</span>
          <span className="block text-xs text-muted-foreground">
            Checked {formatRelative(w.key_checked_at)}
            {w.key_rotated_at ? ` · replaced ${formatRelative(w.key_rotated_at)}` : ""}
          </span>
        </span>
        <KeyStatusBadge status={w.key_status} />
      </div>
      {w.key_error ? <p className="mt-3 text-xs text-red">{w.key_error}</p> : null}

      {!platform ? (
        replacing ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              rotate.mutate(false);
            }}
          >
            <FormError message={error} />
            <Label className="text-xs">New key</Label>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the replacement key"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Use a key from the same Mistral workspace, or this workspace's agents and libraries
              become unreachable. It is checked before it replaces the current one.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!key.trim() || rotate.isPending}>
                {rotate.isPending ? <Loader2 className="animate-spin" /> : null} Verify and replace
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button className="mt-4" size="sm" variant="secondary" onClick={() => setReplacing(true)}>
            Replace key
          </Button>
        )
      ) : null}

      <Confirm
        open={otherWorkspace}
        onOpenChange={setOtherWorkspace}
        title="This key is for a different Mistral workspace"
        description="The agents, libraries and conversations this workspace already has were created in its current Mistral workspace. With this key they can no longer be reached. Replace it anyway?"
        confirmLabel="Replace anyway"
        destructive
        busy={rotate.isPending}
        onConfirm={() => rotate.mutate(true)}
      />
    </Panel>
  );
}

function WorkerPanel({ w }: { w: Workspace }) {
  const worker = w.worker;
  if (!worker) return null;
  const rows: [string, React.ReactNode][] = [
    ["Task queue", <code className="font-mono text-xs">{worker.deployment}</code>],
    ["Published workflows", worker.published_workflows],
  ];
  if (worker.pid) rows.push(["Process", worker.pid]);
  if (worker.started_at)
    rows.push(["Started", formatRelative(new Date(worker.started_at * 1000).toISOString())]);
  if (worker.restarts) rows.push(["Restarts", worker.restarts]);
  return (
    <Panel
      title="Workflow worker"
      description="Runs this workspace's published workflows for Mistral, on its own key and task queue."
      actions={<WorkerBadge worker={worker} />}
    >
      {!worker.enabled ? (
        <p className="text-sm text-muted-foreground">
          The platform's Mistral worker is turned off (MISTRAL_WORKER_ENABLED=false). Workflows run
          on the local engine only.
        </p>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          {worker.state === "idle" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              A worker starts automatically, within half a minute, once a workflow in this workspace
              is published.
            </p>
          ) : null}
          {worker.last_error ? <p className="mt-3 text-xs text-red">{worker.last_error}</p> : null}
          {worker.stale ? (
            <p className="mt-3 text-xs text-amber">
              The worker supervisor hasn't reported for a few minutes — it may have stopped. Restart
              the backend if runs stay queued.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function DangerPanel({ w, onSaved }: { w: Workspace; onSaved: (w: Workspace) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = useMutation({
    mutationFn: () => adminApi.updateWorkspace(w.id, { disabled: !w.disabled }),
    onSuccess: (r) => {
      onSaved(r);
      setConfirmDisable(false);
      toast.success(r.disabled ? "Workspace disabled" : "Workspace enabled");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteWorkspace(w.id),
    onSuccess: () => {
      toast.success("Workspace deleted");
      void qc.invalidateQueries({ queryKey: authKeys.admin.workspaces() });
      void navigate({ to: "/admin/workspaces" });
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(errorMessage(e));
    },
  });
  if (w.is_default) return null;
  return (
    <Panel title="Danger zone" className="border-red/25">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              {w.disabled ? "Enable workspace" : "Disable workspace"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {w.disabled
                ? "Members can work in it again."
                : "Members can no longer work in it; nothing is deleted."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (w.disabled ? toggle.mutate() : setConfirmDisable(true))}
          >
            <Power /> {w.disabled ? "Enable" : "Disable"}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium">Delete workspace</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only possible once it has no members and owns no data.
            </p>
          </div>
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
      <Confirm
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={`Disable ${w.name}?`}
        description="Its members are moved to another workspace they belong to, or signed out if they have none. You can enable it again at any time."
        confirmLabel="Disable"
        destructive
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate()}
      />
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${w.name}?`}
        description="This removes the workspace and its stored key. It cannot be undone."
        confirmLabel="Delete workspace"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Panel>
  );
}
