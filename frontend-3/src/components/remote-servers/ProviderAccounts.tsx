import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Server,
  UserRound,
} from "lucide-react";
import { QK, errorMessage } from "@/api";
import {
  remoteServersApi,
  type AccountState,
  type CloudInstance,
  type ProviderAccountSpec,
  type ProviderAccountStatus,
  type ProviderCatalog,
  type ServerProvider,
} from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerIcon } from "./status";
import { cn } from "@/lib/utils";

/*
 * Provider accounts: one login shared by every server of a provider — the
 * Brev CLI on the backend host ("cli"), or stored cloud credentials ("api")
 * that list VMs and start stopped ones. Each status fetch calls the CLI or the
 * cloud APIs, so the query is cached for a minute and refreshed on demand.
 */

const TONE = {
  ok: "text-emerald border-emerald/25 bg-emerald/10",
  warn: "text-amber border-amber/30 bg-amber/10",
  bad: "text-red border-red/30 bg-red/10",
};

/** Words for the two kinds: a CLI is logged in, a cloud account is connected. */
const WORDS = {
  cli: { in: "Logged in", out: "Logged out", login: "Log in", logout: "Log out" },
  api: { in: "Connected", out: "Not connected", login: "Connect", logout: "Disconnect" },
};

function stateMeta(state: AccountState, kind: ProviderAccountSpec["kind"]) {
  const w = WORDS[kind];
  return {
    logged_in: { label: w.in, tone: TONE.ok, icon: CircleCheck },
    logged_out: { label: w.out, tone: TONE.warn, icon: CircleAlert },
    not_installed: { label: "CLI not installed", tone: TONE.bad, icon: CircleAlert },
    error: { label: "Unavailable", tone: TONE.bad, icon: CircleAlert },
  }[state];
}

export function useProviderAccounts(enabled = true) {
  return useQuery({
    queryKey: QK.remoteServerAccounts(),
    queryFn: remoteServersApi.accounts,
    staleTime: 60_000,
    enabled,
  });
}

/** The listed instance a server points at, by the account's ``match`` keys. */
export function matchInstance(
  spec: ProviderAccountSpec | undefined,
  config: Record<string, unknown>,
  instances: CloudInstance[],
): CloudInstance | undefined {
  if (!spec?.match.length) return undefined;
  const wanted = spec.match.map((k) =>
    String(config[k] ?? "")
      .trim()
      .toLowerCase(),
  );
  if (wanted.some((v) => !v)) return undefined;
  return instances.find((i) =>
    spec.match.every((k, n) => (i.config[k] ?? "").toLowerCase() === wanted[n]),
  );
}

