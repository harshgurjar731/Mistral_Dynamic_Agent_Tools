import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CHAT_MODELS } from "@/lib/models";
import type { AgentCreate } from "@/api/agents";
import type { GuardrailConfig } from "@/types";
import { GuardrailEditor } from "./GuardrailEditor";

const TIERS = [
  { value: "foundation", label: "Foundation" },
  { value: "domain", label: "Domain" },
  { value: "use_case", label: "Use Case" },
];

export function CreateAgentModal({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (body: AgentCreate) => void;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("mistral-large-latest");
  const [tier, setTier] = useState("foundation");
  const [instructions, setInstructions] = useState("");
  const [temperature, setTemperature] = useState<number | null>(0.7);
  const [top_p, setTopP] = useState<number | null>(1.0);
  const [guardrails, setGuardrails] = useState<GuardrailConfig | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setModel("mistral-large-latest");
    setTier("foundation");
    setInstructions("");
    setTemperature(0.7);
    setTopP(1.0);
    setGuardrails(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="bg-background-elevated text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Code Reviewer"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the agent's purpose"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-1 bg-background text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tier</label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="mt-1 bg-background text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Temperature</label>
                <span className="font-mono text-xs text-muted-foreground">{temperature ?? 0.7}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature ?? 0.7}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Top P</label>
                <span className="font-mono text-xs text-muted-foreground">{top_p ?? 1.0}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={top_p ?? 1.0}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">System Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="You are a helpful assistant that…"
              rows={3}
              className="custom-scrollbar mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="rounded-xl border border-border bg-background/50 p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Safety Guardrails (Mistral Moderation)
            </h4>
            <GuardrailEditor value={guardrails} onChange={setGuardrails} />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || isCreating}
            onClick={() =>
              onCreate({
                name: name.trim(),
                model,
                tier,
                instructions,
                description,
                temperature: temperature ?? 0.7,
                top_p: top_p ?? 1.0,
                guardrails: guardrails || undefined,
              })
            }
            className="rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isCreating ? "Creating…" : "Create"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
