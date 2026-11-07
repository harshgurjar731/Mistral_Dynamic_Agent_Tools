import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { adminApi, authApi, authKeys } from "@/api/auth";
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

export const Route = createFileRoute("/admin/login")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({ meta: [{ title: "Admin sign in — Agentic AI Design Patterns" }] }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = safeNext(next, "/admin");
  useEffect(() => {
    if (session?.admin) void navigate({ to: target, replace: true });
  }, [session?.admin, target, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminApi.login(email.trim(), password);
      await qc.fetchQuery({ queryKey: authKeys.session(), queryFn: authApi.session });
      await navigate({ to: target, replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout variant="admin">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <ShieldCheck className="size-3.5" /> Platform administration
      </div>
      <FormHeader
        title="Admin console"
        description="Manage workspaces, users and roles. Admin sessions end when you close the browser."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Admin email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField value={password} onChange={setPassword} />
        <SubmitButton loading={busy} disabled={!email || !password}>
          Sign in as admin
        </SubmitButton>
      </form>
      <div className="mt-8 border-t border-border pt-6">
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to the user sign-in
        </Link>
      </div>
    </AuthLayout>
  );
}
