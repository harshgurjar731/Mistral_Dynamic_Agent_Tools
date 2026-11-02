/**
 * Knowledge sources — any file, a URL or pasted text. Each is read (Mistral OCR
 * for PDFs, scans and Office files), distilled into short items, embedded and
 * checked against existing guidance; the items then wait for review.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Globe, Loader2, RefreshCw, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, knowledgeApi, QK } from "@/api";
import type { KnowledgeSource } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<KnowledgeSource["status"], string> = {
  pending: "text-muted-foreground",
  extracted: "text-cyan",
  distilled: "text-success",
  failed: "text-destructive",
};

export function SourcesPanel() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [conceptId, setConceptId] = useState("");

  const sources = useQuery({ queryKey: QK.knowledgeSources(), queryFn: knowledgeApi.sources });
  const done = (r: { result: { created: number; conflicts: number; notes: string[] } }) => {
    toast.success(
      `${r.result.created} item(s) distilled` + (r.result.conflicts ? `, ${r.result.conflicts} conflicting` : "") +
        " — review them under Guidance.",
    );
    r.result.notes.slice(0, 2).forEach((n) => toast.message(n));
    setUrl("");
    setText("");
    setTitle("");
    void qc.invalidateQueries({ queryKey: ["knowledge"] });
  };
  const add = useMutation({
    mutationFn: (input: { file?: File; url?: string; text?: string }) =>
      knowledgeApi.addSource({ ...input, title, ...(conceptId ? { concept_id: conceptId } : {}) }),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const redistill = useMutation({
    mutationFn: (id: number) => knowledgeApi.redistill(id),
    onSuccess: (r) => {
      toast.success(`${r.created} item(s) distilled again`);
      void qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => knowledgeApi.removeSource(id),
    onSuccess: (r) => {
      toast.success(`Source deleted with ${r.items_removed} item(s)`);
      void qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl border border-border/60 p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="h-8 max-w-xs text-xs" />
          <Input value={conceptId} onChange={(e) => setConceptId(e.target.value)}
            placeholder="Catalog node it is about (optional)" className="h-8 max-w-xs text-xs" />
        </div>
        <Tabs defaultValue="file">
          <TabsList>
            <TabsTrigger value="file"><FileUp className="mr-1 size-3.5" /> File</TabsTrigger>
            <TabsTrigger value="url"><Globe className="mr-1 size-3.5" /> URL</TabsTrigger>
            <TabsTrigger value="text"><ScrollText className="mr-1 size-3.5" /> Text</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="pt-2">
            <input ref={fileInput} type="file" className="hidden"
              accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.json,.yaml,.yml,.csv,.html"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) add.mutate({ file });
                e.target.value = "";
              }} />
            <Button variant="secondary" disabled={add.isPending} onClick={() => fileInput.current?.click()}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              Choose a file — PDF, Word, PowerPoint, image, text, JSON…
            </Button>
          </TabsContent>
          <TabsContent value="url" className="flex gap-2 pt-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-9" />
            <Button disabled={add.isPending || !url.trim()} onClick={() => add.mutate({ url: url.trim() })}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Add
            </Button>
          </TabsContent>
          <TabsContent value="text" className="space-y-2 pt-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
              placeholder="Paste best practices, a design standard, lessons learned…" />
            <Button disabled={add.isPending || !text.trim()} onClick={() => add.mutate({ text })}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Distil
            </Button>
          </TabsContent>
        </Tabs>
        {add.isPending ? (
          <p className="mt-2 text-[11px] text-muted-foreground">Reading and distilling — a long document takes a minute.</p>
        ) : null}
      </div>

      {sources.isError ? (
        <ErrorState error={sources.error} />
      ) : (sources.data?.sources ?? []).length === 0 ? (
        <EmptyState title="No sources yet" description="Everything distilled keeps a link to the source and page it came from." />
      ) : (
        <ul className="space-y-1.5">
          {sources.data!.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs">
              <span className="font-medium text-foreground">{s.title}</span>
              <span className="text-muted-foreground">{s.source_type}{s.filename ? ` · ${s.filename}` : ""}</span>
              <span className={cn("font-medium", STATUS_TONE[s.status])}>{s.status}</span>
              <span className="text-muted-foreground">{s.item_count} item(s) · {Math.round(s.text_chars / 1000)}k chars</span>
              {s.message ? <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={s.message}>{s.message}</span> : <span className="flex-1" />}
              <Button size="sm" variant="ghost" title="Distil again (replaces items still waiting for review)"
                disabled={redistill.isPending || !s.text_chars} onClick={() => redistill.mutate(s.id)}>
                <RefreshCw className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Delete the source and its items" onClick={() => remove.mutate(s.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
