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
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Sidebar } from "@/components/layout/Sidebar";
import { HealthIndicator } from "@/components/layout/HealthIndicator";

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
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
    <html lang="en">
      <head>
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
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative min-h-screen bg-background">
        <div className="app-atmosphere" aria-hidden />
        <div className="app-atmosphere grid-backdrop opacity-40" aria-hidden />

        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        <div
          className={cnMain(collapsed)}
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
            <span className="font-display text-sm font-bold text-foreground">AGENTIC / AI</span>
            <div className="ml-auto">
              <HealthIndicator />
            </div>
          </header>

          <div className="sticky top-0 z-20 hidden h-12 items-center justify-between border-b border-border bg-background/85 px-6 backdrop-blur-xl md:flex">
            <span className="technical-label">Pattern control / production</span>
            <HealthIndicator />
          </div>

          {/* Required: nested routes render here. */}
          <main className="relative z-10 mx-auto min-h-[60vh] w-full max-w-[1680px]">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster position="top-right" theme="dark" />
    </QueryClientProvider>
  );
}

function cnMain(collapsed: boolean) {
  return [
    "relative z-10 flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
    collapsed ? "md:pl-[64px]" : "md:pl-[248px]",
  ].join(" ");
}
