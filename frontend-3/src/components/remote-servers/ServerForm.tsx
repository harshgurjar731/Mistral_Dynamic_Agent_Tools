import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  Info,
  KeyRound,
  Loader2,
  Pencil,
  PlugZap,
  Save,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { errorMessage } from "@/api";
import {
  remoteServersApi,
  type CheckReport,
  type ProviderCatalog,
  type ProviderField,
  type RemoteServer,
  type ServerInput,
  type ServerProvider,
  type ServerPurpose,
} from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckReportView } from "./CheckReportView";
import { PURPOSE_LABEL, ServerStatusBadge, providerIcon } from "./status";
import { cn } from "@/lib/utils";

type Values = Record<string, string>;

const GROUP_TITLE: Record<ProviderField["group"], string> = {
  connection: "Connection",
  provider: "Provider details",
  deployment: "Deployment",
};

const PURPOSE_CARD: Record<ServerPurpose, { icon: LucideIcon; accent: string; needs: string[] }> = {
  workflow: {
    icon: Boxes,
    accent: "text-cyan bg-cyan/10 border-cyan/25",
    needs: [
      "SSH access to a VM (host, user, key or password) — or an upload URL",
      "Python 3 on the VM; Docker if you want it started with compose",
    ],
  },
  tool: {
    icon: Wrench,
    accent: "text-pink bg-pink/10 border-pink/25",
    needs: ["The endpoint URL tool code is POSTed to", "A token, if the endpoint requires one"],
  },
};

const STEPS = ["Purpose", "Hosting", "Connect", "Test & add"] as const;
const DETAILS = 2;
const REVIEW = 3;

function defaultsFor(provider: ServerProvider, config: Record<string, unknown> = {}): Values {
  const values: Values = {};
  for (const f of provider.fields) {
    if (f.secret) continue;
    const v = config[f.key] ?? f.default ?? "";
    values[f.key] = v == null ? "" : String(v);
  }
  return values;
}

function isVisible(field: ProviderField, values: Values): boolean {
  if (!field.show_if) return true;
  return Object.entries(field.show_if).every(([k, expected]) =>
    Array.isArray(expected) ? expected.includes(values[k] ?? "") : values[k] === expected,
  );
}

/**
 * Whether a field belongs up front or under "Advanced settings": required
 * fields and how you connect stay visible; the rest has sensible defaults.
 * Provisioned providers (Brev) fill the connection in themselves, so only
 * what identifies the instance is shown.
 */
function isPrimary(field: ProviderField, provider: ServerProvider): boolean {
  if (field.required) return true;
  if (provider.provisioned) return field.group === "provider" && field.secret;
  return field.group === "connection";
}

/**
 * Add / edit form for a remote server, rendered from the provider catalog.
 *
 * Create mode is a wizard: purpose → hosting → connection details → test &
 * add, one step at a time. Edit mode (``layout="stacked"``, in a dialog)
 * shows the details with test-and-save below them; stored secrets show as
 * "saved" and a blank secret keeps the stored value.
 */
