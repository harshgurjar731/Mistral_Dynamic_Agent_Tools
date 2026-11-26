import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, FileStack, Lightbulb, LineChart, Search } from "lucide-react";
import { z } from "zod";
import { knowledgeApi, QK } from "@/api";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import { GuidancePanel } from "@/components/knowledge/GuidancePanel";
import { FeedbackPanel, TryRetrievalPanel } from "@/components/knowledge/RetrievalPanels";
import { SourcesPanel } from "@/components/knowledge/SourcesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const searchSchema = z.object({ tab: z.string().optional() });

export const Route = createFileRoute("/knowledge")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Knowledge — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Build guidance the orchestrator follows when it designs agents and workflows.",
      },
    ],
  }),
  component: KnowledgePage,
});

const TABS = [
  { value: "guidance", label: "Guidance", icon: Lightbulb },
  { value: "sources", label: "Sources", icon: FileStack },
  { value: "try", label: "Try retrieval", icon: Search },
  { value: "feedback", label: "Feedback", icon: LineChart },
] as const;

function KnowledgePage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const counts = useQuery({ queryKey: QK.knowledgeCounts(), queryFn: knowledgeApi.counts });
  const guidance = counts.data?.counts.guidance ?? {};
  const current = TABS.some((t) => t.value === tab) ? tab! : "guidance";

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        <FeatureTitle route="/knowledge">
          <span className="text-gradient-brand">Knowledge</span>
        </FeatureTitle>
      </h1>
      <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
        <FeatureDescription route="/knowledge">
          Guidance is how to build: best practices the orchestrator follows when it designs agents and workflows and
          chooses each agent&apos;s type. Add any document as a source; its items wait for review before builds use
          them.
        </FeatureDescription>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {guidance.active ?? 0} active guidance · {guidance.proposed ?? 0} waiting for review ·{" "}
        {guidance.conflicting ?? 0} conflicting · {counts.data?.sources ?? 0} source(s)
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        <Building2 className="mr-1 inline size-3.5 align-[-2px]" />
        What an industry involves — its regulations, standards, rules and metrics — is on{" "}
        <Link to="/industry-knowledge" className="text-primary hover:underline">
          Industry knowledge
        </Link>
        , filed by industry, domain and subdomain.
      </p>

      <Tabs value={current} onValueChange={(v) => void navigate({ search: { tab: v }, replace: true })} className="mt-5">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon className="mr-1 size-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="guidance" className="pt-4"><GuidancePanel /></TabsContent>
        <TabsContent value="sources" className="pt-4"><SourcesPanel /></TabsContent>
        <TabsContent value="try" className="pt-4"><TryRetrievalPanel /></TabsContent>
        <TabsContent value="feedback" className="pt-4"><FeedbackPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
