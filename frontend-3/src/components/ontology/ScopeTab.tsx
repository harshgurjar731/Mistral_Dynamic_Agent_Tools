import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, Loader2, Sparkles } from "lucide-react";
import { errorMessage, ontologyApi, QK } from "@/api";
import type { ClassificationResult } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GraphCanvas, type SimpleEdge, type SimpleNode } from "./GraphCanvas";

/**
 * Two rehearsals of the same machinery the planner uses: what a goal narrows
 * the ontology down to, and how a resource description gets classified.
 */
export function ScopeTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ScopePanel />
      <ClassifyPanel />
    </div>
  );
}

function ScopePanel() {
  const [goal, setGoal] = useState("");
  const [submitted, setSubmitted] = useState("");

  const scope = useQuery({
    queryKey: QK.scope(submitted),
    queryFn: () => ontologyApi.scope(submitted),
    enabled: submitted.length > 0,
  });

  const graph = useQuery({
    queryKey: QK.scopeGraph(submitted),
    queryFn: () => ontologyApi.scopeGraph(submitted),
    enabled: submitted.length > 0,
  });

  const nodes: SimpleNode[] = (graph.data?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: n.kind,
    tone:
      n.kind === "scheme"
        ? "purple"
        : n.kind === "concept"
          ? "indigo"
          : n.kind === "agent"
            ? "emerald"
            : "cyan",
  }));
  const edges: SimpleEdge[] = (graph.data?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    dashed: e.reveal === "reverse",
  }));

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Goal scoping"
        description="What the planner narrows to before it picks agents."
      />
      <div className="space-y-3 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(goal.trim());
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="e.g. settle a commercial property claim"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <Button type="submit" disabled={!goal.trim()}>
            <Crosshair className="size-4" /> Scope
          </Button>
        </form>

        {!submitted ? (
          <EmptyState
            title="Nothing scoped yet."
            description="Enter a goal to see which domains it matches and how strongly."
            className="py-10"
          />
        ) : scope.isLoading ? (
          <p className="technical-label">Scoping…</p>
        ) : scope.isError ? (
          <ErrorState error={scope.error} onRetry={() => scope.refetch()} />
        ) : scope.data ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-background-elevated/60 p-3">
              <p className="eyebrow mb-1">Result</p>
              <p className="text-sm text-foreground">
                {scope.data.scoped
                  ? scope.data.label
                  : "No domain matched — planning stays global."}
              </p>
              {scope.data.domains.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {scope.data.domains.map((d) => (
                    <span
                      key={d}
                      className="rounded border border-indigo/30 bg-indigo/10 px-2 py-0.5 font-mono text-[10px] text-indigo"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {scope.data.scores.length > 0 ? (
              <div>
                <p className="eyebrow mb-1.5">Match strength</p>
                <ul className="space-y-1">
                  {scope.data.scores.slice(0, 8).map(([id, score]) => (
                    <li key={id} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                        {id}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                        <span
                          className="block h-full bg-gradient-brand"
                          style={{ width: `${Math.min(100, Math.round(score * 100))}%` }}
                        />
                      </span>
                      <span className="technical-label w-10 text-right">{score.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {nodes.length > 0 ? (
              <div>
                <p className="eyebrow mb-1.5">Scoped subgraph</p>
                <GraphCanvas nodes={nodes} edges={edges} className="h-80" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}

function ClassifyPanel() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [result, setResult] = useState<ClassificationResult | null>(null);

  const classify = useMutation({
    mutationFn: () =>
      ontologyApi.classify({
        name,
        description,
        instructions,
        subject_kind: "agent",
      }),
    onSuccess: (r) => {
      setResult(r.result);
      toast.success(r.classified ? "Classified." : "Nothing matched the vocabulary.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Classifier rehearsal"
        description="How a description maps onto the vocabulary — no annotation is written."
      />
      <div className="space-y-3 p-4">
        <div>
          <label className="eyebrow mb-1.5 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Description</label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Instructions</label>
          <Textarea
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>
        <Button
          onClick={() => classify.mutate()}
          disabled={classify.isPending || !name.trim()}
          className="w-full"
        >
          {classify.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Classify
        </Button>

        {result ? (
          <div className="space-y-2.5 border-t border-border pt-3">
            <ConceptRow label="Tier" values={result.tier ? [result.tier] : []} tone="amber" />
            <ConceptRow label="Domains" values={result.domains} tone="indigo" />
            <ConceptRow label="Requires" values={result.requires_capability} tone="cyan" />
            <ConceptRow label="Provides" values={result.provides_capability} tone="emerald" />
            <ConceptRow label="Data classes" values={result.data_classes} tone="purple" />
            {result.reasoning ? (
              <div>
                <p className="eyebrow mb-1">Reasoning</p>
                <p className="text-xs text-muted-foreground">{result.reasoning}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}

function ConceptRow({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: "indigo" | "cyan" | "emerald" | "purple" | "amber";
}) {
  const toneClass = {
    indigo: "border-indigo/30 bg-indigo/10 text-indigo",
    cyan: "border-cyan/30 bg-cyan/10 text-cyan",
    emerald: "border-emerald/30 bg-emerald/10 text-emerald",
    purple: "border-purple/30 bg-purple/10 text-purple",
    amber: "border-amber/30 bg-amber/10 text-amber",
  }[tone];

  return (
    <div className="flex items-start gap-2">
      <span className="technical-label w-24 shrink-0 pt-1">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {values.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          values.map((v) => (
            <span
              key={v}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${toneClass}`}
            >
              {v}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
