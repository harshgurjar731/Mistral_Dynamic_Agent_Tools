import { Link } from "@tanstack/react-router";
import { ArrowRight, Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/auth/AuthParts";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuthSession } from "@/lib/auth";
import { useUiConfig } from "@/lib/uiConfig";
import { cn } from "@/lib/utils";
import {
  FeaturesSection,
  IntegrationsSection,
  IntegrationStrip,
  PersonasStrip,
  ProblemSection,
  SecuritySection,
  SolutionSection,
  UseCasesSection,
} from "./sections";
import { LiveBuild, Reveal } from "./visuals";

const NAV = [
  ["Problem", "#problem"],
  ["Solution", "#solution"],
  ["Platform", "#features"],
  ["Use cases", "#use-cases"],
  ["Integrations", "#integrations"],
  ["Security", "#security"],
] as const;

export function LandingPage() {
  const ui = useUiConfig();
  const { data } = useAuthSession();
  const signedIn = !!data?.user;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const primaryCta = signedIn ? "Open the app" : "Sign in";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* ── Nav ── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled || menuOpen
            ? "border-b border-border bg-background/85 backdrop-blur-xl"
            : "border-b border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <BrandMark size="sm" to="/welcome" />
          <nav className="ml-4 hidden items-center gap-1 text-sm lg:flex">
            {NAV.map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/admin/login"
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground sm:inline-flex"
            >
              <ShieldCheck className="size-4" /> Admin
            </Link>
            <Link
              to={signedIn ? "/" : "/login"}
              className="hidden h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/88 sm:inline-flex"
            >
              {primaryCta} <ArrowRight className="size-3.5" />
            </Link>
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((o) => !o)}
              className="grid size-9 place-items-center rounded-md border border-border lg:hidden"
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div className="border-t border-border px-4 pb-4 lg:hidden">
            <nav className="grid gap-1 pt-3">
              {NAV.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link
                to={signedIn ? "/" : "/login"}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
              >
                {primaryCta}
              </Link>
              <Link
                to="/admin/login"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border text-sm"
              >
                Admin console
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-16">
        <div className="grid-backdrop absolute inset-0 opacity-50" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-40 size-[480px] rounded-full bg-cyan/20 opacity-30 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-24">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" /> Agentic AI control plane · built on Mistral AI
            </span>
            <h1 className="mt-6 font-display text-[2.6rem] font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.1rem]">
              Turn a business goal
              <br />
              into a <span className="text-gradient-brand">governed AI workflow.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Describe what you need in plain language. {ui.UI_BRAND_TITLE} designs the agents,
              writes the tools they're missing, grounds them in your knowledge, applies your rules
              and runs the result — with every step traced and every action checked against who's
              allowed to take it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to={signedIn ? "/" : "/login"}
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:bg-primary/90"
              >
                {signedIn ? "Open the app" : "Sign in to your workspace"}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#solution"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-background-elevated/80 px-6 text-sm font-semibold text-foreground backdrop-blur transition hover:border-border-strong hover:bg-surface-hover"
              >
                See how it works
              </a>
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6">
              {[
                ["Goal → workflow", "no flowcharts"],
                ["Tools on demand", "sandbox-tested"],
                ["Every step", "traced & governed"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm font-semibold text-foreground">{k}</dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={0.15}>
            <LiveBuild />
          </Reveal>
        </div>
      </section>

      <IntegrationStrip />
      <ProblemSection />
      <SolutionSection />
      <PersonasStrip />
      <FeaturesSection />
      <UseCasesSection />
      <IntegrationsSection />
      <SecuritySection />

      {/* ── Closing CTA ── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-primary/30 px-6 py-14 text-center sm:px-12 sm:py-20">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.16]"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="grid-backdrop absolute inset-0 opacity-40" aria-hidden />
              <div className="relative">
                <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
                  Your next process,{" "}
                  <span className="text-gradient-brand">
                    designed by the time you finish typing it.
                  </span>
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
                  Sign in with the account your administrator created for you, or open the admin
                  console to set up workspaces and invite your team.
                </p>
                <div className="mt-9 flex flex-wrap justify-center gap-3">
                  <Link
                    to={signedIn ? "/" : "/login"}
                    className="group inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:bg-primary/90"
                  >
                    {primaryCta}
                    <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    to="/admin/login"
                    className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-background/80 px-7 text-sm font-semibold backdrop-blur transition hover:bg-surface-hover"
                  >
                    <ShieldCheck className="size-4 text-primary" /> Admin console
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <BrandMark size="sm" to="/welcome" />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Design, govern and run AI agents and workflows on Mistral — one workspace per team,
              roles you control.
            </p>
          </div>
          {[
            [
              "Product",
              [
                ["Problem", "#problem"],
                ["Solution", "#solution"],
                ["Platform", "#features"],
              ],
            ],
            [
              "Explore",
              [
                ["Use cases", "#use-cases"],
                ["Integrations", "#integrations"],
                ["Security", "#security"],
              ],
            ],
          ].map(([heading, links]) => (
            <div key={heading as string}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {heading as string}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {(links as string[][]).map(([label, href]) => (
                  <li key={href}>
                    <a href={href} className="text-foreground/80 hover:text-foreground">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Access
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link to="/login" className="text-foreground/80 hover:text-foreground">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/admin/login" className="text-foreground/80 hover:text-foreground">
                  Admin console
                </Link>
              </li>
              <li>
                <Link to="/forgot-password" className="text-foreground/80 hover:text-foreground">
                  Can't sign in?
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
            © {new Date().getFullYear()} {ui.UI_BRAND_TITLE}. Built on Mistral AI. Mistral and other
            names are trademarks of their respective owners.
          </p>
        </div>
      </footer>
    </div>
  );
}
