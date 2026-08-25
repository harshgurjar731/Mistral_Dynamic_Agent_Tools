import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/libraries")({
  head: () => ({
    meta: [
      { title: "Libraries — Agentic AI Design Patterns" },
      { name: "description", content: "Document library manager." },
      { property: "og:title", content: "Libraries — Agentic AI Design Patterns" },
      { property: "og:description", content: "Document library manager." },
    ],
  }),
  component: LibrariesPage,
});

function LibrariesPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Libraries</h1>
      <p className="mt-2 text-sm text-muted-foreground">Document library manager.</p>
    </div>
  );
}
