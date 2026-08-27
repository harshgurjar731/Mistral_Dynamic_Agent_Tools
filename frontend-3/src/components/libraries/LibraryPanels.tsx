import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Globe, Loader2, Trash2, Upload } from "lucide-react";
import { errorMessage, librariesApi, QK } from "@/api";
import type { Library } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export function LibraryList({
  libraries,
  selectedId,
  onSelect,
  onDelete,
  deletingId,
}: {
  libraries: Library[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  if (libraries.length === 0) {
    return (
      <EmptyState
        title="No libraries yet."
        description="A library is a document set an agent can be pointed at for retrieval."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {libraries.map((lib) => (
        <li key={lib.id}>
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2.5 transition",
              selectedId === lib.id
                ? "border-primary/50 bg-primary/10"
                : "border-border bg-background-elevated/60 hover:border-border-strong hover:bg-surface-hover",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(lib.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-medium text-foreground">{lib.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {lib.description || "No description"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="technical-label">{lib.document_count ?? 0} docs</span>
                <span className="technical-label">{formatRelative(lib.created_at)}</span>
              </div>
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-red"
              disabled={deletingId === lib.id}
              onClick={() => onDelete(lib.id)}
              title="Delete library"
            >
              {deletingId === lib.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DocumentsPanel({ library }: { library: Library | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pageUrl, setPageUrl] = useState("");

  const docs = useQuery({
    queryKey: QK.libraryDocs(library?.id ?? ""),
    queryFn: () => librariesApi.documents(library!.id),
    enabled: Boolean(library),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: QK.libraryDocs(library?.id ?? "") });
    qc.invalidateQueries({ queryKey: QK.libraries() });
  };

  const upload = useMutation({
    mutationFn: (file: File) => librariesApi.uploadDocument(library!.id, file),
    onSuccess: () => {
      toast.success("Document uploaded.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addWebpage = useMutation({
    mutationFn: (url: string) => librariesApi.addWebpage(library!.id, url),
    onSuccess: () => {
      toast.success("Webpage ingested.");
      setPageUrl("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const removeDoc = useMutation({
    mutationFn: (docId: string) => librariesApi.removeDocument(library!.id, docId),
    onSuccess: () => {
      toast.success("Document removed.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!library) {
    return (
      <GlassPanel className="h-full">
        <GlassPanelHeader title="Documents" description="Select a library to manage it." />
        <div className="p-4">
          <EmptyState
            icon={<FileText className="size-6" />}
            title="Nothing selected"
            description="Pick a library on the left to upload documents or ingest a webpage."
            className="py-14"
          />
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="flex h-full flex-col">
      <GlassPanelHeader
        title={library.name}
        description={library.description || "No description"}
        actions={<span className="technical-label">{docs.data?.length ?? 0} documents</span>}
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload file
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pageUrl.trim()) addWebpage.mutate(pageUrl.trim());
            }}
            className="flex min-w-[240px] flex-1 items-center gap-2"
          >
            <Input
              placeholder="https://example.com/page"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={!pageUrl.trim() || addWebpage.isPending}
            >
              {addWebpage.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Globe className="size-3.5" />
              )}
              Ingest
            </Button>
          </form>
        </div>

        {docs.isLoading ? (
          <TableSkeleton rows={5} />
        ) : docs.isError ? (
          <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
        ) : (docs.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="No documents."
            description="Upload a file or ingest a webpage to fill this library."
          />
        ) : (
          <ul className="space-y-2">
            {docs.data?.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background-elevated/60 px-3 py-2"
              >
                <FileText className="size-3.5 shrink-0 text-cyan" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground">{d.filename}</p>
                  <div className="flex items-center gap-2">
                    {d.mime_type ? <span className="technical-label">{d.mime_type}</span> : null}
                    {d.size ? (
                      <span className="technical-label">{Math.round(d.size / 1024)} KB</span>
                    ) : null}
                    <span className="technical-label">{formatRelative(d.created_at)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-red"
                  disabled={removeDoc.isPending}
                  onClick={() => removeDoc.mutate(d.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
