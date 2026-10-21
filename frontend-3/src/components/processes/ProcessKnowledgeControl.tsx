/**
 * The process-knowledge bar on the agent and workflow orchestration pages.
 *
 * A toggle (to build with and without, and compare), the documents attached to
 * this request, and — when none are attached — a live preview of which process
 * the layer would match from the inventory for what is being typed.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { BookOpenCheck, FolderInput, Loader2, Paperclip, Search, Sparkles, X } from "lucide-react";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessDocument, ProcessKnowledgeRequest } from "@/api/processes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ProcessCascadePicker } from "./ProcessCascadePicker";
import { DocumentStatusBadge, FileDrop, TemplateDownloadMenu } from "./shared";
import { useDocumentIngest } from "./useDocumentIngest";

export interface AttachedDoc {
  id: number;
  title: string;
  version: number;
  status: ProcessDocument["status"];
  concept_id: string | null;
  source: string;
}

const storageKey = (page: string) => `process_knowledge:${page}`;

function readStored(page: string): boolean | null {
  try {
    const v = window.localStorage.getItem(storageKey(page));
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

/** The toggle and attachments for one orchestration page. */
export function useProcessKnowledge(page: "agent" | "workflow") {
  const config = useQuery({
    queryKey: QK.processConfig(),
    queryFn: processesApi.config,
    staleTime: 60_000,
  });
  const [stored, setStored] = useState<boolean | null>(null);
  const [attached, setAttached] = useState<AttachedDoc[]>([]);

  useEffect(() => setStored(readStored(page)), [page]);

  const enabled = stored ?? Boolean(config.data?.default_enabled);
  const setEnabled = (on: boolean) => {
    setStored(on);
    try {
      window.localStorage.setItem(storageKey(page), on ? "1" : "0");
    } catch {
      // Storage disabled: the choice lasts for this visit only.
    }
  };

  const request: ProcessKnowledgeRequest = useMemo(
    () => ({ enabled, document_ids: enabled ? attached.map((d) => d.id) : [] }),
    [enabled, attached],
  );

  const attach = (doc: AttachedDoc) =>
    setAttached((prev) => (prev.some((d) => d.id === doc.id) ? prev : [...prev, doc]));
  const detach = (id: number) => setAttached((prev) => prev.filter((d) => d.id !== id));
  const replace = (doc: AttachedDoc) =>
    setAttached((prev) => prev.map((d) => (d.id === doc.id ? doc : d)));

  return { enabled, setEnabled, attached, attach, detach, replace, request, config: config.data };
}

export type ProcessKnowledgeState = ReturnType<typeof useProcessKnowledge>;

