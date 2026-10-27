/**
 * A build's prerequisites question (`decision_required`, kind "prerequisites").
 *
 * Asked before anything is built — or, at stage "code", before one tool's or
 * activity's code is generated — so a build is never spent on something it
 * cannot use. For each item the user chooses:
 *
 *   credential / URL / setting   use a vault entry · enter it now (stored in the
 *                                vault first) · add it later · proceed without
 *                                that service, saying what to do instead
 *   information                  answer it · let the build assume
 *
 * Or stops the build. A typed credential goes to `POST /vault/secrets` and the
 * answer carries only the new entry's id: values never travel with the answer,
 * the run's events or its logs.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  MessageSquareText,
  Plus,
  ServerCog,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { errorMessage, QK, runsApi, vaultApi } from "@/api";
import type { PrerequisiteAnswer, PrerequisiteItem, RunDecision } from "@/api/runs";
import type { VaultSecret } from "@/api/vault";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VaultSecretDialog } from "@/components/vault/VaultSecretDialog";
import { cn } from "@/lib/utils";

type Choice =
  | { action: "vault"; secret_id: string; secret_name: string }
  | { action: "text"; text: string }
  | { action: "skip"; instruction: string }
  | { action: "defer" }
  | { action: "environment" };

const CATEGORY_LABEL: Record<string, string> = {
  credential: "Credential",
  endpoint: "Service URL",
  configuration: "Account setting",
  information: "Information",
};

const STAGE_TEXT: Record<string, string> = {
  workflow: "Nothing has been built yet.",
  agent: "The agent has not been created yet.",
  code: "Its specification is written; no code has been generated yet.",
};

function inVault(item: PrerequisiteItem) {
  return item.category !== "information";
}

function initialChoice(item: PrerequisiteItem): Choice | undefined {
  if (item.status === "vault" && item.secret_id) {
    return {
      action: "vault",
      secret_id: item.secret_id,
      secret_name: item.secret_name ?? item.name,
    };
  }
  if (item.status === "environment") return { action: "environment" };
  if (!inVault(item) && item.default) return { action: "text", text: item.default };
  return undefined;
}

export function PrerequisitesForm({
  runId,
  decision,
  onLater,
}: {
  runId: string;
  decision: RunDecision;
  onLater: () => void;
}) {
  const items = useMemo(() => decision.items ?? [], [decision.items]);
  const [choices, setChoices] = useState<Record<string, Choice | undefined>>(() =>
    Object.fromEntries(items.map((i) => [i.key, initialChoice(i)])),
  );
  const [entering, setEntering] = useState<PrerequisiteItem | null>(null);
  const vault = useQuery({ queryKey: QK.vault(), queryFn: vaultApi.overview });
  const usable = (vault.data?.secrets ?? []).filter((s) => s.usable);

  const send = useMutation({
    mutationFn: ({ choice, answers }: { choice: string; answers?: PrerequisiteAnswer[] }) =>
      runsApi.decide(runId, decision.id, choice, undefined, answers),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = send.isPending || send.isSuccess;

  const set = (key: string, choice: Choice | undefined) =>
    setChoices((c) => ({ ...c, [key]: choice }));

  const open = items.filter((i) => !choices[i.key]);
  const answers = useMemo<PrerequisiteAnswer[]>(
    () =>
      items.flatMap((i): PrerequisiteAnswer[] => {
        const c = choices[i.key];
        if (!c || c.action === "environment") return [];
        if (c.action === "vault") return [{ key: i.key, action: "vault", secret_id: c.secret_id }];
        if (c.action === "text")
          return c.text.trim() ? [{ key: i.key, action: "text", text: c.text.trim() }] : [];
        if (c.action === "skip")
          return [
            {
              key: i.key,
              action: "skip",
              ...(c.instruction.trim() ? { instruction: c.instruction.trim() } : {}),
            },
          ];
        return [{ key: i.key, action: "defer" }];
      }),
    [items, choices],
  );

  const onStored = (item: PrerequisiteItem, secret: VaultSecret) =>
    set(item.key, { action: "vault", secret_id: secret.id, secret_name: secret.name });

  return (
    <div className="flex max-h-[88vh] flex-col">
      <DialogHeader className="border-b border-border bg-primary/5 px-6 py-4 text-left">
        <DialogTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          {decision.title ?? "Before building: what this needs from you"}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {STAGE_TEXT[decision.stage ?? "workflow"] ?? ""} Settle each item so the build uses what
          it needs — or tell it to do without. Anything you type for a credential is stored
          encrypted in the vault and never sent with this answer.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {decision.problems?.length ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="size-3.5" /> Your last answer could not be used
            </p>
            <ul className="mt-1 list-disc pl-5">
              {decision.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {decision.vault && !decision.vault.enabled ? (
          <p className="rounded-lg border border-amber/40 bg-amber/5 px-3 py-2 text-[11px] text-amber">
            The vault is switched off (Settings → Vault), so credentials cannot be stored now —
            choose “Add it later” or “Proceed without”.
          </p>
        ) : null}

        {items.map((item) => (
          <ItemCard
            key={item.key}
            item={item}
            choice={choices[item.key]}
            onChoose={(c) => set(item.key, c)}
            onEnter={() => setEntering(item)}
            vaultEntries={usable}
            vaultOn={decision.vault?.enabled !== false}
            disabled={busy}
          />
        ))}
      </div>

      <DialogFooter className="flex-wrap gap-2 border-t border-border px-6 py-3 sm:space-x-0">
        <p className="mr-auto text-[10px] text-muted-foreground">
          {open.length
            ? `${open.length} item(s) not chosen will be built without — a credential as “add it later”.`
            : "Everything is settled."}
        </p>
        <Button variant="ghost" size="sm" onClick={onLater} disabled={send.isPending}>
          Decide later
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            window.confirm(
              "Stop this build? Nothing has been created, so nothing is left behind.",
            ) && send.mutate({ choice: "cancel" })
          }
        >
          <Ban className="size-3.5" /> Stop the build
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => send.mutate({ choice: "continue", answers })}
        >
          {send.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {send.isSuccess ? "Sent — building…" : "Continue building"}
        </Button>
      </DialogFooter>

      <VaultSecretDialog
        open={entering !== null}
        onOpenChange={(o) => !o && setEntering(null)}
        preset={
          entering
            ? {
                name: entering.name,
                label: entering.label,
                kind: entering.secret_kind,
                service: entering.service,
                description: entering.why,
                formatHint: entering.format_hint,
                origin: "build",
                originRef: decision.run_id ?? runId,
              }
            : undefined
        }
        onSaved={(secret) => entering && onStored(entering, secret)}
      />
    </div>
  );
}

function Option({
  active,
  onClick,
  icon: Icon,
  label,
  detail,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof KeyRound;
  label: string;
  detail?: string | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 basis-40 items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] transition disabled:opacity-50",
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/40 hover:bg-surface-hover",
      )}
    >
      <Icon
        className={cn("mt-px size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")}
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{label}</span>
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </span>
    </button>
  );
}

function ItemCard({
  item,
  choice,
  onChoose,
  onEnter,
  vaultEntries,
  vaultOn,
  disabled,
}: {
  item: PrerequisiteItem;
  choice: Choice | undefined;
  onChoose: (c: Choice | undefined) => void;
  onEnter: () => void;
  vaultEntries: VaultSecret[];
  vaultOn: boolean;
  disabled: boolean;
}) {
  const vaultItem = inVault(item);
  const candidates = item.candidates.filter((c) => c.usable);
  const others = vaultEntries.filter((s) => !candidates.some((c) => c.id === s.id));
  const settledTone = choice
    ? "border-emerald/30"
    : item.required
      ? "border-amber/40"
      : "border-border";

  return (
    <section className={cn("rounded-xl border bg-background-elevated/40 p-3", settledTone)}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
            {choice ? (
              <CheckCircle2 className="size-3.5 text-emerald" />
            ) : (
              <AlertTriangle className="size-3.5 text-amber" />
            )}
            {item.label}
            <span className="rounded border border-border px-1 py-px text-[9px] font-normal text-muted-foreground uppercase">
              {CATEGORY_LABEL[item.category] ?? item.category}
            </span>
            {item.service ? (
              <span className="text-[10px] font-normal text-muted-foreground">
                · {item.service}
              </span>
            ) : null}
            {!item.required ? (
              <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
            ) : null}
          </p>
          {item.why ? <p className="mt-0.5 text-[11px] text-muted-foreground">{item.why}</p> : null}
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {vaultItem ? (
              <>
                Code reads it as <code className="font-mono text-foreground/80">{item.name}</code>
              </>
            ) : null}
            {item.used_by.length ? `${vaultItem ? " · " : ""}for ${item.used_by.join(", ")}` : ""}
            {item.format_hint ? ` · expected: ${item.format_hint}` : ""}
          </p>
        </div>
      </div>

      {vaultItem ? (
        <>
          {item.auto && choice?.action === "vault" ? (
            <p className="mt-2 text-[11px] text-emerald">
              Matched in the vault automatically:{" "}
              <code className="font-mono">{choice.secret_name}</code>
            </p>
          ) : null}
          {choice?.action === "environment" ? (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald">
              <ServerCog className="size-3.5" /> Supplied by the Tool Service's environment.
            </p>
          ) : null}
          <div role="radiogroup" className="mt-2 flex flex-wrap gap-1.5">
            {candidates.slice(0, 3).map((c) => (
              <Option
                key={c.id}
                active={choice?.action === "vault" && choice.secret_id === c.id}
                onClick={() => onChoose({ action: "vault", secret_id: c.id, secret_name: c.name })}
                icon={KeyRound}
                label={`Use ${c.name}`}
                detail={`${c.label}${c.service ? ` · ${c.service}` : ""} · ${c.hint}`}
                disabled={disabled}
              />
            ))}
            <Option
              active={false}
              onClick={onEnter}
              icon={Plus}
              label="Enter it now"
              detail={vaultOn ? "Stored encrypted in the vault" : "Vault is off"}
              disabled={disabled || !vaultOn}
            />
            <Option
              active={choice?.action === "defer"}
              onClick={() => onChoose({ action: "defer" })}
              icon={Clock}
              label="Add it later"
              detail={`Build now; it reports a configuration error until ${item.name} is in the vault`}
              disabled={disabled}
            />
            <Option
              active={choice?.action === "skip"}
              onClick={() =>
                onChoose({
                  action: "skip",
                  instruction: choice?.action === "skip" ? choice.instruction : "",
                })
              }
              icon={SkipForward}
              label={`Proceed without ${item.service || "it"}`}
              detail="Build it a different way"
              disabled={disabled}
            />
          </div>
          {others.length ? (
            <select
              aria-label="Use another vault entry"
              value={
                choice?.action === "vault" && others.some((o) => o.id === choice.secret_id)
                  ? choice.secret_id
                  : ""
              }
              onChange={(e) => {
                const s = others.find((o) => o.id === e.target.value);
                if (s) onChoose({ action: "vault", secret_id: s.id, secret_name: s.name });
              }}
              disabled={disabled}
              className="mt-1.5 h-8 w-full rounded-md border border-input bg-background-elevated px-2 text-[11px] text-foreground focus:outline-none"
            >
              <option value="">…or use another vault entry</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.label}
                  {s.service ? ` (${s.service})` : ""}
                </option>
              ))}
            </select>
          ) : null}
          {choice?.action === "vault" &&
          !candidates.some((c) => c.id === choice.secret_id) &&
          !item.auto ? (
            <p className="mt-1.5 text-[11px] text-emerald">
              Using <code className="font-mono">{choice.secret_name}</code> — the code will read it
              under that name.
            </p>
          ) : null}
          {choice?.action === "skip" ? (
            <SkipInstruction
              item={item}
              value={choice.instruction}
              onChange={(t) => onChoose({ action: "skip", instruction: t })}
              disabled={disabled}
            />
          ) : null}
        </>
      ) : (
        <>
          <div role="radiogroup" className="mt-2 flex flex-wrap gap-1.5">
            <Option
              active={choice?.action === "text"}
              onClick={() =>
                onChoose({
                  action: "text",
                  text: choice?.action === "text" ? choice.text : item.default,
                })
              }
              icon={MessageSquareText}
              label="Answer"
              disabled={disabled}
            />
            <Option
              active={choice?.action === "skip"}
              onClick={() => onChoose({ action: "skip", instruction: "" })}
              icon={SkipForward}
              label="Let the build assume"
              detail="It states the assumption it makes"
              disabled={disabled}
            />
          </div>
          {choice?.action === "text" ? (
            <Input
              value={choice.text}
              onChange={(e) => onChoose({ action: "text", text: e.target.value })}
              placeholder={item.default || "Your answer"}
              maxLength={2000}
              className="mt-1.5 text-xs"
              disabled={disabled}
              autoFocus
            />
          ) : null}
          {choice?.action === "skip" ? (
            <SkipInstruction
              item={item}
              value={choice.instruction}
              onChange={(t) => onChoose({ action: "skip", instruction: t })}
              disabled={disabled}
            />
          ) : null}
          <p className="mt-1 text-[10px] text-muted-foreground">
            Not a secret: this answer is kept with the build's record. Put credentials in the vault.
          </p>
        </>
      )}
    </section>
  );
}

function SkipInstruction({
  item,
  value,
  onChange,
  disabled,
}: {
  item: PrerequisiteItem;
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-1.5">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={2000}
        disabled={disabled}
        className="text-xs"
        placeholder={
          item.alternative
            ? `What should it do instead? Suggested: ${item.alternative}`
            : "What should it do instead? (optional)"
        }
      />
      {item.alternative && !value ? (
        <button
          type="button"
          onClick={() => onChange(item.alternative)}
          className="mt-0.5 text-[10px] text-primary hover:underline"
        >
          Use the suggestion
        </button>
      ) : null}
    </div>
  );
}