export function ServerForm({
  catalog,
  server,
  initialPurpose,
  layout = "page",
  onSaved,
  onCancel,
}: {
  catalog: ProviderCatalog;
  server?: RemoteServer | undefined;
  initialPurpose?: ServerPurpose | undefined;
  layout?: "page" | "stacked";
  onSaved: (server: RemoteServer) => void;
  onCancel?: (() => void) | undefined;
}) {
  const editing = Boolean(server);
  const [purpose, setPurpose] = useState<ServerPurpose | undefined>(
    server?.purpose ?? initialPurpose,
  );
  const [providerId, setProviderId] = useState<string | undefined>(server?.provider);
  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const provider = catalog.providers.find((p) => p.id === providerId);
  const [values, setValues] = useState<Values>(() =>
    provider ? defaultsFor(provider, server?.config) : {},
  );
  const [secrets, setSecrets] = useState<Values>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<CheckReport | null>(null);
  const fingerprint = server?.config?.["host_fingerprint"] as string | undefined;
  const [resetFingerprint, setResetFingerprint] = useState(false);
  const [step, setStep] = useState(editing ? DETAILS : initialPurpose ? 1 : 0);
  const [showErrors, setShowErrors] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const providers = useMemo(
    () => catalog.providers.filter((p) => !purpose || p.purposes.includes(purpose)),
    [catalog, purpose],
  );

  const choosePurpose = (p: ServerPurpose) => {
    if (p !== purpose) {
      setPurpose(p);
      setProviderId(undefined);
      setReport(null);
    }
    setStep(1);
  };
  const chooseProvider = (p: ServerProvider) => {
    if (p.id !== providerId) {
      setProviderId(p.id);
      setValues(defaultsFor(p));
      setSecrets({});
      setReport(null);
      setShowErrors(false);
    }
    setStep(DETAILS);
  };

  const payload = (): ServerInput => {
    const sec: Record<string, string | null> = {};
    for (const f of provider?.fields ?? []) {
      if (!f.secret) continue;
      if (cleared.has(f.key)) sec[f.key] = null;
      else sec[f.key] = secrets[f.key] ?? "";
    }
    const config: Record<string, unknown> = { ...values };
    if (resetFingerprint) config["host_fingerprint"] = "";
    return { name: name.trim(), description, purpose, provider: providerId, config, secrets: sec };
  };

  const test = useMutation({
    mutationFn: () => remoteServersApi.test({ ...payload(), server_id: server?.id }),
    onSuccess: (r) => setReport(r),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? remoteServersApi.update(server!.id, payload())
        : remoteServersApi.create({ ...payload(), initial_check: report }),
    onSuccess: (s) => {
      toast.success(
        editing
          ? "Server updated."
          : s.provision_deployment_id
            ? `Added "${s.name}" — provisioning started.`
            : `Added "${s.name}".`,
      );
      setSecrets({});
      setCleared(new Set());
      setResetFingerprint(false);
      onSaved(s);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setValue = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setReport(null);
  };

  const visibleFields = (provider?.fields ?? []).filter((f) => isVisible(f, values));
  const primaryFields = provider ? visibleFields.filter((f) => isPrimary(f, provider)) : [];
  const advancedGroups = (["connection", "provider", "deployment"] as const)
    .map((g) => ({
      group: g,
      fields: visibleFields.filter((f) => f.group === g && provider && !isPrimary(f, provider)),
    }))
    .filter((g) => g.fields.length > 0);

  const isStored = (f: ProviderField) =>
    Boolean(server?.secrets_set.includes(f.key)) && !cleared.has(f.key);
  const valueOf = (f: ProviderField) => (f.secret ? (secrets[f.key] ?? "") : (values[f.key] ?? ""));
  const missing = new Set(
    visibleFields
      .filter((f) => f.required && !valueOf(f).trim() && !(f.secret && isStored(f)))
      .map((f) => f.key),
  );
  const detailsValid = Boolean(name.trim()) && missing.size === 0;

  const stacked = layout === "stacked";
  const ProviderIcon = providerIcon(provider?.icon);
  // Host and key come from provisioning, so there is nothing to test before saving.
  const provisioned = Boolean(provider?.provisioned) && !editing;
  const done = [Boolean(purpose), Boolean(provider), detailsValid, false];

  const continueFromDetails = () => {
    if (!detailsValid) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep(REVIEW);
  };
  const submit = () => {
    if (!detailsValid) {
      setShowErrors(true);
      if (!editing) setStep(DETAILS);
      return;
    }
    save.mutate();
  };

  const renderField = (f: ProviderField) => (
    <FieldInput
      key={f.key}
      field={f}
      value={valueOf(f)}
      stored={isStored(f)}
      error={showErrors && missing.has(f.key) ? `${f.label} is required` : undefined}
      onChange={(v) => {
        if (f.secret) {
          setSecrets((prev) => ({ ...prev, [f.key]: v }));
          setReport(null);
        } else setValue(f.key, v);
      }}
      onClear={() => {
        setCleared((prev) => new Set(prev).add(f.key));
        setSecrets((prev) => ({ ...prev, [f.key]: "" }));
      }}
    />
  );

  // ── Connection details (wizard step 3, and the body of the edit dialog) ──
  const details = provider ? (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          required
          error={showErrors && !name.trim() ? "Give the server a name" : undefined}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={purpose === "workflow" ? "prod-workflow-vm" : "my-mcp-runner"}
            autoFocus={!editing}
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What runs here?"
          />
        </Field>
      </div>

      {provider.hints?.length ? (
        <div className="flex gap-2.5 rounded-xl border border-blue/20 bg-blue/5 px-3.5 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-blue" />
          <ul className="space-y-1">
            {provider.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {primaryFields.length > 0 ? (
        <div className="space-y-3">
          <p className="eyebrow">{provider.provisioned ? "Instance" : "Connection"}</p>
          <div className="grid gap-3 sm:grid-cols-2">{primaryFields.map(renderField)}</div>
        </div>
      ) : null}

      {fingerprint ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background-elevated/40 p-3 text-xs">
          <KeyRound className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Pinned host key</span>
          <code
            className={cn(
              "truncate font-mono text-[11px]",
              resetFingerprint && "line-through opacity-50",
            )}
          >
            {fingerprint}
          </code>
          <button
            type="button"
            className="ml-auto text-[11px] text-primary hover:underline"
            onClick={() => setResetFingerprint((r) => !r)}
          >
            {resetFingerprint ? "Keep" : "Forget (server was rebuilt)"}
          </button>
        </div>
      ) : null}

      {advancedGroups.length > 0 ? (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl border border-border/60 px-3.5 py-2.5 text-left text-xs transition hover:bg-surface-hover"
            >
              <SlidersHorizontal className="size-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">Advanced settings</span>
              <span className="truncate text-muted-foreground">
                {advancedGroups.map((g) => GROUP_TITLE[g.group]).join(" · ")} — optional
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto size-3.5 shrink-0 text-muted-foreground transition",
                  advancedOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 pt-4">
            {advancedGroups.map(({ group, fields }) => (
              <div key={group} className="space-y-3">
                <p className="eyebrow">{GROUP_TITLE[group]}</p>
                <div className="grid gap-3 sm:grid-cols-2">{fields.map(renderField)}</div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  ) : null;

  // ── Connection test ──
  const testPanel = provider ? (
    provisioned ? (
      <div className="flex gap-2.5 rounded-xl border border-border/60 bg-background-elevated/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-blue" />
        Adding the server looks up the running instance with the Brev CLI, fills in its SSH host and
        key, installs python3-venv and Docker, then runs diagnostics. You can follow the log on the
        server's page.
      </div>
    ) : (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-foreground">Connection test</p>
          <ServerStatusBadge
            state={test.isPending ? "checking" : (report?.status ?? "unknown")}
            size="xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlugZap className="size-3.5" />
            )}
            {report ? "Test again" : "Test connection"}
          </Button>
        </div>
        {report ? (
          <CheckReportView report={report} />
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Checks DNS, the port,{" "}
            {provider.transport === "ssh"
              ? "SSH login and what the host has installed"
              : "TLS, the health endpoint and the deploy route"}
            . Optional — nothing is saved until you click {editing ? "Save" : "Add server"}.
          </p>
        )}
      </div>
    )
  ) : null;

  const saveLabel = editing ? "Save changes" : provisioned ? "Add & provision" : "Add server";
  const saveButton = (
    <Button type="submit" disabled={save.isPending}>
      {save.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Save className="size-3.5" />
      )}
      {saveLabel}
    </Button>
  );

  // ── Edit dialog: one column, details then test & save ──
  if (editing || stacked) {
    return (
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {details}
        <div className="border-t border-border/40 pt-4">{testPanel}</div>
        <div className="flex justify-end gap-2 border-t border-border/40 pt-4">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {saveButton}
        </div>
        <SecretsNote />
      </form>
    );
  }

  // ── Create wizard ──
  const canOpen = (i: number) => i <= step || done.slice(0, i).every(Boolean);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step === DETAILS) continueFromDetails();
        else if (step === REVIEW) submit();
      }}
    >
      {/* Stepper */}
      <ol className="mb-6 grid grid-cols-4 gap-2">
        {STEPS.map((label, i) => {
          const current = i === step;
          const complete = i < step && done[i];
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!canOpen(i)}
                onClick={() => setStep(i)}
                className={cn(
                  "flex w-full flex-col gap-2 text-left disabled:cursor-not-allowed",
                  !current && canOpen(i) && "group",
                )}
              >
                <span
                  className={cn(
                    "h-1 w-full rounded-full transition",
                    current ? "bg-primary" : complete ? "bg-emerald/70" : "bg-muted/60",
                  )}
                />
                <span className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border text-[10px]",
                      current
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : complete
                          ? "border-emerald/30 bg-emerald/15 text-emerald"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {complete ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden truncate sm:inline",
                      current
                        ? "font-medium text-foreground"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        className="rounded-2xl border border-border/60 backdrop-blur-md"
        style={{ background: "var(--surface)" }}
      >
        <div className="border-b border-border/40 px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {step === 0
              ? "What will this server be used for?"
              : step === 1
                ? "Where is it hosted?"
                : step === DETAILS
                  ? provisioned
                    ? "Which Brev instance?"
                    : "How do we connect to it?"
                  : "Check and add"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {step === 0
              ? "This decides what you can send to it later."
              : step === 1
                ? `Servers for ${purpose ? PURPOSE_LABEL[purpose].toLowerCase() : "deployment"}.`
                : step === DETAILS
                  ? "Only the essentials are shown — everything else has defaults under Advanced settings."
                  : provisioned
                    ? "Review the details, then add the server to start provisioning."
                    : "Review the details and test the connection before adding it."}
          </p>
        </div>

        <div className="p-6">
          {step === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {(["workflow", "tool"] as const).map((p) => {
                const meta = PURPOSE_CARD[p];
                const Icon = meta.icon;
                return (
                  <ChoiceCard key={p} selected={purpose === p} onClick={() => choosePurpose(p)}>
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "grid size-11 place-items-center rounded-xl border",
                          meta.accent,
                        )}
                      >
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {catalog.purposes[p].label}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {catalog.purposes[p].description}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-1.5 border-t border-border/40 pt-3">
                      {meta.needs.map((n) => (
                        <li key={n} className="flex gap-2 text-[11px] text-muted-foreground">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  </ChoiceCard>
                );
              })}
            </div>
          ) : step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((p) => {
                const Icon = providerIcon(p.icon);
                const selected = providerId === p.id;
                return (
                  <ChoiceCard
                    key={p.id}
                    selected={selected}
                    onClick={() => chooseProvider(p)}
                    compact
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-lg border transition",
                          selected
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border/60 bg-background-elevated text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 pr-5">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="truncate">{p.label}</span>
                          <span className="shrink-0 rounded border border-border/60 px-1 font-mono text-[9px] font-normal text-muted-foreground">
                            {p.transport === "ssh" ? "SSH" : "HTTPS"}
                          </span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {p.description}
                        </p>
                      </div>
                    </div>
                  </ChoiceCard>
                );
              })}
            </div>
          ) : step === DETAILS ? (
            details
          ) : provider ? (
            <div className="space-y-6">
              <Summary
                name={name}
                description={description}
                purpose={purpose}
                provider={provider}
                fields={visibleFields}
                values={values}
                secrets={secrets}
                onEdit={() => setStep(DETAILS)}
                icon={ProviderIcon}
              />
              {testPanel}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border/40 px-6 py-4">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            ) : null}
            {step === DETAILS ? (
              <Button type="submit">
                Continue <ArrowRight className="size-3.5" />
              </Button>
            ) : step === REVIEW ? (
              saveButton
            ) : done[step] ? (
              <Button type="button" onClick={() => setStep(step + 1)}>
                Continue <ArrowRight className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <SecretsNote className="mt-3 justify-center" />
    </form>
  );
}

function SecretsNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
      <KeyRound className="mt-0.5 size-3 shrink-0" />
      Passwords, keys and tokens are encrypted at rest and never shown again.
    </p>
  );
}

/** What will be saved: identity, then every filled-in setting (secrets as "set"). */
function Summary({
  name,
  description,
  purpose,
  provider,
  fields,
  values,
  secrets,
  onEdit,
  icon: Icon,
}: {
  name: string;
  description: string;
  purpose: ServerPurpose | undefined;
  provider: ServerProvider;
  fields: ProviderField[];
  values: Values;
  secrets: Values;
  onEdit: () => void;
  icon: LucideIcon;
}) {
  const rows = fields
    .map((f) => {
      if (f.secret) return secrets[f.key] ? { f, shown: "•••••• set" } : null;
      const raw = values[f.key] ?? "";
      if (!raw) return null;
      return { f, shown: f.options?.find((o) => o.value === raw)?.label ?? raw };
    })
    .filter((r): r is { f: ProviderField; shown: string } => r != null);

  return (
    <div className="rounded-xl border border-border/60">
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <div className="grid size-9 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{name.trim()}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {purpose ? PURPOSE_LABEL[purpose] : ""} · {provider.label}
            {description ? ` · ${description}` : ""}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>
      <dl className="divide-y divide-border/40 px-4 text-xs">
        {rows.map(({ f, shown }) => (
          <div key={f.key} className="flex min-w-0 items-center gap-3 py-2">
            <dt className="w-40 shrink-0 text-muted-foreground">{f.label}</dt>
            <dd
              className={cn(
                "truncate font-mono text-[11px]",
                f.secret ? "text-emerald" : "text-foreground",
              )}
              title={f.secret ? undefined : shown}
            >
              {shown}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChoiceCard({
  selected,
  onClick,
  compact,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative flex h-full flex-col rounded-2xl border text-left transition-all duration-200",
        compact ? "p-4" : "p-5",
        selected
          ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_28px_-10px_var(--primary)]"
          : "border-border/60 hover:-translate-y-0.5 hover:border-primary/30",
      )}
    >
      {selected ? (
        <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : null}
      {children}
    </button>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required ? <span className="text-red"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-[11px] text-red">{error}</p> : null}
    </div>
  );
}

function FieldInput({
  field,
  value,
  stored,
  error,
  onChange,
  onClear,
}: {
  field: ProviderField;
  value: string;
  stored: boolean;
  error?: string | undefined;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const placeholder = stored ? "•••••••• saved — leave blank to keep" : field.placeholder;

  let control: React.ReactNode;
  if (field.type === "select") {
    control = (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (field.type === "textarea") {
    control = (
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={field.key === "private_key" ? 5 : 3}
        spellCheck={false}
        className={cn("font-mono text-xs", error && "border-red/60")}
      />
    );
  } else {
    control = (
      <Input
        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={field.secret ? "new-password" : "off"}
        className={cn(error && "border-red/60")}
      />
    );
  }

  return (
    <div className={cn("space-y-1.5", field.type === "textarea" && "sm:col-span-2")}>
      <Label className="text-xs">
        {field.label}
        {field.required ? <span className="text-red"> *</span> : null}
        {field.secret ? <KeyRound className="ml-1 inline size-3 text-muted-foreground" /> : null}
      </Label>
      {control}
      {error ? (
        <p className="text-[11px] text-red">{error}</p>
      ) : field.help || stored ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {field.help}
          {stored ? (
            <button type="button" className="ml-1 text-primary hover:underline" onClick={onClear}>
              Remove saved value
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
