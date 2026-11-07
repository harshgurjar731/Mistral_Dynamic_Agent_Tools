import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Check, ChevronsUpDown, Loader2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, useCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Everything cached belongs to the old workspace, so start the app afresh. */
function reloadHome() {
  window.location.assign("/");
}

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const user = useCurrentUser();
  const switchWs = useMutation({
    mutationFn: authApi.switchWorkspace,
    onSuccess: (u) => {
      toast.success(`Switched to ${u.workspace.name}`);
      reloadHome();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  const many = user.workspaces.length > 1;

  const trigger = (
    <button
      type="button"
      disabled={!many}
      title={collapsed ? `${user.workspace.name} · ${user.workspace.role_name ?? ""}` : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border border-border bg-background-elevated px-2 py-1.5 text-left transition",
        many && "hover:border-border-strong hover:bg-surface-hover",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-[11px] font-bold text-foreground">
        {initials(user.workspace.name)}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {user.workspace.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {user.workspace.role_name}
            </span>
          </span>
          {switchWs.isPending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : many ? (
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          ) : null}
        </>
      ) : null}
    </button>
  );

  if (!many) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {user.workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            disabled={w.active || switchWs.isPending}
            onSelect={() => switchWs.mutate(w.id)}
            className="gap-2.5"
          >
            <span className="grid size-6 place-items-center rounded bg-secondary text-[10px] font-bold">
              {initials(w.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{w.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {w.role_name}
              </span>
            </span>
            {w.active ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const user = useCurrentUser();
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => window.location.assign("/"),
  });
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? user.name : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-brand text-[11px] font-bold text-primary-foreground">
            {initials(user.name)}
          </span>
          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {user.name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "top"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account" className="gap-2">
            <UserRound className="size-4" /> Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account" hash="workspaces" className="gap-2">
            <Building2 className="size-4" /> My workspaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            logout.mutate();
          }}
          className="gap-2 text-red focus:text-red"
        >
          {logout.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogOut className="size-4" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