function useAccountMutations(provider: string) {
  const qc = useQueryClient();
  const settle = (s: ProviderAccountStatus) =>
    qc.setQueryData<ProviderAccountStatus[]>(QK.remoteServerAccounts(), (prev) =>
      prev?.some((a) => a.provider === s.provider)
        ? prev.map((a) => (a.provider === s.provider ? s : a))
        : [...(prev ?? []), s],
    );
  const logout = useMutation({
    mutationFn: () => remoteServersApi.accountLogout(provider),
    onSuccess: (s) => {
      toast.success(s.kind === "api" ? "Disconnected — credentials removed." : "Logged out.");
      settle(s);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setOrg = useMutation({
    mutationFn: (org: string) => remoteServersApi.accountSetOrg(provider, org),
    onSuccess: (s) => {
      toast.success(`Switched to ${s.org ?? "the organization"}.`);
      settle(s);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const start = useMutation({
    mutationFn: (instance: CloudInstance) => remoteServersApi.accountStart(provider, instance.ref),
    onSuccess: (s, instance) => {
      toast.success(`Starting ${instance.name} — its address shows once it is running.`);
      settle(s);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { logout, setOrg, start, settle };
}

export function AccountStateBadge({
  state,
  kind,
}: {
  state: AccountState;
  kind: ProviderAccountSpec["kind"];
}) {
  const meta = stateMeta(state, kind);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        meta.tone,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

/** Credentials form for a provider's account, rendered from its catalog spec. */
export function AccountLoginDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: ServerProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const spec = provider.account!;
  const words = WORDS[spec.kind];
  const settings = useProviderAccounts().data?.find((a) => a.provider === provider.id)?.settings;
  const [values, setValues] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const { settle } = useAccountMutations(provider.id);

  // Non-secret values already stored (e.g. AWS regions) prefill the form.
  const valueOf = (key: string) =>
    values[key] ?? settings?.[key] ?? String(spec.fields.find((f) => f.key === key)?.default ?? "");
  const missing = spec.fields.some((f) => f.required && !valueOf(f.key).trim());

  const login = useMutation({
    mutationFn: () =>
      remoteServersApi.accountLogin(provider.id, {
        values: Object.fromEntries(spec.fields.map((f) => [f.key, valueOf(f.key)])),
        remember: spec.kind === "api" || remember,
      }),
    onSuccess: (s) => {
      toast.success(
        `${words.in}: ${spec.label}${s.identity ? ` · ${s.identity}` : s.org ? ` · ${s.org}` : ""}.`,
      );
      settle(s);
      setValues({});
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="custom-scrollbar max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {words.login} {spec.kind === "api" ? "your" : "to"} {spec.label}
            {spec.kind === "api" ? " account" : ""}
          </DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          {spec.fields.map((f, n) => {
            const set = (v: string) => setValues((prev) => ({ ...prev, [f.key]: v }));
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">
                  {f.label}
                  {f.required ? <span className="text-red"> *</span> : null}
                  {f.secret ? (
                    <KeyRound className="ml-1 inline size-3 text-muted-foreground" />
                  ) : null}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea
                    value={valueOf(f.key)}
                    onChange={(e) => set(e.target.value)}
                    placeholder={f.placeholder}
                    rows={6}
                    spellCheck={false}
                    className="font-mono text-xs"
                    autoFocus={n === 0}
                  />
                ) : (
                  <Input
                    type={f.secret ? "password" : "text"}
                    value={valueOf(f.key)}
                    onChange={(e) => set(e.target.value)}
                    placeholder={f.placeholder}
                    autoComplete={f.secret ? "new-password" : "off"}
                    autoFocus={n === 0}
                  />
                )}
                {f.help ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{f.help}</p>
                ) : null}
              </div>
            );
          })}
          {spec.console_url ? (
            <a
              href={spec.console_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open the {spec.label} console <ExternalLink className="size-3" />
            </a>
          ) : null}
          {spec.kind === "cli" ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
                className="mt-0.5"
              />
              <span>
                Remember the token (stored encrypted) so provisioning can log in again by itself
                when the CLI's session expires.
              </span>
            </label>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <KeyRound className="mt-0.5 size-3 shrink-0" />
              The credentials are checked with {spec.label}, then stored encrypted on this backend.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={login.isPending || missing}>
              {login.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogIn className="size-3.5" />
              )}
              {words.login}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function instanceSummary(status: ProviderAccountStatus): string {
  const n = status.instances.length;
  const head = [status.identity, status.org ? `Org ${status.org}` : null]
    .filter(Boolean)
    .join(" · ");
  const list = status.instances
    .slice(0, 4)
    .map((i) => `${i.name} (${i.state.toLowerCase()})`)
    .join(", ");
  return `${head ? `${head} · ` : ""}${n} instance${n === 1 ? "" : "s"}${
    n ? `: ${list}${n > 4 ? `, +${n - 4} more` : ""}` : ""
  }`;
}

/** One provider's account: state, who/which org, and log in / switch / log out. */
function AccountRow({
  provider,
  status,
  refreshing,
}: {
  provider: ServerProvider;
  status: ProviderAccountStatus | undefined;
  refreshing: boolean;
}) {
  const spec = provider.account!;
  const words = WORDS[spec.kind];
  const [loginOpen, setLoginOpen] = useState(false);
  const { logout, setOrg } = useAccountMutations(provider.id);
  const Icon = providerIcon(provider.icon);
  const loggedIn = status?.state === "logged_in";
  // A cloud account in error still has stored credentials worth replacing or removing.
  const hasCredentials = loggedIn || (spec.kind === "api" && Boolean(status?.token_saved));

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background-elevated text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {spec.label}
          {status ? (
            <AccountStateBadge state={status.state} kind={spec.kind} />
          ) : refreshing ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {spec.kind === "cli" && status?.token_saved ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              title="Provisioning logs in again with it when the CLI's session expires"
            >
              <KeyRound className="size-3" /> token saved
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={status?.detail}>
          {loggedIn ? instanceSummary(status) : (status?.detail ?? "Checking…")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {loggedIn && status.orgs.length > 1 ? (
          <Select
            value={status.org ?? ""}
            onValueChange={(org) => setOrg.mutate(org)}
            disabled={setOrg.isPending}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Organization" />
            </SelectTrigger>
            <SelectContent>
              {status.orgs.map((o) => (
                <SelectItem key={o.name} value={o.name}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {status?.state === "not_installed" ? null : hasCredentials ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setLoginOpen(true)}>
              <UserRound className="size-3.5" />
              {spec.kind === "api" ? "Update credentials" : "Switch account"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              {logout.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
              {words.logout}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setLoginOpen(true)} disabled={!status}>
            <LogIn className="size-3.5" /> {words.login}
          </Button>
        )}
      </div>
      <AccountLoginDialog provider={provider} open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}

/** Every provider that has an account, for the top of the Remote servers page. */
export function ProviderAccountsPanel({
  catalog,
  className,
}: {
  catalog: ProviderCatalog | undefined;
  className?: string | undefined;
}) {
  const withAccount = (catalog?.providers ?? []).filter((p) => p.account);
  const accounts = useProviderAccounts(withAccount.length > 0);
  if (withAccount.length === 0) return null;

  return (
    <section
      className={cn("rounded-2xl border border-border/60 backdrop-blur-md", className)}
      style={{ background: "var(--surface)" }}
    >
      <header className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Provider accounts</h2>
          <p className="text-xs text-muted-foreground">
            Shared by every server of that provider — to provision Brev, and to list, fill in and
            start cloud VMs.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => accounts.refetch()}
          disabled={accounts.isFetching}
        >
          <RefreshCw className={cn("size-3.5", accounts.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </header>
      {accounts.isError ? (
        <p className="px-4 py-3 text-xs text-red">{errorMessage(accounts.error)}</p>
      ) : (
        <div className="divide-y divide-border/40">
          {withAccount.map((p) => (
            <AccountRow
              key={p.id}
              provider={p}
              status={accounts.data?.find((a) => a.provider === p.id)}
              refreshing={accounts.isFetching}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Inline notice for one provider's account — nothing while logged in (or when
 * the provider has none). A Brev login is required, so that is a warning; a
 * cloud account is optional, so that is a hint.
 */
export function AccountNotice({
  provider,
  className,
}: {
  provider: ServerProvider | undefined;
  className?: string | undefined;
}) {
  const [loginOpen, setLoginOpen] = useState(false);
  const accounts = useProviderAccounts(Boolean(provider?.account));
  if (!provider?.account) return null;
  const spec = provider.account;
  const status = accounts.data?.find((a) => a.provider === provider.id);
  if (!status || status.state === "logged_in") return null;
  const optional = spec.kind === "api" && status.state === "logged_out";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3 text-xs",
        optional ? "border-blue/20 bg-blue/5" : "border-amber/30 bg-amber/10",
        className,
      )}
    >
      {optional ? (
        <Info className="size-4 shrink-0 text-blue" />
      ) : (
        <CircleAlert className="size-4 shrink-0 text-amber" />
      )}
      <p className="min-w-0 flex-1 text-foreground">
        <span className="font-medium">
          {spec.label}: {stateMeta(status.state, spec.kind).label}.
        </span>{" "}
        <span className="text-muted-foreground">
          {optional
            ? "Optional — connect it to pick an instance here instead of typing its address."
            : status.state === "logged_out"
              ? "Provisioning and every connection to its servers need this login."
              : status.detail}
        </span>
      </p>
      {status.state === "not_installed" ? null : (
        <Button
          type="button"
          size="sm"
          variant={optional ? "outline" : "default"}
          onClick={() => setLoginOpen(true)}
        >
          <LogIn className="size-3.5" /> {WORDS[spec.kind].login}
        </Button>
      )}
      <AccountLoginDialog provider={provider} open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}

/**
 * Pick an instance from the provider account instead of typing its address:
 * applies the instance's ``config`` (host, username, identifiers) to the form.
 */
export function InstancePicker({
  provider,
  config,
  onPick,
}: {
  provider: ServerProvider | undefined;
  config: Record<string, unknown>;
  onPick: (values: Record<string, string>) => void;
}) {
  const accounts = useProviderAccounts(Boolean(provider?.account));
  const { start } = useAccountMutations(provider?.id ?? "");
  const spec = provider?.account;
  const status = accounts.data?.find((a) => a.provider === provider?.id);
  if (!spec || status?.state !== "logged_in") return null;

  const current = matchInstance(spec, config, status.instances);
  const stopped = current && !/^(RUNNING|ACTIVE)$/.test(current.state);

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background-elevated/40 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Server className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-foreground">Pick from your {spec.label} account</p>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => accounts.refetch()}
          disabled={accounts.isFetching}
        >
          <RefreshCw className={cn("size-3", accounts.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>
      {status.instances.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No instances in this account
          {status.settings["regions"] ? ` (regions: ${status.settings["regions"]})` : ""}.
        </p>
      ) : (
        <Select
          value={current?.ref ?? ""}
          onValueChange={(ref) => {
            const picked = status.instances.find((i) => i.ref === ref);
            if (picked) onPick(picked.config);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose an instance…" />
          </SelectTrigger>
          <SelectContent>
            {status.instances.map((i) => (
              <SelectItem key={i.ref} value={i.ref}>
                {i.name} · {i.state.toLowerCase()}
                {i.public_ip ? ` · ${i.public_ip}` : ""}
                {i.location ? ` · ${i.location}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {current && !current.public_ip && spec.kind === "api" ? (
        <p className="text-[11px] text-amber">
          {current.name} has no public IP{stopped ? " while it is stopped" : ""} — enter a host this
          backend can reach, or start it and refresh.
        </p>
      ) : null}
      {stopped && spec.kind === "api" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => start.mutate(current)}
          disabled={start.isPending}
        >
          {start.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Start {current.name}
        </Button>
      ) : null}
    </div>
  );
}

/** Start a cloud VM from anywhere (the server page's instance card). */
export function useStartInstance(provider: string) {
  return useAccountMutations(provider).start;
}
