/**
 * Settings → Cleanup.
 *
 * Delete what the project has accumulated — one area at a time, or all of it
 * with Complete cleanup, which returns the project to its starting point: the
 * state of a fresh install, with the built-in rules, vocabulary, template and
 * native tools seeded again. Every run needs the confirmation phrase typed.
 *
 * "This browser's data" is cleared here rather than on the server: chat
 * sessions, planner history and the other things this interface keeps in
 * localStorage. The page reloads afterwards so no in-memory store writes them
 * back; the results survive the reload in sessionStorage.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { errorMessage, QK, settingsApi, vaultToken } from "@/api";
import type { CleanupResult, CleanupTarget } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";
import { LivePercent } from "@/components/activity/LiveProgress";

/** The client-side target, listed with the server's. */
const BROWSER_ID = "browser";
const BROWSER_TARGET: CleanupTarget = {
  id: BROWSER_ID,
  title: "This browser's data",
  description:
    "Chat sessions, planner history, background-run list, workflow chats and saved run inputs, theme and panel sizes kept by this browser. Other browsers keep theirs.",
  group: "Files & history",
  remote: false,
  counts: {},
  error: null,
};
/** Kept when browser data is cleared: signing in again is not part of a reset. */
const KEEP_LOCAL = new Set(["auth_token"]);
const KEEP_SESSION = new Set(["vault_admin_token"]);
const RESULT_KEY = "cleanup_last_result";

/** What a complete cleanup leaves alone — the starting point itself. */
const KEPT = [
  "API keys and .env configuration",
  "The platform's own agents (query optimiser, ontology architect)",
  "Predefined native tools in the Tool Service",
  "Recommended rules, built-in safety rules, the shipped vocabulary and the built-in process template — seeded again",
  "Mistral's directory connectors, and the remote servers themselves",
];

interface StoredResult {
  at: number;
  results: CleanupResult[];
  browser: boolean;
}

function readStoredResult(): StoredResult | null {
  try {
    const raw = window.sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as StoredResult) : null;
  } catch {
    return null;
  }
}

function writeStoredResult(value: StoredResult | null) {
  try {
    if (value) window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(RESULT_KEY);
  } catch {
    // Results are a convenience; the cleanup itself is done.
  }
}

function browserItemCount(): number {
  try {
    return Object.keys(window.localStorage).filter((k) => !KEEP_LOCAL.has(k)).length;
  } catch {
    return 0;
  }
}

function clearBrowserData() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (!KEEP_LOCAL.has(k)) window.localStorage.removeItem(k);
    }
    for (const k of Object.keys(window.sessionStorage)) {
      if (!KEEP_SESSION.has(k)) window.sessionStorage.removeItem(k);
    }
  } catch {
    // Storage blocked: nothing was kept there to clear.
  }
}

const total = (t: CleanupTarget) => Object.values(t.counts).reduce((n, v) => n + v, 0);

