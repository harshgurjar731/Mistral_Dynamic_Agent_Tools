import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Building2,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { adminApi, authKeys, type SessionAdmin } from "@/api/auth";
import { PasswordCard } from "@/components/auth/AccountCards";
import { BrandMark } from "@/components/auth/AuthParts";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV: { to: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck },
  { to: "/admin/admins", label: "Admins", icon: UserCog },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/settings", label: "Platform settings", icon: Settings },
];

export function AdminShell({ admin, children }: { admin: SessionAdmin; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const active = (to: string, exact?: boolean) =>
    exact
      ? pathname === to || pathname === `${to}/`
      : pathname === to || pathname.startsWith(`${to}/`);

  if (admin.must_change_password) return <ForcedPasswordChange admin={admin} />;

  return (
    <div className="relative min-h-screen bg-background">
      <div className="app-atmosphere" aria-hidden />
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar backdrop-blur-xl transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-[73px] items-center border-b border-border px-4">
          <BrandMark size="sm" to="/admin" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <ShieldCheck className="size-3" /> Admin console
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-4">
          {NAV.map((item) => {
            const on = active(item.to, item.exact);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-xs font-medium transition",
                  on
                    ? "border-border bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <item.icon className={cn("size-4", on ? "text-primary" : "opacity-80")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-border px-2 py-3">
          <a
            href="/welcome"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ExternalLink className="size-4" /> Public site
          </a>
          <ThemeToggle variant="rail" />
          <AdminMenu admin={admin} />
        </div>
      </aside>

      <div className="relative z-10 flex min-h-screen flex-col md:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
            className="rounded-md border border-border bg-secondary p-2"
          >
            <Menu className="size-4" />
          </button>
          <span className="font-display text-sm font-bold">Admin console</span>
        </header>
        <main className="w-full">{children}</main>
      </div>
    </div>
  );
}

function AdminMenu({ admin }: { admin: SessionAdmin }) {
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSettled: () => window.location.assign("/admin/login"),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-brand text-[11px] font-bold text-primary-foreground">
            {initials(admin.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">{admin.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{admin.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Signed in as admin
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/account" className="gap-2">
            <UserRound className="size-4" /> Account & security
          </Link>
        </DropdownMenuItem>
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

function ForcedPasswordChange({ admin }: { admin: SessionAdmin }) {
  const qc = useQueryClient();
  return (
    <div className="relative grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="app-atmosphere" aria-hidden />
      <div className="relative z-10 w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark size="sm" to="/admin" />
          <span className="text-xs text-muted-foreground">{admin.email}</span>
        </div>
        <PasswordCard
          forced
          minLength={12}
          change={adminApi.changePassword}
          onChanged={() => void qc.invalidateQueries({ queryKey: authKeys.session() })}
        />
      </div>
    </div>
  );
}
