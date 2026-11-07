import { Link } from "@tanstack/react-router";
import {
  Boxes,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useUiConfig } from "@/lib/uiConfig";
import { cn } from "@/lib/utils";

/* ── Brand ─────────────────────────────────────────────────────────────── */

export function BrandMark({ size = "md", to = "/" }: { size?: "sm" | "md"; to?: string }) {
  const ui = useUiConfig();
  return (
    <Link to={to} className="group inline-flex items-center gap-2.5">
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-md bg-primary shadow-sm transition group-hover:opacity-90",
          size === "sm" ? "size-8" : "size-9",
        )}
      >
        <Boxes className={cn("text-primary-foreground", size === "sm" ? "size-4" : "size-5")} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[15px] font-bold leading-tight text-foreground">
          {ui.UI_BRAND_TITLE}
        </span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">
          {ui.UI_BRAND_SUBTITLE}
        </span>
      </span>
    </Link>
  );
}

/* ── Split-screen layout for sign-in, invite and reset pages ───────────── */

const SIDE_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Workflow,
    title: "Design agents and workflows",
    body: "Describe a goal and the orchestrator designs, equips and runs the agent.",
  },
  {
    icon: ShieldCheck,
    title: "Governed by roles and rules",
    body: "Every action is checked against your role in the workspace and recorded.",
  },
  {
    icon: KeyRound,
    title: "Isolated workspaces",
    body: "Each workspace runs on its own Mistral key, data and traces.",
  },
];

export function AuthLayout({
  children,
  variant = "user",
  aside,
}: {
  children: ReactNode;
  variant?: "user" | "admin";
  aside?: ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="app-atmosphere" aria-hidden />
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Brand panel */}
        <aside className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col">
          <div className="grid-backdrop absolute inset-0 opacity-50" aria-hidden />
          <div
            aria-hidden
            className="absolute -left-32 top-1/3 size-[520px] rounded-full opacity-25 blur-3xl"
            style={{ background: "var(--gradient-brand)" }}
          />
          <div className="relative z-10 flex flex-1 flex-col justify-between p-10 xl:p-14">
            <BrandMark />
            <div className="max-w-md">
              {aside ?? (
                <>
                  <p className="technical-label">
                    {variant === "admin" ? "Admin console" : "Control plane"}
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground xl:text-4xl">
                    {variant === "admin" ? (
                      <>
                        Run the platform.
                        <br />
                        <span className="text-gradient-brand">Not the paperwork.</span>
                      </>
                    ) : (
                      <>
                        Describe your goal.
                        <br />
                        <span className="text-gradient-brand">We design the agent.</span>
                      </>
                    )}
                  </h2>
                  <ul className="mt-10 space-y-5">
                    {(variant === "admin" ? ADMIN_POINTS : SIDE_POINTS).map((p) => (
                      <li key={p.title} className="flex gap-3.5">
                        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-secondary">
                          <p.icon className="size-4 text-primary" />
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-foreground">
                            {p.title}
                          </span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {p.body}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Sessions are encrypted cookies. Access is checked on every request.
            </p>
          </div>
        </aside>

        {/* Form side */}
        <main className="relative z-10 flex min-h-screen flex-col px-4 py-6 sm:px-8">
          <div className="flex items-center justify-between">
            <div className="lg:hidden">
              <BrandMark size="sm" />
            </div>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[400px]">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

const ADMIN_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: KeyRound,
    title: "Workspaces on Mistral keys",
    body: "Add a workspace with its Mistral API key — it is verified before it is saved.",
  },
  {
    icon: ShieldCheck,
    title: "Users, roles and permissions",
    body: "Invite people, place them in workspaces and give each a built-in or custom role.",
  },
  {
    icon: Lock,
    title: "A full audit trail",
    body: "Every sign-in, change and refusal is recorded with who, when and from where.",
  },
];

export function FormHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="mb-7">
      {eyebrow ? <p className="technical-label">{eyebrow}</p> : null}
      <h1 className="mt-2 font-display text-2xl font-bold text-foreground">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-red/30 bg-red/10 px-3 py-2.5 text-sm text-red"
    >
      {message}
    </div>
  );
}

export function SubmitButton({
  loading,
  children,
  disabled,
}: {
  loading?: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/88 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ── Fields ────────────────────────────────────────────────────────────── */

export function TextField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </Label>
      <Input id={id} className="h-10" {...props} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PasswordField({
  label = "Password",
  value,
  onChange,
  autoComplete = "current-password",
  showStrength = false,
  minLength,
  labelAside,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  showStrength?: boolean;
  minLength?: number;
  labelAside?: ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </Label>
        {labelAside}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          maxLength={128}
          className="h-10 pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {showStrength ? <PasswordStrength value={value} minLength={minLength ?? 10} /> : null}
    </div>
  );
}

/** A guide, not the rule: the server's policy (length + blocklist) decides. */
function PasswordStrength({ value, minLength }: { value: string; minLength: number }) {
  const { score, label } = useMemo(() => {
    if (!value) return { score: 0, label: "" };
    let s = 0;
    if (value.length >= minLength) s++;
    if (value.length >= minLength + 4) s++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) s++;
    if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) s++;
    if (value.length < minLength) s = Math.min(s, 1);
    return { score: s, label: ["Too short", "Weak", "Fair", "Good", "Strong"][s] ?? "" };
  }, [value, minLength]);
  const tone = ["bg-red", "bg-red", "bg-amber", "bg-emerald", "bg-emerald"][score];
  return (
    <div className="space-y-1.5 pt-1">
      <div className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("h-1 rounded-full bg-border transition-colors", score >= i && tone)}
          />
        ))}
      </div>
      <p className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>At least {minLength} characters. A short sentence works well.</span>
        {label ? <span className="font-medium text-foreground">{label}</span> : null}
      </p>
    </div>
  );
}

export function PasswordMatch({ a, b }: { a: string; b: string }) {
  if (!b) return null;
  const ok = a === b;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs", ok ? "text-emerald" : "text-red")}>
      {ok ? <Check className="size-3.5" /> : null}
      {ok ? "Passwords match" : "Passwords do not match"}
    </p>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

export function Splash({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <span className="grid size-11 place-items-center rounded-lg bg-primary shadow-sm">
          <Boxes className="size-6 text-primary-foreground" />
        </span>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {label}
        </div>
      </div>
    </div>
  );
}

export function NoAccess({ workspace, role }: { workspace?: string | null; role?: string | null }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="glass max-w-md rounded-lg p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-lg border border-border bg-secondary">
          <Lock className="size-5 text-muted-foreground" />
        </span>
        <h1 className="mt-4 font-display text-lg font-bold text-foreground">
          You don't have access to this page
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role{role ? ` (${role})` : ""}
          {workspace ? ` in ${workspace}` : ""} doesn't include it. Switch workspace from the menu,
          or ask your administrator for a role that does.
        </p>
      </div>
    </div>
  );
}
