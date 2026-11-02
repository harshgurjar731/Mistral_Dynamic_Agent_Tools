/**
 * Try retrieval — exactly what a build with this goal would be given, per layer.
 * Feedback — how the builds that used each guidance item ended.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, knowledgeApi, QK } from "@/api";
import type { RetrieveResult } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StrengthPill } from "./GuidancePanel";

export function TryRetrievalPanel() {
  const [goal, setGoal] = useState("");
  const [concepts, setConcepts] = useState("");
  const [facts, setFacts] = useState('{\n  "execution_profile": {"workflow_determinism": "fixed_steps"}\n}');
  const [proposed, setProposed] = useState(false);
  const [view, setView] = useState<string>("");
  const run = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = facts.trim() ? (JSON.parse(facts) as Record<string, unknown>) : {};
      } catch {
        throw new Error("Facts must be valid JSON.");
      }
      return knowledgeApi.retrieve({
        goal,
        concept_ids: concepts.split(",").map((c) => c.trim()).filter(Boolean),
        facts: parsed,
        include_proposed: proposed,
      });
    },
    onSuccess: (r: RetrieveResult) => setView(Object.keys(r.rendered)[0] ?? ""),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const result = run.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-2">
        <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3}
          placeholder="A goal, e.g. “Extract supplier invoices and post them to SAP”" />
        <Input value={concepts} onChange={(e) => setConcepts(e.target.value)}
          placeholder="Catalog nodes in scope, comma-separated (optional)" className="text-xs" />
        <Textarea value={facts} onChange={(e) => setFacts(e.target.value)} rows={5} className="font-mono text-[11px]" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={proposed} onChange={(e) => setProposed(e.target.checked)} />
          Include items still waiting for review
        </label>
        <Button disabled={!goal.trim() || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Retrieve
        </Button>
      </div>
      <div className="min-w-0 space-y-3">
        {!result ? (
          <EmptyState title="Nothing retrieved yet" description="Facts are checked against item conditions; an unknown fact keeps the item, a false one drops it." />
        ) : result.items.length === 0 ? (
          <EmptyState title="No guidance applies" description="With nothing in scope a build runs exactly as it would without guidance." />
        ) : (
          <>
            <ul className="space-y-1.5">
              {result.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs">
                  <StrengthPill strength={i.strength} />
                  <span className="font-medium text-foreground">{i.title}</span>
                  <span className="text-muted-foreground">score {i.score}</span>
                  {i.applies === "unknown" ? <span className="text-amber">conditions not all known</span> : null}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1">
              {Object.keys(result.rendered).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${v === view ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                  {v}
                </button>
              ))}
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-background-elevated p-3 text-[11px] whitespace-pre-wrap">
              {result.rendered[view] ?? ""}
            </pre>
            <p className="text-[10px] text-muted-foreground">
              Ranking {result.embedding_used ? "used embeddings and keywords" : "used keywords only (no embeddings yet)"}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function FeedbackPanel() {
  const feedback = useQuery({ queryKey: QK.knowledgeFeedback(), queryFn: knowledgeApi.feedback });
  if (feedback.isError) return <ErrorState error={feedback.error} />;
  const rows = feedback.data?.items ?? [];
  if (!rows.length) {
    return <EmptyState title="No guidance has been used yet" description="Once builds use guidance, accepted and rolled-back builds are counted against it here." />;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        An item whose builds were rolled back {feedback.data!.rollback_threshold}+ times, more often than accepted,
        goes back to review automatically.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-1">Guidance</th><th>Used</th><th>Accepted</th><th>Rolled back</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/40">
              <td className="py-1.5 pr-2"><StrengthPill strength={r.strength} /> {r.title}</td>
              <td>{r.stats.used}</td>
              <td className="text-success">{r.stats.accepted_builds}</td>
              <td className={r.stats.rolled_back_builds ? "text-destructive" : ""}>{r.stats.rolled_back_builds}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
