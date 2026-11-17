import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  ChevronDown,
  Globe,
  History,
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
import { useRef, useState, type ReactNode } from "react";
import { adminApi, authKeys, type SessionAdmin } from "@/api/auth";
import { PasswordCard } from "@/components/auth/AccountCards";
import { BrandMark } from "@/components/auth/AuthParts";
import { Breadcrumb, HeaderBar } from "@/components/layout/AppHeader";
import { usePageSetCrumbs } from "@/components/layout/pageCrumbs";
import { NavLink, NavSection, headerIconButton } from "@/components/layout/NavSection";
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
import { usePageTransition } from "@/lib/gsap";
import { cn } from "@/lib/utils";

type AdminLink = { to: string; label: string; icon: LucideIcon; exact?: boolean };

/** The admin console's menu, by section. */
const NAV: { label: string; items: AdminLink[] }[] = [
  {
    label: "General",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/admin/health", label: "System health", icon: Activity },
    ],
  },
  {
    label: "Access",
    items: [
      { to: "/admin/workspaces", label: "Workspaces", icon: Building2 },
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck },
      { to: "/admin/admins", label: "Admins", icon: UserCog },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { to: "/admin/logs", label: "Activity logs", icon: History },
      { to: "/admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  {
    label: "Platform",
    items: [{ to: "/settings", label: "Platform settings", icon: Settings }],
  },
];

export function AdminShell({ admin, children }: { admin: SessionAdmin; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const adminCrumbs = usePageSetCrumbs(pathname);
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  usePageTransition(mainRef, pathname);
  const active = (to: string, exact?: boolean) =>
    exact
      ? pathname === to || pathname === `${to}/`
      : pathname === to || pathname.startsWith(`${to}/`);

  const current = NAV.flatMap((section) => section.items.map((item) => ({ section, item }))).find(
    ({ item }) => active(item.to, item.exact),
  );

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
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
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
        <div className="px-3 pt-3 pb-1">
          <span className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/8 px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-primary uppercase">
            <ShieldCheck className="size-3.5" /> Admin console
          </span>
        </div>
        <nav aria-label="Admin" className="custom-scrollbar flex-1 overflow-y-auto px-2 pt-2 pb-4">
          {NAV.map((section, index) => (
            <NavSection
              key={section.label}
              label={section.label}
              collapsed={false}
              first={index === 0}
            >
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  active={active(item.to, item.exact)}
                  collapsed={false}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </NavSection>
          ))}
        </nav>
      </aside>

      <div className="relative z-10 flex min-h-screen flex-col md:pl-64">
        <HeaderBar
          left={
            <>
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setOpen(true)}
                className={cn(headerIconButton, "md:hidden")}
              >
                <Menu className="size-[18px]" />
              </button>
              {current ? (
                <Breadcrumb
                  section={current.section.label}
                  page={current.item.label}
                  pageTo={current.item.to}
                  trail={adminCrumbs ?? []}
                />
              ) : (
                <span className="truncate text-sm font-semibold text-foreground">
                  Admin console
                </span>
              )}
            </>
          }
          right={
            <>
              <a
                href="/welcome"
                title="Public site"
                aria-label="Public site"
                className={cn(headerIconButton, "hidden sm:grid")}
              >
                <Globe className="size-[18px]" />
              </a>
              <ThemeToggle variant="ghost" />
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              <AdminMenu admin={admin} />
            </>
          }
        />
        <main ref={mainRef} className="w-full">
          {children}
        </main>
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
          aria-label={`Admin account: ${admin.name}`}
          className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-brand text-[11px] font-bold text-primary-foreground">
            {initials(admin.name)}
          </span>
          <span className="hidden max-w-[10rem] min-w-0 text-left lg:block">
            <span className="block truncate text-xs leading-tight font-medium text-foreground">
              {admin.name}
            </span>
            <span className="block truncate text-[10px] leading-tight text-muted-foreground">
              Platform admin
            </span>
          </span>
          <ChevronDown className="hidden size-3.5 shrink-0 text-muted-foreground lg:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{admin.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{admin.email}</span>
          <span className="mt-1.5 block text-[11px] text-muted-foreground">Signed in as admin</span>
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
