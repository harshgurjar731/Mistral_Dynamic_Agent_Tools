/**
 * Create or edit one node of the process tree — an industry, domain or
 * subdomain (ontology domain concepts) or a process or subprocess (ontology
 * process concepts). Synonyms are what goal matching scores a request against,
 * so the form asks for them in those terms.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessLevel, TreeConcept } from "@/api/processes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LivePercent } from "@/components/activity/LiveProgress";

const LEVEL_TEXT: Record<ProcessLevel, { title: string; hint: string }> = {
  industry: { title: "industry", hint: "A line of business, e.g. Insurance or Healthcare." },
  domain: { title: "domain", hint: "An area inside the industry, e.g. Claims or Underwriting." },
  subdomain: { title: "subdomain", hint: "A product or speciality, e.g. Motor claims." },
  process: {
    title: "process",
    hint: "An end-to-end business process in this domain, e.g. Claims lifecycle.",
  },
  subprocess: {
    title: "subprocess",
    hint: "A part of the parent process with its own stages, e.g. Fraud review.",
  },
};

export function NodeFormDialog({
  open,
  onOpenChange,
  level,
  parentId,
  parentLabel,
  node,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: ProcessLevel;
  parentId?: string | null | undefined;
  parentLabel?: string | undefined;
  /** Editing this node; omitted to create. */
  node?: TreeConcept | null | undefined;
  onSaved?: ((node: TreeConcept) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [definition, setDefinition] = useState("");
  const [synonyms, setSynonyms] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(node?.label ?? "");
    setDefinition(node?.definition ?? "");
    setSynonyms((node?.synonyms ?? []).filter((s) => !s.startsWith("!")).join(", "));
  }, [open, node]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: label.trim(),
        definition: definition.trim(),
        synonyms: synonyms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      return node
        ? processesApi.updateNode(node.id, body)
        : processesApi.createNode({ level, parent_id: parentId ?? null, ...body });
    },
    onSuccess: (saved) => {
      toast.success(
        node
          ? "Saved."
          : `${LEVEL_TEXT[level].title[0]!.toUpperCase()}${LEVEL_TEXT[level].title.slice(1)} created.`,
      );
      void qc.invalidateQueries({ queryKey: QK.processes() });
      void qc.invalidateQueries({ queryKey: QK.ontology() });
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const text = LEVEL_TEXT[level];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {node ? `Edit ${text.title}` : `New ${text.title}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {parentLabel ? (
              <>
                Under <span className="text-foreground">{parentLabel}</span>.{" "}
              </>
            ) : null}
            {text.hint} It is added to the ontology, so it appears there and on the graph too.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="node-label" className="text-xs">
              Name
            </Label>
            <Input
              id="node-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-definition" className="text-xs">
              Definition
            </Label>
            <Textarea
              id="node-definition"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={3}
              className="text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-synonyms" className="text-xs">
              Other names <span className="text-muted-foreground">(comma separated)</span>
            </Label>
            <Input
              id="node-synonyms"
              value={synonyms}
              onChange={(e) => setSynonyms(e.target.value)}
              placeholder="the words people use for it in a request"
            />
            <p className="text-[10px] text-muted-foreground">
              Requests are matched against the name and these. Good names here are how a process is
              found when nothing is attached.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!label.trim() || save.isPending}>
              {save.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : null}
              {node ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete a node, asking again — with what it would take along — when the
 * first attempt is refused because something hangs off it.
 */
export async function deleteNodeFlow(
  node: { id: string; label: string },
  done: () => void,
): Promise<void> {
  if (!window.confirm(`Delete "${node.label}"?`)) return;
  try {
    await processesApi.deleteNode(node.id);
    toast.success(`Deleted "${node.label}".`);
    done();
  } catch (e) {
    const msg = errorMessage(e);
    if (!/cascade/i.test(msg)) {
      toast.error(msg);
      return;
    }
    const cleaned = msg.replace(/ Pass cascade=true.*$/i, "");
    if (
      !window.confirm(
        `${cleaned}\n\nDelete "${node.label}" together with everything under it, its process documents and their usage history? This cannot be undone.`,
      )
    )
      return;
    try {
      await processesApi.deleteNode(node.id, true);
      toast.success(`Deleted "${node.label}" and everything under it.`);
      done();
    } catch (e2) {
      toast.error(errorMessage(e2));
    }
  }
}
