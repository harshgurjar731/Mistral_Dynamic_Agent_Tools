import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { adminApi, authKeys, type IssuedLink, type MembershipInput } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AdminPage,
  Chip,
  LinkDialog,
  MembershipEditor,
  PageHeader,
  UserStatusBadge,
  useWorkspacesAndRoles,
} from "@/components/admin/parts";
import { FormError } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/auth";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/admin/users/")({
  validateSearch: z.object({
    invite: z.boolean().optional(),
    workspace: z.string().optional(),
    status: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Users — Admin console" }] }),
  component: UsersPage,
});

const ALL = "__all__";

function UsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/users/" });
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [inviteOpen, setInviteOpen] = useState(!!search.invite);
  useEffect(() => setInviteOpen(!!search.invite), [search.invite]);
  const { workspaces } = useWorkspacesAndRoles();

  const params = {
    q: debounced || undefined,
    workspace_id: search.workspace,
    status: search.status,
  };
  const users = useQuery({
    queryKey: authKeys.admin.users(params),
    queryFn: () => adminApi.users(params),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key: "workspace" | "status", value: string) =>
    void navigate({
      search: (s) => ({ ...s, [key]: value === ALL ? undefined : value }),
      replace: true,
    });

  return (
    <AdminPage>
      <PageHeader
        title="Users"
        description="People who sign in to the platform. Each belongs to one or more workspaces, with a role in each."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite user
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            className="h-9 pl-9"
          />
        </div>
        <Select value={search.workspace ?? ALL} onValueChange={(v) => setFilter("workspace", v)}>
          <SelectTrigger className="h-9 w-48">
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
        <Select value={search.status ?? ALL} onValueChange={(v) => setFilter("status", v)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {users.isError ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : null}

      <div className="glass overflow-hidden rounded-lg">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_110px_120px] gap-4 border-b border-border px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
          <span>User</span>
          <span>Workspaces and roles</span>
          <span>Status</span>
          <span className="text-right">Last sign-in</span>
        </div>
        {users.isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : users.data?.users.length ? (
          <ul className="divide-y divide-border">
            {users.data.users.map((u) => (
              <li key={u.id}>
                <Link
                  to="/admin/users/$id"
                  params={{ id: u.id }}
                  className="grid gap-3 px-5 py-3.5 transition hover:bg-surface-hover md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_110px_120px] md:items-center md:gap-4"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold">
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {u.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {u.memberships.map((m) => (
                      <Chip key={m.workspace_id} muted={m.workspace_disabled}>
                        <span className="font-medium">{m.workspace_name}</span>
                        <span className="text-muted-foreground">· {m.role_name}</span>
                      </Chip>
                    ))}
                  </span>
                  <span>
                    <UserStatusBadge status={u.status} locked={u.locked} />
                  </span>
                  <span className="text-xs text-muted-foreground md:text-right">
                    {u.last_login_at ? formatRelative(u.last_login_at) : "Never"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            className="py-14"
            icon={<Users className="size-6" />}
            title={
              debounced || search.workspace || search.status ? "No users match" : "No users yet"
            }
            description="Invite someone to get started."
          />
        )}
      </div>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={(v) => {
          setInviteOpen(v);
          if (!v && search.invite)
            void navigate({ search: (s) => ({ ...s, invite: undefined }), replace: true });
        }}
        defaultWorkspace={search.workspace}
      />
    </AdminPage>
  );
}

function InviteUserDialog({
  open,
  onOpenChange,
  defaultWorkspace,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultWorkspace?: string | undefined;
}) {
  const qc = useQueryClient();
  const { workspaces, roles } = useWorkspacesAndRoles();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<MembershipInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: IssuedLink; who: string } | null>(null);

  const initial = useMemo(() => {
    const ws =
      workspaces.find((w) => w.id === defaultWorkspace && !w.disabled) ??
      workspaces.find((w) => !w.disabled);
    const role = roles.find((r) => r.system_key === "operator") ?? roles[0];
    return ws && role ? [{ workspace_id: ws.id, role_id: role.id }] : [];
  }, [workspaces, roles, defaultWorkspace]);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setError(null);
      setMemberships(initial);
    }
  }, [open, initial]);

  const create = useMutation({
    mutationFn: () => adminApi.createUser({ name: name.trim(), email: email.trim(), memberships }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: authKeys.admin.overview() });
      onOpenChange(false);
      if (u.link) setLink({ link: u.link, who: u.name });
      toast.success(`${u.name} invited`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              They get a one-time link to choose their password. Until then they can't sign in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Full name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Workspaces and roles</Label>
              <MembershipEditor value={memberships} onChange={setMemberships} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || !email.trim() || !memberships.length || create.isPending}
              >
                {create.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Create and get link
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <LinkDialog link={link?.link ?? null} who={link?.who ?? ""} onClose={() => setLink(null)} />
    </>
  );
}