export function CleanupPanel() {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: QK.cleanup(),
    queryFn: settingsApi.cleanupPreview,
    staleTime: 0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<"all" | "selected" | null>(null);
  const [lastResult, setLastResult] = useState<StoredResult | null>(null);
  const [browserCount, setBrowserCount] = useState(0);

  // Read after mount: the server render has no storage.
  useEffect(() => {
    setLastResult(readStoredResult());
    setBrowserCount(browserItemCount());
  }, []);

  const targets = useMemo(() => {
    const list = [...(preview.data?.targets ?? [])];
    const browser = { ...BROWSER_TARGET, counts: { "saved items": browserCount } };
    const at = list.findIndex((t) => t.group === BROWSER_TARGET.group);
    list.splice(at < 0 ? list.length : at + 1, 0, browser);
    return list;
  }, [preview.data, browserCount]);
  const groups = useMemo(() => {
    const map = new Map<string, CleanupTarget[]>();
    for (const t of targets) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [targets]);

  const run = useMutation({
    mutationFn: async ({ everything, ids }: { everything: boolean; ids: string[] }) => {
      const serverIds = ids.filter((id) => id !== BROWSER_ID);
      const browser = everything || ids.includes(BROWSER_ID);
      const confirm = preview.data?.confirm_phrase ?? "DELETE";
      const res =
        everything || serverIds.length
          ? await settingsApi.cleanup(
              everything ? { everything: true, confirm } : { targets: serverIds, confirm },
              vaultToken.get(),
            )
          : { results: [], ok: true };
      return { ...res, browser };
    },
    onSuccess: (res) => {
      const stored: StoredResult = { at: Date.now(), results: res.results, browser: res.browser };
      setSelected(new Set());
      setConfirming(null);
      if (res.browser) {
        clearBrowserData();
        writeStoredResult(stored);
        // In-memory stores would write their data straight back; start over.
        window.location.reload();
        return;
      }
      writeStoredResult(stored);
      setLastResult(stored);
      toast[res.ok ? "success" : "warning"](
        res.ok ? "Cleanup finished" : "Cleanup finished with problems — see the results.",
      );
      // Nearly every page's data just changed.
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleGroup = (items: CleanupTarget[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const t of items) {
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });

  if (preview.isError) {
    return <ErrorState error={preview.error} onRetry={() => preview.refetch()} />;
  }
  if (!preview.data) return <Skeleton className="h-96 rounded-2xl" />;

  const busy = preview.data.busy;
  const chosen = targets.filter((t) => selected.has(t.id));

  return (
    <div className="space-y-6">
      {lastResult ? (
        <ResultCard
          result={lastResult}
          onDismiss={() => {
            writeStoredResult(null);
            setLastResult(null);
          }}
        />
      ) : null}

      {busy.length ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber" />
          <div>
            <p className="font-medium text-foreground">
              {busy.length} run{busy.length > 1 ? "s are" : " is"} still in progress
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cleanup is refused until they finish or are stopped: {busy.slice(0, 4).join(" · ")}
              {busy.length > 4 ? ` and ${busy.length - 4} more` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Complete cleanup ── */}
      <section className="rounded-2xl border border-red/30 bg-red/5 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-red/30 bg-red/10 text-red">
            <Trash2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Complete cleanup</h3>
            <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
              Deletes everything listed below — agents, workflows, tools, conversations, libraries,
              the knowledge graph, uploaded images, rules, vault entries, history and settings — and
              returns the project to its starting point. This cannot be undone.
            </p>
            <div className="mt-3 rounded-xl border border-border/50 bg-background/60 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                <ShieldCheck className="size-3.5 text-emerald" /> Kept
              </p>
              <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-xs text-foreground/85 md:grid-cols-2">
                {KEPT.map((k) => (
                  <li key={k} className="flex gap-1.5">
                    <span className="text-emerald">·</span>
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Button
            variant="destructive"
            disabled={run.isPending || busy.length > 0}
            onClick={() => setConfirming("all")}
          >
            <Trash2 className="size-4" />
            Complete cleanup…
          </Button>
        </div>
      </section>

      {/* ── Choose ── */}
      <section
        className="rounded-2xl border border-border/60 backdrop-blur-md"
        style={{ background: "var(--surface)" }}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border/40 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Choose what to delete</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick the areas to clear. Counts are what each holds now.{" "}
              <span className="inline-flex items-center gap-1">
                <Cloud className="size-3" /> marks areas deleted on Mistral too.
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBrowserCount(browserItemCount());
              void preview.refetch();
            }}
            disabled={preview.isFetching}
          >
            <RefreshCw className={cn("size-3.5", preview.isFetching && "animate-spin")} />
            Recount
          </Button>
        </header>

        <div className="space-y-5 p-4 sm:p-5">
          {groups.map(([group, items]) => {
            const all = items.every((t) => selected.has(t.id));
            return (
              <div key={group}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {group}
                  </p>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => toggleGroup(items, !all)}
                  >
                    {all ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="grid gap-2 xl:grid-cols-2">
                  {items.map((t) => (
                    <TargetRow
                      key={t.id}
                      target={t}
                      checked={selected.has(t.id)}
                      onChange={(on) => toggle(t.id, on)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {chosen.length
              ? `${chosen.length} area${chosen.length > 1 ? "s" : ""} selected`
              : "Nothing selected"}
          </p>
          <div className="flex gap-2">
            {chosen.length ? (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              disabled={!chosen.length || run.isPending || busy.length > 0}
              onClick={() => setConfirming("selected")}
            >
              <Trash2 className="size-3.5" />
              Delete selected…
            </Button>
          </div>
        </footer>
      </section>

      <ConfirmDialog
        mode={confirming}
        targets={confirming === "all" ? targets : chosen}
        phrase={preview.data.confirm_phrase}
        pending={run.isPending}
        onCancel={() => !run.isPending && setConfirming(null)}
        onConfirm={() =>
          run.mutate({ everything: confirming === "all", ids: chosen.map((t) => t.id) })
        }
      />
    </div>
  );
}

function TargetRow({
  target,
  checked,
  onChange,
}: {
  target: CleanupTarget;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const n = total(target);
  const Icon = target.id === BROWSER_ID ? MonitorSmartphone : null;
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border p-3 transition",
        checked
          ? "border-red/40 bg-red/5"
          : "border-border/50 bg-background-elevated/40 hover:border-border",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
          <span className="text-sm font-medium text-foreground">{target.title}</span>
          {target.remote ? (
            <span
              className="inline-flex items-center gap-1 rounded border border-blue/30 bg-blue/10 px-1.5 py-px text-[10px] text-blue"
              title="Deleted on Mistral too"
            >
              <Cloud className="size-3" /> Mistral
            </span>
          ) : null}
          {!target.error && n === 0 ? (
            <span className="text-[10.5px] text-muted-foreground">· empty</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{target.description}</p>
        {target.error ? (
          <p className="mt-1.5 text-[11px] text-amber">Couldn’t count: {target.error}</p>
        ) : n > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(target.counts)
              .filter(([, v]) => v > 0)
              .map(([label, v]) => (
                <span
                  key={label}
                  className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5 text-[10.5px] text-foreground/85"
                >
                  <span className="font-mono">{v}</span> {label}
                </span>
              ))}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function ConfirmDialog({
  mode,
  targets,
  phrase,
  pending,
  onCancel,
  onConfirm,
}: {
  mode: "all" | "selected" | null;
  targets: CleanupTarget[];
  phrase: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [mode]);
  const ready = typed.trim() === phrase;
  const remote = targets.some((t) => t.remote);

  return (
    <Dialog open={mode != null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-red" />
            {mode === "all" ? "Delete everything?" : `Delete ${targets.length} area(s)?`}
          </DialogTitle>
          <DialogDescription>
            {mode === "all"
              ? "The project goes back to its starting point. Nothing deleted can be recovered."
              : "Everything in these areas is deleted. Nothing deleted can be recovered."}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border/50 bg-background-elevated/40 p-3 text-xs">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{t.title}</span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {t.error ? "?" : total(t)}
              </span>
            </li>
          ))}
        </ul>
        {remote ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Cloud className="mt-px size-3.5 shrink-0 text-blue" />
            Agents, conversations, connectors and libraries are deleted from your Mistral workspace;
            workflows there are archived.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="cleanup-confirm" className="text-xs text-muted-foreground">
            Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to
            confirm
          </label>
          <Input
            id="cleanup-confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ready && !pending && onConfirm()}
            disabled={pending}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!ready || pending} onClick={onConfirm}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <LivePercent />
              </>
            ) : (
              <Trash2 className="size-4" />
            )}
            {pending ? "Deleting…" : mode === "all" ? "Delete everything" : "Delete"}
          </Button>
        </DialogFooter>
        {pending ? (
          <p className="text-center text-[11px] text-muted-foreground">
            This can take a few minutes with many agents or conversations. Keep this tab open.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResultCard({ result, onDismiss }: { result: StoredResult; onDismiss: () => void }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <section
      className={cn(
        "rounded-2xl border p-5",
        failed.length ? "border-amber/30 bg-amber/5" : "border-emerald/30 bg-emerald/5",
      )}
    >
      <header className="flex flex-wrap items-start gap-3">
        {failed.length ? (
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {failed.length
              ? `Cleanup finished — ${failed.length} area(s) need attention`
              : "Cleanup finished"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(result.at).toLocaleString()}
            {result.browser ? " · this browser's data cleared" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </header>
      {result.results.length ? (
        <ul className="mt-3 divide-y divide-border/40 rounded-xl border border-border/50 bg-background/60 text-xs">
          {result.results.map((r) => {
            const removed = Object.entries(r.removed).filter(([, v]) => v > 0);
            return (
              <li key={r.id} className="flex gap-2.5 px-3 py-2">
                {r.ok ? (
                  <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald" />
                ) : (
                  <XCircle className="mt-px size-3.5 shrink-0 text-red" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.seconds}s
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {removed.length
                      ? removed.map(([k, v]) => `${v} ${k}`).join(" · ")
                      : "Nothing to delete"}
                  </p>
                  {r.errors.map((e) => (
                    <p key={e} className="mt-0.5 font-mono text-[10.5px] break-words text-red">
                      {e}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {failed.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Fix what stopped them (for example, start the Tool Service), then run the cleanup again
          for those areas.
        </p>
      ) : null}
    </section>
  );
}
