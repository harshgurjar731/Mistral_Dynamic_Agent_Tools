import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Building2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { authApi, authKeys } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AuthLayout,
  FormError,
  FormHeader,
  PasswordField,
  PasswordMatch,
  SubmitButton,
  Splash,
  TextField,
} from "./AuthParts";

/** Shared by /invite/$token and /reset-password/$token — the server knows which it is. */
export function AcceptLinkPage({ token, expect }: { token: string; expect: "invite" | "reset" }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: authKeys.link(token),
    queryFn: () => authApi.linkInfo(token),
    retry: false,
    staleTime: Infinity,
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info.data) setName(info.data.name);
  }, [info.data]);

  if (info.isLoading) return <Splash label="Checking your link" />;

  if (info.isError || !info.data) {
    return (
      <AuthLayout>
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-lg border border-border bg-secondary">
            <AlertTriangle className="size-5 text-amber" />
          </span>
          <h1 className="mt-5 font-display text-xl font-bold">This link can't be used</h1>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage(info.error)}</p>
          <Link
            to="/login"
            className="mt-8 inline-flex items-center gap-2 text-sm font-medium hover:text-primary"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const d = info.data;
  const isInvite = d.kind === "invite";
  const isAdmin = d.account === "admin";
  const minLength = isAdmin ? 12 : 10;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.acceptLink(token, password, isInvite ? name : undefined);
      await qc.fetchQuery({ queryKey: authKeys.session(), queryFn: authApi.session });
      await navigate({ to: res.account === "admin" ? "/admin" : "/", replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout variant={isAdmin ? "admin" : "user"}>
      <FormHeader
        eyebrow={isInvite ? (isAdmin ? "Admin invitation" : "Invitation") : "Password reset"}
        title={isInvite ? "Set up your account" : "Choose a new password"}
        description={
          <>
            For <span className="font-medium text-foreground">{d.email}</span>
            {expect === "reset" && isInvite
              ? " — this is an invitation, so you'll set up your account first."
              : null}
          </>
        }
      />
      {isInvite && d.workspaces.length ? (
        <div className="mb-6 rounded-md border border-border bg-background-elevated p-4">
          <p className="technical-label">You're joining</p>
          <ul className="mt-2 space-y-1.5">
            {d.workspaces.map((w) => (
              <li key={w.name} className="flex items-center gap-2 text-sm">
                <Building2 className="size-3.5 text-primary" />
                <span className="font-medium text-foreground">{w.name}</span>
                <span className="text-muted-foreground">as {w.role}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        {isInvite ? (
          <TextField
            label="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        ) : null}
        <input type="email" value={d.email} autoComplete="username" readOnly hidden />
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          minLength={minLength}
          autoFocus={!isInvite}
        />
        <PasswordField
          label="Repeat password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <PasswordMatch a={password} b={confirm} />
        <SubmitButton
          loading={busy}
          disabled={
            password.length < minLength || password !== confirm || (isInvite && !name.trim())
          }
        >
          {isInvite ? "Create account and sign in" : "Save password and sign in"}
        </SubmitButton>
        <p className="text-center text-xs text-muted-foreground">
          This link expires {new Date(d.expires_at).toLocaleString()} and works once.
        </p>
      </form>
    </AuthLayout>
  );
}
