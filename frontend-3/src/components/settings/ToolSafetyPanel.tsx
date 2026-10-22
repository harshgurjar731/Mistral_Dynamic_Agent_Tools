/**
 * Settings → Tool safety.
 *
 * One grid: a row per rule, a column per place a rule can apply. Each row has
 * an on/off switch and a strictness; each cell says whether the rule applies at
 * that place. Columns are grouped by what applying means there — guiding the AI
 * while it designs, or screening a request before code is built.
 *
 * Everything ships off: until a rule is switched on, no rule applies anywhere.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Edit2, Info, Loader2, Plus, PowerOff, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { errorMessage, QK, safetyApi } from "@/api";
import type {
  SafetyPayload,
  SafetyPoint,
  SafetyRule,
  SafetyRuleInput,
  Strictness,
} from "@/api/safety";
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
import { cn } from "@/lib/utils";

const STRICTNESS_ORDER: Strictness[] = ["advise", "standard", "strict"];

function StrictnessPicker({
  value,
  onChange,
  disabled,
}: {
  value: Strictness;
  onChange: (s: Strictness) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Strictness"
      className={cn(
        "inline-flex rounded-lg border border-border/60 bg-background-elevated p-0.5",
        disabled && "opacity-50",
      )}
    >
      {STRICTNESS_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] capitalize transition",
            value === s
              ? s === "strict"
                ? "bg-red/15 font-medium text-red"
                : s === "standard"
                  ? "bg-amber/15 font-medium text-amber"
                  : "bg-blue/15 font-medium text-blue"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function ToolSafetyPanel() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: QK.safetyRules(), queryFn: safetyApi.list });
  const [editing, setEditing] = useState<SafetyRule | "new" | null>(null);

  const set = (payload: SafetyPayload) => qc.setQueryData(QK.safetyRules(), payload);
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SafetyRuleInput> }) =>
      safetyApi.update(id, body),
    // Optimistic: a toggle in a grid should not wait for the network.
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: QK.safetyRules() });
      const before = qc.getQueryData<SafetyPayload>(QK.safetyRules());
      if (before) {
        set({ ...before, rules: before.rules.map((r) => (r.id === id ? { ...r, ...body } : r)) });
      }
      return { before };
    },
    onError: (e, _v, context) => {
      if (context?.before) set(context.before);
      toast.error(errorMessage(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: QK.safetyRules() }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => safetyApi.remove(id),
    onSuccess: () => {
      toast.success("Rule deleted.");
      void qc.invalidateQueries({ queryKey: QK.safetyRules() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const allOff = useMutation({
    mutationFn: safetyApi.turnAllOff,
    onSuccess: (r) => {
      set(r);
      toast.success(`${r.turned_off} rule(s) switched off. No rule applies anywhere now.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  if (!data.data) return <Skeleton className="h-96 rounded-2xl" />;

  const { rules, points, strictness, summary } = data.data;
  const guidance = points.filter((p) => p.kind === "guidance");
  const screens = points.filter((p) => p.kind === "screen");
  const cols = [...guidance, ...screens];
  const anyOn = summary.active_rules > 0;

  const togglePoint = (rule: SafetyRule, point: SafetyPoint) => {
    const next = rule.applies_to.includes(point.key)
      ? rule.applies_to.filter((p) => p !== point.key)
      : [...rule.applies_to, point.key];
    update.mutate({ id: rule.id, body: { applies_to: next } });
  };

  return (
    <section
      id="section-backend-tool_safety"
      className="overflow-hidden rounded-2xl border border-border/60"
      style={{ background: "var(--surface)" }}
    >
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="size-4 text-primary" /> Tool safety rules
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            What the AI may not design, request or build as a tool. Switch a rule on, choose how
            strict it is, and tick where it applies. Code a tool runs is always sandboxed and
            checked regardless — these rules decide which tools get designed and built at all.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Add rule
        </Button>
      </header>

      {/* ── Status ── */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border-b border-border/50 px-5 py-3 text-xs",
          anyOn ? "bg-primary/5" : "bg-background-elevated/40",
        )}
      >
        {anyOn ? (
          <>
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-foreground">
              {summary.active_rules} rule{summary.active_rules === 1 ? "" : "s"} on, applied in{" "}
              {summary.points_in_use.length} of {points.length} places.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7"
              disabled={allOff.isPending}
              onClick={() =>
                window.confirm("Switch every rule off? No rule will apply anywhere.") &&
                allOff.mutate()
              }
            >
              <PowerOff className="size-3.5" /> Turn all off
            </Button>
          </>
        ) : (
          <>
            <ShieldOff className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Off — no rule is applied anywhere. Tools are designed and built without these checks.
            </span>
          </>
        )}
      </div>

      {/* ── What strictness means ── */}
      <details className="group border-b border-border/50">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-[11px] text-muted-foreground hover:text-foreground">
          <Info className="size-3.5" /> What each strictness does
        </summary>
        <div className="grid gap-2 px-5 pb-4 sm:grid-cols-3">
          {strictness.map((s) => (
            <div key={s.key} className="rounded-lg border border-border/60 p-3 text-[11px]">
              <p className="font-semibold text-foreground">{s.label}</p>
              <p className="mt-1 text-muted-foreground">
                <span className="text-foreground/80">Guiding the AI:</span> {s.guidance}.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                <span className="text-foreground/80">Screening a build:</span> {s.screen}.
              </p>
            </div>
          ))}
        </div>
      </details>

      {/* ── The grid ── */}
      <div className="custom-scrollbar overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase">
              <th className="px-4 pt-3 text-left font-semibold tracking-wider" rowSpan={2}>
                Rule
              </th>
              <th className="px-2 pt-3 text-left font-semibold tracking-wider" rowSpan={2}>
                On
              </th>
              <th className="px-2 pt-3 text-left font-semibold tracking-wider" rowSpan={2}>
                Strictness
              </th>
              <th
                colSpan={guidance.length}
                className="border-l border-border/50 px-2 pt-3 text-center font-semibold tracking-wider"
              >
                Guides the AI when…
              </th>
              <th
                colSpan={screens.length}
                className="border-l border-border/50 px-2 pt-3 text-center font-semibold tracking-wider"
              >
                Screens a request…
              </th>
              <th rowSpan={2} />
            </tr>
            <tr className="border-b border-border/50 text-[10px] text-muted-foreground">
              {cols.map((p, i) => (
                <th
                  key={p.key}
                  title={p.detail}
                  className={cn(
                    "max-w-[7.5rem] px-2 pt-1 pb-2 text-center font-normal leading-tight normal-case",
                    (i === 0 || i === guidance.length) && "border-l border-border/50",
                  )}
                >
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-border/40 align-top transition-colors",
                  r.enabled ? "bg-background/40" : "",
                )}
              >
                <td className="max-w-[22rem] px-4 py-3">
                  <p
                    className={cn(
                      "font-medium",
                      r.enabled ? "text-foreground" : "text-foreground/70",
                    )}
                  >
                    {r.title}
                    {!r.builtin ? (
                      <span className="ml-1.5 rounded bg-primary/10 px-1 text-[9px] font-semibold text-primary uppercase">
                        yours
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Never design or request a tool that{" "}
                    {r.rule.charAt(0).toLowerCase() + r.rule.slice(1)}
                  </p>
                </td>
                <td className="px-2 py-3">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(on) => update.mutate({ id: r.id, body: { enabled: on } })}
                    aria-label={`${r.enabled ? "Turn off" : "Turn on"} ${r.title}`}
                  />
                </td>
                <td className="px-2 py-3">
                  <StrictnessPicker
                    value={r.strictness}
                    disabled={!r.enabled}
                    onChange={(s) => update.mutate({ id: r.id, body: { strictness: s } })}
                  />
                </td>
                {cols.map((p, i) => {
                  const on = r.applies_to.includes(p.key);
                  return (
                    <td
                      key={p.key}
                      className={cn(
                        "px-2 py-3 text-center",
                        (i === 0 || i === guidance.length) && "border-l border-border/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => togglePoint(r, p)}
                        aria-label={`${r.title} — ${p.label}`}
                        title={
                          r.enabled
                            ? p.detail
                            : `${p.detail} (takes effect once the rule is switched on)`
                        }
                        className={cn(
                          "size-3.5 cursor-pointer accent-[var(--primary)]",
                          !r.enabled && "opacity-40",
                        )}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {!r.builtin ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${r.title}`}
                        onClick={() => setEditing(r)}
                        className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${r.title}`}
                        onClick={() =>
                          window.confirm(`Delete the rule “${r.title}”?`) && remove.mutate(r.id)
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-red/10 hover:text-red"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RuleDialog
        target={editing}
        points={points}
        onClose={() => setEditing(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: QK.safetyRules() })}
      />
    </section>
  );
}

function RuleDialog({
  target,
  points,
  onClose,
  onSaved,
}: {
  target: SafetyRule | "new" | null;
  points: SafetyPoint[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target && target !== "new" ? target : null;
  const [form, setForm] = useState<SafetyRuleInput | null>(null);
  const [lastTarget, setLastTarget] = useState<typeof target>(null);
  if (target !== lastTarget) {
    setLastTarget(target);
    setForm(
      target
        ? editing
          ? {
              title: editing.title,
              rule: editing.rule,
              strictness: editing.strictness,
              applies_to: editing.applies_to,
              enabled: editing.enabled,
            }
          : {
              title: "",
              rule: "",
              strictness: "standard",
              applies_to: points.map((p) => p.key),
              enabled: false,
            }
        : null,
    );
  }

  const save = useMutation({
    mutationFn: () => (editing ? safetyApi.update(editing.id, form!) : safetyApi.create(form!)),
    onSuccess: (r) => {
      toast.success(
        editing
          ? "Rule saved."
          : r.enabled
            ? `“${r.title}” added and on.`
            : `“${r.title}” added — switch it on when you want it applied.`,
      );
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!form) return null;
  const toggle = (key: string) =>
    setForm({
      ...form,
      applies_to: form.applies_to.includes(key)
        ? form.applies_to.filter((p) => p !== key)
        : [...form.applies_to, key],
    });
  const group = (kind: "guidance" | "screen", title: string) => (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-foreground">{title}</p>
      <div className="space-y-1">
        {points
          .filter((p) => p.kind === kind)
          .map((p) => (
            <label key={p.key} className="flex cursor-pointer items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={form.applies_to.includes(p.key)}
                onChange={() => toggle(p.key)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                <span className="text-foreground">{p.label}</span>
                <span className="block text-muted-foreground">{p.detail}</span>
              </span>
            </label>
          ))}
      </div>
    </div>
  );

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{editing ? "Edit rule" : "Add a rule"}</DialogTitle>
          <DialogDescription className="text-xs">
            Describe a kind of tool the AI must not design or build.
          </DialogDescription>
        </DialogHeader>
        <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="rule-title" className="text-xs">
              Title
            </Label>
            <Input
              id="rule-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. No paid third-party APIs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-text" className="text-xs">
              Never design or request a tool that…
            </Label>
            <Textarea
              id="rule-text"
              rows={3}
              value={form.rule}
              onChange={(e) => setForm({ ...form, rule: e.target.value })}
              placeholder="e.g. calls a paid third-party API without a configured budget."
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Describe what the tool would do, not the data it handles — a tool that validates
              untrusted text is fine; one that executes it is not.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Strictness</Label>
            <div>
              <StrictnessPicker
                value={form.strictness}
                onChange={(s) => setForm({ ...form, strictness: s })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {group("guidance", "Guides the AI when…")}
            {group("screen", "Screens a request…")}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={form.enabled}
              onCheckedChange={(on) => setForm({ ...form, enabled: on })}
            />
            <span>
              {form.enabled ? "On — applies straight away" : "Off — saved, not applied yet"}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              form.title.trim().length < 3 || form.rule.trim().length < 10 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {editing ? "Save" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
