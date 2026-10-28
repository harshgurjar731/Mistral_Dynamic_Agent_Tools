import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Sidebar } from "@/components/layout/Sidebar";
import { HealthIndicator } from "@/components/layout/HealthIndicator";
import { BackgroundRuns } from "@/components/runs/BackgroundRuns";
import { RunsIndicator } from "@/components/runs/RunsIndicator";
import { AppConfigApplier } from "@/components/layout/AppConfigApplier";
import { useUiConfig } from "@/lib/uiConfig";
import { THEME_BOOT_SCRIPT, useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useResizablePanel } from "@/components/shared/ResizeHandle";
import { cn } from "@/lib/utils";
import { RunQuestions } from "@/components/runs/RunQuestions";
import { ActivityTray } from "@/components/activity/ActivityTray";
import { TopProgressBar } from "@/components/activity/TopProgressBar";
import { installOpTracking } from "@/lib/ops/tracker";

// Before any page asks for anything: every request reports live progress.
installOpTracking();

const NAV_COLLAPSED_WIDTH = 64;
const NAV_DEFAULT_WIDTH = 248;

function NotFoundComponent() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient-brand">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route isn't part of the control plane.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Back to Orchestrator
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Something went wrong on our end."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-border glass px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-hover"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentic AI Design Patterns — Control Plane" },
      {
        name: "description",
        content:
          "Design, orchestrate and observe AI agents, tools, workflows and knowledge graphs from one control plane.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme / class / color-scheme before React
    // hydrates, so the server's markup and the live <html> differ on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Day / night before first paint — no flash of the other theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AppConfigApplier />
      <AppShell />
    </QueryClientProvider>
  );
}

function AppShell() {
  const ui = useUiConfig();
  const { resolved: theme } = useTheme();
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Follow the configured default until the user toggles the sidebar.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setCollapsed(ui.UI_SIDEBAR_COLLAPSED);
  }, [ui.UI_SIDEBAR_COLLAPSED, touched]);

  const navPanel = useResizablePanel({
    storageKey: "nav",
    defaultWidth: NAV_DEFAULT_WIDTH,
    min: 200,
    max: 400,
    edge: "right",
  });
  // One variable drives both the rail's width and the content's offset.
  const navWidth = collapsed ? NAV_COLLAPSED_WIDTH : (navPanel.width ?? NAV_DEFAULT_WIDTH);

  return (
    <>
      <div
        className="relative min-h-screen bg-background"
        style={{ "--nav-w": `${navWidth}px` } as CSSProperties}
      >
        {ui.UI_BACKGROUND_EFFECTS ? (
          <>
            <div className="app-atmosphere" aria-hidden />
            <div className="app-atmosphere grid-backdrop opacity-40" aria-hidden />
          </>
        ) : null}

        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => {
            setTouched(true);
            setCollapsed((c) => !c);
          }}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          resize={collapsed ? undefined : navPanel}
        />

        <div
          className={cn(
            "relative z-10 flex min-h-screen flex-col md:pl-[var(--nav-w)]",
            // Follow the pointer exactly while dragging; ease only on toggle.
            !navPanel.dragging && "transition-[padding] duration-300 ease-out",
          )}
        >
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl md:hidden">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              className="rounded-md border border-border bg-secondary p-2 text-foreground"
            >
              <Menu className="size-4" />
            </button>
            <span className="truncate font-display text-sm font-bold text-foreground">
              {ui.UI_BRAND_TITLE} {ui.UI_BRAND_SUBTITLE}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <RunsIndicator />
              <HealthIndicator />
              <ThemeToggle />
            </div>
          </header>

          {/* Required: nested routes render here. */}
          {/* Full width, no top bar on desktop: the run and health indicators live in the sidebar. */}
          <main className="relative z-10 min-h-[60vh] w-full">
            <Outlet />
          </main>
        </div>

        {/* Inside the shell, so both can offset by the nav's width. */}
        <TopProgressBar />
        <ActivityTray />
      </div>
      <BackgroundRuns />
      {/* A run waiting on an answer, wherever you are — unless its page shows it. */}
      <RunQuestions />
      <Toaster position={ui.UI_TOAST_POSITION as "top-right"} theme={theme} />
    </>
  );
}
