import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  adminApi,
  authKeys,
  type IssuedLink,
  type KeyStatus,
  type MembershipInput,
  type UserStatus,
  type WorkspaceWorker,
} from "@/api/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* ── Layout ────────────────────────────────────────────────────────────── */

export function AdminPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-8">
      {back ? <div className="mb-3">{back}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div className="glass rounded-lg p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className={cn("size-4", tone === "warn" ? "text-amber" : "text-primary")} />
      </div>
      <p className="mt-3 font-display text-2xl font-bold text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("glass rounded-lg", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ── Badges ────────────────────────────────────────────────────────────── */

const PILL =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium";

export function UserStatusBadge({
  status,
  locked,
}: {
  status: UserStatus | string;
  locked?: boolean;
}) {
  if (locked)
    return <span className={cn(PILL, "border-amber/30 bg-amber/10 text-amber")}>Locked</span>;
  const map: Record<string, string> = {
    active: "border-emerald/30 bg-emerald/10 text-emerald",
    invited: "border-blue/30 bg-blue/10 text-blue",
    disabled: "border-border bg-secondary text-muted-foreground",
    deleted: "border-red/30 bg-red/10 text-red",
  };
  return (
    <span className={cn(PILL, map[status] ?? map["disabled"])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function KeyStatusBadge({ status }: { status: KeyStatus }) {
  if (status === "valid")
    return (
      <span className={cn(PILL, "border-emerald/30 bg-emerald/10 text-emerald")}>
        <CheckCircle2 className="size-3" /> Verified
      </span>
    );
  if (status === "invalid")
    return (
      <span className={cn(PILL, "border-red/30 bg-red/10 text-red")}>
        <XCircle className="size-3" /> Rejected
      </span>
    );
  return (
    <span className={cn(PILL, "border-border bg-secondary text-muted-foreground")}>
      Not checked
    </span>
  );
}

export function WorkerBadge({ worker }: { worker?: WorkspaceWorker | undefined }) {
  if (!worker || !worker.enabled) return null;
  const state = worker.stale && worker.state === "running" ? "stopped" : worker.state;
  const map: Record<string, [string, string]> = {
    running: ["border-emerald/30 bg-emerald/10 text-emerald", "Worker running"],
    starting: ["border-blue/30 bg-blue/10 text-blue", "Worker starting"],
    crashed: ["border-red/30 bg-red/10 text-red", "Worker crashed"],
    stopped: ["border-amber/30 bg-amber/10 text-amber", "Worker stopped"],
    idle: ["border-border bg-secondary text-muted-foreground", "No published workflows"],
  };
  const [tone, label] = map[state] ?? map["idle"]!;
  return (
    <span className={cn(PILL, tone)}>
      <Cpu className="size-3" /> {label}
    </span>
  );
}

/** The green / amber / red dot of an audit outcome. */
export function OutcomeDot({ outcome }: { outcome: string }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        outcome === "ok" ? "bg-emerald" : outcome === "denied" ? "bg-amber" : "bg-red",
      )}
    />
  );
}

export function Chip({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border px-1.5 py-0.5 text-[11px]",
        muted ? "text-muted-foreground" : "bg-secondary text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/* ── Confirm ───────────────────────────────────────────────────────────── */

export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className={cn(
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── One-time links ────────────────────────────────────────────────────── */

export function linkUrl(link: IssuedLink): string {
  return `${window.location.origin}${link.path}`;
}

/**
 * Copy text even where the async clipboard API is missing — it only exists
 * on HTTPS and localhost, and the platform may be served over plain HTTP.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function LinkDialog({
  link,
  who,
  onClose,
}: {
  link: IssuedLink | null;
  who: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link?.token]);
  if (!link) return null;
  const url = linkUrl(link);
  const invite = link.kind === "invite";

  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      toast.success("Link copied");
    } else {
      toast.error("Couldn't copy automatically — select the link and copy it.");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10">
            {invite ? (
              <Link2 className="size-5 text-primary" />
            ) : (
              <KeyRound className="size-5 text-primary" />
            )}
          </span>
          <DialogHeader className="min-w-0 flex-1">
            <DialogTitle>
              {invite ? "Invitation link ready" : "Password reset link ready"}
            </DialogTitle>
            <DialogDescription>
              Send it to <span className="font-medium text-foreground">{who}</span> through a
              channel you trust — chat, email or in person.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-background-elevated">
          <p className="technical-label px-3.5 pt-3">One-time link</p>
          <p className="select-all break-all px-3.5 pb-3.5 pt-1.5 font-mono text-xs leading-relaxed text-foreground">
            {url}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Expires {new Date(link.expires_at).toLocaleString()}
            </span>
            <Button size="sm" onClick={() => void copy()} className="min-w-[104px]">
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>

        <ul className="space-y-2 text-xs text-muted-foreground">
          {[
            invite
              ? "Opening it lets them choose a password and signs them in."
              : "Opening it lets them choose a new password; their other sessions end.",
            "It works once. This is the only time it is shown.",
            "Issuing another link cancels this one.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
              {t}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Workspace + role picker ───────────────────────────────────────────── */

export function useWorkspacesAndRoles() {
  const ws = useQuery({ queryKey: authKeys.admin.workspaces(), queryFn: adminApi.workspaces });
  const roles = useQuery({ queryKey: authKeys.admin.roles(), queryFn: adminApi.roles });
  return {
    workspaces: ws.data?.workspaces ?? [],
    roles: roles.data?.roles ?? [],
    loading: ws.isLoading || roles.isLoading,
  };
}

export function MembershipEditor({
  value,
  onChange,
}: {
  value: MembershipInput[];
  onChange: (v: MembershipInput[]) => void;
}) {
  const { workspaces, roles, loading } = useWorkspacesAndRoles();
  const used = new Set(value.map((m) => m.workspace_id));
  const free = workspaces.filter((w) => !used.has(w.id) && !w.disabled);
  const defaultRole = roles.find((r) => r.system_key === "operator") ?? roles[0];

  if (loading) return <p className="text-sm text-muted-foreground">Loading workspaces…</p>;
  if (!workspaces.length)
    return (
      <p className="flex items-center gap-2 text-sm text-amber">
        <AlertTriangle className="size-4" /> Create a workspace first.
      </p>
    );

  return (
    <div className="space-y-2">
      {value.map((m, i) => {
        const ws = workspaces.find((w) => w.id === m.workspace_id);
        return (
          <div key={m.workspace_id || i} className="flex items-center gap-2">
            <Select
              value={m.workspace_id}
              onValueChange={(v) =>
                onChange(value.map((x, j) => (j === i ? { ...x, workspace_id: v } : x)))
              }
            >
              <SelectTrigger className="h-9 min-w-0 flex-1">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {ws ? (
                  <SelectItem value={ws.id}>
                    {ws.name}
                    {ws.disabled ? " (disabled)" : ""}
                  </SelectItem>
                ) : null}
                {free.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={m.role_id}
              onValueChange={(v) =>
                onChange(value.map((x, j) => (j === i ? { ...x, role_id: v } : x)))
              }
            >
              <SelectTrigger className="h-9 w-36 shrink-0 sm:w-44">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {r.system ? "" : " · custom"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Remove from workspace"
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {free.length && defaultRole ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([...value, { workspace_id: free[0]!.id, role_id: defaultRole.id }])
          }
        >
          <Plus /> Add to another workspace
        </Button>
      ) : null}
    </div>
  );
}

/* ── Audit rows ────────────────────────────────────────────────────────── */

const ACTION_TEXT: Record<string, string> = {
  "user.login": "signed in",
  "admin.login": "signed in to the admin console",
  "user.logout": "signed out",
  "admin.logout": "signed out of the admin console",
  "user.logout_all": "signed out everywhere",
  "user.create": "created a user",
  "user.update": "updated a user",
  "user.memberships": "changed workspace access",
  "user.invite_link": "issued an invite link",
  "user.reset_link": "issued a password reset link",
  "user.invite_accept": "accepted an invitation",
  "user.password_reset": "reset their password",
  "user.password_change": "changed their password",
  "user.disable": "disabled a user",
  "user.enable": "enabled a user",
  "user.unlock": "unlocked a user",
  "user.delete": "deleted a user",
  "user.sessions_revoke": "signed a user out everywhere",
  "user.switch_workspace": "switched workspace",
  "workspace.create": "created a workspace",
  "workspace.update": "updated a workspace",
  "workspace.disable": "disabled a workspace",
  "workspace.enable": "enabled a workspace",
  "workspace.delete": "deleted a workspace",
  "workspace.key_rotate": "replaced a workspace key",
  "workspace.key_check": "checked a workspace key",
  "workspace.key_rejected": "— Mistral rejected a workspace key",
  "role.create": "created a role",
  "role.update": "changed a role",
  "role.delete": "deleted a role",
  "admin.create": "added an admin",
  "admin.update": "updated an admin",
  "admin.delete": "removed an admin",
  "admin.password_change": "changed their admin password",
  "admin.invite_accept": "accepted an admin invitation",
};

export function describeAction(action: string, outcome: string): string {
  const base = ACTION_TEXT[action] ?? action;
  if (outcome === "failed" && action.endsWith(".login")) return "failed to sign in";
  if (outcome === "denied" && action.endsWith(".login")) return "was refused sign-in";
  return base;
}
