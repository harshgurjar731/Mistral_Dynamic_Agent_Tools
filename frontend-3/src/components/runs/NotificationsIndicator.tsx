/**
 * The notification bell: runs that completed or failed, and runs waiting for
 * a review — each with a button that goes straight to it.
 */
import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, ShieldAlert, X, XCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { headerIconButton } from "@/components/layout/NavSection";
import { useExecutionWatch, type AppNotification } from "@/stores/executionWatch";
import { useOpenNotification } from "./ExecutionWatcher";

const KIND = {
  review: {
    icon: ShieldAlert,
    tone: "border-amber/30 bg-amber/10 text-amber",
    action: "Review now",
  },
  completed: {
    icon: CheckCircle2,
    tone: "border-emerald/30 bg-emerald/10 text-emerald",
    action: "View result",
  },
  failed: { icon: XCircle, tone: "border-red/30 bg-red/10 text-red", action: "See the error" },
} as const;

function useDesktopPermission() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<string>(
    supported ? Notification.permission : "unsupported",
  );
  useEffect(() => {
    if (supported) setPermission(Notification.permission);
  }, [supported]);
  const request = async () => {
    if (!supported) return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      /* ignored */
    }
  };
  return { permission, request };
}

function Row({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const meta = KIND[n.kind];
  const Icon = meta.icon;
  const remove = () =>
    useExecutionWatch.setState((s) => ({
      notifications: s.notifications.filter((x) => x.id !== n.id),
    }));
  return (
    <div
      className={cn(
        "group relative flex gap-2.5 rounded-lg px-3 py-2.5 transition hover:bg-surface-hover",
        !n.read && "bg-surface/60",
      )}
    >
      {!n.read ? (
        <span className="absolute top-4 left-1 size-1.5 rounded-full bg-primary" aria-label="New" />
      ) : null}
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border",
          meta.tone,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{n.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {n.body}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Button
            size="sm"
            variant={n.kind === "review" && !n.read ? "default" : "outline"}
            className="h-6 px-2 text-[10px]"
            onClick={() => onOpen(n)}
          >
            {meta.action}
          </Button>
          <span className="text-[10px] text-muted-foreground">{formatRelative(n.created_at)}</span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={remove}
        className="self-start rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground focus:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function NotificationsIndicator({
  variant = "pill",
  collapsed = false,
}: {
  variant?: "pill" | "rail";
  collapsed?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const notifications = useExecutionWatch((s) => s.notifications);
  const markRead = useExecutionWatch((s) => s.markRead);
  const markAllRead = useExecutionWatch((s) => s.markAllRead);
  const clear = useExecutionWatch((s) => s.clear);
  const openTarget = useOpenNotification();
  const desktop = useDesktopPermission();

  const unread = notifications.filter((n) => !n.read);
  const reviewsWaiting = unread.filter((n) => n.kind === "review").length;
  const failed = unread.some((n) => n.kind === "failed");
  const tone = reviewsWaiting
    ? "text-amber"
    : failed
      ? "text-red"
      : unread.length
        ? "text-primary"
        : "text-muted-foreground";
  const label = reviewsWaiting
    ? `${reviewsWaiting} review${reviewsWaiting === 1 ? "" : "s"} waiting`
    : unread.length
      ? `${unread.length} new notification${unread.length === 1 ? "" : "s"}`
      : "Notifications";

  const onOpen = (n: AppNotification) => {
    markRead(n.id);
    setOpen(false);
    openTarget(n);
  };

  const BellIcon = unread.length ? BellRing : Bell;
  const badge = unread.length ? (
    <span
      className={cn(
        "grid min-w-4 place-items-center rounded-full px-1 text-[9px] leading-4 font-semibold text-white tabular-nums",
        reviewsWaiting ? "bg-amber" : failed ? "bg-red" : "bg-primary",
        collapsed
          ? "absolute -top-1 -right-1"
          : variant === "pill"
            ? "absolute top-1 right-1"
            : "ml-auto",
      )}
    >
      {unread.length > 9 ? "9+" : unread.length}
    </span>
  ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "rail" ? (
          <button
            type="button"
            aria-label={label}
            title={collapsed ? label : undefined}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center",
              tone,
            )}
          >
            <BellIcon className={cn("size-4 shrink-0", reviewsWaiting && "animate-pulse")} />
            {collapsed ? null : <span className="truncate">{label}</span>}
            {badge}
          </button>
        ) : (
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(headerIconButton, tone)}
          >
            <BellIcon className={cn("size-[18px]", reviewsWaiting && "animate-pulse")} />
            {badge}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={variant === "rail" ? "right" : "bottom"}
        align={variant === "rail" ? "end" : "end"}
        className="w-[360px] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unread.length ? (
            <button
              type="button"
              onClick={markAllRead}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          ) : null}
          {notifications.length ? (
            <button
              type="button"
              onClick={clear}
              className={cn(
                "text-[11px] text-muted-foreground hover:text-foreground",
                !unread.length && "ml-auto",
              )}
            >
              Clear
            </button>
          ) : null}
        </div>
        {desktop.permission === "default" ? (
          <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-2">
            <p className="flex-1 text-[11px] text-muted-foreground">
              Get a desktop alert when a run finishes or needs a review while this tab is in the
              background.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => void desktop.request()}
            >
              Turn on
            </Button>
          </div>
        ) : null}
        <div className="custom-scrollbar max-h-[60vh] space-y-0.5 overflow-auto p-1.5">
          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell className="mx-auto size-5 text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                Nothing yet. Runs you start, and reviews waiting on a person, show up here.
              </p>
            </div>
          ) : (
            notifications.map((n) => <Row key={n.id} n={n} onOpen={onOpen} />)
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
