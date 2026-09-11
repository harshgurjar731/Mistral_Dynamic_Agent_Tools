import { Link } from "@tanstack/react-router";
import {
  Wrench,
  Zap,
  Code2,
  Hash,
  FileCode,
} from "lucide-react";
import type { Tool } from "@/types";
import { toolSource, TOOL_SOURCE_IDENTITY } from "@/lib/status";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";

function schemaEntries(tool: Tool): Record<string, unknown> | null {
  const schema = tool.schema_json ?? tool.schema;
  if (!schema) return null;
  if (typeof schema === "string") {
    try {
      return JSON.parse(schema) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return schema;
}

/** Tool Service records carry no top-level description — the schema holds it. */
function toolDescription(tool: Tool): string {
  if (tool.description) return tool.description;
  const fn = schemaEntries(tool)?.["function"] as { description?: string } | undefined;
  return fn?.description ?? "";
}

/** Count parameters from the tool schema. */
function paramCount(tool: Tool): number {
  const schema = schemaEntries(tool);
  if (!schema) return 0;
  const fn = schema["function"] as { parameters?: { properties?: Record<string, unknown> } } | undefined;
  const props = fn?.parameters?.properties ?? (schema as { properties?: Record<string, unknown> })?.properties;
  return props ? Object.keys(props).length : 0;
}

export function ToolCard({
  tool,
  pending = false,
  variant = "tool",
}: {
  tool: Tool;
  pending?: boolean;
  /** Section the card lives in — decides which detail page the card opens. */
  variant?: "tool" | "activity";
}) {
  const src = toolSource(tool.id);
  const summary = toolDescription(tool);
  const isActivity = (tool.purpose ?? "tool") === "activity";
  const params = paramCount(tool);
  const identity = TOOL_SOURCE_IDENTITY[src];

  return (
    <div
      className="group relative flex flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: isActivity
            ? "linear-gradient(135deg, oklch(0.65 0.20 350 / 0.06), oklch(0.70 0.16 330 / 0.04), transparent 70%)"
            : "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)",
        }}
      />

      {/* Full-card clickable link */}
      <Link
        to={variant === "activity" ? "/workflows/activities/$id" : "/tools/$id"}
        params={{ id: String(tool.id) }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={tool.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
              "border-border/60 bg-background-elevated text-muted-foreground",
              "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
            )}
          >
            {isActivity ? <Zap className="size-5" /> : <Wrench className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{tool.name}</h3>
              <StatusPill identity={identity} size="xs" />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {summary || "No description provided"}
            </p>
          </div>
        </div>

        {/* Badges */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
              isActivity
                ? "border-violet-500/25 bg-violet-500/10 text-violet-400"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
            )}
          >
            {isActivity ? <Zap className="size-2.5" /> : <Wrench className="size-2.5" />}
            {isActivity ? "Activity" : "Agent Tool"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-blue/20 bg-blue/8 px-1.5 py-0.5 font-mono text-[10px] text-blue">
            <Hash className="size-2.5" />
            v{tool.version ?? 1}
          </span>
          {params > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
              <Code2 className="size-2.5" />
              {params} param{params !== 1 ? "s" : ""}
            </span>
          )}
          {tool.source_code && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber/20 bg-amber/8 px-1.5 py-0.5 text-[10px] font-medium text-amber">
              <FileCode className="size-2.5" />
              Source
            </span>
          )}
          {tool.status && (
            <span className="rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tool.status}
            </span>
          )}
        </div>

        {/* Footer */}
        {tool.created_at && (
          <div className="mt-3.5 flex items-center justify-end border-t border-border/40 pt-3.5">
            <span className="text-[9px] tabular-nums text-muted-foreground/35">
              {new Date(tool.created_at).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
