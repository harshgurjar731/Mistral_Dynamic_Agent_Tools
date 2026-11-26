/**
 * Industry documents: the upload dialog — what to upload, filed under which
 * node — and the list of documents and packs read so far.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileUp,
  Globe,
  Loader2,
  RefreshCw,
  ScrollText,
  Trash2,
  XCircle,
} from "lucide-react";
import { errorMessage, industryApi, QK } from "@/api";
import type { IndustryConfig } from "@/api/industry";
import { downloadFrom } from "@/api/processes";
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
import { TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { NodeSelect, type TreeIndex } from "./IndustryTree";
import { nodePath } from "./labels";

export function TemplateButtons({ compact = false }: { compact?: boolean }) {
  const get = (format: "json" | "yaml" | "csv") =>
    void downloadFrom(industryApi.templateUrl(format), `industry-knowledge-pack.${format}`).catch(
      (e) => toast.error(errorMessage(e)),
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!compact ? (
        <span className="text-[11px] text-muted-foreground">Structured pack template:</span>
      ) : null}
      {(["json", "yaml", "csv"] as const).map((f) => (
        <Button
          key={f}
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={() => get(f)}
        >
          <Download className="size-3" /> {f.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}

export function IndustryUploadDialog({
  open,
  onOpenChange,
  index,
  config,
  defaultNode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  index: TreeIndex;
  config: IndustryConfig | undefined;
  defaultNode: string | null;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [node, setNode] = useState("");
  const [title, setTitle] = useState("");
  const [jurisdiction, setJurisdiction] = useState("global");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState("file");

  useEffect(() => {
    if (open) {
      setNode(defaultNode ?? "");
      setFile(null);
      setUrl("");
      setText("");
      setTitle("");
    }
  }, [open, defaultNode]);

  const add = useMutation({
    mutationFn: () =>
      industryApi.addSource({
        concept_id: node,
        title: title.trim(),
        jurisdiction: jurisdiction.trim() || "global",
        ...(tab === "file" && file ? { file } : {}),
        ...(tab === "url" ? { url: url.trim() } : {}),
        ...(tab === "text" ? { text } : {}),
      }),
    onSuccess: (r) => {
      const res = r.result;
      if (res.document_type === "industry_pack") {
        toast.success(`${res.created} item(s) imported as approved.`);
      } else if (res.created) {
        toast.success(
          `${res.created} fact(s) extracted` +
            (res.duplicates ? `, ${res.duplicates} duplicate(s) retired` : "") +
            (config?.auto_approve ? "." : " — they wait for your review."),
        );
      } else {
        toast.warning("Nothing was extracted.");
      }
      res.notes.slice(0, 3).forEach((n) => toast.message(n));
      void qc.invalidateQueries({ queryKey: QK.industry() });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ready =
    Boolean(node) &&
    (tab === "file" ? Boolean(file) : tab === "url" ? Boolean(url.trim()) : Boolean(text.trim()));
  const guide = config?.what_to_upload;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add industry knowledge</DialogTitle>
          <DialogDescription>
            Upload a reference document about an industry. Its regulations, standards, rules,
            metrics, risks and terms are extracted, filed under the node you choose (or one below
            it), and wait for review before plans use them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div>
              <label className="eyebrow mb-1.5 block">What it is about</label>
              <NodeSelect index={index} value={node} onChange={setNode} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {node
                  ? `Filed under ${nodePath(index.byId, node)}. Facts specific to a narrower node below it are placed there.`
                  : "Choose at least the industry. Pick the domain or subdomain when the whole document is about one."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="eyebrow mb-1.5 block">Title (optional)</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="FCA MCOB 11 summary"
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Jurisdiction</label>
                <Input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="global, EU, UK, US…"
                />
              </div>
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="file">
                  <FileUp className="mr-1 size-3.5" /> File
                </TabsTrigger>
                <TabsTrigger value="url">
                  <Globe className="mr-1 size-3.5" /> URL
                </TabsTrigger>
                <TabsTrigger value="text">
                  <ScrollText className="mr-1 size-3.5" /> Text
                </TabsTrigger>
              </TabsList>
              <TabsContent value="file" className="pt-3">
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.pptx,.doc,.ppt,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt,.md,.html,.htm,.json,.yaml,.yml,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-surface/30 px-4 py-6 text-center transition hover:border-primary/40"
                >
                  <FileUp className="size-5 text-primary" />
                  <span className="text-xs font-medium text-foreground">
                    {file ? file.name : "Choose a document or a pack"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Up to {config?.source_max_mb ?? 25} MB. A .json, .yaml or .csv in the pack
                    template is imported exactly, as approved.
                  </span>
                </button>
                <div className="mt-2">
                  <TemplateButtons />
                </div>
              </TabsContent>
              <TabsContent value="url" className="pt-3">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://… (a page or a PDF)"
                />
              </TabsContent>
              <TabsContent value="text" className="pt-3">
                <Textarea
                  rows={7}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the text…"
                />
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-3 rounded-xl border border-border/60 bg-surface/30 p-3 text-[11px]">
            <div>
              <p className="eyebrow mb-1.5">Upload these</p>
              <ul className="space-y-1.5">
                {(guide?.accepted ?? []).map((a) => (
                  <li key={a.kind} className="flex gap-1.5">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald" />
                    <span>
                      <span className="font-medium text-foreground">{a.kind}</span>
                      <span className="block text-muted-foreground">{a.examples}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-1.5">Not here</p>
              <ul className="space-y-1">
                {(guide?.elsewhere ?? []).map((e) => (
                  <li key={e.kind} className="flex gap-1.5 text-muted-foreground">
                    <XCircle className="mt-0.5 size-3 shrink-0 text-red" />
                    <span>
                      {e.kind}
                      {e.page ? (
                        <>
                          {" "}
                          —{" "}
                          {e.page === "/processes" ? (
                            <Link to="/processes" className="text-primary hover:underline">
                              Processes
                            </Link>
                          ) : (
                            <Link to="/knowledge" className="text-primary hover:underline">
                              Knowledge
                            </Link>
                          )}
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              Formats: {(guide?.formats ?? []).join(", ")}. Up to {config?.max_excerpts ?? 40}{" "}
              excerpts of a document are read.
            </p>
          </aside>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={!ready || add.isPending}>
            {add.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Reading…
              </>
            ) : (
              "Add and extract"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOURCE_TONE: Record<string, string> = {
  pending: "text-muted-foreground",
  extracted: "text-cyan",
  distilled: "text-emerald",
  failed: "text-red",
};

export function IndustrySourcesPanel({
  canManage,
  onShowItems,
}: {
  canManage: boolean;
  onShowItems: (sourceId: number) => void;
}) {
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: QK.industrySources(), queryFn: industryApi.sources });
  const invalidate = () => void qc.invalidateQueries({ queryKey: QK.industry() });
  const redistill = useMutation({
    mutationFn: (id: number) => industryApi.redistill(id),
    onSuccess: (r) => {
      toast.success(`${r.created} fact(s) extracted again.`);
      r.notes.slice(0, 2).forEach((n) => toast.message(n));
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => industryApi.removeSource(id),
    onSuccess: (r) => {
      toast.success(`Document deleted with ${r.items_removed} item(s).`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (sources.isLoading) return <TableSkeleton rows={4} />;
  if (sources.isError)
    return <ErrorState error={sources.error} onRetry={() => sources.refetch()} />;
  const rows = sources.data?.sources ?? [];
  if (!rows.length)
    return (
      <EmptyState
        icon={<ScrollText className="size-6" />}
        title="No industry documents yet."
        description="Upload a regulation, a standard, a policy manual or a KPI handbook, or import a structured pack."
      />
    );

  return (
    <ul className="space-y-2">
      {rows.map((s) => (
        <li key={s.id} className="rounded-xl border border-border/60 bg-background-elevated/60 p-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
              <p className="mt-0.5 font-mono text-[10px] text-cyan">{s.path || s.concept_id}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <span className={cn("font-medium", SOURCE_TONE[s.status])}>{s.status}</span> ·{" "}
                {s.item_count} item(s) · {s.source_type}
                {s.filename ? ` · ${s.filename}` : ""}
                {s.created_at ? ` · ${formatRelative(s.created_at)}` : ""}
              </p>
              {s.message ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{s.message}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => onShowItems(s.id)}
              >
                Items
              </Button>
              {canManage ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    title="Read again (replaces what is still waiting for review)"
                    onClick={() => redistill.mutate(s.id)}
                    disabled={redistill.isPending || s.text_chars === 0}
                  >
                    {redistill.isPending && redistill.variables === s.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground hover:text-red"
                    title="Delete with its items"
                    onClick={() => remove.mutate(s.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
