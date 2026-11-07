import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Lock, UserCog } from "lucide-react";
import { AuthLayout, FormHeader } from "@/components/auth/AuthParts";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Can't sign in — Agentic AI Design Patterns" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <FormHeader
        eyebrow="Account help"
        title="Can't sign in?"
        description="Passwords on this platform are reset by your administrator, so nobody can take over an account by guessing an email address."
      />
      <ol className="space-y-3">
        {[
          {
            icon: UserCog,
            title: "Ask your platform administrator",
            body: "They open your account in the admin console and choose “Send reset link”.",
          },
          {
            icon: KeyRound,
            title: "Open the link they send you",
            body: "It works once and expires after a day. Choose a new password there.",
          },
          {
            icon: Lock,
            title: "Locked after too many attempts?",
            body: "The lock lifts by itself after a few minutes, or your administrator can unlock you now.",
          },
        ].map((s) => (
          <li key={s.title} className="flex gap-3 rounded-md border border-border p-4">
            <s.icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium text-foreground">{s.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <Link
        to="/login"
        className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
