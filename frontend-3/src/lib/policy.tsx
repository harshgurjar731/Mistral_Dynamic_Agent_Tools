import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { get } from "@/api/client";
import { useAuthSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Hiding what the signed-in person's role does not allow.
 *
 * The browser loads the server's own route policy (GET /api/auth/policy —
 * backend app/auth/permissions.py) and checks a control against the exact
 * endpoint it calls, with the same first-match rules. So a button is shown
 * exactly when the server would accept its request. This is presentation
 * only: the server enforces every rule regardless.
 */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ExportedRule {
  methods: string[];
  pattern: string;
  access: "public" | "self" | "user" | "any" | "admin" | "perm";
  perms: string[];
  admin_ok: boolean;
}

interface Policy {
  api_prefix: string;
  rules: ExportedRule[];
}

interface CompiledRule extends ExportedRule {
  re: RegExp;
}

export function usePolicy() {
  return useQuery({
    queryKey: ["auth", "policy"],
    queryFn: () => get<Policy>("/api/auth/policy"),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
  });
}

/** `allowed("POST", "/api/workflows/x/publish")` — would the server accept it? */
export function useAllowed(): (method: Method, path: string) => boolean {
  const { data: policy } = usePolicy();
  const { data: session } = useAuthSession();
  const rules = useMemo<CompiledRule[]>(
    () => (policy?.rules ?? []).map((r) => ({ ...r, re: new RegExp(r.pattern) })),
    [policy],
  );
  const user = session?.user ?? null;
  const admin = session?.admin ?? null;
  const prefix = policy?.api_prefix ?? "/api";

  return useCallback(
    (method: Method, path: string) => {
      // Until the policy is known, show nothing that writes: no flash of
      // buttons that then disappear.
      if (!rules.length) return false;
      let p = path.split("?")[0] ?? "";
      if (p.startsWith(prefix)) p = p.slice(prefix.length);
      const rule = rules.find((r) => r.methods.includes(method) && r.re.test(p));
      if (!rule) return false; // the server denies unmatched routes too
      switch (rule.access) {
        case "public":
        case "self":
          return true;
        case "user":
          return !!user;
        case "any":
          return !!user || !!admin;
        case "admin":
          return !!admin;
        case "perm":
          if (rule.admin_ok && admin) return true;
          return !!user && rule.perms.some((perm) => user.permissions.includes(perm));
        default:
          return false;
      }
    },
    [rules, user, admin, prefix],
  );
}

/** Shorthand for one endpoint. */
export function useCanCall(method: Method, path: string): boolean {
  return useAllowed()(method, path);
}

/** Renders its children only when the server would accept the call. */
export function Allowed({
  call,
  children,
  fallback = null,
}: {
  call: [Method, string];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useAllowed();
  return <>{allowed(call[0], call[1]) ? children : fallback}</>;
}

/** "View only" — shown where a form is read-only for this role. */
export function ViewOnlyNote({ className, what }: { className?: string; what?: string }) {
  const { data } = useAuthSession();
  const u = data?.user;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-3.5 shrink-0" />
      <span>
        View only — your role{u?.workspace.role_name ? ` (${u.workspace.role_name})` : ""}
        {u?.workspace.name ? ` in ${u.workspace.name}` : ""} can't change {what ?? "this"}.
      </span>
    </div>
  );
}

/**
 * A form that becomes read-only for roles that may not save it: a native
 * disabled fieldset disables every input, select, switch and button inside
 * (Radix controls included, they are buttons), with one note on top.
 */
export function EditGuard({
  allowed,
  children,
  what,
  className,
  note = true,
}: {
  allowed: boolean;
  children: ReactNode;
  what?: string;
  className?: string;
  note?: boolean;
}) {
  return (
    <>
      {!allowed && note ? <ViewOnlyNote className="mb-4" {...(what ? { what } : {})} /> : null}
      <fieldset disabled={!allowed} className={cn("m-0 min-w-0 border-0 p-0", className)}>
        {children}
      </fieldset>
    </>
  );
}
