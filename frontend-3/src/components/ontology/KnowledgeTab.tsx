import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Link2, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { errorMessage, ontologyApi, QK } from "@/api";
import type { Concept, KnowledgeEntry } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/chat/Markdown";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground";

function asArray<T>(res: { [k: string]: T[] } | T[] | undefined, key: string): T[] {
  if (!res) return [];
  return Array.isArray(res) ? res : ((res as Record<string, T[]>)[key] ?? []);
}

export function KnowledgeTab() {
  const qc = useQueryClient();
  const [conceptFilter, setConceptFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (conceptFilter) p["concept_id"] = conceptFilter;
    if (kindFilter) p["kind"] = kindFilter;
    return p;
  }, [conceptFilter, kindFilter]);

  const entriesQ = useQuery({
    queryKey: QK.knowledge(params),
    queryFn: () => ontologyApi.knowledge(params),
  });

  const conceptsQ = useQuery({
    queryKey: QK.ontologyConcepts("domain"),
    queryFn: () => ontologyApi.concepts("domain"),
  });
  const concepts = asArray<Concept>(conceptsQ.data, "concepts");

  const remove = useMutation({
    mutationFn: (id: number) => ontologyApi.deleteKnowledge(id),
    onSuccess: () => {
      toast.success("Entry deleted.");
      qc.invalidateQueries({ queryKey: ["ontology", "knowledge"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attach = useMutation({
    mutationFn: () => ontologyApi.attachKnowledgeTool(),
    onSuccess: (r) =>
      toast.success(
        `Checked ${r.checked} agents — ${r.attached} attached, ${r.unchanged} already had it.`,
      ),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const visible = useMemo(() => {
    const all = entriesQ.data?.entries ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q) ||
        e.concept_id.toLowerCase().includes(q),
    );
  }, [entriesQ.data, search]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <GlassPanel className="min-w-0">
        <GlassPanelHeader
          title="Industry knowledge"
          description="What the knowledge tool retrieves for agents, scoped by their domain annotation."
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => attach.mutate()}
                disabled={attach.isPending}
                title="Give every agent the knowledge tool"
              >
                {attach.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Link2 className="size-3.5" />
                )}
                Attach tool
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" /> New entry
              </Button>
            </div>
          }
        />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Filter entries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className={SELECT_CLASS}
              value={conceptFilter}
              onChange={(e) => setConceptFilter(e.target.value)}
            >
              <option value="">All domains</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              className={SELECT_CLASS}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="">All kinds</option>
              {(entriesQ.data?.kinds ?? []).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          {entriesQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : entriesQ.isError ? (
            <ErrorState error={entriesQ.error} onRetry={() => entriesQ.refetch()} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-6" />}
              title="No knowledge entries."
              description="Entries are seeded from the shipped vocabulary and can be extended by hand."
            />
          ) : (
            <ul className="space-y-2">
              {visible.map((e) => (
                <EntryCard key={e.id} entry={e} onDelete={() => remove.mutate(e.id)} />
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>

      <RehearsalPanel concepts={concepts} />

      <CreateEntryDialog
        open={creating}
        concepts={concepts}
        kinds={entriesQ.data?.kinds ?? []}
        onOpenChange={setCreating}
      />
    </div>
  );
}

function EntryCard({ entry, onDelete }: { entry: KnowledgeEntry; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-border bg-background-elevated/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-foreground">{entry.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-cyan">{entry.concept_id}</span>
            <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase">
              {entry.kind}
            </span>
            {entry.tags.slice(0, 4).map((t) => (
              <span key={t} className="technical-label">
                #{t}
              </span>
            ))}
          </div>
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-red"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {open ? (
        <div className="mt-3 border-t border-border pt-3">
          <Markdown content={entry.body} />
        </div>
      ) : (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{entry.body}</p>
      )}
    </li>
  );
}

function RehearsalPanel({ concepts }: { concepts: Concept[] }) {
  const [query, setQuery] = useState("");
  const [domains, setDomains] = useState("");
  const [submitted, setSubmitted] = useState<{ query: string; domains: string } | null>(null);

  const params = useMemo(
    () =>
      submitted
        ? { query: submitted.query, ...(submitted.domains ? { domains: submitted.domains } : {}) }
        : {},
    [submitted],
  );

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: QK.knowledgeSearch(params),
    queryFn: () => ontologyApi.knowledgeSearch(params),
    enabled: submitted !== null,
  });

  return (
    <GlassPanel className="h-fit">
      <GlassPanelHeader
        title="Rehearse a retrieval"
        description="Runs the same code path the agent tool uses."
      />
      <div className="space-y-3 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) setSubmitted({ query: query.trim(), domains });
          }}
          className="space-y-2"
        >
          <Input
            placeholder="What would the agent be asked?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className={`${SELECT_CLASS} w-full`}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          >
            <option value="">Unscoped — search every domain</option>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                Scoped to {c.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" className="w-full" disabled={!query.trim()}>
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Retrieve
          </Button>
        </form>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data ? (
          <div className="space-y-3">
            <p className="technical-label">
              {data.count} hit{data.count === 1 ? "" : "s"}
              {data.domains.length > 0 ? ` · scoped to ${data.domains.join(", ")}` : " · unscoped"}
            </p>
            {data.results.length === 0 ? (
              <EmptyState title="Nothing retrieved." className="py-8" />
            ) : (
              <ul className="space-y-1.5">
                {data.results.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border bg-background-elevated/60 px-2.5 py-2"
                  >
                    <p className="truncate text-xs font-medium text-foreground">{r.title}</p>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-cyan">{r.concept_id}</span>
                      {typeof r.score === "number" ? (
                        <span className="technical-label">score {r.score.toFixed(2)}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.rendered ? (
              <div>
                <p className="eyebrow mb-1.5">Exactly what the model receives</p>
                <pre className="custom-scrollbar max-h-56 overflow-auto rounded-lg border border-border bg-background-elevated p-2.5 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                  {data.rendered}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ask a question to see which entries an agent would get back, and how they are rendered
            into its prompt.
          </p>
        )}
      </div>
    </GlassPanel>
  );
}

function CreateEntryDialog({
  open,
  concepts,
  kinds,
  onOpenChange,
}: {
  open: boolean;
  concepts: Concept[];
  kinds: string[];
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [conceptId, setConceptId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("");
  const [tags, setTags] = useState("");

  const create = useMutation({
    mutationFn: () =>
      ontologyApi.createKnowledge({
        concept_id: conceptId,
        title,
        body,
        ...(kind ? { kind } : {}),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success("Knowledge entry saved.");
      qc.invalidateQueries({ queryKey: ["ontology", "knowledge"] });
      onOpenChange(false);
      setTitle("");
      setBody("");
      setTags("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New knowledge entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="eyebrow mb-1.5 block">Domain concept</label>
            <select
              className={`${SELECT_CLASS} w-full`}
              value={conceptId}
              onChange={(e) => setConceptId(e.target.value)}
            >
              <option value="">— choose a domain —</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Body</label>
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow mb-1.5 block">Kind</label>
              <select
                className={`${SELECT_CLASS} w-full`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">default</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Tags</label>
              <Input
                placeholder="comma, separated"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !conceptId || !title.trim() || !body.trim()}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
