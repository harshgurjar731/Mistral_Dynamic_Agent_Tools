import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Plus,
  Boxes,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { arrangeNav, groupRows, navLabel, parseNavLayout, type NavGroupId } from "./nav-items";
import { NavLink, NavSection, footerButton } from "./NavSection";
import { HealthIndicator } from "./HealthIndicator";
import { RunsIndicator } from "@/components/runs/RunsIndicator";
import { ThemeToggle } from "./ThemeToggle";
import { useSessionStore } from "@/stores/sessions";
import { cn } from "@/lib/utils";
import { useUiConfig } from "@/lib/uiConfig";
import { canOpen, useCurrentUser } from "@/lib/auth";
import { UserMenu, WorkspaceSwitcher } from "@/components/auth/AccountMenus";
import { ResizeHandle, type ResizablePanel } from "@/components/shared/ResizeHandle";

/** Width comes from `--nav-w`, set by the app shell from `collapsed` and `resize`. */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  resize,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Present while expanded: the rail can then be dragged wider or narrower. */
  resize?: ResizablePanel | undefined;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ui = useUiConfig();
  const user = useCurrentUser();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folded, setFolded] = useFoldedSections();

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const generalSessions = useMemo(() => sessions.filter((s) => s.type === "general"), [sessions]);

  const matches = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  // Order, visibility and labels come from Settings → Layout → Navigation menu.
  const sections = useMemo(
    () =>
      groupRows(
        arrangeNav(parseNavLayout(ui.UI_NAV_LAYOUT))
          .filter((r) => !r.hidden)
          // Only pages the user's role in this workspace can open.
          .filter((r) => canOpen(user, r.item.to)),
      ).map(({ group, rows }) => ({
        group,
        items: rows.map((r) => ({ ...r.item, label: navLabel(r) })),
      })),
    [ui.UI_NAV_LAYOUT, user],
  );
  const navItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  // Only the most specific item lights up (/workflows/activities/x → Activities, not Workflows).
  const activeTo = navItems
    .filter((i) => matches(i.to))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const isActive = (to: string) => to === activeTo;

  const showLabels = !collapsed;

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[var(--nav-w)] flex-col border-r border-border bg-sidebar backdrop-blur-xl",
          resize?.dragging
            ? "transition-transform duration-300 ease-out"
            : "transition-[width,transform] duration-300 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {resize ? (
          <ResizeHandle panel={resize} label="Resize navigation" className="hidden md:flex" />
        ) : null}
        <div className="flex h-[73px] items-center gap-2.5 border-b border-border px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary shadow-sm">
            <Boxes className="size-5 text-primary-foreground" />
          </span>
          {showLabels ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold leading-tight text-foreground">
                {ui.UI_BRAND_TITLE}
              </p>
              <p className="mt-0.5 truncate text-[13px] leading-tight text-muted-foreground">
                {ui.UI_BRAND_SUBTITLE}
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-border px-2 py-2.5">
          <WorkspaceSwitcher collapsed={collapsed} />
        </div>

        <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto px-2 py-3">
          {sections.map(({ group, items }, index) => {
            // The section holding the current page never folds away.
            const holdsActive = items.some((i) => isActive(i.to));
            const open = holdsActive || !folded.has(group.id);
            return (
              <NavSection
                key={group.id}
                label={group.label}
                collapsed={collapsed}
                first={index === 0}
                open={open}
                onToggle={holdsActive ? undefined : () => setFolded(group.id, open)}
              >
                {items.map((item) => {
                  const key = item.expandable ?? item.to;
                  const subOpen = Boolean(expanded[key]);
                  return (
                    <div key={item.to}>
                      <NavLink
                        to={item.to}
                        label={item.label}
                        icon={item.icon}
                        active={isActive(item.to)}
                        collapsed={collapsed}
                        onNavigate={onCloseMobile}
                        trailing={
                          item.expandable ? (
                            <button
                              type="button"
                              aria-label={`Toggle ${item.label} sessions`}
                              aria-expanded={subOpen}
                              onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                              className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                            >
                              <ChevronDown
                                className={cn(
                                  "size-3.5 transition-transform",
                                  subOpen && "rotate-180",
                                )}
                              />
                            </button>
                          ) : null
                        }
                      />
                      {item.expandable === "playground" && subOpen && showLabels ? (
                        <div className="mt-0.5 mb-1 ml-[18px] space-y-0.5 border-l border-border pl-2">
                          <div className="flex items-center justify-between px-1.5 py-1">
                            <span className="eyebrow">Chats</span>
                            <button
                              type="button"
                              aria-label="New chat session"
                              onClick={() => createSession("general")}
                              className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                          {generalSessions.length === 0 ? (
                            <p className="px-1.5 py-1 text-[11px] text-muted-foreground">
                              No sessions
                            </p>
                          ) : (
                            generalSessions.map((s) => (
                              <SessionRow
                                key={s.id}
                                title={s.title}
                                to="/playground"
                                search={{ session: s.id }}
                                onRename={(t) => renameSession(s.id, t)}
                                onDelete={() => removeSession(s.id)}
                                onNavigate={onCloseMobile}
                              />
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </NavSection>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-border px-2 py-2">
          {/* Desktop only: on phones the top header carries these. */}
          <div className="hidden space-y-0.5 md:block">
            <RunsIndicator variant="rail" collapsed={collapsed} />
            <HealthIndicator variant="rail" collapsed={collapsed} />
          </div>
          <div className="border-t border-border pt-1.5 md:mt-1">
            <UserMenu collapsed={collapsed} />
          </div>
          <div className={cn("flex gap-0.5", collapsed && "flex-col")}>
            <div className={cn("flex", collapsed ? "justify-center" : "flex-1")}>
              <ThemeToggle variant="rail" collapsed />
            </div>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className={footerButton}
              title="API docs (opens in a new tab)"
              aria-label="API docs"
            >
              <ExternalLink className="size-4" />
            </a>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={cn(footerButton, "hidden md:grid")}
              title={collapsed ? "Expand the menu" : "Collapse the menu"}
              aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            >
              {collapsed ? (
                <ChevronsRight className="size-4" />
              ) : (
                <ChevronsLeft className="size-4" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

const FOLDED_KEY = "nav-folded-sections";

/** Sections folded shut, remembered in this browser. */
function useFoldedSections(): [Set<NavGroupId>, (id: NavGroupId, fold: boolean) => void] {
  const [folded, setState] = useState<Set<NavGroupId>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FOLDED_KEY);
      const ids = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(ids)) {
        setState(new Set(ids.filter((x): x is NavGroupId => typeof x === "string")));
      }
    } catch {
      // Storage unavailable: every section starts open.
    }
  }, []);
  const set = (id: NavGroupId, fold: boolean) =>
    setState((prev) => {
      const next = new Set(prev);
      if (fold) next.add(id);
      else next.delete(id);
      try {
        window.localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
      } catch {
        // Not remembered; it still applies now.
      }
      return next;
    });
  return [folded, set];
}

function SessionRow({
  title,
  to,
  params,
  search,
  onRename,
  onDelete,
  onNavigate,
}: {
  title: string;
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  onRename: (title: string) => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim()) onRename(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border border-border bg-background-elevated px-2 py-1 text-xs text-foreground outline-none"
      />
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        params={params as never}
        search={search as never}
        onClick={onNavigate}
        onDoubleClick={() => setEditing(true)}
        className="min-w-0 flex-1 truncate rounded-lg px-1.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
      >
        {title}
      </Link>
      <button
        type="button"
        aria-label="Delete session"
        onClick={onDelete}
        className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-red group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
