import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Sparkles, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/workflows/new/")({
  head: () => ({
    meta: [
      { title: "New workflow — Agentic AI Design Patterns" },
      { name: "description", content: "Plan a workflow from a goal, or assemble the DAG by hand." },
      { property: "og:title", content: "New workflow — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Plan a workflow from a goal, or assemble the DAG by hand.",
      },
    ],
  }),
  component: NewWorkflowPage,
});

const OPTIONS = [
  {
    to: "/workflows/new/ai" as const,
    icon: Sparkles,
    tone: "purple",
    eyebrow: "Planner",
    title: "Describe the goal",
    lede: "State the outcome in a sentence. The planner analyses it, synthesises any missing tools, reuses or creates the agents it needs, wires the DAG, compiles it and registers it with the worker — streaming every phase as it goes.",
    bullets: [
      "Best for a workflow you have not designed yet",
      "Creates tools and agents on your behalf",
      "Ends with a saved, published workflow",
    ],
    cta: "Open the planner",
  },
  {
    to: "/workflows/new/visual" as const,
    icon: Wrench,
    tone: "cyan",
    eyebrow: "Builder",
    title: "Assemble it yourself",
    lede: "Drag steps onto a canvas and connect them. Every agent, tool and connector already registered on the platform is in the palette, and the definition is validated as you build.",
    bullets: [
      "Best when you know exactly which steps you want",
      "Reuses existing agents, tools and connectors only",
      "Saves as a draft until you publish",
    ],
    cta: "Open the builder",
  },
];

function NewWorkflowPage() {
  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Orchestration"
        title="New workflow"
        description="Two routes to the same artefact — a validated DAG that the Mistral worker can run."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows">
              <ArrowLeft className="size-3.5" /> All workflows
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const accent =
            o.tone === "purple"
              ? "border-purple/30 bg-purple/10 text-purple"
              : "border-cyan/30 bg-cyan/10 text-cyan";
          return (
            <GlassPanel key={o.to} tone="raised" className="flex flex-col p-6">
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${accent}`}
              >
                <Icon className="size-2.5" /> {o.eyebrow}
              </span>
              <h2 className="mt-4 font-display text-lg font-bold text-foreground">{o.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{o.lede}</p>
              <ul className="mt-4 space-y-1.5">
                {o.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-6 pt-2">
                <Button asChild>
                  <Link to={o.to}>
                    {o.cta} <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}
