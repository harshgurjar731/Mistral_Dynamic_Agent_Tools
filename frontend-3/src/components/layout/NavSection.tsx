/**
 * The pieces both sidebars are built from — the user app's and the admin
 * console's — so a link, a section heading and a footer button look and
 * behave the same in each.
 */
import { Link } from "@tanstack/react-router";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A section of the menu: a small heading (foldable when `onToggle` is given) over its links. */
export function NavSection({
  label,
  collapsed,
  open = true,
  onToggle,
  first = false,
  children,
}: {
  label: string;
  /** The icon-only rail: no heading, a thin rule between sections instead. */
  collapsed: boolean;
  open?: boolean;
  onToggle?: (() => void) | undefined;
  first?: boolean;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <div role="group" aria-label={label} className="space-y-0.5">
        {first ? null : <div aria-hidden className="mx-3 my-2 h-px bg-border" />}
        {children}
      </div>
    );
  }
  const heading = (
    <span className="truncate text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
      {label}
    </span>
  );
  return (
    <div role="group" aria-label={label} className={cn(!first && "pt-3")}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group/heading flex w-full items-center gap-1 rounded px-2.5 pb-1 text-left transition hover:text-foreground"
        >
          {heading}
          <ChevronDown
            className={cn(
              "ml-auto size-3 text-muted-foreground/60 opacity-0 transition group-hover/heading:opacity-100",
              !open && "-rotate-90 opacity-100",
            )}
          />
        </button>
      ) : (
        <div className="px-2.5 pb-1">{heading}</div>
      )}
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </div>
  );
}

/** One page in the menu. The current page gets an accent bar and a tinted background. */
export function NavLink({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  onNavigate,
  trailing,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  /** e.g. a toggle for the page's own sub-list; shown only when expanded. */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-md transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-primary"
        />
      ) : null}
      <Link
        to={to}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            active ? "text-primary" : "opacity-75 group-hover:opacity-100",
          )}
        />
        {collapsed ? null : <span className="truncate">{label}</span>}
      </Link>
      {!collapsed && trailing ? <div className="mr-1 shrink-0">{trailing}</div> : null}
    </div>
  );
}

/** The small square buttons in a sidebar's footer row. */
export const footerButton =
  "grid h-8 min-w-8 flex-1 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground";

/** An icon button in the top header. */
export const headerIconButton =
  "relative grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
