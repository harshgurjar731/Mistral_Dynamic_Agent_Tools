import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authApi, authKeys } from "@/api/auth";
import { errorMessage } from "@/api/client";
import { Card, PasswordCard, ProfileCard, SessionsCard } from "@/components/auth/AccountCards";
import { Button } from "@/components/ui/button";
import { initials, useCurrentUser, useRefreshSession } from "@/lib/auth";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — Agentic AI Design Patterns" }] }),
  component: AccountPage,
});

function AccountPage() {
  const user = useCurrentUser();
  const refresh = useRefreshSession();
  const switchWs = useMutation({
    mutationFn: authApi.switchWorkspace,
    onSuccess: () => window.location.assign("/"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-gradient-brand text-lg font-bold text-primary-foreground">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-foreground">{user.name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {user.email} · last sign-in {formatRelative(user.last_login_at)}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <Card
          id="workspaces"
          title="Your workspaces"
          description="Your administrator decides which workspaces you belong to and your role in each."
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {user.workspaces.map((w) => (
              <li
                key={w.id}
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3.5",
                  w.active ? "border-primary/40 bg-primary/5" : "border-border",
                )}
              >
                <span className="grid size-9 place-items-center rounded-md bg-secondary text-xs font-bold">
                  {initials(w.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {w.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {w.role_name}
                  </span>
                </span>
                {w.active ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <Check className="size-3.5" /> Current
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={switchWs.isPending}
                    onClick={() => switchWs.mutate(w.id)}
                  >
                    {switchWs.isPending && switchWs.variables === w.id ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-md border border-border bg-background-elevated p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-foreground">
              <KeyRound className="size-3.5 text-primary" />
              What your role allows in {user.workspace.name}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {user.permissions.map((p) => (
                <span
                  key={p}
                  className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <ProfileCard
          name={user.name}
          email={user.email}
          save={authApi.updateProfile}
          onSaved={() => void refresh()}
        />
        <PasswordCard change={authApi.changePassword} minLength={10} />
        <SessionsCard
          queryKey={authKeys.sessions()}
          list={authApi.sessions}
          revoke={authApi.revokeSession}
          signOutEverywhere={authApi.logoutAll}
        />
      </div>
    </div>
  );
}
