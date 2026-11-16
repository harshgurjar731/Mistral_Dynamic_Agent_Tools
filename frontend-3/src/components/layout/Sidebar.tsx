import { Link } from "@tanstack/react-router";
import { ChevronDown, Plus, Boxes, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NavGroupId } from "./nav-items";
import { NavLink, NavSection } from "./NavSection";
import { useNavSections } from "./useNav";
import { useSessionStore } from "@/stores/sessions";
import { cn } from "@/lib/utils";
import { useUiConfig } from "@/lib/uiConfig";
import { WorkspaceSwitcher } from "@/components/auth/AccountMenus";
import { ResizeHandle, type ResizablePanel } from "@/components/shared/ResizeHandle";

/**
 * The pages, and nothing else: brand, workspace, then the tabs by section.
 * Status, runs, notifications, theme and account are in the top header
 * (AppHeader), and so is the button that collapses this rail.
 *
 * Width comes from `--nav-w`, set by the app shell from `collapsed` and `resize`.
 */
export function Sidebar({
  collapsed: railCollapsed,
  mobileOpen,
  onCloseMobile,
  resize,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Present while expanded: the rail can then be dragged wider or narrower. */
  resize?: ResizablePanel | undefined;
}) {
  const ui = useUiConfig();
  const { sections, active } = useNavSections();
  // The phone drawer always shows labels; only the desktop rail collapses to icons.
  const collapsed = railCollapsed && !mobileOpen;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folded, setFolded] = useFoldedSections();

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const generalSessions = useMemo(() => sessions.filter((s) => s.type === "general"), [sessions]);

  const isActive = (to: string) => to === active?.item.to;

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
          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-border bg-sidebar backdrop-blur-xl md:w-[var(--nav-w)]",
          resize?.dragging
            ? "transition-transform duration-300 ease-out"
            : "transition-[width,transform] duration-300 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {resize ? (
          <ResizeHandle panel={resize} label="Resize navigation" className="hidden md:flex" />
        ) : null}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-border",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <Link
            to="/"
            onClick={onCloseMobile}
            title={collapsed ? ui.UI_BRAND_TITLE : undefined}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary shadow-sm ring-1 ring-primary/30">
              <Boxes className="size-[18px] text-primary-foreground" />
            </span>
            {showLabels ? (
              <span className="min-w-0">
                <span className="block truncate font-display text-[15px] leading-tight font-bold text-foreground">
                  {ui.UI_BRAND_TITLE}
                </span>
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                  {ui.UI_BRAND_SUBTITLE}
                </span>
              </span>
            ) : null}
          </Link>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-2 pt-3 pb-1">
          <WorkspaceSwitcher collapsed={collapsed} />
        </div>

        <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto px-2 pt-2 pb-4">
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
