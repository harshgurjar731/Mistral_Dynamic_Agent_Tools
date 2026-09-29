import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  Library,
  Loader2,
  Network,
  Plug,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { agentsApi } from "@/api/agents";
import { errorMessage, librariesApi, QK, rulesApi } from "@/api";
import { RunProgressCard } from "@/components/runs/RunProgress";
import { stopRun } from "@/lib/runs/connections";
import { runOutputName } from "@/components/runs/runMeta";
import { useSynthesisRun } from "@/lib/runs/useSynthesisRun";
import type { CatalogConnector, CatalogTool, GuardrailConfig, RuleRef } from "@/types";
import { GuardrailEditor } from "@/components/agents/GuardrailEditor";
import { RuleSelector } from "@/components/rules/RuleSelector";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHAT_MODELS } from "@/lib/models";
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

type AgentTab = "basics" | "capabilities" | "model" | "safety";

/**
 * The full agent configuration Agent Studio and the orchestrator's
 * provisioning use — identity, tools, connectors, knowledge, sampling,
 * guardrails and rules — so an agent made on the canvas is not a lesser one.
 * A missing tool can be synthesised without leaving the form.
 */
export function CreateAgentModal({
  open,
  onOpenChange,
  models,
  tiers,
  tools,
  connectors,
  onCreated,
  onCatalogChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: string[];
  tiers: string[];
  tools: CatalogTool[];
  connectors: CatalogConnector[];
  onCreated: (agentId: string, agentName: string) => void;
  /** A tool was synthesised from inside the form — refresh whatever lists tools. */
  onCatalogChanged?: () => void;
}) {
  const [tab, setTab] = useState<AgentTab>("basics");
  // Identity
  const [name, setName] = useState("");
  const [model, setModel] = useState(models[0] ?? "mistral-large-latest");
  const [tier, setTier] = useState(tiers[0] ?? "foundation");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  // Capabilities
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [libraryIds, setLibraryIds] = useState<string[]>([]);
  const [knowledgeGraph, setKnowledgeGraph] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);
  // Sampling — null leaves the model default
  const [sampling, setSampling] = useState<Sampling>(EMPTY_SAMPLING);
  // Safety
  const [guardrails, setGuardrails] = useState<GuardrailConfig | null>(null);
  const [rules, setRules] = useState<RuleRef[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const librariesQuery = useQuery({
    queryKey: QK.libraries(),
    queryFn: librariesApi.list,
    enabled: open,
    staleTime: 60_000,
  });
  const libraries = librariesQuery.data ?? [];

  const nameOk = name.trim().length > 1;
  const instructionsOk = instructions.trim().length >= 20;
  const canSubmit = nameOk && instructionsOk && !busy;

  const reset = () => {
    setTab("basics");
    setName("");
    setDescription("");
    setInstructions("");
    setSelectedTools([]);
    setSelectedConnectors([]);
    setLibraryIds([]);
    setKnowledgeGraph(false);
    setToolQuery("");
    setSampling(EMPTY_SAMPLING);
    setGuardrails(null);
    setRules([]);
    setError(null);
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const q = toolQuery.trim().toLowerCase();
  const visibleTools = q
    ? tools.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      )
    : tools;
  // A just-synthesised tool is selected before the refreshed catalog lists it.
  const pendingTools = selectedTools.filter((n) => !tools.some((t) => t.name === n));

  const capabilityCount =
    selectedTools.length + selectedConnectors.length + libraryIds.length + (knowledgeGraph ? 1 : 0);
  const samplingCount = Object.values(sampling).filter((v) => v !== null).length;
  const safetyCount = (guardrails ? 1 : 0) + rules.length;

  const submit = async () => {
    if (!canSubmit) {
      setTab("basics");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const samplingArgs = Object.fromEntries(
        Object.entries(sampling).filter(([, v]) => v !== null),
      ) as Partial<Record<keyof Sampling, number>>;
      const res = await agentsApi.create({
        name: name.trim(),
        model,
        description: description.trim() || `Workflow agent: ${name.trim()}`,
        instructions: instructions.trim(),
        tier,
        tools: selectedTools,
        ...(selectedConnectors.length
          ? { connectors: selectedConnectors.map((connector_id) => ({ connector_id })) }
          : {}),
        ...(libraryIds.length ? { document_library_ids: libraryIds } : {}),
        ...(knowledgeGraph ? { knowledge_graph: true } : {}),
        ...samplingArgs,
        ...(guardrails ? { guardrails } : {}),
        ...(rules.length ? { rules } : {}),
      });
      const createdName = name.trim();
      onOpenChange(false);
      reset();
      onCreated(res.id, createdName);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="flex h-[min(88vh,760px)] max-w-3xl flex-col border-border bg-background-elevated/95 backdrop-blur-xl">
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
                  Same configuration as Agent Studio — the agent is provisioned in Mistral and
                  dropped into the workflow
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red/30 bg-red/10 p-2.5 text-xs text-red">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as AgentTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="w-full justify-start">
              <TabsTrigger value="basics">
                Basics
                {!nameOk || !instructionsOk ? (
                  <span className="ml-1 size-1.5 rounded-full bg-amber" aria-label="incomplete" />
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="capabilities">
                Capabilities{capabilityCount ? ` (${capabilityCount})` : ""}
              </TabsTrigger>
              <TabsTrigger value="model">
                Model settings{samplingCount ? ` (${samplingCount})` : ""}
              </TabsTrigger>
              <TabsTrigger value="safety">
                Safety & rules{safetyCount ? ` (${safetyCount})` : ""}
              </TabsTrigger>
            </TabsList>

            {/* ── Basics ─────────────────────────────────────────────── */}
            <TabsContent
              value="basics"
              className="custom-scrollbar mt-3 min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-1"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_190px_150px]">
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
                <div>
                  <label className="eyebrow mb-1 block">Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {models.map((m) => (
                      <option key={m} value={m} className="bg-background-elevated">
                        {CHAT_MODELS.find((c) => c.value === m)?.label ?? m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="eyebrow mb-1 block">Tier</label>
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {tiers.map((t) => (
                      <option key={t} value={t} className="bg-background-elevated">
                        {t.replace("_", " ")}
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
                <label className="eyebrow mb-1 block">System Instructions</label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={10}
                  placeholder="ROLE: You are an expert analyst...&#10;TASK: Evaluate inputs against the risk model...&#10;CONSTRAINTS: Return structured JSON..."
                  className="font-mono text-xs leading-relaxed"
                />
                <p
                  className={cn(
                    "mt-1 text-[10px]",
                    instructionsOk ? "text-muted-foreground" : "text-amber",
                  )}
                >
                  {instructions.trim().length} characters
                  {instructionsOk ? "" : " (minimum 20 required)"}
                </p>
              </div>
            </TabsContent>

            {/* ── Capabilities ───────────────────────────────────────── */}
            <TabsContent
              value="capabilities"
              className="custom-scrollbar mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
            >
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="eyebrow">Tools ({selectedTools.length} selected)</label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={() => setSynthesizing(true)}
                  >
                    <Sparkles className="size-3 text-amber" /> Synthesize new tool
                  </Button>
                </div>
                {pendingTools.length > 0 ? (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {pendingTools.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber"
                      >
                        <Wrench className="size-2.5" /> {t}
                        <button
                          type="button"
                          aria-label={`Remove ${t}`}
                          onClick={() => setSelectedTools((prev) => prev.filter((n) => n !== t))}
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {tools.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    No tools yet — synthesize one above.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="relative border-b border-border">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={toolQuery}
                        onChange={(e) => setToolQuery(e.target.value)}
                        placeholder={`Search ${tools.length} tools…`}
                        className="h-8 w-full bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                    <div className="custom-scrollbar max-h-44 divide-y divide-border overflow-y-auto">
                      {visibleTools.map((t) => (
                        <CheckRow
                          key={`${t.source}:${t.name}`}
                          checked={selectedTools.includes(t.name)}
                          onToggle={() => setSelectedTools((prev) => toggle(prev, t.name))}
                          title={t.name}
                          mono
                          description={t.description}
                          badge={t.source}
                        />
                      ))}
                      {visibleTools.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">
                          No tool matches “{toolQuery}”.
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="eyebrow mb-1.5 block">
                  Connectors ({selectedConnectors.length} selected)
                </label>
                {connectors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No connectors available.</p>
                ) : (
                  <div className="custom-scrollbar max-h-36 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {connectors.map((c) => (
                      <CheckRow
                        key={c.id}
                        checked={selectedConnectors.includes(c.id)}
                        onToggle={() => setSelectedConnectors((prev) => toggle(prev, c.id))}
                        title={c.name}
                        description={c.description}
                        icon={<Plug className="size-3 text-violet" />}
                        badge={c.is_authenticated ? "connected" : "needs auth"}
                        badgeTone={c.is_authenticated ? "ok" : "warn"}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="eyebrow mb-1.5 block">
                  Document libraries ({libraryIds.length} selected)
                </label>
                {librariesQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading libraries…</p>
                ) : libraries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No document libraries. Create one under Libraries to ground this agent.
                  </p>
                ) : (
                  <div className="custom-scrollbar max-h-36 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {libraries.map((l) => (
                      <CheckRow
                        key={l.id}
                        checked={libraryIds.includes(l.id)}
                        onToggle={() => setLibraryIds((prev) => toggle(prev, l.id))}
                        title={l.name}
                        description={l.description}
                        icon={<Library className="size-3 text-emerald" />}
                        {...(l.document_count !== undefined
                          ? { badge: `${l.document_count} docs` }
                          : {})}
                      />
                    ))}
                  </div>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 transition-colors hover:bg-surface-hover">
                <input
                  type="checkbox"
                  checked={knowledgeGraph}
                  onChange={(e) => setKnowledgeGraph(e.target.checked)}
                  className="mt-0.5 size-3.5 shrink-0 rounded accent-primary"
                />
                <Network className="mt-0.5 size-3.5 shrink-0 text-cyan" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    Knowledge graph & industry knowledge
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Adds grounded retrieval over the knowledge graph. Off by default — an agent that
                    only quotes its libraries does not need a competing retrieval tool.
                  </span>
                </span>
              </label>
            </TabsContent>

            {/* ── Model settings ─────────────────────────────────────── */}
            <TabsContent
              value="model"
              className="custom-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  Unset values use the model&apos;s defaults.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  disabled={samplingCount === 0}
                  onClick={() => setSampling(EMPTY_SAMPLING)}
                >
                  Reset to defaults
                </Button>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <SamplingSlider
                  label="Temperature"
                  lowLabel="Precise"
                  highLabel="Creative"
                  value={sampling.temperature}
                  fallback={0.7}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onChange={(v) => setSampling((s) => ({ ...s, temperature: v }))}
                />
                <SamplingSlider
                  label="Top P"
                  lowLabel="Focused"
                  highLabel="Diverse"
                  value={sampling.top_p}
                  fallback={1}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setSampling((s) => ({ ...s, top_p: v }))}
                />
                <SamplingNumber
                  label="Max Tokens"
                  placeholder="Default (model limit)"
                  min={1}
                  value={sampling.max_tokens}
                  onChange={(v) => setSampling((s) => ({ ...s, max_tokens: v }))}
                />
                <SamplingNumber
                  label="Random Seed"
                  placeholder="None (random)"
                  min={0}
                  value={sampling.random_seed}
                  onChange={(v) => setSampling((s) => ({ ...s, random_seed: v }))}
                />
                <SamplingSlider
                  label="Frequency Penalty"
                  lowLabel="0"
                  highLabel="2"
                  value={sampling.frequency_penalty}
                  fallback={0}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => setSampling((s) => ({ ...s, frequency_penalty: v }))}
                />
                <SamplingSlider
                  label="Presence Penalty"
                  lowLabel="0"
                  highLabel="2"
                  value={sampling.presence_penalty}
                  fallback={0}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => setSampling((s) => ({ ...s, presence_penalty: v }))}
                />
              </div>
            </TabsContent>

            {/* ── Safety & rules ─────────────────────────────────────── */}
            <TabsContent
              value="safety"
              className="custom-scrollbar mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
            >
              <div className="rounded-xl border border-border bg-background/50 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Safety Guardrails (Mistral Moderation)
                </h4>
                <GuardrailEditor value={guardrails} onChange={setGuardrails} />
              </div>

              <div className="rounded-xl border border-border bg-background/50 p-3">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Rules
                </h4>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Always-on rules apply to every agent. Add optional rules, or let the AI suggest
                  the ones that fit what this agent does.
                </p>
                <RuleSelector
                  scope="agent"
                  value={rules}
                  onChange={setRules}
                  suggestHint={
                    name.trim() && instructions.trim()
                      ? undefined
                      : "Add a name and instructions first"
                  }
                  onSuggest={async () =>
                    (
                      await rulesApi.suggest({
                        scope: "agent",
                        name,
                        description,
                        instructions,
                        tier,
                        model,
                      })
                    ).selected
                  }
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-[11px] text-muted-foreground">
              {!nameOk
                ? "Name the agent to continue."
                : !instructionsOk
                  ? "Instructions need at least 20 characters."
                  : `${selectedTools.length} tools · ${selectedConnectors.length} connectors · ${libraryIds.length} libraries`}
            </p>
            <div className="flex gap-2">
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
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {synthesizing ? (
        <CreateToolModal
          open={synthesizing}
          onOpenChange={setSynthesizing}
          purpose="tool"
          onCreated={(toolName) => {
            if (toolName)
              setSelectedTools((prev) => (prev.includes(toolName) ? prev : [...prev, toolName]));
            onCatalogChanged?.();
          }}
        />
      ) : null}
    </>
  );
}

interface Sampling {
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  random_seed: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
}

const EMPTY_SAMPLING: Sampling = {
  temperature: null,
  top_p: null,
  max_tokens: null,
  random_seed: null,
  frequency_penalty: null,
  presence_penalty: null,
};

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-ring";

function SamplingSlider({
  label,
  lowLabel,
  highLabel,
  value,
  fallback,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  /** Where the thumb sits while the value is unset (the model default). */
  fallback: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {value === null ? "default" : value.toFixed(2)}
          {value !== null ? (
            <button
              type="button"
              title="Use the model default"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(null)}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      </div>
      <Slider
        value={[value ?? fallback]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v ?? null)}
        className={cn("mt-2", value === null && "opacity-60")}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function SamplingNumber({
  label,
  placeholder,
  min,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  min: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-foreground">{label}</label>
      <Input
        type="number"
        min={min}
        step={1}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= min ? n : null);
        }}
        className="mt-1.5 h-8 text-xs"
      />
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  title,
  description,
  icon,
  badge,
  badgeTone,
  mono,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description?: string | null | undefined;
  icon?: ReactNode;
  badge?: string;
  badgeTone?: "ok" | "warn";
  mono?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 size-3.5 shrink-0 rounded accent-primary"
      />
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <span className={cn("text-xs font-medium text-foreground", mono && "font-mono")}>
          {title}
        </span>
        {description ? (
          <p className="line-clamp-1 text-[11px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {badge ? (
        <span
          className={cn(
            "technical-label shrink-0 text-[9px] uppercase",
            badgeTone === "ok" && "text-emerald",
            badgeTone === "warn" && "text-amber",
          )}
        >
          {badge}
        </span>
      ) : null}
    </label>
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
  const [error, setError] = useState<string | null>(null);
  const noun = purpose === "activity" ? "Activity" : "Agent tool";

  // Synthesis runs in the background: closing this dialog hands it off, and
  // the global notification reports the outcome instead.
  const synthesis = useSynthesisRun(purpose, {
    watching: open,
    onFinished: (run, watching) => {
      synthesis.clear();
      if (!watching) return;
      if (run.status === "completed") {
        toast.success(`${noun} “${runOutputName(run) ?? "new"}” synthesised`);
        onOpenChange(false);
        onCreated(runOutputName(run) ?? "");
      } else if (run.status !== "cancelled") {
        setError(run.error ?? `${noun} synthesis failed.`);
      }
    },
  });
  const busy = synthesis.busy;

  const canSubmit = task.trim().length >= 10 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    await synthesis.start(task.trim());
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

          {synthesis.run?.status === "running" ? (
            <div className="space-y-1.5">
              <RunProgressCard
                run={synthesis.run}
                onStop={() => synthesis.run && void stopRun(synthesis.run.id)}
              />
              <p className="text-[11px] text-muted-foreground">
                Codestral is generating the function, verifying type hints, running AST checks, and
                validating test executions. You can close this dialog — synthesis continues in the
                background and you will be notified when it is ready.
              </p>
            </div>
          ) : synthesis.starting ? (
            <div className="flex items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/5 p-3 text-xs font-medium text-cyan">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Starting synthesis…</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={synthesis.starting}
          >
            {busy ? "Run in background" : "Cancel"}
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
