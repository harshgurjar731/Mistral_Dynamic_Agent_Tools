/**
 * Add a vault entry, or replace an entry's value.
 *
 * Shared by Settings → Vault, the build prerequisites dialog, a workflow's run
 * prerequisites and the connector credentials form, so a credential is always
 * entered the same way: once, into the vault, encrypted, and never shown again.
 * The caller receives the saved entry (never the value) in `onSaved`.
 *
 * When the backend has a vault admin token and this tab does not, the save
 * answers 401; the dialog then asks for the token and retries.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { errorMessage, QK, vaultApi, vaultToken } from "@/api";
import {
  normaliseVaultName,
  VAULT_NAME_RE,
  type VaultKind,
  type VaultSecret,
  type VaultSecretInput,
} from "@/api/vault";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LivePercent } from "@/components/activity/LiveProgress";

export interface VaultSecretPreset {
  name?: string | undefined;
  label?: string | undefined;
  kind?: VaultKind | string | undefined;
  service?: string | undefined;
  description?: string | undefined;
  /** Shown under the value field: what a valid value looks like. */
  formatHint?: string | undefined;
  origin?: "settings" | "build" | "connector" | undefined;
  originRef?: string | null | undefined;
}

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background-elevated px-2.5 text-xs text-foreground focus:outline-none";

function isUnauthorised(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 401;
}

