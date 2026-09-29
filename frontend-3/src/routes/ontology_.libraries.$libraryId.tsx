import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Database } from "lucide-react";
import { z } from "zod";
import { ragApi } from "@/api";
import { LibraryWorkspace } from "@/components/ontology/LibraryDetail";
import type { LibraryPane } from "@/components/ontology/libraryMeta";
import { EmptyState } from "@/components/ui/EmptyState";
import { DetailSkeleton } from "@/components/ui/Skeletons";

const searchSchema = z.object({
  /** Which half of the workspace is open, so a refresh lands in the same place. */
  tab: z.enum(["documents", "graph"]).optional(),
});

export const Route = createFileRoute("/ontology_/libraries/$libraryId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Library — Ontology — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "One library's documents, their extraction status and the knowledge graph they produced.",
      },
    ],
  }),
  component: OntologyLibraryPage,
});

function OntologyLibraryPage() {
  const { libraryId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // The overview is already cached from the card grid, so this usually resolves at once.
  const { data, isLoading } = useQuery({
    queryKey: ["rag", "overview"],
    queryFn: ragApi.overview,
    refetchInterval: 15_000,
  });
  const library = data?.libraries.find((l) => l.id === libraryId);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[36rem] flex-col gap-3 p-3 sm:p-4 md:h-dvh">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 px-1 text-xs">
        <Link to="/ontology" className="text-muted-foreground transition hover:text-foreground">
          Ontology
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
        <Link
          to="/ontology"
          search={{ view: "libraries" }}
          className="text-muted-foreground transition hover:text-foreground"
        >
          Libraries
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
        <span className="truncate font-medium text-foreground">{library?.name ?? "…"}</span>
      </nav>

      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {isLoading ? (
          <div className="p-4">
            <DetailSkeleton />
          </div>
        ) : !library ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              className="border-0 bg-transparent"
              icon={<Database className="size-5" />}
              title="Library not found"
              description="It may have been deleted. Go back to the libraries to pick another."
            />
          </div>
        ) : (
          <LibraryWorkspace
            key={library.id}
            library={library}
            pane={tab ?? "documents"}
            onPane={(next: LibraryPane) =>
              void navigate({
                search: { tab: next === "documents" ? undefined : next },
                replace: true,
              })
            }
          />
        )}
      </section>
    </div>
  );
}
