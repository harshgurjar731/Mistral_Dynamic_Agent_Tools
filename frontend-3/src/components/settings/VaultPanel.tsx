/**
 * Settings → Vault.
 *
 * Every credential, service URL and account setting the platform's code may
 * use, in one list. A value is written once and never shown again (a
 * non-sensitive one is shown as-is); each row says what it is, whether code can
 * use it now, and when it was last used and by what. Replacing a value keeps
 * the previous one for rollback; every change, use and refusal is audited.
 *
 * Builds add entries here too: answering a build's prerequisites stores what
 * was typed in this vault, marked "from a build".
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  History,
  KeyRound,
  Loader2,
  Lock,
  LockKeyholeOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { errorMessage, QK, vaultApi, vaultToken } from "@/api";
import type { VaultAuditEvent, VaultOverview, VaultSecret } from "@/api/vault";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/Skeletons";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { VaultSecretDialog } from "@/components/vault/VaultSecretDialog";
import { cn } from "@/lib/utils";

type Filter = "all" | "attention" | "expired" | "disabled" | "build";

const FLAG_TEXT: Record<string, string> = {
  expiring_soon: "expires soon",
  rotation_due: "rotation due",
  old_key: "old key",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return d.toLocaleDateString();
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return d.toLocaleDateString();
}

function StatusPill({ secret }: { secret: VaultSecret }) {
  const tone =
    secret.status === "active"
      ? secret.flags.length
        ? "border-amber/40 bg-amber/10 text-amber"
        : "border-emerald/30 bg-emerald/10 text-emerald"
      : "border-destructive/30 bg-destructive/10 text-destructive";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={cn("rounded border px-1.5 py-px text-[10px] font-medium", tone)}>
        {secret.status === "active" ? "usable" : secret.status}
      </span>
      {secret.flags.map((f) => (
        <span
          key={f}
          className="rounded border border-amber/30 px-1 py-px text-[9px] text-amber uppercase"
        >
          {FLAG_TEXT[f] ?? f}
        </span>
      ))}
    </span>
  );
}

export function VaultPanel({
  focusId,
  createName,
}: {
  /** Open on this entry (from a run prerequisite's "Open in the vault"). */
  focusId?: string | undefined;
  /** Open the add dialog with this name (from "Add to the vault"). */
  createName?: string | undefined;
}) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: QK.vault(), queryFn: vaultApi.overview });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<VaultSecret | null>(null);
  const [editing, setEditing] = useState<VaultSecret | null>(null);
  const [history, setHistory] = useState<VaultSecret | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [unlocking, setUnlocking] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; instructions: string[] } | null>(null);

  useEffect(() => {
    if (createName) setAdding(createName);
  }, [createName]);
  useEffect(() => {
    if (!focusId || !data.data) return;
    const el = document.getElementById(`vault-row-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, data.data]);

  const refresh = () => void qc.invalidateQueries({ queryKey: QK.vault() });
  const onError = (e: unknown) => {
    if ((e as { response?: { status?: number } })?.response?.status === 401) setUnlocking(true);
    toast.error(errorMessage(e));
  };

  const toggle = useMutation({
    mutationFn: (s: VaultSecret) => vaultApi.update(s.id, { disabled: !s.disabled }),
    onSuccess: (s) => {
      toast.success(
        s.disabled
          ? `${s.name} switched off — code no longer receives it.`
          : `${s.name} switched on.`,
      );
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (s: VaultSecret) => vaultApi.remove(s.id),
    onSuccess: (r) => {
      toast.success(`${r.deleted.name} deleted.`);
      refresh();
    },
    onError,
  });
  const reveal = useMutation({
    mutationFn: (s: VaultSecret) => vaultApi.reveal(s.id),
    onSuccess: (r) => {
      setRevealed((m) => ({ ...m, [r.id]: r.value }));
      // A revealed value stays on screen briefly, then is dropped from memory.
      window.setTimeout(
        () =>
          setRevealed((m) => {
            const { [r.id]: _gone, ...rest } = m;
            return rest;
          }),
        30_000,
      );
    },
    onError,
  });
  const rotate = useMutation({
    mutationFn: vaultApi.rotateKey,
    onSuccess: (r) => {
      toast.success(
        `${r.re_encrypted} value(s) re-encrypted with key ${r.primary_key_id}` +
          (r.unreadable.length ? `; unreadable: ${r.unreadable.join(", ")}` : "."),
      );
      refresh();
    },
    onError,
  });
  const generate = useMutation({
    mutationFn: vaultApi.generateKey,
    onSuccess: setNewKey,
    onError,
  });

  const rows = useMemo(() => {
    const list = data.data?.secrets ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((s) => {
      if (filter === "attention" && !(s.flags.length || s.status !== "active")) return false;
      if (filter === "expired" && s.status !== "expired") return false;
      if (filter === "disabled" && s.status !== "disabled") return false;
      if (filter === "build" && s.origin !== "build") return false;
      if (!q) return true;
      return [s.name, s.label, s.service, s.kind_label, ...s.tags]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.data, query, filter]);

  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  if (!data.data) return <Skeleton className="h-96 rounded-2xl" />;
  const v: VaultOverview = data.data;
  const unlocked = Boolean(vaultToken.get());

  return (
    <section
      id="section-backend-vault"
      className="overflow-hidden rounded-2xl border border-border/60"
      style={{ background: "var(--surface)" }}
    >
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="size-4 text-primary" /> Vault
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            API keys, tokens, service URLs and account settings for the third-party services your
            tools, activities and connectors call. Code names what it needs (e.g.{" "}
            <code className="font-mono text-[11px]">OPENWEATHER_API_KEY</code>) and receives the
            value only while it runs — never in its source, a prompt, or a log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {v.admin_token_required ? (
            <Button size="sm" variant="outline" onClick={() => setUnlocking(true)}>
              {unlocked ? <LockKeyholeOpen className="size-3.5" /> : <Lock className="size-3.5" />}
              {unlocked ? "Unlocked" : "Unlock"}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setAdding("")} disabled={!v.enabled}>
            <Plus className="size-3.5" /> Add entry
          </Button>
        </div>
      </header>

      {/* ── Status ── */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-5 py-3 text-xs",
          v.enabled ? "bg-primary/5" : "bg-background-elevated/40",
        )}
      >
        {v.enabled ? (
          <span className="flex items-center gap-1.5 text-foreground">
            <ShieldCheck className="size-4 text-primary" />
            {v.summary.active} of {v.summary.total} usable
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldOff className="size-4" /> Vault off — nothing is supplied from here (see the
            settings below).
          </span>
        )}
        {v.summary.attention ? (
          <button
            type="button"
            onClick={() => setFilter("attention")}
            className="flex items-center gap-1 text-amber hover:underline"
          >
            <AlertTriangle className="size-3.5" /> {v.summary.attention} need attention
          </button>
        ) : null}
        <span className="text-muted-foreground">
          Master key <code className="font-mono">{v.key.primary_key_id}</code> from{" "}
          {v.key.source === "environment" ? "VAULT_MASTER_KEYS" : "the generated key file"}
          {v.key.key_ids.length > 1 ? ` (+${v.key.key_ids.length - 1} older)` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {v.key.on_old_key ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Re-encrypt {v.key.on_old_key} with the newest key
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            Rotate master key…
          </Button>
        </span>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-5 py-2.5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, service, label…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        {(
          [
            ["all", "All"],
            ["attention", "Needs attention"],
            ["expired", "Expired"],
            ["disabled", "Off"],
            ["build", "Added by a build"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition",
              filter === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Entries ── */}
      {v.secrets.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-muted-foreground">
          <KeyRound className="mx-auto mb-2 size-6 opacity-40" />
          Nothing stored yet. Add an entry here, or answer a build's prerequisites — what you type
          there is stored here.
        </div>
      ) : (
        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] tracking-wider text-muted-foreground uppercase">
                <th className="px-5 py-2 font-semibold">Entry</th>
                <th className="px-2 py-2 font-semibold">Service · kind</th>
                <th className="px-2 py-2 font-semibold">Value</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Used</th>
                <th className="px-2 py-2 font-semibold">On</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  id={`vault-row-${s.id}`}
                  className={cn(
                    "border-b border-border/40 align-top",
                    focusId === s.id && "bg-primary/5",
                    s.disabled && "opacity-60",
                  )}
                >
                  <td className="max-w-[18rem] px-5 py-2.5">
                    <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-foreground">
                      {s.name}
                      <button
                        type="button"
                        title="Copy the name"
                        onClick={() => {
                          void navigator.clipboard?.writeText(s.name);
                          toast.success(`${s.name} copied.`);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="size-3" />
                      </button>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    {s.origin === "build" ? (
                      <span className="mt-0.5 inline-block rounded bg-primary/10 px-1 text-[9px] font-semibold text-primary uppercase">
                        added by a build
                      </span>
                    ) : null}
                    {s.allowed_consumers.length ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Only: {s.allowed_consumers.join(", ")}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <p className="text-foreground/90">{s.service || "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{s.kind_label}</p>
                  </td>
                  <td className="max-w-[14rem] px-2 py-2.5">
                    <code className="font-mono text-[11px] break-all text-foreground/80">
                      {revealed[s.id] ?? s.hint}
                    </code>
                    <p className="text-[10px] text-muted-foreground">
                      v{s.version} · changed {when(s.value_changed_at)}
                    </p>
                  </td>
                  <td className="px-2 py-2.5">
                    <StatusPill secret={s} />
                    {s.expires_at ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        expires {new Date(s.expires_at).toLocaleDateString()}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                    {s.use_count ? (
                      <>
                        {when(s.last_used_at)}
                        <span className="block text-[10px]">
                          {s.use_count}× · {s.last_used_by}
                        </span>
                      </>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <Switch
                      checked={!s.disabled}
                      disabled={toggle.isPending}
                      onCheckedChange={() => toggle.mutate(s)}
                      aria-label={`${s.disabled ? "Switch on" : "Switch off"} ${s.name}`}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <IconButton title="Replace the value" onClick={() => setReplacing(s)}>
                        <RefreshCw className="size-3.5" />
                      </IconButton>
                      {s.sensitive && v.allow_reveal && !revealed[s.id] ? (
                        <IconButton
                          title="Reveal for 30 seconds (audited)"
                          onClick={() => reveal.mutate(s)}
                        >
                          <Eye className="size-3.5" />
                        </IconButton>
                      ) : null}
                      <IconButton title="Previous values" onClick={() => setHistory(s)}>
                        <History className="size-3.5" />
                      </IconButton>
                      <IconButton title="Edit details and access" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton
                        title="Delete"
                        danger
                        onClick={() =>
                          window.confirm(
                            `Delete ${s.name} and its previous values? Code that reads it will report a configuration error until it is added again.`,
                          ) && remove.mutate(s)
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                    No entry matches.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <AuditLog />

      <VaultSecretDialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        preset={adding ? { name: adding } : undefined}
      />
      <VaultSecretDialog
        open={replacing !== null}
        onOpenChange={(o) => !o && setReplacing(null)}
        replace={replacing ?? undefined}
      />
      {editing ? (
        <EditDialog secret={editing} onClose={() => setEditing(null)} onError={onError} />
      ) : null}
      {history ? (
        <HistoryDialog secret={history} onClose={() => setHistory(null)} onError={onError} />
      ) : null}
      <UnlockDialog open={unlocking} onClose={() => setUnlocking(false)} />
      <Dialog open={newKey !== null} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Rotate the master key</DialogTitle>
            <DialogDescription className="text-xs">
              A new key, generated for you and not stored anywhere. Copy it now.
            </DialogDescription>
          </DialogHeader>
          <code className="block rounded-lg border border-border bg-background-elevated p-3 font-mono text-[11px] break-all">
            {newKey?.key}
          </code>
          <ol className="list-decimal space-y-1 pl-5 text-[11px] text-muted-foreground">
            {newKey?.instructions.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ol>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(newKey?.key ?? "");
                toast.success("Key copied.");
              }}
            >
              <Copy className="size-3.5" /> Copy key
            </Button>
            <Button size="sm" onClick={() => setNewKey(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-hover",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EditDialog({
  secret,
  onClose,
  onError,
}: {
  secret: VaultSecret;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(secret.label);
  const [service, setService] = useState(secret.service);
  const [description, setDescription] = useState(secret.description);
  const [consumers, setConsumers] = useState(secret.allowed_consumers.join(", "));
  const [tags, setTags] = useState(secret.tags.join(", "));
  const [sensitive, setSensitive] = useState(secret.sensitive);
  const [expires, setExpires] = useState(secret.expires_at ? secret.expires_at.slice(0, 10) : "");
  const save = useMutation({
    mutationFn: () =>
      vaultApi.update(secret.id, {
        label,
        service,
        description,
        sensitive,
        allowed_consumers: consumers
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(expires
          ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() }
          : { clear_expiry: true }),
      }),
    onSuccess: () => {
      toast.success(`${secret.name} saved.`);
      void qc.invalidateQueries({ queryKey: QK.vault() });
      onClose();
    },
    onError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{secret.name}</DialogTitle>
          <DialogDescription className="text-xs">
            What it is and who may use it. The value is changed with “Replace the value”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Service</Label>
              <Input
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Allowed tools and activities</Label>
            <Input
              value={consumers}
              onChange={(e) => setConsumers(e.target.value)}
              placeholder="Empty: any tool. e.g. fetch_weather, crm_*"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Comma separated; <code>prefix_*</code> matches by prefix. Anything else asking for it
              is refused and the refusal audited.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Expires</Label>
              <Input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} className="text-xs" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={sensitive} onCheckedChange={setSensitive} aria-label="Sensitive" />
            Sensitive — never shown after saving
          </label>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  secret,
  onClose,
  onError,
}: {
  secret: VaultSecret;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: QK.vaultVersions(secret.id),
    queryFn: () => vaultApi.versions(secret.id),
  });
  const audit = useQuery({
    queryKey: QK.vaultAudit({ secret_id: secret.id }),
    queryFn: () => vaultApi.audit({ secret_id: secret.id, limit: 30 }),
  });
  const rollback = useMutation({
    mutationFn: (version: number) => vaultApi.rollback(secret.id, version),
    onSuccess: (s) => {
      toast.success(`${s.name} restored — now version ${s.version}.`);
      void qc.invalidateQueries({ queryKey: QK.vault() });
      onClose();
    },
    onError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{secret.name} — history</DialogTitle>
          <DialogDescription className="text-xs">
            Previous values are kept encrypted; restoring one makes it a new version.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {(versions.data?.versions ?? []).map((ver) => (
            <li
              key={ver.version}
              className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs"
            >
              <span className="font-medium">v{ver.version}</span>
              <code className="font-mono text-[11px] text-muted-foreground">{ver.hint}</code>
              <span className="text-[10px] text-muted-foreground">{when(ver.created_at)}</span>
              {ver.current ? (
                <span className="ml-auto text-[10px] text-emerald">current</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 text-[10px]"
                  disabled={rollback.isPending}
                  onClick={() => rollback.mutate(ver.version)}
                >
                  <Undo2 className="size-3" /> Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
        {secret.used_by?.length ? (
          <p className="text-[11px] text-muted-foreground">Used by: {secret.used_by.join(", ")}</p>
        ) : null}
        <p className="mt-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Recent activity
        </p>
        <AuditRows events={audit.data?.events ?? []} compact />
      </DialogContent>
    </Dialog>
  );
}

function AuditRows({ events, compact }: { events: VaultAuditEvent[]; compact?: boolean }) {
  if (!events.length) return <p className="text-[11px] text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="divide-y divide-border/40">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-[11px]">
          <span className="w-32 shrink-0 text-muted-foreground">
            {e.at ? new Date(e.at).toLocaleString() : ""}
          </span>
          <span
            className={cn(
              "flex items-center gap-1 font-medium",
              e.outcome === "ok" ? "text-foreground" : "text-destructive",
            )}
          >
            {e.outcome === "ok" ? (
              <CheckCircle2 className="size-3 text-emerald" />
            ) : (
              <Ban className="size-3" />
            )}
            {e.action}
          </span>
          {!compact && e.secret_name ? <code className="font-mono">{e.secret_name}</code> : null}
          {e.consumer ? <span className="text-muted-foreground">by {e.consumer}</span> : null}
          {e.detail ? <span className="text-muted-foreground">— {e.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function AuditLog() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const audit = useQuery({
    queryKey: QK.vaultAudit({ action }),
    queryFn: () => vaultApi.audit({ ...(action ? { action } : {}), limit: 200 }),
    enabled: open,
  });
  return (
    <details className="group" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-3 text-[11px] text-muted-foreground hover:text-foreground">
        <History className="size-3.5" /> Audit log — who changed, revealed or used what
      </summary>
      <div className="px-5 pb-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {[
            ["", "Everything"],
            ["create,update,set_value,rollback,delete", "Changes"],
            ["use", "Uses"],
            ["denied", "Refusals"],
            ["reveal", "Reveals"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAction(key!)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px]",
                action === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {audit.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <AuditRows events={audit.data?.events ?? []} />
        )}
      </div>
    </details>
  );
}

function UnlockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [token, setToken] = useState("");
  useEffect(() => {
    if (open) setToken(vaultToken.get() ?? "");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Unlock the vault</DialogTitle>
          <DialogDescription className="text-xs">
            Adding, changing, revealing and deleting entries needs the VAULT_ADMIN_TOKEN set on the
            backend. It is remembered in this browser tab only.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Vault admin token"
          className="text-xs"
          autoComplete="off"
          autoFocus
        />
        <DialogFooter>
          {vaultToken.get() ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                vaultToken.set(null);
                toast.success("Vault locked in this tab.");
                onClose();
              }}
            >
              Lock
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!token.trim()}
            onClick={() => {
              vaultToken.set(token.trim());
              toast.success("Vault unlocked in this tab.");
              onClose();
            }}
          >
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