export function VaultSecretDialog({
  open,
  onOpenChange,
  preset,
  replace,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** New entry: what to prefill. */
  preset?: VaultSecretPreset | undefined;
  /** Replace this entry's value instead of adding one. */
  replace?: VaultSecret | undefined;
  onSaved?: ((secret: VaultSecret) => void) | undefined;
}) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: QK.vault(), queryFn: vaultApi.overview, enabled: open });
  const kinds = useMemo(() => overview.data?.kinds ?? [], [overview.data?.kinds]);

  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<VaultKind>("api_key");
  const [service, setService] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [sensitive, setSensitive] = useState(true);
  const [sensitiveTouched, setSensitiveTouched] = useState(false);
  const [expires, setExpires] = useState("");
  const [needToken, setNeedToken] = useState(false);
  const [token, setToken] = useState("");

  // Reset to the preset each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const k = (preset?.kind as VaultKind) || "api_key";
    setName(preset?.name ? normaliseVaultName(preset.name) : "");
    setLabel(preset?.label ?? "");
    setKind(k);
    setService(preset?.service ?? "");
    setDescription(preset?.description ?? "");
    setValue("");
    setShow(false);
    setSensitiveTouched(false);
    setExpires("");
    setNeedToken(false);
    setToken(vaultToken.get() ?? "");
  }, [open, preset?.name, preset?.label, preset?.kind, preset?.service, preset?.description]);

  const kindInfo = useMemo(() => kinds.find((k) => k.key === kind), [kinds, kind]);
  useEffect(() => {
    if (!sensitiveTouched && kindInfo) setSensitive(kindInfo.sensitive);
  }, [kindInfo, sensitiveTouched]);

  const multiline = kind === "certificate" || kind === "connection_string" || kind === "other";
  const isReplace = Boolean(replace);
  const masked = isReplace ? replace!.sensitive : sensitive;
  const nameOk = isReplace || VAULT_NAME_RE.test(name);

  const save = useMutation({
    mutationFn: async () => {
      if (needToken) vaultToken.set(token.trim() || null);
      if (replace) return vaultApi.setValue(replace.id, value);
      const body: VaultSecretInput = {
        name,
        value,
        kind,
        sensitive,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(service.trim() ? { service: service.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(expires ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() } : {}),
        ...(preset?.origin ? { origin: preset.origin } : {}),
        ...(preset?.originRef ? { origin_ref: preset.originRef } : {}),
      };
      return vaultApi.create(body);
    },
    onSuccess: (secret) => {
      setValue("");
      toast.success(
        isReplace
          ? `${secret.name} updated — now version ${secret.version}.`
          : `${secret.name} stored in the vault.`,
      );
      void qc.invalidateQueries({ queryKey: QK.vault() });
      onSaved?.(secret);
      onOpenChange(false);
    },
    onError: (e) => {
      if (isUnauthorised(e)) {
        setNeedToken(true);
        toast.error("The vault is locked — enter its admin token to save.");
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const canSave = nameOk && value.trim().length > 0 && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            {isReplace ? `Replace the value of ${replace!.name}` : "Add to the vault"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isReplace
              ? "The current value is kept as a previous version, so this can be rolled back."
              : "Stored encrypted. Code receives it only while it runs, and it is never sent back to this page."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          {!isReplace ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="vault-name" className="text-xs">
                    Name code reads it by
                  </Label>
                  <Input
                    id="vault-name"
                    value={name}
                    onChange={(e) =>
                      setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                    }
                    onBlur={() => setName(normaliseVaultName(name))}
                    placeholder="OPENWEATHER_API_KEY"
                    className={cn("font-mono text-xs", name && !nameOk && "border-destructive")}
                    disabled={Boolean(preset?.name)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {name && !nameOk ? (
                    <p className="text-[10px] text-destructive">
                      Capital letters, digits and _; start with a letter.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vault-kind" className="text-xs">
                    Kind
                  </Label>
                  <select
                    id="vault-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as VaultKind)}
                    className={SELECT}
                  >
                    {(kinds.length ? kinds : [{ key: "api_key", label: "API key" }]).map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="vault-label" className="text-xs">
                    Label
                  </Label>
                  <Input
                    id="vault-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="OpenWeather API key"
                    className="text-xs"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vault-service" className="text-xs">
                    Service
                  </Label>
                  <Input
                    id="vault-service"
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    placeholder="OpenWeather"
                    className="text-xs"
                    maxLength={120}
                  />
                </div>
              </div>
            </>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="vault-value" className="flex items-center justify-between text-xs">
              <span>{isReplace ? "New value" : "Value"}</span>
              {masked && !multiline ? (
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {show ? "Hide" : "Show"} while typing
                </button>
              ) : null}
            </Label>
            {multiline ? (
              <Textarea
                id="vault-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={5}
                placeholder={kindInfo?.placeholder || ""}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            ) : (
              <Input
                id="vault-value"
                type={masked && !show ? "password" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kindInfo?.placeholder || ""}
                className="font-mono text-xs"
                autoComplete="new-password"
                spellCheck={false}
                autoFocus
              />
            )}
            {preset?.formatHint ? (
              <p className="text-[10px] text-muted-foreground">Expected: {preset.formatHint}</p>
            ) : null}
          </div>

          {!isReplace ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-2 rounded-lg border border-border/60 p-2.5 text-[11px]">
                <Switch
                  checked={sensitive}
                  onCheckedChange={(on) => {
                    setSensitive(on);
                    setSensitiveTouched(true);
                  }}
                  aria-label="Sensitive"
                />
                <span>
                  <span className="font-medium text-foreground">Sensitive</span>
                  <span className="block text-muted-foreground">
                    {sensitive
                      ? "Never shown again after saving."
                      : "May be shown (a URL, a region)."}
                  </span>
                </span>
              </label>
              <div className="space-y-1">
                <Label htmlFor="vault-expires" className="text-xs">
                  Expires <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="vault-expires"
                  type="date"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          ) : null}

          {!isReplace ? (
            <div className="space-y-1">
              <Label htmlFor="vault-desc" className="text-xs">
                Notes <span className="text-muted-foreground">(optional, no secrets here)</span>
              </Label>
              <Textarea
                id="vault-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                className="text-xs"
                placeholder="Which account, who owns it, where to rotate it."
              />
            </div>
          ) : null}

          {needToken ? (
            <div className="space-y-1 rounded-lg border border-amber/40 bg-amber/5 p-3">
              <Label htmlFor="vault-token" className="flex items-center gap-1.5 text-xs">
                <LockKeyhole className="size-3.5 text-amber" /> Vault admin token
              </Label>
              <Input
                id="vault-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="text-xs"
                autoComplete="off"
              />
              <p className="text-[10px] text-muted-foreground">
                Set as VAULT_ADMIN_TOKEN on the backend. Remembered in this tab only.
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2 pt-1">
            <p className="mr-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3" /> Encrypted at rest · every change audited
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {save.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : null}
              {isReplace ? "Replace value" : "Store in the vault"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
