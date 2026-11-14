import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Link2, Loader2, LogOut, Power, Trash2, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  adminApi,
  authKeys,
  type IssuedLink,
  type MembershipInput,
  type PlatformUser,
} from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AdminPage,
  Confirm,
  describeAction,
  LinkDialog,
  MembershipEditor,
  PageHeader,
  Panel,
  UserStatusBadge,
} from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/auth";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/users/$id")({
  head: () => ({ meta: [{ title: "User — Admin console" }] }),
  component: UserDetailPage,
});

function UserDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: authKeys.admin.user(id), queryFn: () => adminApi.user(id) });
  const [link, setLink] = useState<IssuedLink | null>(null);

  const saved = (u?: PlatformUser) => {
    if (u)
      qc.setQueryData(authKeys.admin.user(id), (old: PlatformUser | undefined) => ({
        ...old,
        ...u,
      }));
    void qc.invalidateQueries({ queryKey: authKeys.admin.user(id) });
    void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    void qc.invalidateQueries({ queryKey: authKeys.admin.overview() });
  };

  if (q.isError)
    return (
      <AdminPage>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </AdminPage>
    );
  const u = q.data;

  return (
    <AdminPage>
      <PageHeader
        back={
          <Link
            to="/admin/users"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Users
          </Link>
        }
        title={
          u ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-gradient-brand text-sm font-bold text-primary-foreground">
                {initials(u.name)}
              </span>
              {u.name}
              <UserStatusBadge status={u.status} locked={u.locked} />
            </span>
          ) : (
            <Skeleton className="h-10 w-64" />
          )
        }
        description={
          u
            ? `${u.email} · last sign-in ${u.last_login_at ? formatRelative(u.last_login_at) : "never"} · ${u.active_sessions ?? 0} active session${u.active_sessions === 1 ? "" : "s"}`
            : undefined
        }
      />

      {u ? (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            <AccessPanel u={u} onSaved={saved} />
            <DetailsPanel u={u} onSaved={saved} />
            <Panel
              title="Recent activity"
              bodyClassName="p-0"
              actions={
                <div className="flex flex-wrap gap-3 text-xs">
                  <Link
                    to="/admin/logs"
                    search={{ user: u.id }}
                    className="text-primary hover:underline"
                  >
                    Activity logs
                  </Link>
                  <Link
                    to="/admin/audit"
                    search={{ actor: u.email }}
                    className="text-primary hover:underline"
                  >
                    Audit events
                  </Link>
                </div>
              }
            >
              <ul className="divide-y divide-border">
                {(u.activity ?? []).map((e) => (
                  <li
                    key={e.id}
                    className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-sm transition hover:bg-surface-hover"
                    onClick={() =>
                      navigate({ to: "/admin/audit/$eventId", params: { eventId: String(e.id) } })
                    }
                  >
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
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-foreground">{e.actor_email ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">
                        {describeAction(e.action, e.outcome)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(e.at)}
                    </span>
                  </li>
                ))}
                {!u.activity?.length ? (
                  <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                    No activity yet.
                  </li>
                ) : null}
              </ul>
            </Panel>
          </div>
          <div className="space-y-6">
            <SignInPanel u={u} onLink={setLink} onSaved={saved} />
            <DangerPanel u={u} onSaved={saved} />
          </div>
        </div>
      ) : (
        <Skeleton className="h-96 rounded-lg" />
      )}
      <LinkDialog link={link} who={u?.name ?? "the user"} onClose={() => setLink(null)} />
    </AdminPage>
  );
}

