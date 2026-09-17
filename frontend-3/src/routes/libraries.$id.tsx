import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Edit2, FileText, Library as LibraryIcon, Trash2 } from "lucide-react";
import { errorMessage, librariesApi, QK } from "@/api";
import { DocumentsPanel } from "@/components/libraries/LibraryPanels";
import { LibraryFormDialog } from "@/components/libraries/LibraryFormDialog";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/libraries/$id")({
  head: () => ({
    meta: [
      { title: "Library — Agentic AI Design Patterns" },
      { name: "description", content: "The documents inside one library." },
      { property: "og:title", content: "Library — Agentic AI Design Patterns" },
      { property: "og:description", content: "The documents inside one library." },
    ],
  }),
  component: LibraryDetailPage,
});

function LibraryDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const libs = useQuery({ queryKey: QK.libraries(), queryFn: librariesApi.list });
  const library = (libs.data ?? []).find((l) => l.id === id) ?? null;

  const remove = useMutation({
    mutationFn: () => librariesApi.remove(id),
    onSuccess: () => {
      toast.success("Library deleted.");
      void qc.invalidateQueries({ queryKey: QK.libraries() });
      void navigate({ to: "/libraries" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (libs.isError) {
    return (
      <div className="px-6 py-8">
        <ErrorState error={libs.error} onRetry={() => libs.refetch()} />
      </div>
    );
  }
  if (libs.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (!library) {
    return (
      <div className="px-6 py-8">
        <ErrorState error="Library not found" />
      </div>
    );
  }

  const docs = library.document_count ?? 0;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Link
            to="/libraries"
            aria-label="Back to libraries"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-surface/30 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground">
              <LibraryIcon className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {library.name}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                  <FileText className="size-2.5" />
                  {docs} document{docs !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {library.description || "No description provided"}
                {library.created_at ? (
                  <span className="text-muted-foreground/50">
                    {" · created "}
                    {formatRelative(library.created_at)}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Edit2 className="size-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red hover:text-red"
            onClick={() =>
              window.confirm(`Delete the library "${library.name}"?`) && remove.mutate()
            }
            disabled={remove.isPending}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <DocumentsPanel library={library} onRenameLibrary={() => setEditing(true)} />
      </div>

      <LibraryFormDialog open={editing} onOpenChange={setEditing} library={library} />
    </div>
  );
}
