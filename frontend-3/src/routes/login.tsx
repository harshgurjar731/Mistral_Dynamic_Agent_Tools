import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { authApi, authKeys } from "@/api/auth";
import { errorMessage } from "@/api/client";
import {
  AuthLayout,
  FormError,
  FormHeader,
  PasswordField,
  SubmitButton,
  TextField,
} from "@/components/auth/AuthParts";
import { safeNext, useAuthSession } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({ meta: [{ title: "Sign in — Agentic AI Design Patterns" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in: straight through.
  useEffect(() => {
    if (session?.user) void navigate({ to: safeNext(next), replace: true });
  }, [session?.user, next, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.login(email.trim(), password);
      await qc.fetchQuery({ queryKey: authKeys.session(), queryFn: authApi.session });
      await navigate({ to: safeNext(next), replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <FormHeader
        eyebrow="Welcome back"
        title="Sign in to your workspace"
        description="Use the email and password from your invitation."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          labelAside={
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          }
        />
        <SubmitButton loading={busy} disabled={!email || !password}>
          Sign in
        </SubmitButton>
      </form>

      <div className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>No account yet? Your administrator creates accounts and sends an invite link.</p>
        <Link
          to="/admin/login"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
        >
          <ShieldCheck className="size-4 text-primary" />
          Platform admin? Sign in to the admin console
        </Link>
      </div>
    </AuthLayout>
  );
}
