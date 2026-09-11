import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { errorMessage, ontologyApi } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  capability_gap: "Capability coverage",
  egress: "Restricted data egress",
  guardrail: "Guardrail coverage",
  library_domain: "Library / domain match",
  cardinality: "Cardinality",
  derives_annotation: "Derived annotation",
};

export function RulesTab() {
  const qc = useQueryClient();
  const [showEditor, setShowEditor] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ontology", "rules"],
    queryFn: () => ontologyApi.rules(),
  });

  const approve = useMutation({
    mutationFn: (id: string) => ontologyApi.approveRule(id),
    onSuccess: () => {
      toast.success("Rule approved");
      qc.invalidateQueries({ queryKey: ["ontology", "rules"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ontologyApi.deleteRule(id),
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["ontology", "rules"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold text-foreground">Validation & Governance Rules</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Declarative governance checks run during workflow validation before publishing.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowEditor(true)} className="flex items-center gap-1.5">
            <Plus className="size-3.5" /> Add Rule
          </Button>
        </div>
      </GlassPanel>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No rules recorded yet"
          description="Rules govern capabilities, egress, and domain consistency across workflows."
        />
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <GlassPanel key={r.id} className="p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex items-center gap-2.5 text-left"
                >
                  {expanded === r.id ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">{r.id}</span>
                      <span className="technical-label">{KIND_LABELS[r.kind] ?? r.kind}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold",
                          r.status === "approved"
                            ? "bg-emerald/10 text-emerald border border-emerald/30"
                            : "bg-amber/10 text-amber border border-amber/30",
                        )}
                      >
                        {r.status}
                      </span>
                    </div>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  {r.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => approve.mutate(r.id)}
                      disabled={approve.isPending}
                      className="h-7 flex items-center gap-1 text-xs"
                    >
                      <Check className="size-3 text-emerald" /> Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(r.id)}
                    disabled={remove.isPending}
                    className="h-7 text-muted-foreground hover:text-red"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>

              {expanded === r.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="eyebrow mb-1 text-[10px]">Rule Parameters (JSON)</p>
                  <pre className="custom-scrollbar max-h-44 overflow-auto rounded-lg border border-border bg-background-elevated p-2.5 font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(r.params ?? {}, null, 2)}
                  </pre>
                </div>
              )}
            </GlassPanel>
          ))}
        </div>
      )}

      {showEditor && (
        <CreateRuleModal
          open={showEditor}
          onOpenChange={setShowEditor}
          onCreated={() => {
            setShowEditor(false);
            qc.invalidateQueries({ queryKey: ["ontology", "rules"] });
          }}
        />
      )}
    </div>
  );
}

function CreateRuleModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState("capability_gap");
  const [description, setDescription] = useState("");
  const [paramsText, setParamsText] = useState("{}");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(paramsText);
      } catch {
        toast.error("Invalid JSON parameters");
        setBusy(false);
        return;
      }
      await ontologyApi.createRule({
        id: id.trim(),
        kind,
        description: description.trim(),
        params: parsed,
        severity: "error",
      });
      toast.success("Rule created as draft");
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-background-elevated">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">Create Governance Rule</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Created rules enter in draft state until explicitly approved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="eyebrow mb-1 block">Rule ID</label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. check_guardrails_required"
              className="text-xs font-mono"
            />
          </div>
          <div>
            <label className="eyebrow mb-1 block">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background-elevated px-2.5 text-xs text-foreground"
            >
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label} ({k})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="eyebrow mb-1 block">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this rule checks"
              className="text-xs"
            />
          </div>
          <div>
            <label className="eyebrow mb-1 block">Parameters (JSON)</label>
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background-elevated p-2 font-mono text-xs text-foreground focus:outline-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !id.trim()}>
            {busy && <Loader2 className="size-3.5 animate-spin mr-1.5" />} Create Draft Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
