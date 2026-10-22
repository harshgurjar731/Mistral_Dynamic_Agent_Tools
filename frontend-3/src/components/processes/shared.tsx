/**
 * Small pieces shared by the Processes page, the Settings template section and
 * the orchestration pages' process controls.
 */
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileJson,
  Upload,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage, processesApi, QK } from "@/api";
import type { DocumentStats, DocumentStatus, ProcessUse, TemplateRef } from "@/api/processes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ── Template download ─────────────────────────────────────────────── */

/**
 * Download a template: the one that applies at a node of the classification
 * (``conceptId``; ``null`` for the global default), or one specific version
 * (``templateId``). With a node, the menu names which template that is and
 * where it is set, since templates are inherited down the classification.
 */
export function TemplateDownloadMenu({
  conceptId,
  templateId,
  size = "sm",
  variant = "outline",
  label = "Download template",
  className,
}: {
  conceptId?: string | null | undefined;
  templateId?: number | undefined;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "ghost";
  label?: string;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const byNode = templateId === undefined;
  const scope = conceptId ?? null;
  const effective = useQuery({
    queryKey: QK.processTemplate(`for:${scope ?? "global"}`),
    queryFn: () => processesApi.templateFor(scope),
    enabled: open && byNode,
    staleTime: 30_000,
  });
  const get = (kind: "blank" | "example" | "schema") =>
    (byNode
      ? processesApi.downloadTemplateFor(scope, kind)
      : processesApi.downloadTemplate(templateId, kind)
    ).catch((e) => toast.error(`Download failed: ${errorMessage(e)}`));
  const t = effective.data;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} className={className}>
          <Download className="size-3.5" />
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="space-y-0.5 text-[11px] font-normal text-muted-foreground">
          {byNode ? (
            t ? (
              <>
                <span className="block font-medium text-foreground">
                  {t.name} v{t.version}
                </span>
                <span className="block">
                  {t.inherited
                    ? `Inherited from ${t.scope_path}`
                    : t.concept_id
                      ? `Set for ${t.scope_path}`
                      : "The global default"}
                </span>
              </>
            ) : (
              "Loading the template that applies here…"
            )
          ) : (
            "Documents must match this format exactly"
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void get("blank")}>
          <FileJson className="size-3.5" />
          <div>
            <p className="text-xs font-medium">Blank template</p>
            <p className="text-[10px] text-muted-foreground">Every field, with what goes there</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void get("example")}>
          <FileJson className="size-3.5" />
          <div>
            <p className="text-xs font-medium">Filled example</p>
            <p className="text-[10px] text-muted-foreground">A complete, valid document</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void get("schema")}>
          <FileJson className="size-3.5" />
          <div>
            <p className="text-xs font-medium">JSON Schema</p>
            <p className="text-[10px] text-muted-foreground">For editors and validators</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Checked against X v2 — inherited from BFSI › Lending" for a node. */
export function TemplateLine({
  template,
  className,
}: {
  template: TemplateRef | null | undefined;
  className?: string | undefined;
}) {
  if (!template) return null;
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      Template: <span className="text-foreground">{template.name}</span> v{template.version}
      {" · "}
      {template.inherited
        ? `inherited from ${template.scope_path ?? "above"}`
        : template.concept_id
          ? "set here"
          : "global default"}
    </span>
  );
}

/* ── Status and stats ──────────────────────────────────────────────── */

const STATUS: Record<DocumentStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  valid: {
    label: "Valid",
    cls: "border-emerald/30 bg-emerald/10 text-emerald",
    icon: CheckCircle2,
  },
  invalid: { label: "Invalid", cls: "border-red/30 bg-red/10 text-red", icon: AlertTriangle },
  stale: { label: "Stale", cls: "border-amber/30 bg-amber/10 text-amber", icon: Clock },
};

export function DocumentStatusBadge({
  status,
  className,
}: {
  status: DocumentStatus;
  className?: string;
}) {
  const meta = STATUS[status] ?? STATUS.invalid;
  const Icon = meta.icon;
  return (
    <span
      title={
        status === "stale"
          ? "Valid once, but fails the current default template. Re-upload or fix it."
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        meta.cls,
        className,
      )}
    >
      <Icon className="size-2.5" />
      {meta.label}
    </span>
  );
}

