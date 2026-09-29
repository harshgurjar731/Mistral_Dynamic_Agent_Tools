import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Library as LibraryIcon, Plus, RefreshCw, Search, X } from "lucide-react";
import { errorMessage, librariesApi, QK } from "@/api";
import type { Library } from "@/types";
import { LibraryCard } from "@/components/libraries/LibraryCard";
import { LibraryFormDialog } from "@/components/libraries/LibraryFormDialog";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, standardSorts, useSortKey } from "@/lib/sorting";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

export const Route = createFileRoute("/libraries/")({
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
  component: LibrariesIndexPage,
});

const LIBRARY_SORTS = standardSorts<Library>(
  (l) => l.name,
  (l) => l.created_at,
);

function LibrariesIndexPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Library | null>(null);

  const libs = useQuery({ queryKey: QK.libraries(), queryFn: librariesApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => librariesApi.remove(id),
    onSuccess: () => {
      toast.success("Library deleted.");
      void qc.invalidateQueries({ queryKey: QK.libraries() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = useMemo(() => libs.data ?? [], [libs.data]);
  const [sort, setSort] = useSortKey("libraries");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = !q
      ? all
      : all.filter(
          (l) =>
            l.name.toLowerCase().includes(q) || (l.description ?? "").toLowerCase().includes(q),
        );
    return applySort(rows, LIBRARY_SORTS, sort);
  }, [all, search, sort]);

  const selection = useBulkSelection(
    filtered,
    (l) => l.id,
    () => true,
    (l) => l.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "library",
    deleteOne: (id) => librariesApi.remove(id),
    invalidate: [QK.libraries()],
    selection,
  });

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <span className="text-gradient-brand">Libraries</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Document sets an agent can be pointed at. Attach one to an agent from its detail page to
            give it retrieval over these files.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          New library
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search libraries…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <SortSelect value={sort} onChange={setSort} options={LIBRARY_SORTS} />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => libs.refetch()}
          disabled={libs.isFetching}
        >
          <RefreshCw className={libs.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          Refresh
        </Button>
        {all.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/60">
            {filtered.length} of {all.length} librar{all.length !== 1 ? "ies" : "y"}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {libs.isLoading ? (
          <CardGridSkeleton />
        ) : libs.isError ? (
          <ErrorState error={libs.error} onRetry={() => libs.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <LibraryIcon className="size-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {search ? "No libraries match that search" : "No libraries yet"}
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {search
                ? "Try a different name or description."
                : "A library is a document set an agent can be pointed at for retrieval."}
            </p>
            {!search && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New library
              </button>
            )}
          </div>
        ) : (
          <>
            <BulkActionBar
              className="mb-4"
              selection={selection}
              noun="library"
              onDelete={bulkDelete.run}
              deleting={bulkDelete.running}
              warning="A library attached to any agent is refused — detach it from those agents first. The rest are deleted with their documents and everything they contributed to the knowledge graph."
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((lib) => (
                <SelectableItem key={lib.id} selection={selection} id={lib.id} label={lib.name}>
                  <LibraryCard
                    library={lib}
                    onRename={(l) => setEditing(l)}
                    onDelete={(l) =>
                      window.confirm(`Delete the library "${l.name}"?`) && remove.mutate(l.id)
                    }
                    deleting={remove.isPending && remove.variables === lib.id}
                  />
                </SelectableItem>
              ))}
            </div>
          </>
        )}
      </div>

      <LibraryFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(lib) => void navigate({ to: "/libraries/$id", params: { id: lib.id } })}
      />
      <LibraryFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        library={editing}
      />
    </div>
  );
}
