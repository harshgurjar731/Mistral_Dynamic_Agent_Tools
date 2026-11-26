/**
 * One industry knowledge item, the dialog that creates or edits one, and the
 * list of builds that used it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban,
  Check,
  Edit2,
  FileText,
  History,
  Loader2,
  Quote,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { errorMessage, industryApi, QK } from "@/api";
import type {
  IndustryCategory,
  IndustryForce,
  IndustryItem,
  IndustryItemInput,
} from "@/api/industry";
import { Markdown } from "@/components/chat/Markdown";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { NodeSelect, type TreeIndex } from "./IndustryTree";
import {
  CATEGORY,
  CATEGORY_ORDER,
  FORCE,
  FORCE_ORDER,
  forceOf,
  RELATION,
  SELECT_CLASS,
  STATUS_LABEL,
  STATUS_TONE,
} from "./labels";

function Chip({
  className,
  children,
  title,
}: {
  className?: string | undefined;
  children: React.ReactNode;
  title?: string | undefined;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IndustryItemCard({
  item,
  selected,
  onToggle,
  canManage,
  onEdit,
  onUsage,
}: {
  item: IndustryItem;
  selected: boolean;
  onToggle: () => void;
  canManage: boolean;
  onEdit: () => void;
  onUsage: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const force = forceOf(item.strength);
  const category = CATEGORY[item.category] ?? CATEGORY.definition;
  const invalidate = () => void qc.invalidateQueries({ queryKey: QK.industry() });

  const status = useMutation({
    mutationFn: (next: "active" | "retired" | "proposed") => industryApi.setStatus([item.id], next),
    onSuccess: (_r, next) => {
      toast.success(
        next === "active"
          ? "Approved — plans in scope now use it."
          : next === "retired"
            ? "Retired."
            : "Sent back to review.",
      );
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => industryApi.remove(item.id),
    onSuccess: () => {
      toast.success("Deleted.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li
      className={cn(
        "rounded-xl border p-3 transition",
        selected ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background-elevated/60",
        item.relation === "inherited" && "border-dashed",
      )}
    >
      <div className="flex items-start gap-2.5">
        {canManage ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${item.title}`}
            className="mt-1 accent-[var(--primary)]"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className={FORCE[force].tone} title={FORCE[force].hint}>
              {FORCE[force].label}
            </Chip>
            <Chip className={category.tone} title={category.hint}>
              {category.label}
            </Chip>
            {item.jurisdiction && item.jurisdiction !== "global" ? (
              <Chip className="border-border bg-muted/30 text-foreground">{item.jurisdiction}</Chip>
            ) : null}
            {item.as_of ? (
              <Chip className="border-border text-muted-foreground">as of {item.as_of}</Chip>
            ) : null}
            {item.status !== "active" ? (
              <Chip className={STATUS_TONE[item.status]}>
                {STATUS_LABEL[item.status] ?? item.status}
              </Chip>
            ) : null}
            {item.relation && item.relation !== "exact" ? (
              <Chip className="border-border text-muted-foreground">{RELATION[item.relation]}</Chip>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-cyan">{item.path || item.concept_id}</p>
          {!open ? (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {canManage && item.status !== "active" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => status.mutate("active")}
              disabled={status.isPending}
              title="Approve: plans in scope will use it"
            >
              <Check className="size-3.5" /> Approve
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onUsage}
            title="Where it was used"
          >
            <History className="size-3.5" />
          </Button>
          {canManage ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onEdit} title="Edit">
                <Edit2 className="size-3.5" />
              </Button>
              {item.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => status.mutate("retired")}
                  title="Retire: plans stop using it"
                >
                  <Ban className="size-3.5" />
                </Button>
              ) : item.status === "retired" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => status.mutate("proposed")}
                  title="Back to review"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted-foreground hover:text-red"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
          <Markdown content={item.body} />
          {item.source_ref?.quote ? (
            <p className="flex gap-1.5 rounded-lg border border-border/50 bg-surface/40 p-2 text-[11px] text-muted-foreground italic">
              <Quote className="mt-0.5 size-3 shrink-0" />
              <span>
                “{item.source_ref.quote}”
                {item.source_ref.page ? (
                  <span className="not-italic"> — page {item.source_ref.page}</span>
                ) : null}
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {item.source_id ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3" /> from document #{item.source_id}
              </span>
            ) : (
              <span>
                {item.origin === "seed" ? "shipped with the platform" : "written by hand"}
              </span>
            )}
            {item.confidence ? <span>· {item.confidence} confidence</span> : null}
            <span>
              · used by {item.stats.used} build{item.stats.used === 1 ? "" : "s"} (
              {item.stats.accepted_builds} accepted, {item.stats.rolled_back_builds} rolled back)
            </span>
            {item.tags.length ? <span>· {item.tags.map((t) => `#${t}`).join(" ")}</span> : null}
            {item.rationale ? <span className="text-amber">· {item.rationale}</span> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

const EMPTY: IndustryItemInput = {
  concept_id: "",
  category: "regulation",
  title: "",
  body: "",
  strength: "must",
  jurisdiction: "global",
  as_of: null,
  tags: [],
};

export function IndustryItemDialog({
  open,
  onOpenChange,
  index,
  item,
  defaultNode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  index: TreeIndex;
  /** Edit this item; create a new one when absent. */
  item?: IndustryItem | null;
  defaultNode?: string | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<IndustryItemInput>(EMPTY);
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!open) return;
    if (item) {
      setForm({
        concept_id: item.concept_id ?? "",
        category: item.category,
        title: item.title,
        body: item.body,
        strength: forceOf(item.strength),
        jurisdiction: item.jurisdiction ?? "global",
        as_of: item.as_of,
        tags: item.tags,
      });
      setTags(item.tags.join(", "));
    } else {
      setForm({ ...EMPTY, concept_id: defaultNode ?? "" });
      setTags("");
    }
  }, [open, item, defaultNode]);

  const set = <K extends keyof IndustryItemInput>(key: K, value: IndustryItemInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body: IndustryItemInput = {
        ...form,
        as_of: form.as_of?.trim() || null,
        jurisdiction: form.jurisdiction.trim() || "global",
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      return item ? industryApi.update(item.id, body) : industryApi.create(body);
    },
    onSuccess: () => {
      toast.success(item ? "Saved." : "Added — plans in scope use it from the next build.");
      void qc.invalidateQueries({ queryKey: QK.industry() });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const category = CATEGORY[form.category];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? "Edit industry knowledge" : "New industry knowledge"}</DialogTitle>
          <DialogDescription>
            One rule, formula, threshold, obligation, risk, standard or term — short and
            self-contained, so a planner or a code generator can apply it on its own. File it at the
            most general level it is true at.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="eyebrow mb-1.5 block">Filed on</label>
            <NodeSelect
              index={index}
              value={form.concept_id}
              onChange={(id) => set("concept_id", id)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="eyebrow mb-1.5 block">Category</label>
              <select
                className={`${SELECT_CLASS} w-full`}
                value={form.category}
                onChange={(e) => set("category", e.target.value as IndustryCategory)}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY[c].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">{category.hint}</p>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Force</label>
              <select
                className={`${SELECT_CLASS} w-full`}
                value={form.strength ?? "may"}
                onChange={(e) => set("strength", e.target.value as IndustryForce)}
              >
                {FORCE_ORDER.map((f) => (
                  <option key={f} value={f}>
                    {FORCE[f].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {FORCE[form.strength ?? "may"].hint}
              </p>
            </div>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Title</label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Body</label>
            <Textarea rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Keep numbers, units, limits and formulas exactly as the source states them.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="eyebrow mb-1.5 block">Jurisdiction</label>
              <Input
                value={form.jurisdiction}
                onChange={(e) => set("jurisdiction", e.target.value)}
                placeholder="global, EU, UK, US-CA…"
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">As of</label>
              <Input
                value={form.as_of ?? ""}
                onChange={(e) => set("as_of", e.target.value)}
                placeholder="2026-01"
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Tags</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="ltv, affordability"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.concept_id || !form.title.trim() || !form.body.trim()}
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {item ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IndustryUsageDialog({
  itemId,
  onClose,
}: {
  itemId: number | null;
  onClose: () => void;
}) {
  const usage = useQuery({
    queryKey: QK.industryUsage(itemId ?? 0),
    queryFn: () => industryApi.usage(itemId!),
    enabled: itemId !== null,
  });
  const rows = usage.data?.usage ?? [];
  return (
    <Dialog open={itemId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Where it was used</DialogTitle>
          <DialogDescription>
            {usage.data?.item.title ?? "…"} — every agent and workflow whose plan or code named it.
          </DialogDescription>
        </DialogHeader>
        {usage.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Not used yet."
            description="It is shown to plans in its scope; a build records it here once a decision says it acted on it."
            className="py-8"
          />
        ) : (
          <ul className="custom-scrollbar max-h-96 space-y-1.5 overflow-y-auto">
            {rows.map((r, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/60 bg-background-elevated/60 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {r.subject_name || r.subject_id}
                  </span>
                  <span className="technical-label">{r.subject_type}</span>
                  <span className="technical-label">{r.layer}</span>
                  {r.created_at ? (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatRelative(r.created_at)}
                    </span>
                  ) : null}
                </div>
                {r.how ? <p className="mt-1 text-[11px] text-muted-foreground">{r.how}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
