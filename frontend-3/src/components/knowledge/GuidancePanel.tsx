/**
 * Build guidance — the best practices the orchestrator follows when it designs
 * agents and workflows. Distilled items arrive as "proposed" and reach builds
 * only once approved here.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, knowledgeApi, QK } from "@/api";
import type { ItemInput, ItemStatus, KnowledgeItem, KnowledgeVocabulary, Strength } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const STRENGTH_TONE: Record<Strength, string> = {
  must: "border-destructive/40 bg-destructive/10 text-destructive",
  avoid: "border-amber/40 bg-amber/10 text-amber",
  should: "border-primary/40 bg-primary/10 text-primary",
  may: "border-border bg-surface text-muted-foreground",
};

const STATUS_TONE: Record<ItemStatus, string> = {
  proposed: "border-amber/40 text-amber",
  active: "border-success/40 text-success",
  retired: "border-border text-muted-foreground",
  conflicting: "border-destructive/40 text-destructive",
};

export function StrengthPill({ strength }: { strength: Strength | null }) {
  if (!strength) return null;
  return (
    <span className={cn("rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase", STRENGTH_TONE[strength])}>
      {strength}
    </span>
  );
}

const selectClass =
  "h-8 rounded-md border border-input bg-background-elevated px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export function GuidancePanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ItemStatus | "">("proposed");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem | "new" | null>(null);

  const vocab = useQuery({ queryKey: QK.knowledgeVocabulary(), queryFn: knowledgeApi.vocabulary, staleTime: 300_000 });
  const params = { kind: "guidance", ...(status ? { status } : {}) };
  const items = useQuery({ queryKey: QK.knowledgeItems(params), queryFn: () => knowledgeApi.items(params) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["knowledge"] });
  };
  const setItemStatus = useMutation({
    mutationFn: ({ ids, to }: { ids: number[]; to: ItemStatus }) => knowledgeApi.setStatus(ids, to),
    onSuccess: (r, v) => {
      toast.success(`${r.updated} item(s) ${v.to === "active" ? "approved" : v.to}`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => knowledgeApi.remove(id),
    onSuccess: () => {
      toast.success("Deleted");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = items.data?.items ?? [];
    return q ? all.filter((i) => `${i.title} ${i.body} ${i.category}`.toLowerCase().includes(q)) : all;
  }, [items.data, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guidance…" className="h-8 pl-8 text-xs" />
        </div>
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | "")} aria-label="Status">
          <option value="proposed">Waiting for review</option>
          <option value="active">Active</option>
          <option value="conflicting">Conflicting</option>
          <option value="retired">Retired</option>
          <option value="">All</option>
        </select>
        {status === "proposed" && shown.length > 0 ? (
          <Button size="sm" variant="secondary" disabled={setItemStatus.isPending}
            onClick={() => setItemStatus.mutate({ ids: shown.map((i) => i.id), to: "active" })}>
            <Check className="size-3.5" /> Approve all {shown.length}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> New guidance
        </Button>
      </div>

      {items.isError ? (
        <ErrorState error={items.error} />
      ) : items.isLoading ? (
        <p className="py-6 text-center text-xs text-muted-foreground"><Loader2 className="inline size-3.5 animate-spin" /> Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          title={status === "proposed" ? "Nothing waiting for review" : "No guidance here"}
          description="Add a source (a best-practice document, a URL or pasted text) and its distilled items appear here for review — or write one by hand."
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((item) => (
            <li key={item.id} className="glass rounded-xl border border-border/60 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    <StrengthPill strength={item.strength} />
                    {item.title}
                    <span className="text-[10px] font-normal text-muted-foreground">#{item.id} · {item.category.replace(/_/g, " ")}</span>
                    <span className={cn("rounded-full border px-1.5 text-[10px]", STATUS_TONE[item.status])}>{item.status}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded border border-border/60 px-1">{item.concept_id ?? "global"}</span>
                    <span className="rounded border border-border/60 px-1">{item.subject} · {item.audience}</span>
                    {item.conditions.map((c, i) => (
                      <span key={i} className="rounded border border-indigo/30 px-1 text-indigo">
                        if {c.attr} {c.op} {JSON.stringify(c.value ?? "")}
                      </span>
                    ))}
                    {Object.entries(item.effect).map(([k, v]) => (
                      <span key={k} className="rounded border border-purple/30 px-1 text-purple">
                        {k.replace("archetype.", "")} → {Array.isArray(v) ? v.join(", ") : String(v)}
                      </span>
                    ))}
                    {item.source_ref?.quote ? (
                      <span className="italic" title="From the source">
                        “{item.source_ref.quote}”{item.source_ref.page ? ` (p. ${item.source_ref.page})` : ""}
                      </span>
                    ) : null}
                  </div>
                  {item.rationale ? <p className="mt-1 text-[11px] text-amber">{item.rationale}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.status !== "active" ? (
                    <Button size="sm" variant="secondary" title="Approve — builds will use it"
                      onClick={() => setItemStatus.mutate({ ids: [item.id], to: "active" })}>
                      <Check className="size-3.5" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" title="Retire — builds stop using it"
                      onClick={() => setItemStatus.mutate({ ids: [item.id], to: "retired" })}>
                      <Undo2 className="size-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(item)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" title="Delete" onClick={() => remove.mutate(item.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ItemEditorDialog
          item={editing === "new" ? null : editing}
          vocabulary={vocab.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemEditorDialog({
  item,
  vocabulary,
  onClose,
  onSaved,
}: {
  item: KnowledgeItem | null;
  vocabulary: KnowledgeVocabulary | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ItemInput>(() => ({
    kind: "guidance",
    title: item?.title ?? "",
    body: item?.body ?? "",
    category: item?.category ?? "best_practice",
    strength: item?.strength ?? "should",
    subject: item?.subject ?? "both",
    audience: item?.audience ?? "builder",
    concept_id: item?.concept_id ?? null,
    rationale: item?.rationale ?? "",
    status: item?.status ?? "active",
    conditions: item?.conditions ?? [],
    effect: item?.effect ?? {},
  }));
  const [advanced, setAdvanced] = useState(() =>
    JSON.stringify({ conditions: draft.conditions, effect: draft.effect }, null, 2),
  );
  const save = useMutation({
    mutationFn: () => {
      let extra: Pick<ItemInput, "conditions" | "effect"> = {};
      try {
        extra = JSON.parse(advanced) as Pick<ItemInput, "conditions" | "effect">;
      } catch {
        throw new Error("Conditions and effect must be valid JSON.");
      }
      const body = { ...draft, ...extra };
      return item ? knowledgeApi.update(item.id, body) : knowledgeApi.create(body);
    },
    onSuccess: () => {
      toast.success(item ? "Guidance updated" : "Guidance added");
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = <K extends keyof ItemInput>(key: K, value: ItemInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? `Edit guidance #${item.id}` : "New guidance"}</DialogTitle>
          <DialogDescription>
            One short, self-contained practice. Strength decides how firmly builds follow it; an effect lets the
            agent-type decision apply it without asking the model.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Title (≤ 12 words)" />
          <Textarea value={draft.body} onChange={(e) => set("body", e.target.value)} rows={3}
            placeholder="What to do, in one to three sentences." />
          <div className="flex flex-wrap gap-2">
            <select className={selectClass} value={draft.category} onChange={(e) => set("category", e.target.value)} aria-label="Category">
              {(vocabulary?.guidance_categories ?? ["best_practice"]).map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
            <select className={selectClass} value={draft.strength ?? "should"} onChange={(e) => set("strength", e.target.value as Strength)} aria-label="Strength">
              {(vocabulary?.strengths ?? ["must", "should", "may", "avoid"]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className={selectClass} value={draft.subject} onChange={(e) => set("subject", e.target.value as ItemInput["subject"])} aria-label="Applies to">
              <option value="both">agents and workflows</option>
              <option value="agent">agents</option>
              <option value="workflow">workflows</option>
            </select>
            <select className={selectClass} value={draft.audience} onChange={(e) => set("audience", e.target.value as ItemInput["audience"])} aria-label="Audience">
              <option value="builder">read by the builder</option>
              <option value="both">builder and built agents</option>
              <option value="runtime">built agents only</option>
            </select>
            <Input value={draft.concept_id ?? ""} onChange={(e) => set("concept_id", e.target.value || null)}
              placeholder="Catalog node (blank: global)" className="h-8 w-56 text-xs" />
          </div>
          <Textarea value={draft.rationale ?? ""} onChange={(e) => set("rationale", e.target.value)} rows={2} placeholder="Why (optional)" />
          <details className="rounded-lg border border-border/60 p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Conditions and effect (JSON)</summary>
            <Textarea value={advanced} onChange={(e) => setAdvanced(e.target.value)} rows={6} className="mt-2 font-mono text-[11px]" />
            {vocabulary ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Attributes: {Object.keys(vocabulary.condition_attributes).join(", ")}. Effects:{" "}
                {Object.keys(vocabulary.effect_keys).join(", ")}.
              </p>
            ) : null}
          </details>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="size-3.5" /> Cancel</Button>
          <Button disabled={save.isPending || !draft.title.trim() || !draft.body.trim()} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