export function StatsLine({
  stats,
  className,
}: {
  stats?: DocumentStats | undefined;
  className?: string | undefined;
}) {
  if (!stats) return null;
  const parts = (
    [
      ["stages", stats.stages],
      ["controls", stats.controls],
      ["risks", stats.risks],
      ["exceptions", stats.exceptions],
    ] as const
  ).filter(([, n]) => n);
  if (!parts.length) return null;
  return (
    <span className={cn("text-[10px] text-muted-foreground tabular-nums", className)}>
      {parts.map(([k, n]) => `${n} ${k}`).join(" · ")}
      {stats.mandatory_controls ? ` · ${stats.mandatory_controls} mandatory` : ""}
    </span>
  );
}

/* ── File input ────────────────────────────────────────────────────── */

export function FileDrop({
  onFile,
  busy,
  label = "Drop a process JSON file here, or click to choose",
  hint,
  compact,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  label?: string;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onFile(file);
    if (input.current) input.current.value = "";
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => {
        if (!busy && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) pick(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-center transition",
        compact ? "px-3 py-3" : "px-4 py-7",
        over ? "border-primary/60 bg-primary/5" : "border-border/70 hover:border-primary/40",
        busy && "cursor-wait opacity-60",
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <Upload className={cn("text-muted-foreground", compact ? "size-4" : "size-5")} />
      <p className="text-xs text-foreground">{busy ? "Checking…" : label}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ── Usage ─────────────────────────────────────────────────────────── */

const REF_TONE: Record<string, string> = {
  stage: "border-indigo/30 bg-indigo/10 text-indigo",
  control: "border-amber/30 bg-amber/10 text-amber",
  risk: "border-red/30 bg-red/10 text-red",
  regulation: "border-purple/30 bg-purple/10 text-purple",
  exception: "border-orange/30 bg-orange/10 text-orange",
  data: "border-cyan/30 bg-cyan/10 text-cyan",
  actor: "border-emerald/30 bg-emerald/10 text-emerald",
  kpi: "border-blue/30 bg-blue/10 text-blue",
};

export function RefChip({ refId, label }: { refId: string; label?: string }) {
  const type = refId.split(":", 1)[0] ?? "";
  return (
    <span
      title={refId}
      className={cn(
        "inline-flex max-w-[16rem] items-center gap-1 truncate rounded border px-1.5 py-px font-mono text-[10px]",
        REF_TONE[type] ?? "border-border bg-background text-muted-foreground",
      )}
    >
      <span className="opacity-70">{type}</span>
      <span className="truncate font-sans">{label ?? refId.split(":").slice(1).join(":")}</span>
    </span>
  );
}

export function ProcessUseList({ uses, className }: { uses: ProcessUse[]; className?: string }) {
  if (!uses.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)}>
      {uses.map((u, i) => (
        <li key={`${u.ref}-${i}`} className="flex flex-wrap items-start gap-1.5 text-[11px]">
          <RefChip refId={u.ref} label={u.label} />
          {u.target ? (
            <span className="rounded bg-background px-1 font-mono text-[10px] text-muted-foreground">
              {u.target}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 leading-snug text-muted-foreground">
            {u.how || "Used"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Diff ──────────────────────────────────────────────────────────── */

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff of two texts (LCS). Capped so a huge document stays responsive. */
export function lineDiff(before: string, after: string, cap = 1500): DiffLine[] {
  const a = before.split("\n").slice(0, cap);
  const b = after.split("\n").slice(0, cap);
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after);
  const changed = lines.filter((l) => l.kind !== "same").length;
  return (
    <div>
      <p className="mb-1.5 text-[10px] text-muted-foreground">
        {changed} changed line{changed === 1 ? "" : "s"}
      </p>
      <pre className="custom-scrollbar max-h-80 overflow-auto rounded-lg border border-border bg-background-elevated p-2 font-mono text-[10px] leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap",
              l.kind === "add" && "bg-emerald/10 text-emerald",
              l.kind === "del" && "bg-red/10 text-red line-through decoration-red/40",
              l.kind === "same" && "text-muted-foreground",
            )}
          >
            {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function prettyJson(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return JSON.stringify(raw ?? null, null, 2);
}
