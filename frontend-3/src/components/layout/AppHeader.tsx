/**
 * The bar across the top of every page: where you are on the left, and
 * everything that is not a page on the right — system status, background
 * runs, notifications, API docs, the theme and your account. The sidebar is
 * left with the pages alone.
 */
import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/auth/AccountMenus";
import { NotificationsIndicator } from "@/components/runs/NotificationsIndicator";
import { RunsIndicator } from "@/components/runs/RunsIndicator";
import { useUiConfig } from "@/lib/uiConfig";
import { cn } from "@/lib/utils";
import { HealthIndicator } from "./HealthIndicator";
import { headerIconButton } from "./NavSection";
import { ThemeToggle } from "./ThemeToggle";
import { routeCrumbs, usePageSetCrumbs, type Crumb } from "./pageCrumbs";
import { useNavSections } from "./useNav";

export function AppHeader({
  collapsed,
  onToggleCollapsed,
  onOpenMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}) {
  const ui = useUiConfig();
  const { active, pathname } = useNavSections();
  // What the page says it shows wins; the route names the rest.
  const pageCrumbs = usePageSetCrumbs(pathname);
  const trail = active ? (pageCrumbs ?? routeCrumbs(pathname, active.item.to)) : [];

  return (
    <HeaderBar
      left={
        <>
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onOpenMobile}
            className={cn(headerIconButton, "md:hidden")}
          >
            <Menu className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            title={collapsed ? "Expand the menu" : "Collapse the menu"}
            className={cn(headerIconButton, "hidden md:grid")}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[18px]" />
            ) : (
              <PanelLeftClose className="size-[18px]" />
            )}
          </button>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border md:block" />
          {active ? (
            <Breadcrumb
              section={active.group.label}
              page={active.item.label}
              pageTo={active.item.to}
              trail={trail}
            />
          ) : (
            <span className="truncate text-sm font-semibold text-foreground">
              {ui.UI_BRAND_TITLE}
            </span>
          )}
        </>
      }
      right={
        <>
          <div className="hidden sm:block">
            <HealthIndicator />
          </div>
          <RunsIndicator />
          <NotificationsIndicator />
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            title="API docs (opens in a new tab)"
            aria-label="API docs"
            className={cn(headerIconButton, "hidden sm:grid")}
          >
            <BookOpen className="size-[18px]" />
          </a>
          <ThemeToggle variant="ghost" />
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          <UserMenu variant="header" />
        </>
      }
    />
  );
}

/** The bar itself, shared with the admin console. */
export function HeaderBar({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </header>
  );
}

/** Section › Page › what the page shows (an agent's name, a workflow and "Run"…). */
export function Breadcrumb({
  section,
  page,
  pageTo,
  trail: rawTrail = [],
}: {
  section: string;
  page: string;
  pageTo: string;
  trail?: Array<string | Crumb>;
}) {
  const trail = rawTrail.map((c) => (typeof c === "string" ? { label: c } : c));
  const sep = <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/50" />;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="hidden shrink-0 text-muted-foreground sm:inline">{section}</span>
      <span className="hidden sm:inline">{sep}</span>
      {trail.length ? (
        <Link
          to={pageTo}
          className="shrink-0 text-muted-foreground transition hover:text-foreground"
        >
          {page}
        </Link>
      ) : (
        <span aria-current="page" className="truncate font-semibold text-foreground">
          {page}
        </span>
      )}
      {trail.map((crumb, i) => {
        const last = i === trail.length - 1;
        const cls = cn(
          "truncate",
          last ? "font-semibold text-foreground" : "max-w-[12rem] text-muted-foreground",
        );
        return (
          <span key={`${i}-${crumb.label}`} className="flex min-w-0 items-center gap-1.5">
            {sep}
            {crumb.to && !last ? (
              <Link
                to={crumb.to}
                title={crumb.label}
                className={cn(cls, "transition hover:text-foreground")}
              >
                {crumb.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} title={crumb.label} className={cls}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
