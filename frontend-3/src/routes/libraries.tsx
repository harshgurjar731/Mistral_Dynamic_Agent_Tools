import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Library as LibraryIcon, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { errorMessage, librariesApi, QK } from "@/api";
import type { Library } from "@/types";
import { PageHeader, StatTile } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { DocumentsPanel, LibraryList } from "@/components/libraries/LibraryPanels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/libraries")({
  head: () => ({
    meta: [
      { title: "Libraries — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Document libraries agents retrieve from, and the files inside them.",
      },
      { property: "og:title", content: "Libraries — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Document libraries agents retrieve from, and the files inside them.",
      },
    ],
  }),
  component: LibrariesPage,
});

function LibrariesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [renamingLib, setRenamingLib] = useState<Library | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");

  const libs = useQuery({ queryKey: QK.libraries(), queryFn: librariesApi.list });

  const create = useMutation({
    mutationFn: () => librariesApi.create({ name, description }),
    onSuccess: (lib) => {
      toast.success("Library created.");
      setCreating(false);
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: QK.libraries() });
      if (lib?.id) setSelectedId(lib.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rename = useMutation({
    mutationFn: () =>
      librariesApi.update(renamingLib!.id, { name: renameName, description: renameDesc }),
    onSuccess: () => {
      toast.success("Library updated.");
      setRenamingLib(null);
      qc.invalidateQueries({ queryKey: QK.libraries() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => librariesApi.remove(id),
    onSuccess: (_res, id) => {
      toast.success("Library deleted.");
      if (selectedId === id) setSelectedId(null);
      qc.invalidateQueries({ queryKey: QK.libraries() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = libs.data ?? [];
    if (!q) return all;
    return all.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.description ?? "").toLowerCase().includes(q),
    );
  }, [libs.data, search]);

  const selected = useMemo(
    () => (libs.data ?? []).find((l) => l.id === selectedId) ?? null,
    [libs.data, selectedId],
  );

  const totalDocs = (libs.data ?? []).reduce((n, l) => n + (l.document_count ?? 0), 0);

  const startRename = (lib: Library) => {
    setRenamingLib(lib);
    setRenameName(lib.name);
    setRenameDesc(lib.description || "");
  };

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Knowledge"
        title="Libraries"
        description="Document sets an agent can be pointed at. Attach one to an agent from its detail page to give it retrieval over these files."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => libs.refetch()}
              disabled={libs.isFetching}
            >
              <RefreshCw className={libs.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" /> New library
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Libraries" value={libs.data?.length ?? "—"} />
        <StatTile label="Documents" value={libs.data ? totalDocs : "—"} tone="blue" />
        <StatTile
          label="Selected"
          value={selected ? (selected.document_count ?? 0) : "—"}
          tone="emerald"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <GlassPanel className="h-fit">
          <GlassPanelHeader
            title="All libraries"
            description={libs.data ? `${visible.length} shown` : undefined}
          />
          <div className="space-y-3 p-4">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search libraries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {libs.isLoading ? (
              <TableSkeleton rows={6} />
            ) : libs.isError ? (
              <ErrorState error={libs.error} onRetry={() => libs.refetch()} />
            ) : (
              <LibraryList
                libraries={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDelete={(id) => remove.mutate(id)}
                deletingId={remove.isPending ? (remove.variables ?? null) : null}
                onRename={startRename}
              />
            )}
          </div>
        </GlassPanel>

        <DocumentsPanel
          library={selected}
          onRenameLibrary={() => selected && startRename(selected)}
        />
      </div>

      {/* New library dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New library</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="eyebrow mb-1.5 block">Name</label>
              <Input
                value={name}
                placeholder="EU regulation"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Description</label>
              <Textarea
                rows={3}
                value={description}
                placeholder="What this library holds and who should use it."
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LibraryIcon className="size-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename library dialog */}
      <Dialog open={Boolean(renamingLib)} onOpenChange={(open) => !open && setRenamingLib(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Library</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="eyebrow mb-1.5 block">Name</label>
              <Input
                value={renameName}
                placeholder="Library name"
                onChange={(e) => setRenameName(e.target.value)}
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Description</label>
              <Textarea
                rows={3}
                value={renameDesc}
                placeholder="Description"
                onChange={(e) => setRenameDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingLib(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => rename.mutate()}
              disabled={!renameName.trim() || rename.isPending}
            >
              {rename.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LibraryIcon className="size-4" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
