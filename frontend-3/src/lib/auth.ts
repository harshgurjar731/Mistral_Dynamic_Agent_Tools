import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { authApi, authKeys, type AuthSessionState, type SessionUser } from "@/api/auth";

/** Fired by the API client when the server says the session has ended. */
export const AUTH_EXPIRED_EVENT = "auth:expired";

/**
 * Who is signed in on this browser. Session cookies are httpOnly, so this is
 * the only way the interface learns it; the server re-checks every request.
 */
export function useAuthSession() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: authKeys.session(),
    queryFn: authApi.session,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  useEffect(() => {
    const onExpired = () => void qc.invalidateQueries({ queryKey: authKeys.session() });
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [qc]);
  return query;
}

export function useCurrentUser(): SessionUser | null {
  const { data } = useAuthSession();
  return data?.user ?? null;
}

export function useCan() {
  const user = useCurrentUser();
  return useCallback(
    (...perms: string[]) => !!user && perms.some((p) => user.permissions.includes(p)),
    [user],
  );
}

export function useRefreshSession() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: authKeys.session() }), [qc]);
}

export function setSessionData(
  qc: ReturnType<typeof useQueryClient>,
  update: (s: AuthSessionState | undefined) => AuthSessionState,
) {
  qc.setQueryData(authKeys.session(), update);
}

/* ── Which page needs what ─────────────────────────────────────────────── */

/**
 * The permission(s) a page needs — any one is enough. Mirrors the API's
 * route policy (backend app/auth/permissions.py), which is what actually
 * enforces it; this only keeps people from opening pages that would fail.
 */
const PAGE_PERMISSIONS: [prefix: string, perms: string[]][] = [
  ["/workflows/activities", ["workflows.view"]],
  ["/workflows", ["workflows.view"]],
  ["/playground", ["chat.use", "orchestrator.use"]],
  ["/agents", ["agents.view"]],
  ["/tools", ["tools.view"]],
  ["/connectors", ["connectors.view"]],
  ["/mcp", ["connectors.view"]],
  ["/rules", ["rules.view"]],
  ["/reviews", ["reviews.view"]],
  ["/logs", ["logs.view"]],
  ["/ontology", ["catalog.view"]],
  ["/processes", ["catalog.view"]],
  ["/knowledge", ["knowledge.view"]],
  ["/libraries", ["knowledge.view"]],
  ["/remote-servers", ["remote_servers.view"]],
  ["/settings", ["settings.view"]],
];

/** Null: open to every signed-in user. */
/** Pages that exist only to change something: they need the write permission. */
const WRITE_PAGES: [RegExp, string[]][] = [
  [/^\/workflows\/new(\/.*)?$/, ["workflows.manage"]],
  [/^\/workflows\/[^/]+\/(edit|refine)\/?$/, ["workflows.manage"]],
  [/^\/remote-servers\/new\/?$/, ["remote_servers.manage"]],
];

export function pagePermissions(pathname: string): string[] | null {
  if (pathname === "/") return ["orchestrator.use"];
  for (const [re, perms] of WRITE_PAGES) {
    if (re.test(pathname)) return perms;
  }
  for (const [prefix, perms] of PAGE_PERMISSIONS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return perms;
  }
  return null;
}

export function canOpen(user: SessionUser | null, pathname: string): boolean {
  if (!user) return false;
  const perms = pagePermissions(pathname);
  return !perms || perms.some((p) => user.permissions.includes(p));
}

/** Pages that render without the app shell and without a session. */
export const PUBLIC_PATHS: RegExp[] = [
  /^\/welcome\/?$/,
  /^\/login\/?$/,
  /^\/forgot-password\/?$/,
  /^\/invite\/[^/]+\/?$/,
  /^\/reset-password\/[^/]+\/?$/,
  /^\/admin\/login\/?$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

/** Only same-site paths are followed after sign-in (no open redirects). */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (isPublicPath(next.split("?")[0] ?? "")) return fallback;
  return next;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}
