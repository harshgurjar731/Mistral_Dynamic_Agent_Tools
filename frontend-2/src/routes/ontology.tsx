import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/ontology")({
  head: () => ({
    meta: [
      { title: "Ontology — Agentic AI Design Patterns" },
      { name: "description", content: "Concept browser." },
      { property: "og:title", content: "Ontology — Agentic AI Design Patterns" },
      { property: "og:description", content: "Concept browser." },
    ],
  }),
  component: OntologyPage,
});

function OntologyPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ontology</h1>
      <p className="mt-2 text-sm text-muted-foreground">Concept browser.</p>
    </div>
  );
}
