import { Link } from "@tanstack/react-router";
import { BookOpen, Trash2 } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { tierIdentity } from "@/lib/status";
import type { Agent, AnnotationMap } from "@/types";

export function AgentCard({
  agent,
  domains,
  hasKnowledgeTool,
  onDelete,
}: {
  agent: Agent;
  domains: string[];
  hasKnowledgeTool: boolean;
  onDelete: (agent: Agent) => void;
}) {
  const tier = tierIdentity(agent.tier);
  return (
    <div className="group relative flex flex-col rounded-2xl border border-border glass p-5 transition hover:border-primary/25 hover:bg-surface-hover">
      <Link to="/agents/$id" params={{ id: agent.id }} className="absolute inset-0" aria-label={agent.name} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
        <StatusPill identity={tier} />
      </div>
      <span className="mt-1 inline-block w-fit rounded-md border border-border bg-background-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {agent.model}
      </span>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {agent.description || "No description provided"}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {domains.map((d) => (
          <span
            key={d}
            className="rounded-full border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan"
          >
            {d}
          </span>
        ))}
        {hasKnowledgeTool ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber">
            <BookOpen className="size-2.5" />
            Industry knowledge
          </span>
        ) : null}
      </div>
      {!agent.protected ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(agent);
          }}
          aria-label={`Delete ${agent.name}`}
          className="relative z-10 mt-4 inline-flex w-fit items-center gap-1.5 self-end rounded-lg border border-transparent px-2 py-1 text-[11px] text-muted-foreground opacity-0 transition hover:border-red/30 hover:bg-red/10 hover:text-red group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      ) : null}
    </div>
  );
}

export function extractDomains(map?: AnnotationMap): string[] {
  return map?.serves_domain ?? [];
}