function AccessPanel({ u, onSaved }: { u: PlatformUser; onSaved: (u: PlatformUser) => void }) {
  const initial = u.memberships.map((m) => ({ workspace_id: m.workspace_id, role_id: m.role_id }));
  const [value, setValue] = useState<MembershipInput[]>(initial);
  const key = JSON.stringify(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValue(initial), [key]);
  const dirty = JSON.stringify(value) !== key;
  const m = useMutation({
    mutationFn: () => adminApi.setMemberships(u.id, value),
    onSuccess: (r) => {
      toast.success("Access updated — it applies on their next request");
      onSaved(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel
      title="Workspace access"
      description="Which workspaces they can work in, and their role in each."
    >
      <MembershipEditor value={value} onChange={setValue} />
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          disabled={!dirty || !value.length || m.isPending}
          onClick={() => m.mutate()}
        >
          {m.isPending ? <Loader2 className="animate-spin" /> : null} Save access
        </Button>
        {dirty ? (
          <Button size="sm" variant="ghost" onClick={() => setValue(initial)}>
            Discard
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function DetailsPanel({ u, onSaved }: { u: PlatformUser; onSaved: (u: PlatformUser) => void }) {
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email);
  useEffect(() => {
    setName(u.name);
    setEmail(u.email);
  }, [u.name, u.email]);
  const m = useMutation({
    mutationFn: () => adminApi.updateUser(u.id, { name: name.trim(), email: email.trim() }),
    onSuccess: (r) => {
      toast.success("Saved");
      onSaved(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = name !== u.name || email !== u.email;
  return (
    <Panel title="Profile">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Email (their sign-in)</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={!dirty || m.isPending}>
            {m.isPending ? <Loader2 className="animate-spin" /> : null} Save profile
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SignInPanel({
  u,
  onLink,
  onSaved,
}: {
  u: PlatformUser;
  onLink: (l: IssuedLink) => void;
  onSaved: (u?: PlatformUser) => void;
}) {
  const link = useMutation({
    mutationFn: () => adminApi.userLink(u.id),
    onSuccess: (l) => {
      onLink(l);
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unlock = useMutation({
    mutationFn: () => adminApi.unlockUser(u.id),
    onSuccess: (r) => {
      toast.success("Unlocked");
      onSaved(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: () => adminApi.revokeUserSessions(u.id),
    onSuccess: (r) => {
      toast.success(
        `Signed out of ${r.sessions_ended} session${r.sessions_ended === 1 ? "" : "s"}`,
      );
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const invited = u.status === "invited";
  return (
    <Panel title="Sign-in">
      <div className="space-y-3">
        {u.pending_link ? (
          <p className="rounded-md border border-border bg-background-elevated p-3 text-xs text-muted-foreground">
            A {u.pending_link.kind === "invite" ? "invite" : "reset"} link is outstanding until{" "}
            {new Date(u.pending_link.expires_at).toLocaleString()}.
          </p>
        ) : null}
        <ActionRow
          icon={invited ? Link2 : KeyRound}
          title={invited ? "Invite link" : "Password reset link"}
          body={
            invited
              ? "A new link cancels any earlier one."
              : "They choose a new password; their sessions end."
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={u.status === "disabled" || link.isPending}
            onClick={() => link.mutate()}
          >
            {link.isPending ? <Loader2 className="animate-spin" /> : null}
            {invited ? "New invite link" : "Send reset link"}
          </Button>
        </ActionRow>
        {u.locked ? (
          <ActionRow icon={Unlock} title="Locked" body="Too many failed sign-ins.">
            <Button
              size="sm"
              variant="outline"
              onClick={() => unlock.mutate()}
              disabled={unlock.isPending}
            >
              Unlock
            </Button>
          </ActionRow>
        ) : null}
        <ActionRow icon={LogOut} title="Sessions" body={`${u.active_sessions ?? 0} active`}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => revoke.mutate()}
            disabled={!u.active_sessions || revoke.isPending}
          >
            Sign out everywhere
          </Button>
        </ActionRow>
      </div>
    </Panel>
  );
}

function ActionRow({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

function DangerPanel({ u, onSaved }: { u: PlatformUser; onSaved: (u?: PlatformUser) => void }) {
  const navigate = useNavigate();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const disabled = u.status === "disabled";
  const toggle = useMutation({
    mutationFn: () => (disabled ? adminApi.enableUser(u.id) : adminApi.disableUser(u.id)),
    onSuccess: (r) => {
      setConfirmDisable(false);
      toast.success(disabled ? "User enabled" : "User disabled and signed out");
      onSaved(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteUser(u.id),
    onSuccess: (r) => {
      toast.success(r.mode === "removed" ? "User removed" : "User deleted and anonymised");
      onSaved();
      void navigate({ to: "/admin/users" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Danger zone" className="border-red/25">
      <div className="space-y-4">
        <ActionRow
          icon={Power}
          title={disabled ? "Enable user" : "Disable user"}
          body={
            disabled ? "They can sign in again." : "Blocks sign-in and ends their sessions now."
          }
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => (disabled ? toggle.mutate() : setConfirmDisable(true))}
          >
            {disabled ? "Enable" : "Disable"}
          </Button>
        </ActionRow>
        <div className="border-t border-border pt-4">
          <ActionRow
            icon={Trash2}
            title="Delete user"
            body="Removes their sign-in and access. What they built stays in its workspace."
          >
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </ActionRow>
        </div>
      </div>
      <Confirm
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={`Disable ${u.name}?`}
        description="They are signed out everywhere and can't sign in until you enable them again."
        confirmLabel="Disable"
        destructive
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate()}
      />
      <Confirm
        open={confirmDelete}
        onOpenChange={(v) => {
          setConfirmDelete(v);
          setTyped("");
        }}
        title={`Delete ${u.name}?`}
        description={
          <>
            Their name and email are erased and they lose access to every workspace. The audit log
            keeps a record that they existed. Type <strong>{u.email}</strong> to confirm.
          </>
        }
        confirmLabel="Delete user"
        destructive
        busy={remove.isPending}
        onConfirm={() =>
          typed.trim().toLowerCase() === u.email
            ? remove.mutate()
            : toast.error("Type the email exactly to confirm.")
        }
      >
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={u.email}
          autoFocus
        />
      </Confirm>
    </Panel>
  );
}
