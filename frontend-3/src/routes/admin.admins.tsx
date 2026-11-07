import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Loader2, MoreHorizontal, Power, ShieldPlus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { adminApi, authKeys, type AdminAccount, type IssuedLink } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AdminPage,
  Confirm,
  LinkDialog,
  PageHeader,
  UserStatusBadge,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/auth";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/admin/admins")({
  head: () => ({ meta: [{ title: "Admins — Admin console" }] }),
  component: AdminsPage,
});

function AdminsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: authKeys.admin.admins(), queryFn: adminApi.admins });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ link: IssuedLink; who: string } | null>(null);
  const [pending, setPending] = useState<{
    kind: "disable" | "delete";
    admin: AdminAccount;
  } | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: authKeys.admin.admins() });

  const update = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      adminApi.updateAdmin(id, { disabled }),
    onSuccess: (a) => {
      toast.success(a.status === "disabled" ? "Admin disabled" : "Admin enabled");
      setPending(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteAdmin(id),
    onSuccess: () => {
      toast.success("Admin removed");
      setPending(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const issue = useMutation({
    mutationFn: (a: AdminAccount) => adminApi.adminLink(a.id).then((l) => ({ l, a })),
    onSuccess: ({ l, a }) => setLink({ link: l, who: a.name }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <AdminPage>
      <PageHeader
        title="Admins"
        description="Platform admins manage workspaces, users, roles and settings. They don't work inside workspaces — give yourself a user account for that. Keep at least two."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <ShieldPlus /> Add admin
          </Button>
        }
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      <div className="glass overflow-hidden rounded-lg">
        {q.isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {q.data?.admins.map((a) => {
              const me = a.id === q.data?.me;
              return (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-brand text-xs font-bold text-primary-foreground">
                    {initials(a.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {a.name}
                      {me ? (
                        <span className="text-[11px] font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {a.last_login_at
                      ? `signed in ${formatRelative(a.last_login_at)}`
                      : "never signed in"}
                  </span>
                  <UserStatusBadge status={a.status} locked={a.locked} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label="Admin actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => issue.mutate(a)}
                        disabled={a.status === "disabled"}
                      >
                        <KeyRound className="size-4" />
                        {a.status === "invited" ? "New invite link" : "Password reset link"}
                      </DropdownMenuItem>
                      {!me ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() =>
                              a.status === "disabled"
                                ? update.mutate({ id: a.id, disabled: false })
                                : setPending({ kind: "disable", admin: a })
                            }
                          >
                            <Power className="size-4" />{" "}
                            {a.status === "disabled" ? "Enable" : "Disable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red focus:text-red"
                            onSelect={() => setPending({ kind: "delete", admin: a })}
                          >
                            <Trash2 className="size-4" /> Remove admin
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={(a) => {
          invalidate();
          if (a.link) setLink({ link: a.link, who: a.name });
        }}
      />
      <LinkDialog link={link?.link ?? null} who={link?.who ?? ""} onClose={() => setLink(null)} />
      <Confirm
        open={!!pending}
        onOpenChange={(v) => (!v ? setPending(null) : null)}
        title={
          pending?.kind === "delete"
            ? `Remove ${pending.admin.name} as admin?`
            : `Disable ${pending?.admin.name ?? ""}?`
        }
        description={
          pending?.kind === "delete"
            ? "Their admin account is deleted and their sessions end. This cannot be undone."
            : "They are signed out of the admin console and can't sign in until enabled."
        }
        confirmLabel={pending?.kind === "delete" ? "Remove" : "Disable"}
        destructive
        busy={update.isPending || remove.isPending}
        onConfirm={() =>
          pending?.kind === "delete"
            ? remove.mutate(pending.admin.id)
            : pending && update.mutate({ id: pending.admin.id, disabled: true })
        }
      />
    </AdminPage>
  );
}

function InviteAdminDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (a: AdminAccount) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => adminApi.createAdmin({ name: name.trim(), email: email.trim() }),
    onSuccess: (a) => {
      toast.success(`${a.name} added`);
      onOpenChange(false);
      setName("");
      setEmail("");
      onCreated(a);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    m.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a platform admin</DialogTitle>
          <DialogDescription>
            They get full control of the platform. Admin passwords need at least 12 characters.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label className="text-xs">Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !email.trim() || m.isPending}>
              {m.isPending ? <Loader2 className="animate-spin" /> : null} Add and get link
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
