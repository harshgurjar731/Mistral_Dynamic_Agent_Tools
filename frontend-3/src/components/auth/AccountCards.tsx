import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Loader2, LogOut, Monitor, Smartphone } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { BrowserSession } from "@/api/auth";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/status";
import { FormError, PasswordField, PasswordMatch, TextField } from "./AuthParts";

export function Card({
  id,
  title,
  description,
  children,
  aside,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="glass scroll-mt-6 rounded-lg">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ProfileCard({
  name,
  email,
  save,
  onSaved,
}: {
  name: string;
  email: string;
  save: (name: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(name);
  const m = useMutation({
    mutationFn: () => save(value.trim()),
    onSuccess: () => {
      toast.success("Name updated");
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title="Profile" description="Your name is shown to admins and on what you create.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <TextField label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
        <TextField
          label="Email"
          value={email}
          readOnly
          disabled
          hint="Only an admin can change it."
        />
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={m.isPending || !value.trim() || value === name}>
            {m.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PasswordCard({
  change,
  minLength,
  forced,
  onChanged,
}: {
  change: (current: string, next: string) => Promise<unknown>;
  minLength: number;
  forced?: boolean;
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => change(current, next),
    onSuccess: () => {
      toast.success("Password changed. Your other sessions were signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      onChanged?.();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("The new passwords do not match.");
    m.mutate();
  }
  return (
    <Card
      id="password"
      title={forced ? "Set a new password to continue" : "Password"}
      description={
        forced
          ? "You signed in with a temporary password. Choose your own before doing anything else."
          : "Changing it signs you out everywhere else."
      }
    >
      <form onSubmit={submit} className="max-w-md space-y-4">
        <FormError message={error} />
        <PasswordField
          label={forced ? "Temporary password" : "Current password"}
          value={current}
          onChange={setCurrent}
        />
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          showStrength
          minLength={minLength}
        />
        <PasswordField
          label="Repeat new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <PasswordMatch a={next} b={confirm} />
        <Button
          type="submit"
          disabled={m.isPending || !current || next.length < minLength || next !== confirm}
        >
          {m.isPending ? <Loader2 className="animate-spin" /> : null}
          Change password
        </Button>
      </form>
    </Card>
  );
}

function deviceIcon(ua: string | null) {
  const s = (ua ?? "").toLowerCase();
  if (/iphone|android|mobile/.test(s)) return Smartphone;
  if (/mac|windows|linux/.test(s)) return Laptop;
  return Monitor;
}

function describeAgent(ua: string | null): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /Chrome\//.test(s)
      ? "Chrome"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Safari\//.test(s)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(s)
    ? "Windows"
    : /Mac OS X/.test(s)
      ? "macOS"
      : /Android/.test(s)
        ? "Android"
        : /iPhone|iPad/.test(s)
          ? "iOS"
          : /Linux/.test(s)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsCard({
  queryKey,
  list,
  revoke,
  signOutEverywhere,
}: {
  queryKey: readonly unknown[];
  list: () => Promise<{ sessions: BrowserSession[] }>;
  revoke: (id: string) => Promise<unknown>;
  signOutEverywhere?: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: list });
  const revokeM = useMutation({
    mutationFn: revoke,
    onSuccess: () => {
      toast.success("Session signed out");
      void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const allM = useMutation({
    mutationFn: () => signOutEverywhere?.() ?? Promise.resolve(),
    onSettled: () => window.location.assign("/login"),
  });
  return (
    <Card
      id="sessions"
      title="Where you're signed in"
      description="Sign out any session you don't recognise."
      aside={
        signOutEverywhere ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => allM.mutate()}
            disabled={allM.isPending}
          >
            <LogOut /> Sign out everywhere
          </Button>
        ) : null
      }
    >
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border">
          {(q.data?.sessions ?? []).map((s) => {
            const Icon = deviceIcon(s.user_agent);
            return (
              <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="grid size-9 place-items-center rounded-md border border-border bg-secondary">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {describeAgent(s.user_agent)}
                    {s.current ? (
                      <span className="rounded border border-emerald/30 bg-emerald/10 px-1.5 py-px text-[10px] font-medium text-emerald">
                        This browser
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.ip ?? "unknown address"} · active {formatRelative(s.last_seen_at ?? "")}
                    {s.workspace_name ? ` · ${s.workspace_name}` : ""}
                  </span>
                </span>
                {!s.current ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revokeM.mutate(s.id)}
                    disabled={revokeM.isPending}
                  >
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
