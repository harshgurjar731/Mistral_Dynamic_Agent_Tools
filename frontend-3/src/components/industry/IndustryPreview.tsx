/**
 * Planning preview — exactly what a plan with this goal would be given: the
 * matched industry, the ranked items, the block each decision reads and what
 * a tool or activity's code generator receives.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Code2, Loader2, Play } from "lucide-react";
import { errorMessage, industryApi } from "@/api";
import type { IndustryPreview } from "@/api/industry";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NodeSelect, type TreeIndex } from "./IndustryTree";
import { CATEGORY, FORCE, forceOf, RELATION, SELECT_CLASS } from "./labels";

/** The planning decisions, in the order a workflow plan reaches them. */
const VIEW_LABEL: Record<string, string> = {
  decomposition: "Goal decomposition",
  execution_mode: "Agent or activity",
  agent_archetype: "Agent type",
  data_flow: "Data contract and wiring",
  design: "Agent design",
  agent_instructions: "Agent instructions",
  agent_identity: "Agent name",
  agent_tools: "Tool choice",
  agent_connectors: "Connector choice",
  agent_libraries: "Library choice",
  topology: "Step graph",
  oversight: "Human oversight",
  guardrail: "Workflow guardrails",
  agent_guardrail: "Agent guardrails",
  rules: "Workflow rules",
  agent_rules: "Agent rules",
  revision: "Refine with AI",
  code: "Tool and activity code",
};
const VIEW_ORDER = Object.keys(VIEW_LABEL);

export function IndustryPreviewPanel({
  index,
  defaultNode,
}: {
  index: TreeIndex;
  defaultNode: string | null;
}) {
  const [goal, setGoal] = useState("");
  const [node, setNode] = useState(defaultNode ?? "");
  const [codePurpose, setCodePurpose] = useState("");
  const [includeProposed, setIncludeProposed] = useState(false);
  const [view, setView] = useState("decomposition");

  const run = useMutation({
    mutationFn: () =>
      industryApi.preview({
        goal: goal.trim(),
        ...(node ? { concept_ids: [node] } : {}),
        include_proposed: includeProposed,
        ...(codePurpose.trim() ? { code_purpose: codePurpose.trim() } : {}),
      }),
    onSuccess: (r) => {
      const views = VIEW_ORDER.filter((v) => r.views[v]?.length && v !== "code");
      const first = views[0];
      if (first && !r.views[view]?.length) setView(first);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const data: IndustryPreview | undefined = run.data;
  const views = useMemo(
    () => (data ? VIEW_ORDER.filter((v) => v !== "code" && data.views[v]?.length) : []),
    [data],
  );

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (goal.trim()) run.mutate();
        }}
        className="space-y-2.5 rounded-xl border border-border/60 bg-surface/30 p-3"
      >
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="A goal, as someone would ask the planner — e.g. assess a UK remortgage application"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Scope:</span>
          <NodeSelect index={index} value={node} onChange={setNode} />
          {node ? (
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => setNode("")}
            >
              match from the goal instead
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              empty: matched from the goal, as planning does
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={codePurpose}
            onChange={(e) => setCodePurpose(e.target.value)}
            placeholder="Optional: what a tool or activity does, to see what its code is given"
            className="h-8 max-w-md text-xs"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeProposed}
              onChange={(e) => setIncludeProposed(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Include items waiting for review
          </label>
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={!goal.trim() || run.isPending}
          >
            {run.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Preview
          </Button>
        </div>
      </form>

      {!data ? (
        <p className="text-xs text-muted-foreground">
          Runs the same scoping and ranking a plan does, without planning anything. Use it to check
          that a regulation reaches the decisions it should before you rely on it.
        </p>
      ) : data.items.length === 0 ? (
        <EmptyState
          title={data.domains.length ? "No approved knowledge in scope." : "No industry matched."}
          description={
            data.domains.length
              ? `Scoped to ${data.domains.map((d) => d.path).join("; ")} — nothing is filed there or above it yet.`
              : "Choose a scope, or name the industry in the goal."
          }
        />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Scoped to{" "}
            <span className="font-medium text-foreground">
              {data.domains.map((d) => d.path).join("; ")}
            </span>{" "}
            ({data.scope_source}) · {data.items.length} item(s) ·{" "}
            {data.embedding_used
              ? "ranked by meaning and words"
              : "ranked by words (no embeddings)"}
            {data.mode === "off" ? (
              <span className="text-amber">
                {" "}
                · Industry knowledge is off in Settings, so plans do not use this now.
              </span>
            ) : null}
          </p>

          <ol className="space-y-1">
            {data.items.map((i, n) => {
              const force = forceOf(i.strength);
              return (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background-elevated/60 px-2.5 py-1.5 text-xs"
                >
                  <span className="w-5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {n + 1}
                  </span>
                  <span
                    className={cn("rounded border px-1 text-[9px] font-medium", FORCE[force].tone)}
                  >
                    {FORCE[force].label}
                  </span>
                  <span
                    className={cn("rounded border px-1 text-[9px]", CATEGORY[i.category]?.tone)}
                  >
                    {CATEGORY[i.category]?.label ?? i.category}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {i.title}
                  </span>
                  <span className="font-mono text-[10px] text-cyan">{i.path}</span>
                  {i.relation ? (
                    <span className="technical-label">{RELATION[i.relation]}</span>
                  ) : null}
                  <span className="technical-label">score {i.score.toFixed(1)}</span>
                </li>
              );
            })}
          </ol>

          {views.length ? (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <p className="eyebrow">Exactly what this decision is shown</p>
                <select
                  className={SELECT_CLASS}
                  value={view}
                  onChange={(e) => setView(e.target.value)}
                >
                  {views.map((v) => (
                    <option key={v} value={v}>
                      {VIEW_LABEL[v]} ({data.views[v]?.length ?? 0})
                    </option>
                  ))}
                </select>
              </div>
              <pre className="custom-scrollbar max-h-80 overflow-auto rounded-lg border border-border bg-background-elevated p-3 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                {data.rendered[view]}
              </pre>
            </div>
          ) : null}

          <div>
            <p className="eyebrow mb-1.5 flex items-center gap-1.5">
              <Code2 className="size-3.5" /> What a tool or activity&apos;s code is given
            </p>
            {data.code_items.length ? (
              <pre className="custom-scrollbar max-h-64 overflow-auto rounded-lg border border-border bg-background-elevated p-3 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                {data.code_rendered}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nothing — no rule, metric, standard or regulation in scope matches what the code
                does.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