const asAttached = (d: ProcessDocument): AttachedDoc => ({
  id: d.id,
  title: d.title,
  version: d.version,
  status: d.status,
  concept_id: d.concept_id,
  source: d.source,
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProcessKnowledgeControl({
  state,
  goal,
  disabled,
  className,
}: {
  state: ProcessKnowledgeState;
  /** What is being typed — previews the inventory match. */
  goal: string;
  disabled?: boolean;
  className?: string;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [filing, setFiling] = useState<AttachedDoc | null>(null);
  const debounced = useDebounced(goal.trim(), 700);
  const preview = useQuery({
    queryKey: QK.processResolve(debounced),
    queryFn: () => processesApi.resolve(debounced),
    enabled: state.enabled && state.attached.length === 0 && debounced.length >= 8,
    staleTime: 30_000,
  });

  const best = preview.data?.candidates?.[0];
  const chosen = preview.data?.documents?.[0];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs backdrop-blur-md transition-colors",
        state.enabled
          ? "border-indigo/30 bg-indigo/5"
          : "border-border/60 bg-background-elevated/70",
        className,
      )}
    >
      <label className="flex cursor-pointer items-center gap-2">
        <Switch
          checked={state.enabled}
          onCheckedChange={state.setEnabled}
          disabled={disabled}
          aria-label="Build with process knowledge"
        />
        <span
          className={cn("font-medium", state.enabled ? "text-indigo" : "text-muted-foreground")}
        >
          <BookOpenCheck className="mr-1 inline size-3.5" />
          Process knowledge {state.enabled ? "on" : "off"}
        </span>
      </label>

      {state.enabled ? (
        <>
          {state.attached.map((d) => (
            <span
              key={d.id}
              className="inline-flex max-w-[18rem] items-center gap-1 rounded-full border border-indigo/30 bg-background py-0.5 pr-1 pl-2 text-[11px]"
            >
              <span className="truncate text-foreground">
                {d.title} <span className="text-muted-foreground">v{d.version}</span>
              </span>
              <DocumentStatusBadge status={d.status} className="px-1 py-0" />
              {!d.concept_id ? (
                <button
                  type="button"
                  title="Save to the Processes page"
                  onClick={() => setFiling(d)}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <FolderInput className="size-3" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${d.title}`}
                onClick={() => state.detach(d.id)}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={disabled}
            onClick={() => setAttachOpen(true)}
          >
            <Paperclip className="size-3.5" /> Attach process document
          </Button>
          {state.attached.length === 0 ? (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {preview.isFetching ? (
                <Loader2 className="inline size-3 animate-spin" />
              ) : debounced.length < 8 ? (
                "Nothing attached — a matching process will be looked up from the inventory."
              ) : chosen ? (
                <>
                  <Search className="mr-1 inline size-3" />
                  Will use <span className="text-foreground">{chosen.title}</span> v{chosen.version}{" "}
                  <span className="text-muted-foreground/70">({chosen.path})</span>
                </>
              ) : best ? (
                <>
                  No close match (best: {best.label}, score {best.score}) — will continue without.
                </>
              ) : (
                <>
                  No process defined for {preview.data?.scope.label ?? "this request"} —{" "}
                  <Link to="/processes" className="text-primary hover:underline">
                    add one
                  </Link>
                  .
                </>
              )}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          Builds exactly as before. Turn on to ground the design in a business process.
        </span>
      )}

      <AttachDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttach={(doc) => {
          state.attach(doc);
          setAttachOpen(false);
        }}
      />
      <FileUnderDialog
        doc={filing}
        onClose={() => setFiling(null)}
        onFiled={(doc) => {
          state.detach(filing!.id);
          state.attach(doc);
          setFiling(null);
        }}
      />
    </div>
  );
}

function AttachDialog({
  open,
  onOpenChange,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAttach: (doc: AttachedDoc) => void;
}) {
  const tree = useQuery({ queryKey: QK.processTree(), queryFn: processesApi.tree, enabled: open });
  const [picked, setPicked] = useState("");
  const ingest = useDocumentIngest({ onSaved: (d) => onAttach(asAttached(d)) });
  const pickedNode = tree.data?.processes.find((p) => p.id === picked);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Attach a process document</DialogTitle>
            <DialogDescription className="text-xs">
              Used for this request only. It is checked against the template first — anything that
              does not match is shown with how to fix it.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="upload">
            <TabsList>
              <TabsTrigger value="upload">Upload a file</TabsTrigger>
              <TabsTrigger value="inventory">From Processes</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-3 pt-2">
              <FileDrop
                onFile={(f) => void ingest.upload(f)}
                busy={ingest.busy}
                hint="JSON in the template's format"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TemplateDownloadMenu />
                <Button size="sm" variant="ghost" onClick={ingest.draft}>
                  <Sparkles className="size-3.5" /> Draft one from text with AI
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="inventory" className="space-y-3 pt-2">
              {tree.isLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ProcessCascadePicker
                  tree={tree.data}
                  value={picked}
                  onChange={setPicked}
                  onlyWithDocuments
                />
              )}
              {pickedNode ? (
                <p className="text-[11px] text-muted-foreground">
                  {pickedNode.documents.active_id
                    ? `${pickedNode.documents.active_title ?? pickedNode.label} v${pickedNode.documents.active_version} will be attached.`
                    : "This process has no valid document yet."}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  size="sm"
                  disabled={!pickedNode?.documents.active_id}
                  onClick={async () => {
                    try {
                      const d = await processesApi.document(pickedNode!.documents.active_id!);
                      onAttach(asAttached(d));
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  Attach
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {ingest.dialogs}
    </>
  );
}

function FileUnderDialog({
  doc,
  onClose,
  onFiled,
}: {
  doc: AttachedDoc | null;
  onClose: () => void;
  onFiled: (doc: AttachedDoc) => void;
}) {
  const qc = useQueryClient();
  const tree = useQuery({
    queryKey: QK.processTree(),
    queryFn: processesApi.tree,
    enabled: Boolean(doc),
  });
  const [target, setTarget] = useState("");
  const file = useMutation({
    mutationFn: () => processesApi.fileUnder(doc!.id, target),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: QK.processes() });
      if (!r.report.valid) {
        toast.error(
          "Filed, but it does not fit this process — open it on the Processes page to fix.",
        );
      } else {
        toast.success(`Saved to Processes as version ${r.document.version}.`);
      }
      onFiled(asAttached(r.document));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Save to Processes</DialogTitle>
          <DialogDescription className="text-xs">
            File “{doc?.title}” under a process so later requests in that scope can find it. It is
            re-checked there, including that it describes that process.
          </DialogDescription>
        </DialogHeader>
        <ProcessCascadePicker tree={tree.data} value={target} onChange={setTarget} />
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!target || file.isPending} onClick={() => file.mutate()}>
            {file.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderInput className="size-3.5" />
            )}
            Save here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
