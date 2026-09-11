import { useState } from "react";
import { AlertCircle, Bot, Loader2, Sparkles, Wrench } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { errorMessage, toolsApi } from "@/api";
import type { CatalogTool } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ── Inline Agent Creation Modal ────────────────────────────────────── */

export function CreateAgentModal({
  open,
  onOpenChange,
  models,
  tiers,
  tools,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: string[];
  tiers: string[];
  tools: CatalogTool[];
  onCreated: (agentId: string) => void;
}) {
  const [name, setName] = useState("");
  const [model, setModel] = useState(models[0] ?? "mistral-large-latest");
  const [tier, setTier] = useState(tiers[0] ?? "foundation");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 1 && instructions.trim().length >= 20 && !busy;

  const toggleTool = (toolName: string) =>
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName],
    );

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await agentsApi.create({
        name: name.trim(),
        model,
        description: description.trim() || `Workflow agent: ${name.trim()}`,
        instructions: instructions.trim(),
        tier,
        tools: selectedTools as any,
      });
      onOpenChange(false);
      onCreated(res.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-background-elevated/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bot className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Create Agent
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Provision a new agent in your Mistral account and drop it into the workflow
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red/30 bg-red/10 p-2.5 text-xs text-red">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="eyebrow mb-1 block">Agent Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Risk Assessor"
              className="text-xs"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow mb-1 block">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map((m) => (
                  <option key={m} value={m} className="bg-background-elevated">
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="eyebrow mb-1 block">Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {tiers.map((t) => (
                  <option key={t} value={t} className="bg-background-elevated">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="eyebrow mb-1 block">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line explaining what this agent does"
              className="text-xs"
            />
          </div>

          <div>
            <label className="eyebrow mb-1 block">Instructions</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              placeholder="ROLE: You are an expert analyst...&#10;TASK: Evaluate inputs against the risk model...&#10;CONSTRAINTS: Return structured JSON..."
              className="font-mono text-xs leading-relaxed"
            />
            <p
              className={cn(
                "mt-1 text-[10px]",
                instructions.trim().length < 20 ? "text-amber" : "text-muted-foreground",
              )}
            >
              {instructions.trim().length} characters
              {instructions.trim().length < 20 ? " (minimum 20 required)" : ""}
            </p>
          </div>

          <div>
            <label className="eyebrow mb-1 block">Tools ({selectedTools.length} selected)</label>
            {tools.length === 0 ? (
              <p className="text-xs text-muted-foreground">No catalog tools available yet.</p>
            ) : (
              <div className="custom-scrollbar max-h-36 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {tools.map((t) => {
                  const checked = selectedTools.includes(t.name);
                  return (
                    <label
                      key={`${t.source}:${t.name}`}
                      className="flex items-start gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-surface-hover transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTool(t.name)}
                        className="mt-1 size-3.5 accent-primary shrink-0 rounded"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-medium text-foreground">
                          {t.name}
                        </span>
                        {t.description && (
                          <p className="line-clamp-1 text-[11px] text-muted-foreground">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <span className="technical-label shrink-0 text-[9px] uppercase">
                        {t.source}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Inline Tool / Activity Synthesis Modal ─────────────────────────── */

export function CreateToolModal({
  open,
  onOpenChange,
  purpose,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purpose: "tool" | "activity";
  onCreated: (toolName: string) => void;
}) {
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = task.trim().length >= 10 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await toolsApi.synthesize(task.trim(), purpose);
      if (res.status === "failed" || res.status === "error") {
        setError(res.message ?? "Tool synthesis failed.");
        return;
      }
      onOpenChange(false);
      onCreated(res.tool_name ?? "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-background-elevated/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
              {purpose === "activity" ? (
                <Sparkles className="size-4" />
              ) : (
                <Wrench className="size-4" />
              )}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {purpose === "activity" ? "Synthesise Activity" : "Synthesise Tool"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Codestral generates Python code, lints, and executes it in sandbox verification
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red/30 bg-red/10 p-2.5 text-xs text-red">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="eyebrow mb-1 block">
              {purpose === "activity"
                ? "What should this workflow activity do?"
                : "What should this agent tool do?"}
            </label>
            <Textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={5}
              autoFocus
              placeholder="e.g. Given an annual interest rate, loan amount, and duration in months, calculate the amortization table and monthly payment."
              className="text-xs leading-relaxed"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Describe inputs, operations, and returned outputs clearly.
            </p>
          </div>

          {busy && (
            <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-cyan">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Synthesizing code in Docker sandbox...</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Codestral is generating the function, verifying type hints, running AST checks, and
                validating test executions.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "Synthesizing..." : "Synthesize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
