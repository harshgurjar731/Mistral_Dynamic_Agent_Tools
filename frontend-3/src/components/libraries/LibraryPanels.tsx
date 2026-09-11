import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpDown,
  Check,
  Edit2,
  FileCode,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { errorMessage, librariesApi, QK } from "@/api";
import type { Library, LibraryDocument } from "@/types";
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
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const imgExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
  const codeExts = ["py", "js", "ts", "html", "css", "json", "xml", "yaml", "md", "rst"];
  const sheetExts = ["xlsx", "xls", "csv", "ods", "numbers"];
  if (imgExts.includes(ext)) return <ImageIcon className="size-3.5 shrink-0 text-emerald-400" />;
  if (codeExts.includes(ext)) return <FileCode className="size-3.5 shrink-0 text-amber-400" />;
  if (sheetExts.includes(ext)) return <FileSpreadsheet className="size-3.5 shrink-0 text-green-400" />;
  return <FileText className="size-3.5 shrink-0 text-cyan" />;
}

export function LibraryList({
  libraries,
  selectedId,
  onSelect,
  onDelete,
  deletingId,
  onRename,
}: {
  libraries: Library[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
  onRename?: (lib: Library) => void;
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
            <div className="flex items-center gap-1">
              {onRename && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onRename(lib)}
                  title="Rename library"
                >
                  <Edit2 className="size-3" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0 text-muted-foreground hover:text-red"
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
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DocumentsPanel({
  library,
  onRenameLibrary,
}: {
  library: Library | null;
  onRenameLibrary?: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

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
    onSuccess: (_res, docId) => {
      toast.success("Document removed.");
      setSelectedDocs((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length > 50) {
        toast.error("You can upload up to 50 files at once.");
        return;
      }
      for (const file of arr) {
        if (file.size > 100 * 1024 * 1024) {
          toast.error(`"${file.name}" exceeds the 100 MB limit.`);
          continue;
        }
        upload.mutate(file);
      }
    },
    [upload],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleBatchDelete = async () => {
    if (!library || selectedDocs.size === 0) return;
    if (!window.confirm(`Delete ${selectedDocs.size} selected document(s)?`)) return;
    setIsDeletingBatch(true);
    try {
      for (const id of Array.from(selectedDocs)) {
        await librariesApi.removeDocument(library.id, id);
      }
      toast.success(`Deleted ${selectedDocs.size} document(s).`);
      setSelectedDocs(new Set());
      invalidate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const processedDocs = useMemo(() => {
    const list = [...(docs.data ?? [])];
    const filtered = search.trim()
      ? list.filter((d) => d.filename.toLowerCase().includes(search.trim().toLowerCase()))
      : list;

    filtered.sort((a, b) => {
      if (sort === "newest") {
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      }
      if (sort === "oldest") {
        return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
      }
      if (sort === "name") {
        return a.filename.localeCompare(b.filename);
      }
      if (sort === "size") {
        return (b.size ?? 0) - (a.size ?? 0);
      }
      return 0;
    });
    return filtered;
  }, [docs.data, search, sort]);

  const allSelected = processedDocs.length > 0 && selectedDocs.size === processedDocs.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(processedDocs.map((d) => d.id)));
    }
  };

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    <GlassPanel
      className={cn(
        "flex h-full flex-col transition-colors",
        isDragging && "border-primary bg-primary/5",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <GlassPanelHeader
        title={
          <div className="flex items-center gap-2">
            <span>{library.name}</span>
            {onRenameLibrary && (
              <button
                type="button"
                onClick={onRenameLibrary}
                className="text-muted-foreground hover:text-foreground"
                title="Rename library"
              >
                <Edit2 className="size-3.5" />
              </button>
            )}
          </div>
        }
        description={library.description || "No description"}
        actions={<span className="technical-label">{docs.data?.length ?? 0} documents</span>}
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload files
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

        {/* Drag and Drop Zone Hint */}
        <div
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-border/80 bg-background-elevated/40 p-3 text-center transition hover:border-primary/50 hover:bg-background-elevated/80"
        >
          <p className="text-xs text-muted-foreground">
            Drag & drop files here, or click to browse (up to 100MB per file)
          </p>
        </div>

        {/* Search, Sort, and Batch Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/60 py-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded accent-primary"
              />
              Select all
            </label>
            {selectedDocs.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-red hover:bg-red/10"
                onClick={handleBatchDelete}
                disabled={isDeletingBatch}
              >
                {isDeletingBatch ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                Delete selected ({selectedDocs.size})
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents…"
                className="h-7 w-40 rounded-lg border border-border bg-background py-1 pr-2.5 pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name (A-Z)</option>
              <option value="size">File size</option>
            </select>
          </div>
        </div>

        {docs.isLoading ? (
          <TableSkeleton rows={5} />
        ) : docs.isError ? (
          <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
        ) : processedDocs.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={search ? "No matching documents" : "No documents yet"}
            description={
              search
                ? "Try a different search query."
                : "Upload files or ingest a webpage to fill this library."
            }
          />
        ) : (
          <ul className="space-y-2">
            {processedDocs.map((d) => (
              <li
                key={d.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 transition",
                  selectedDocs.has(d.id)
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-background-elevated/60 hover:bg-surface-hover",
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.has(d.id)}
                  onChange={() => toggleDoc(d.id)}
                  className="rounded accent-primary"
                />
                {getFileIcon(d.filename)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{d.filename}</p>
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
