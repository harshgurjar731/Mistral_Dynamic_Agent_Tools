import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Layers, Library, type LucideIcon } from "lucide-react";
import { ontologyApi, QK } from "@/api";
import { OverviewTab } from "@/components/ontology/OverviewTab";
import { VocabularyTab } from "@/components/ontology/VocabularyTab";
import { AnnotationsTab } from "@/components/ontology/AnnotationsTab";
import { KnowledgeTab } from "@/components/ontology/KnowledgeTab";
import { ScopeTab } from "@/components/ontology/ScopeTab";
import { RagTab } from "@/components/ontology/RagTab";
import { RetrievalTab } from "@/components/ontology/RetrievalTab";
import { QueryTab } from "@/components/ontology/QueryTab";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/utils";
import type { OntologyOverview } from "@/types";

export const Route = createFileRoute("/ontology")({
  head: () => ({
    meta: [
      { title: "Ontology — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "The SKOS-lite vocabulary that scopes planning: schemes, concepts, annotations and the knowledge the tool retrieves.",
      },
      { property: "og:title", content: "Ontology — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content:
          "The SKOS-lite vocabulary that scopes planning: schemes, concepts, annotations and the knowledge the tool retrieves.",
      },
    ],
  }),
  component: OntologyPage,
});

interface ViewDef {
  value: string;
  label: string;
  /** Shown under the sub-nav so each view says what it is for. */
  hint: string;
}

interface SectionDef {
  value: string;
  label: string;
  icon: LucideIcon;
  views: ViewDef[];
}

/**
 * Eight flat tabs became three sections, grouped by what you are actually doing:
 * defining the vocabulary, feeding it documents, or rehearsing how it behaves.
 */
const SECTIONS: SectionDef[] = [
  {
    value: "vocabulary",
    label: "Vocabulary",
    icon: Layers,
    views: [
      {
        value: "graph",
        label: "Graph",
        hint: "The whole ontology as a canvas. Select a node to focus its neighbourhood.",
      },
      {
        value: "terms",
        label: "Schemes & concepts",
        hint: "The schemes that group the vocabulary, and every concept inside them.",
      },
      {
        value: "annotations",
        label: "Annotations",
        hint: "Every (subject, predicate, concept) triple recorded against a platform resource.",
      },
    ],
  },
  {
    value: "knowledge",
    label: "Knowledge",
    icon: Library,
    views: [
      {
        value: "libraries",
        label: "Libraries",
        hint: "Document extraction and review — the Graph RAG store behind retrieval.",
      },
      {
        value: "industry",
        label: "Industry knowledge",
        hint: "What the knowledge tool returns to agents, scoped by their domain annotation.",
      },
    ],
  },
  {
    value: "bench",
    label: "Bench",
    icon: FlaskConical,
    views: [
      {
        value: "scoping",
        label: "Scoping",
        hint: "What the planner narrows to before it picks agents, and how text maps onto concepts.",
      },
      {
        value: "retrieval",
        label: "Retrieval",
        hint: "Run a query through the retrieval path and inspect what comes back.",
      },
      {
        value: "cypher",
        label: "Cypher console",
        hint: "Query the graph store directly. Read-only, for when the UI is not enough.",
      },
    ],
  },
];

function OntologyPage() {
  const [section, setSection] = useState(SECTIONS[0]!.value);
  const [view, setView] = useState(SECTIONS[0]!.views[0]!.value);

  const overview = useQuery({ queryKey: QK.ontology(), queryFn: ontologyApi.overview });

  const activeSection = SECTIONS.find((s) => s.value === section) ?? SECTIONS[0]!;
  const activeView = activeSection.views.find((v) => v.value === view) ?? activeSection.views[0]!;

  const selectSection = (next: SectionDef) => {
    setSection(next.value);
    setView(next.views[0]!.value);
  };

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <span className="text-gradient-brand">Ontology</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            A shared vocabulary the planner narrows on before it chooses agents. Concepts live in
            schemes; annotations bind them to agents, tools, connectors, workflows and libraries.
          </p>
        </div>
      </div>

      {/* ── Section nav ── */}
      <div className="mt-6 flex flex-wrap items-center gap-1 rounded-xl border border-border/40 bg-surface/20 p-1 backdrop-blur-sm">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = s.value === section;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => selectSection(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── View nav + what this view is for ── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated p-0.5">
          {activeSection.views.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                v.value === activeView.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground/70">{activeView.hint}</p>
      </div>

      {/* ── Active view ── */}
      <div className="mt-5">
        {overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        ) : (
          <ActiveView view={activeView.value} overview={overview.data} />
        )}
      </div>
    </div>
  );
}

function ActiveView({ view, overview }: { view: string; overview: OntologyOverview | undefined }) {
  switch (view) {
    case "graph":
      return <OverviewTab />;
    case "terms":
      return <VocabularyTab />;
    case "annotations":
      return <AnnotationsTab overview={overview} />;
    case "libraries":
      return <RagTab />;
    case "industry":
      return <KnowledgeTab />;
    case "scoping":
      return <ScopeTab />;
    case "retrieval":
      return <RetrievalTab />;
    case "cypher":
      return <QueryTab />;
    default:
      return <OverviewTab />;
  }
}
