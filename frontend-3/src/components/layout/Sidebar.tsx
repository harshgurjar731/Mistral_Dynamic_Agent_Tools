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
import { useMemo, useState } from "react";
import { NAV_ITEMS } from "./nav-items";
import { HealthIndicator } from "./HealthIndicator";
import { RunsIndicator } from "@/components/runs/RunsIndicator";
import { useSessionStore } from "@/stores/sessions";
import { cn } from "@/lib/utils";

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const generalSessions = useMemo(
    () => sessions.filter((s) => s.type === "general"),
    [sessions],
  );

  const matches = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  // Only the most specific item lights up (/workflows/activities/x → Activities, not Workflows).
  const activeTo = NAV_ITEMS.filter((i) => matches(i.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to;
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
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar backdrop-blur-xl transition-[width,transform] duration-300 ease-out",
          collapsed ? "w-16" : "w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-[73px] items-center gap-2.5 border-b border-border px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary shadow-sm">
            <Boxes className="size-5 text-primary-foreground" />
          </span>
          {showLabels ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold leading-tight text-foreground">
                Agentic AI
              </p>
              <p className="mt-0.5 truncate text-[13px] leading-tight text-muted-foreground">
                Design Patterns
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

        <nav className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            const key = item.expandable ?? item.to;
            const open = Boolean(expanded[key]);
            return (
              <div key={item.to}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-md border border-transparent transition",
                    active ? "border-border bg-secondary text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Link
                    to={item.to}
                    onClick={onCloseMobile}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition hover:bg-surface-hover hover:text-foreground",
                      collapsed && "justify-center",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", active ? "text-primary" : "opacity-80")}
                    />
                    {showLabels ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                  {item.expandable && showLabels ? (
                    <button
                      type="button"
                      aria-label={`Toggle ${item.label} sessions`}
                      onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                      className="mr-1.5 rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", open && "rotate-180")}
                      />
                    </button>
                  ) : null}
                </div>

                {item.expandable === "playground" && open && showLabels ? (
                  <div className="mt-1 ml-4 space-y-0.5 border-l border-border pl-2">
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
                      <p className="px-1.5 py-1 text-[11px] text-muted-foreground">No sessions</p>
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
        </nav>

        <div className="space-y-1 border-t border-border px-2 py-3">
          {/* Desktop only: on phones the top header carries these. */}
          <div className="hidden space-y-1 border-b border-border pb-2 md:block">
            <RunsIndicator variant="rail" collapsed={collapsed} />
            <HealthIndicator variant="rail" collapsed={collapsed} />
          </div>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center",
            )}
            title="API Docs"
          >
            <ExternalLink className="size-4 shrink-0" />
            {showLabels ? <span>API Docs</span> : null}
          </a>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              "hidden w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground md:flex",
              collapsed && "justify-center",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="size-4 shrink-0" />
            ) : (
              <ChevronsLeft className="size-4 shrink-0" />
            )}
            {showLabels ? <span>Collapse</span> : null}
          </button>
        </div>
      </aside>
    </>
  );
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
