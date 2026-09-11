import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  History,
  Pencil,
  Play,
  Rocket,
  Sparkles,
  Tag,
  Package,
  Wrench,
} from "lucide-react";
import type { WorkflowDefinition } from "@/types";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DeployBadge({ workflow }: { workflow: WorkflowDefinition }) {
  if (workflow.has_unpublished_changes) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-[10px] font-bold text-amber uppercase">
        <CircleDot className="size-2.5" /> Unpublished edits
      </span>
    );
  }
  if (workflow.is_deployed) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald/30 bg-emerald/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald uppercase">
        <Rocket className="size-2.5" /> Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground uppercase">
      Draft
    </span>
  );
}

export function SourceBadge({ source }: { source: WorkflowDefinition["source"] }) {
  const builder = source === "builder";
  const Icon = builder ? Wrench : Sparkles;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
        builder
          ? "border-cyan/30 bg-cyan/10 text-cyan"
          : "border-purple/30 bg-purple/10 text-purple",
      )}
    >
      <Icon className="size-2.5" /> {builder ? "Builder" : "Planner"}
    </span>
  );
}

export function WorkflowCard({
  workflow,
  onArchive,
  onUnarchive,
  onPublish,
  onHistory,
  onPackage,
  onClassify,
  onExecuteModal,
  busy,
}: {
  workflow: WorkflowDefinition;
  onArchive?: (name: string) => void;
  onUnarchive?: (name: string) => void;
  onPublish?: (name: string) => void;
  onHistory?: (name: string) => void;
  onPackage?: (name: string) => void;
  onClassify?: (name: string) => void;
  onExecuteModal?: (name: string) => void;
  busy?: string | null;
}) {
  /** A remote-only workflow arrives with no steps — it can be run but not edited. */
  const remoteOnly = workflow.steps.length === 0;
  const isBusy = busy === workflow.name;

  return (
    <GlassPanel className="flex flex-col p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          to="/workflows/$workflowName"
          params={{ workflowName: workflow.name }}
          className="min-w-0 font-display text-sm font-bold break-words text-foreground transition hover:text-primary"
        >
          {workflow.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge source={workflow.source} />
          <DeployBadge workflow={workflow} />
        </div>
      </div>

      <p className="mt-2 line-clamp-3 min-h-[2.5rem] text-xs text-muted-foreground">
        {workflow.description || "No description."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <span className="technical-label">
          {remoteOnly ? "remote only" : `${workflow.steps.length} steps`}
        </span>
        {workflow.entry_step ? (
          <span className="technical-label truncate">entry · {workflow.entry_step}</span>
        ) : null}
        {workflow.input_schema.length > 0 ? (
          <span className="technical-label">{workflow.input_schema.length} inputs</span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {onExecuteModal ? (
          <Button size="sm" onClick={() => onExecuteModal(workflow.name)} className="gap-1.5">
            <Play className="size-3.5" /> Run
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link to="/workflows/$workflowName/execute" params={{ workflowName: workflow.name }}>
              <Play className="size-3.5" /> Run
            </Link>
          </Button>
        )}
        {!remoteOnly ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/workflows/$workflowName/edit" params={{ workflowName: workflow.name }}>
              <Pencil className="size-3.5" /> Edit
            </Link>
          </Button>
        ) : null}
        {onPublish && !remoteOnly ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => onPublish(workflow.name)}
          >
            <Rocket className="size-3.5" />
            {workflow.has_unpublished_changes || !workflow.is_deployed ? "Publish" : "Republish"}
          </Button>
        ) : null}
        {onPackage ? (
          <Button size="sm" variant="outline" onClick={() => onPackage(workflow.name)}>
            <Package className="size-3.5" /> Package
          </Button>
        ) : null}
        {onClassify ? (
          <Button size="sm" variant="outline" onClick={() => onClassify(workflow.name)}>
            <Tag className="size-3.5" /> Classify
          </Button>
        ) : null}
        {onHistory ? (
          <Button size="sm" variant="ghost" onClick={() => onHistory(workflow.name)}>
            <History className="size-3.5" /> History
          </Button>
        ) : null}
        {onArchive ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isBusy}
            className="ml-auto text-muted-foreground hover:text-red"
            onClick={() => onArchive(workflow.name)}
          >
            <Archive className="size-3.5" /> Archive
          </Button>
        ) : null}
        {onUnarchive ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            className="ml-auto"
            onClick={() => onUnarchive(workflow.name)}
          >
            <ArchiveRestore className="size-3.5" /> Restore
          </Button>
        ) : null}
      </div>
    </GlassPanel>
  );
}
