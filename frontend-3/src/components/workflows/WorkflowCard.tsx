import type { ReactElement } from "react";
import { CreatedAt } from "@/components/shared/CreatedAt";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  GitBranch,
  History,
  Package,
  Pencil,
  Play,
  Rocket,
  Sparkles,
  Tag,
  Wrench,
} from "lucide-react";
import type { WorkflowDefinition } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

type ActionTone = "default" | "primary" | "danger";

function actionClass(tone: ActionTone = "default") {
  return cn(
    "pointer-events-auto relative z-10 grid size-8 shrink-0 place-items-center rounded-lg border transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
    tone === "primary"
      ? "border-primary/30 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/20"
      : tone === "danger"
        ? "border-border/60 text-muted-foreground hover:border-red/40 hover:bg-red/10 hover:text-red"
        : "border-border/60 text-muted-foreground hover:border-primary/30 hover:bg-surface-hover hover:text-foreground",
  );
}

/** Icon-only card action — the label lives in the tooltip and the aria-label. */
function IconAction({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const metaChip =
  "inline-flex items-center rounded-md border border-border/60 bg-background-elevated/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";

export function WorkflowCard({
  workflow,
  domains = [],
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
  /** Domain labels this workflow is classified under. */
  domains?: string[];
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
  const publishLabel =
    workflow.has_unpublished_changes || !workflow.is_deployed ? "Publish" : "Republish";

  return (
    <div
      className="group relative flex flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)",
        }}
      />

      <Link
        to="/workflows/$workflowName"
        params={{ workflowName: workflow.name }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={workflow.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
              "border-border/60 bg-background-elevated text-muted-foreground",
              "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
            )}
          >
            <GitBranch className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold break-words text-foreground transition-colors group-hover:text-primary">
              {workflow.name}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SourceBadge source={workflow.source} />
              <DeployBadge workflow={workflow} />
            </div>
          </div>
        </div>

        {/* Shape of the definition */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className={metaChip}>
            {remoteOnly ? "remote only" : `${workflow.steps.length} steps`}
          </span>
          {workflow.entry_step ? (
            <span className={cn(metaChip, "max-w-full truncate")}>
              entry · {workflow.entry_step}
            </span>
          ) : null}
          {workflow.input_schema.length > 0 ? (
            <span className={metaChip}>{workflow.input_schema.length} inputs</span>
          ) : null}
        </div>

        {/* Classification tablet — click to open the domain classification modal */}
        {onClassify || domains.length > 0 ? (
          <div className="mt-3.5 flex items-center">
            <button
              type="button"
              disabled={!onClassify}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClassify?.(workflow.name);
              }}
              title={
                domains.length
                  ? `Domain: ${domains.join(", ")} — click to edit`
                  : "Click to classify this workflow by domain"
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
        ) : null}

        {/* Actions — icon only */}
        <TooltipProvider delayDuration={200}>
          <div className="mt-auto pt-3.5">
            <CreatedAt value={workflow.created_at} className="mb-2.5" />
            <div
              data-card-footer
              className="flex items-center gap-1.5 border-t border-border/40 pt-3.5"
            >
              <IconAction label="Run">
                {onExecuteModal ? (
                  <button
                    type="button"
                    aria-label="Run"
                    className={actionClass("primary")}
                    onClick={() => onExecuteModal(workflow.name)}
                  >
                    <Play />
                  </button>
                ) : (
                  <Link
                    to="/workflows/$workflowName/execute"
                    params={{ workflowName: workflow.name }}
                    aria-label="Run"
                    className={actionClass("primary")}
                  >
                    <Play />
                  </Link>
                )}
              </IconAction>
              {!remoteOnly ? (
                <IconAction label="Edit">
                  <Link
                    to="/workflows/$workflowName/edit"
                    params={{ workflowName: workflow.name }}
                    aria-label="Edit"
                    className={actionClass()}
                  >
                    <Pencil />
                  </Link>
                </IconAction>
              ) : null}
              {onPublish && !remoteOnly ? (
                <IconAction label={publishLabel}>
                  <button
                    type="button"
                    aria-label={publishLabel}
                    disabled={isBusy}
                    className={actionClass()}
                    onClick={() => onPublish(workflow.name)}
                  >
                    <Rocket />
                  </button>
                </IconAction>
              ) : null}
              {onPackage ? (
                <IconAction label="Package">
                  <button
                    type="button"
                    aria-label="Package"
                    className={actionClass()}
                    onClick={() => onPackage(workflow.name)}
                  >
                    <Package />
                  </button>
                </IconAction>
              ) : null}
              {onHistory ? (
                <IconAction label="History">
                  <button
                    type="button"
                    aria-label="History"
                    className={actionClass()}
                    onClick={() => onHistory(workflow.name)}
                  >
                    <History />
                  </button>
                </IconAction>
              ) : null}
              {onArchive ? (
                <IconAction label="Archive">
                  <button
                    type="button"
                    aria-label="Archive"
                    disabled={isBusy}
                    className={cn(actionClass("danger"), "ml-auto")}
                    onClick={() => onArchive(workflow.name)}
                  >
                    <Archive />
                  </button>
                </IconAction>
              ) : null}
              {onUnarchive ? (
                <IconAction label="Restore">
                  <button
                    type="button"
                    aria-label="Restore"
                    disabled={isBusy}
                    className={cn(actionClass(), "ml-auto")}
                    onClick={() => onUnarchive(workflow.name)}
                  >
                    <ArchiveRestore />
                  </button>
                </IconAction>
              ) : null}
            </div>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
