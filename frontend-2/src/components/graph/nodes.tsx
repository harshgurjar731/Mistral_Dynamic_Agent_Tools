import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Info, Flag } from "lucide-react";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { StepFlowNode } from "./types";

export function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { step, isEntry, errorCount, warningCount } = data;
  const identity = STEP_TYPE_IDENTITY[step.type];

  return (
    <div
      className={cn(
        "w-[240px] rounded-2xl border backdrop-blur-xl transition glass",
        selected ? "glow-ring border-primary/60" : "border-border",
        errorCount > 0 && "border-red/50",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            identity.bg,
            identity.border,
            identity.text,
          )}
        >
          {identity.label}
        </span>
        <div className="flex items-center gap-1">
          {isEntry ? (
            <span
              title="Entry step"
              className="inline-flex items-center gap-0.5 rounded-full border border-emerald/30 bg-emerald/10 px-1.5 py-0.5 text-[9px] text-emerald"
            >
              <Flag className="size-2.5" /> Entry
            </span>
          ) : null}
          {errorCount > 0 ? (
            <span
              title="This step has errors"
              className="inline-flex items-center gap-0.5 rounded-full border border-red/30 bg-red/10 px-1.5 py-0.5 text-[9px] text-red"
            >
              <AlertTriangle className="size-2.5" /> {errorCount}
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span
              title="This step has warnings"
              className="inline-flex items-center gap-0.5 rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[9px] text-amber"
            >
              <Info className="size-2.5" /> {warningCount}
            </span>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-foreground">{step.id}</p>
        {step.description ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
            {step.description}
          </p>
        ) : null}
        {step.parallel_group ? (
          <p className="mt-1 truncate font-mono text-[10px] text-cyan">∥ {step.parallel_group}</p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
}

export const stepNodeTypes = { step: StepNode };
