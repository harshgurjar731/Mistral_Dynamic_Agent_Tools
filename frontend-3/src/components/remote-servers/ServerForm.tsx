import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Boxes,
  Check,
  Cloud,
  FileText,
  Info,
  KeyRound,
  Loader2,
  PlugZap,
  Rocket,
  Save,
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
import { CheckReportView } from "./CheckReportView";
import { SectionCard } from "@/components/shared/SectionCard";
import { PURPOSE_LABEL, ServerStatusBadge, providerIcon } from "./status";
import { cn } from "@/lib/utils";

type Values = Record<string, string>;

const GROUPS: Record<ProviderField["group"], { title: string; icon: LucideIcon }> = {
  connection: { title: "Connection & credentials", icon: KeyRound },
  provider: { title: "Provider details", icon: Cloud },
  deployment: { title: "Deployment settings", icon: Rocket },
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
 * Add / edit form for a remote server, rendered from the provider catalog.
 *
 * Create mode walks purpose → provider → details. Edit mode fixes both and
 * shows stored secrets as "saved" — a blank secret keeps the stored value.
 * ``layout="page"`` puts test-and-save in a sticky side card; ``"stacked"``
 * (dialogs) keeps everything in one column.
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

  const providers = useMemo(
    () => catalog.providers.filter((p) => !purpose || p.purposes.includes(purpose)),
    [catalog, purpose],
  );

  const choosePurpose = (p: ServerPurpose) => {
    setPurpose(p);
    setProviderId(undefined);
    setReport(null);
  };
  const chooseProvider = (p: ServerProvider) => {
    setProviderId(p.id);
    setValues(defaultsFor(p));
    setSecrets({});
    setReport(null);
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
  const groups = (["connection", "provider", "deployment"] as const)
    .map((g) => ({ group: g, fields: visibleFields.filter((f) => f.group === g) }))
    .filter((g) => g.fields.length > 0);

  const stacked = layout === "stacked";
  const ProviderIcon = providerIcon(provider?.icon);
  // Host and key come from provisioning, so there is nothing to test before saving.
  const provisioned = Boolean(provider?.provisioned) && !editing;

  const details = provider ? (
    <div className="space-y-4">
      <SectionCard icon={FileText} title="Basics" bodyClassName="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={purpose === "workflow" ? "prod-workflow-vm" : "my-mcp-runner"}
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What runs here?"
          />
        </Field>
      </SectionCard>

      {provider.hints?.length ? (
        <div className="flex gap-2.5 rounded-2xl border border-blue/20 bg-blue/5 p-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-blue" />
          <ul className="space-y-1">
            {provider.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {groups.map(({ group, fields }) => (
        <SectionCard
          key={group}
          icon={GROUPS[group].icon}
          title={GROUPS[group].title}
          bodyClassName="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={f.secret ? (secrets[f.key] ?? "") : (values[f.key] ?? "")}
                stored={Boolean(server?.secrets_set.includes(f.key)) && !cleared.has(f.key)}
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
            ))}
          </div>
          {group === "connection" && fingerprint ? (
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
        </SectionCard>
      ))}
    </div>
  ) : null;

  const aside = provider ? (
    <div
      className={cn(
        "rounded-2xl border border-border/60 backdrop-blur-md",
        !stacked && "lg:sticky lg:top-6",
      )}
      style={{ background: "var(--surface)" }}
    >
      <div className="flex items-center gap-3 border-b border-border/40 px-5 py-4">
        <div className="grid size-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
          <ProviderIcon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {name.trim() || "New server"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {purpose ? PURPOSE_LABEL[purpose] : ""} · {provider.label}
          </p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {provisioned ? null : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Connection test</p>
            <ServerStatusBadge
              state={test.isPending ? "checking" : (report?.status ?? "unknown")}
              size="xs"
            />
          </div>
        )}
        {provisioned ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Adding the server looks up the running instance with the Brev CLI, fills in its SSH host
            and key, installs python3-venv and Docker, then runs diagnostics. Follow the log on the
            server's page.
          </p>
        ) : report ? (
          <CheckReportView report={report} />
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Checks DNS, the port,{" "}
            {provider.transport === "ssh"
              ? "SSH login and what the host has installed"
              : "TLS, the health endpoint and the deploy route"}{" "}
            — nothing is saved until you click {editing ? "Save" : "Add server"}.
          </p>
        )}
        <div className="space-y-2">
          {provisioned ? null : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              {test.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlugZap className="size-3.5" />
              )}
              Test connection
            </Button>
          )}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {editing ? "Save changes" : provisioned ? "Add & provision" : "Add server"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <KeyRound className="mt-0.5 size-3 shrink-0" />
          Passwords, keys and tokens are encrypted at rest and never shown again.
        </p>
      </div>
    </div>
  ) : null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          toast.error("Give the server a name.");
          return;
        }
        save.mutate();
      }}
    >
      {/* ── 1. Purpose ── */}
      {!editing ? (
        <Step n={1} title="What will this server be used for?" done={Boolean(purpose)}>
          <div className="grid gap-4 md:grid-cols-2">
            {(["workflow", "tool"] as const).map((p) => {
              const meta = PURPOSE_CARD[p];
              const Icon = meta.icon;
              const selected = purpose === p;
              return (
                <ChoiceCard key={p} selected={selected} onClick={() => choosePurpose(p)}>
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
        </Step>
      ) : null}

      {/* ── 2. Provider ── */}
      {!editing && purpose ? (
        <Step n={2} title="Where is the server hosted?" done={Boolean(provider)}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {providers.map((p) => {
              const Icon = providerIcon(p.icon);
              const selected = providerId === p.id;
              return (
                <ChoiceCard key={p.id} selected={selected} onClick={() => chooseProvider(p)}>
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "grid size-10 place-items-center rounded-xl border transition",
                        selected
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border/60 bg-background-elevated text-muted-foreground",
                      )}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{p.label}</p>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.transport === "ssh" ? "SSH · SFTP" : "HTTPS"}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {p.description}
                  </p>
                </ChoiceCard>
              );
            })}
          </div>
        </Step>
      ) : null}

      {/* ── 3. Details ── */}
      {provider ? (
        stacked ? (
          <div className="space-y-4">
            {details}
            {aside}
          </div>
        ) : (
          <Step n={editing ? undefined : 3} title={editing ? undefined : "Server details"}>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              {details}
              {aside}
            </div>
          </Step>
        )
      ) : null}
    </form>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n?: number | undefined;
  title?: string | undefined;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title ? (
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
          {n ? (
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-[11px]",
                done
                  ? "border-emerald/30 bg-emerald/15 text-emerald"
                  : "border-primary/30 bg-primary/15 text-primary",
              )}
            >
              {done ? <Check className="size-3" /> : n}
            </span>
          ) : null}
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function ChoiceCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative flex h-full flex-col rounded-2xl border p-5 text-left backdrop-blur-md transition-all duration-200",
        selected
          ? "border-primary/60 shadow-[0_0_28px_-10px_var(--primary)]"
          : "border-border/60 hover:-translate-y-0.5 hover:border-primary/30",
      )}
      style={{ background: "var(--surface)" }}
    >
      {selected ? (
        <span className="pointer-events-none absolute inset-0 rounded-2xl bg-primary/[0.06]" />
      ) : null}
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
  help,
  wide,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <Label className="text-xs">
        {label}
        {required ? <span className="text-red"> *</span> : null}
      </Label>
      {children}
      {help ? <p className="text-[11px] leading-relaxed text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function FieldInput({
  field,
  value,
  stored,
  onChange,
  onClear,
}: {
  field: ProviderField;
  value: string;
  stored: boolean;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const placeholder = stored ? "•••••••• saved — leave blank to keep" : field.placeholder;
  const help = (
    <>
      {field.help}
      {stored ? (
        <button type="button" className="ml-1 text-primary hover:underline" onClick={onClear}>
          Remove saved value
        </button>
      ) : null}
    </>
  );

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
        className="font-mono text-xs"
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
      {field.help || stored ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}
