/**
 * Decision cards shared by the agent orchestrator and the workflow planner.
 *
 * Each one renders the evidence a single layer produced, and is attached to that
 * layer's row in the PipelineTimeline so the reasoning sits beside the decision.
 */
import { AlertCircle, FolderPlus, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import type { RuleOutcome, RuleSuggestion } from "@/types";
import { OutcomePill } from "@/components/rules/RulePills";
import { cn } from "@/lib/utils";

/** Why a layer decided what it decided. Most decision events carry one. */
export function Rationale({ text }: { text?: unknown }) {
  if (!text || typeof text !== "string") return null;
  return (
    <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground italic">
      {text}
    </p>
  );
}

/* ── Moderation guardrail ──────────────────────────────────────────────── */

export interface GuardrailView {
  enabled?: boolean;
  version?: string;
  action?: string;
  block_on_error?: boolean;
  ignore_other_categories?: boolean;
  max_tool_rounds?: number;
  thresholds?: Array<{ category: string; threshold: number }>;
  rationale?: string;
}

/**
 * Lower threshold = stricter; a score above the threshold is a violation.
 * 1.0 is special — Mistral treats it as "category disabled", which is how an
 * agent is exempted from the topic category that is its own subject.
 */
function bandFor(t: number): { bar: string; text: string; word: string } {
  if (t >= 1) return { bar: "bg-border", text: "text-muted-foreground", word: "disabled" };
  if (t <= 0.3) return { bar: "bg-red", text: "text-red", word: "strict" };
  if (t <= 0.6) return { bar: "bg-amber", text: "text-amber", word: "moderate" };
  return { bar: "bg-emerald", text: "text-emerald", word: "permissive" };
}

/**
 * The platform's moderation configuration for one agent. Not instruction text:
 * Mistral scores every turn against these categories outside the model, so it
 * holds regardless of what the agent was told.
 */
export function ModerationGuardrailCard({
  data,
  compact = false,
}: {
  data: GuardrailView;
  compact?: boolean;
}) {
  const thresholds = data.thresholds ?? [];

  if (!data.enabled) {
    return (
      <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-border bg-background-elevated/40 p-3.5 text-xs">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-semibold text-foreground">No moderation guardrail</p>
          <p className="mt-0.5 leading-relaxed text-muted-foreground">
            {data.rationale ||
              "This agent holds no tools, integrations or documents and its subject matter carries no moderation risk."}
          </p>
          {data.max_tool_rounds !== undefined ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Tool-call budget: <strong className="text-foreground">{data.max_tool_rounds}</strong>{" "}
              rounds
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border border-emerald/25 bg-emerald/5 text-xs",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Shield className="size-3.5 text-emerald" />
        <span className="font-semibold text-foreground">Moderation guardrail</span>
        <span className="font-mono text-[9px] tracking-wider text-emerald/80 uppercase">
          {data.version ?? "v2"}
        </span>
        <span
          className={cn(
            "ml-auto rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase",
            data.action === "block"
              ? "border-red/25 bg-red/10 text-red"
              : "border-border text-muted-foreground",
          )}
        >
          {data.action === "block" ? "blocks the turn" : "scores only"}
        </span>
      </div>

      <p className="mb-3 text-[10px] leading-relaxed text-muted-foreground">
        Enforced by Mistral outside the model — not written into the agent's instructions.
      </p>

      {thresholds.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          {thresholds.map((t) => {
            const band = bandFor(t.threshold);
            return (
              <div key={t.category} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate font-mono text-[11px] text-foreground">
                  {t.category}
                </span>
                <div className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-full bg-border/60">
                  <div
                    className={cn("h-full rounded-full", band.bar)}
                    style={{ width: `${Math.max(4, (1 - t.threshold) * 100)}%` }}
                  />
                </div>
                <span
                  className={cn("w-8 text-right font-mono text-[10px] tabular-nums", band.text)}
                >
                  {t.threshold.toFixed(2)}
                </span>
                <span className="w-16 text-[9px] tracking-wider text-muted-foreground uppercase">
                  {band.word}
                </span>
              </div>
            );
          })}
          <p className="pt-0.5 text-[9px] text-muted-foreground">
            Lower is stricter; 1.00 disables a category. Anything not listed keeps the model's own
            default rather than being skipped.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
        <span>
          Tool rounds: <strong className="text-foreground">{data.max_tool_rounds ?? 5}</strong>
        </span>
        <span>
          On moderation error:{" "}
          <strong className="text-foreground">{data.block_on_error ? "block" : "allow"}</strong>
        </span>
        {data.ignore_other_categories ? <span>Other categories ignored</span> : null}
      </div>

      {data.rationale ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground italic">
          {data.rationale}
        </p>
      ) : null}
    </div>
  );
}

/* ── Document library provisioned ──────────────────────────────────────── */

export interface LibraryProvisionedView {
  created?: boolean;
  name?: string;
  description?: string;
  library_id?: string;
  capability?: string;
  error?: string;
}

/**
 * An empty document library created for a new agent. Shown because the agent
 * is wired to something with no content yet — filling it is the next step, or
 * the agent will look broken when it finds nothing to cite.
 */
export function LibraryProvisionedCard({ data }: { data: LibraryProvisionedView }) {
  if (data.created === false) {
    return (
      <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-amber/25 bg-amber/5 p-3.5 text-xs">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber" />
        <div>
          <p className="font-semibold text-amber">Could not create “{data.name}”</p>
          <p className="mt-0.5 text-muted-foreground">
            {data.error} — the agent was created without it and will answer from general knowledge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-xl border border-cyan/25 bg-cyan/5 p-3.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <FolderPlus className="size-3.5 text-cyan" />
        <span className="font-semibold text-foreground">{data.name}</span>
        {data.capability ? (
          <span className="font-mono text-[10px] text-muted-foreground">for {data.capability}</span>
        ) : null}
        <span className="ml-auto rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-amber uppercase">
          new · empty
        </span>
      </div>
      {data.description ? <p className="mt-1.5 text-muted-foreground">{data.description}</p> : null}
      <p className="mt-2 leading-relaxed text-muted-foreground">
        No existing library covered this subject, so one was created and attached. Upload documents
        to it and the agent will start using them — no changes needed.
      </p>
      {data.library_id ? (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">{data.library_id}</p>
      ) : null}
    </div>
  );
}

/* ── Rules ─────────────────────────────────────────────────────────────── */

export interface RulesSelectedView {
  agent_name?: string;
  selected?: RuleSuggestion[];
  always_on?: { rule_id: string; name: string }[];
  reasoning?: string;
}

/** Which optional rules were chosen, and which always apply. */
export function RulesSelectedCard({ data }: { data: RulesSelectedView }) {
  const selected = data.selected ?? [];
  const alwaysOn = data.always_on ?? [];
  return (
    <div className="mt-2.5 rounded-xl border border-purple/25 bg-purple/5 p-3.5 text-xs">
      {data.agent_name ? (
        <p className="mb-2 font-semibold text-foreground">{data.agent_name}</p>
      ) : null}
      {selected.length ? (
        <ul className="space-y-1.5">
          {selected.map((s) => (
            <li key={s.rule_id} className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-purple" />
              <span className="min-w-0">
                <span className="font-medium text-foreground">{s.name ?? s.rule_id}</span>
                {s.reason ? <span className="text-muted-foreground"> — {s.reason}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No optional rules chosen.</p>
      )}
      {alwaysOn.length ? (
        <p className="mt-2 text-muted-foreground">
          Always on: {alwaysOn.map((r) => r.name).join(", ")}
        </p>
      ) : null}
      <Rationale text={data.reasoning} />
    </div>
  );
}

/** What the rules decided — at creation or on an answer. */
export function RuleOutcomesCard({ outcomes, title }: { outcomes: RuleOutcome[]; title?: string }) {
  if (!outcomes.length) return null;
  return (
    <div className="mt-2.5 rounded-xl border border-purple/25 bg-purple/5 p-3.5 text-xs">
      {title ? <p className="eyebrow mb-2">{title}</p> : null}
      <ul className="space-y-1">
        {outcomes.map((o) => (
          <li key={`${o.rule_id}-${o.checkpoint ?? ""}`} className="flex items-start gap-2">
            <OutcomePill outcome={o.outcome} />
            <span className="text-muted-foreground">
              <span className="text-foreground">{o.name}</span> — {o.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
