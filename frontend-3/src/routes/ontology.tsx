import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ontologyApi, QK } from "@/api";
import { PageHeader, StatTile } from "@/components/shared/PageHeader";
import { OverviewTab } from "@/components/ontology/OverviewTab";
import { VocabularyTab } from "@/components/ontology/VocabularyTab";
import { AnnotationsTab } from "@/components/ontology/AnnotationsTab";
import { KnowledgeTab } from "@/components/ontology/KnowledgeTab";
import { ScopeTab } from "@/components/ontology/ScopeTab";
import { RagTab } from "@/components/ontology/RagTab";
import { RetrievalTab } from "@/components/ontology/RetrievalTab";
import { QueryTab } from "@/components/ontology/QueryTab";
import { RulesTab } from "@/components/ontology/RulesTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/ui/ErrorState";

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

function OntologyPage() {
  const overview = useQuery({
    queryKey: QK.ontology(),
    queryFn: ontologyApi.overview,
  });

  const counts = overview.data?.counts;

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Knowledge"
        title="Ontology"
        description="A shared vocabulary the planner narrows on before it chooses agents. Concepts live in schemes; annotations bind them to agents, tools, connectors, workflows and libraries."
      />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Schemes" value={counts?.schemes ?? "—"} />
          <StatTile label="Concepts" value={counts?.concepts ?? "—"} tone="blue" />
          <StatTile label="Annotations" value={counts?.annotations ?? "—"} tone="emerald" />
          <StatTile
            label="Seeded"
            value={overview.data ? (overview.data.seeded ? "yes" : "no") : "—"}
            tone={overview.data?.seeded ? "emerald" : "amber"}
          />
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="libraries">Libraries (Graph RAG)</TabsTrigger>
          <TabsTrigger value="retrieval">Retrieval Bench</TabsTrigger>
          <TabsTrigger value="query">Cypher Console</TabsTrigger>
          <TabsTrigger value="rules">Governance Rules</TabsTrigger>
          <TabsTrigger value="vocabulary">Vocabulary</TabsTrigger>
          <TabsTrigger value="annotations">Annotations</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="scope">Scoping</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="libraries" className="mt-4">
          <RagTab />
        </TabsContent>
        <TabsContent value="retrieval" className="mt-4">
          <RetrievalTab />
        </TabsContent>
        <TabsContent value="query" className="mt-4">
          <QueryTab />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="vocabulary" className="mt-4">
          <VocabularyTab />
        </TabsContent>
        <TabsContent value="annotations" className="mt-4">
          <AnnotationsTab overview={overview.data} />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-4">
          <KnowledgeTab />
        </TabsContent>
        <TabsContent value="scope" className="mt-4">
          <ScopeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
