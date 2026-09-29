import { Link } from "@tanstack/react-router";
import { Bot, BookOpen, Plug, ShieldCheck, Sparkles, Tag, Wrench } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { tierIdentity } from "@/lib/status";
import type { Agent, AnnotationMap } from "@/types";
import { cn } from "@/lib/utils";
import { CreatedAt } from "@/components/shared/CreatedAt";

export function AgentCard({
  agent,
  domains,
  hasKnowledgeTool,
  onDelete,
  onClassify,
}: {
  agent: Agent;
  domains: string[];
  hasKnowledgeTool: boolean;
  onDelete: (agent: Agent) => void;
  onClassify?: (agent: Agent) => void;
}) {
  const tier = tierIdentity(agent.tier);
  const activeModeration = agent.guardrails?.moderation_llm_v2 ?? agent.guardrails?.moderation_llm_v1;
  const hasGuardrails = Boolean(activeModeration);
  const toolCount = agent.tools?.length ?? 0;
  const connectorCount = agent.connectors?.length ?? 0;

  return (
    <div className="group relative flex flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)",
        }}
      />

      <Link to="/agents/$id" params={{ id: agent.id }} className="absolute inset-0 z-0 rounded-2xl" aria-label={agent.name} />

      <div className="pointer-events-none relative z-[1] flex flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
            "border-border/60 bg-background-elevated text-muted-foreground",
            "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
          )}>
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
              <StatusPill identity={tier} size="xs" />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {agent.description || "No description provided"}
            </p>
          </div>
        </div>

        {/* Model + capability badges */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-blue/20 bg-blue/8 px-1.5 py-0.5 font-mono text-[10px] text-blue">
            <Sparkles className="size-2.5" />
            {agent.model}
          </span>
          {hasGuardrails && (
            <span
              title="Moderation guardrail active"
              className="inline-flex items-center gap-1 rounded-md border border-emerald/25 bg-emerald/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald"
            >
              <ShieldCheck className="size-2.5" />
              Protected
            </span>
          )}
          {toolCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-pink/20 bg-pink/8 px-1.5 py-0.5 text-[10px] font-medium text-pink">
              <Wrench className="size-2.5" />
              {toolCount} tool{toolCount !== 1 ? "s" : ""}
            </span>
          )}
          {connectorCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
              <Plug className="size-2.5" />
              {connectorCount}
            </span>
          )}
          {hasKnowledgeTool && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber/20 bg-amber/8 px-1.5 py-0.5 text-[10px] font-medium text-amber">
              <BookOpen className="size-2.5" />
              Knowledge
            </span>
          )}
        </div>

        {/* Classification tablet — click to open the domain classification modal */}
        <div className="mt-3.5 flex items-center border-t border-border/40 pt-3.5">
          <button
            type="button"
            disabled={!onClassify}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClassify?.(agent);
            }}
            title={
              domains.length
                ? `Domain: ${domains.join(", ")} — click to edit`
                : "Click to classify this agent by domain"
            }
            className={cn(
              "pointer-events-auto relative z-10 inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:pointer-events-none",
              domains.length
                ? "border-indigo/25 bg-indigo/10 text-indigo hover:border-indigo/45 hover:bg-indigo/20"
                : "border-dashed border-border/70 text-muted-foreground hover:border-indigo/45 hover:bg-indigo/10 hover:text-indigo",
            )}
          >
            <Tag className="size-2.5 shrink-0" />
            <span className="truncate">
              {domains.length === 0
                ? "Classify"
                : domains.length > 2
                  ? `${domains.slice(0, 2).join(", ")} +${domains.length - 2}`
                  : domains.join(", ")}
            </span>
          </button>
        </div>

        {/* Footer — when it was created */}
        <div className="mt-2.5 flex items-center">
          <CreatedAt value={agent.created_at} />
        </div>
      </div>
    </div>
  );
}

export function extractDomains(map?: AnnotationMap): string[] {
  return map?.serves_domain ?? [];
}
