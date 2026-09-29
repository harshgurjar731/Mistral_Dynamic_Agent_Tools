import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Crosshair,
  FlaskConical,
  Layers,
  Library,
  ListTree,
  Orbit,
  Search,
  Share2,
  Tags,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
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
import { kindColor, kindLabel } from "@/components/ontology/graphTones";
import { cn } from "@/lib/utils";
import type { OntologyOverview } from "@/types";

const searchSchema = z.object({
  /** The view on screen, so a refresh or a shared link lands in the same place. */
  view: z.string().optional(),
});

export const Route = createFileRoute("/ontology")({
  validateSearch: searchSchema,
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
  icon: LucideIcon;
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
 * Eight views in three groups, by what you are actually doing: defining the
 * vocabulary, feeding it documents, or rehearsing how it behaves.
 */
const SECTIONS: SectionDef[] = [
  {
    // The graph spans the whole platform, not just the vocabulary, so it stands alone.
    value: "overview",
    label: "Overview",
    icon: Orbit,
    views: [
      {
        value: "graph",
        icon: Share2,
        label: "Application graph",
        hint: "Industries, their domains and subdomains, and the agents and workflows that serve them — the whole platform as one hierarchy.",
      },
    ],
  },
  {
    value: "vocabulary",
    label: "Vocabulary",
    icon: Layers,
    views: [
      {
        value: "terms",
        icon: ListTree,
        label: "Schemes & concepts",
        hint: "The schemes that group the vocabulary, and every concept inside them.",
      },
      {
        value: "annotations",
        icon: Tags,
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
        icon: Library,
        label: "Libraries",
        hint: "Document extraction and review — the Graph RAG store behind retrieval.",
      },
      {
        value: "industry",
        icon: BookOpen,
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
        icon: Crosshair,
        label: "Scoping",
        hint: "What the planner narrows to before it picks agents, and how text maps onto concepts.",
      },
      {
        value: "retrieval",
        icon: Search,
        label: "Retrieval",
        hint: "Run a query through the retrieval path and inspect what comes back.",
      },
      {
        value: "cypher",
        icon: Terminal,
        label: "Cypher console",
        hint: "Query the graph store directly. Read-only, for when the UI is not enough.",
      },
    ],
  },
];

/** One accent per group, so a feature's card and its open view read as the same thing. */
const SECTION_TONE: Record<string, { text: string; tile: string; glow: string; hover: string }> = {
  overview: {
    text: "text-primary",
    tile: "border-primary/30 bg-primary/10 text-primary",
    glow: "var(--primary)",
    hover: "hover:border-primary/45",
  },
  vocabulary: {
    text: "text-purple",
    tile: "border-purple/30 bg-purple/10 text-purple",
    glow: "var(--purple)",
    hover: "hover:border-purple/45",
  },
  knowledge: {
    text: "text-cyan",
    tile: "border-cyan/30 bg-cyan/10 text-cyan",
    glow: "var(--cyan)",
    hover: "hover:border-cyan/45",
  },
  bench: {
    text: "text-amber",
    tile: "border-amber/30 bg-amber/10 text-amber",
    glow: "var(--amber)",
    hover: "hover:border-amber/45",
  },
};

function OntologyPage() {
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const overview = useQuery({ queryKey: QK.ontology(), queryFn: ontologyApi.overview });
  const counts = overview.data?.counts;
  const stat: Record<string, string | undefined> = {
    terms: counts ? `${counts.concepts} concepts · ${counts.schemes} schemes` : undefined,
    annotations: counts ? `${counts.annotations} annotations` : undefined,
  };

  const all = SECTIONS.flatMap((s) => s.views.map((v) => ({ section: s, view: v })));
  const active = view ? all.find((a) => a.view.value === view) : undefined;
  const open = (value: string | undefined) =>
    void navigate({ search: value ? { view: value } : {}, replace: !value });

  if (!active) {
    return <OntologyHub stat={stat} counts={counts} onOpen={open} />;
  }

  const tone = SECTION_TONE[active.section.value]!;
  const fillsFrame = active.view.value === "graph";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[34rem] flex-col p-3 sm:p-4 md:h-dvh">
      {/* The open feature, as one card that fills the page. */}
      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => open(undefined)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Ontology
          </button>
          <span className="h-5 w-px bg-border" aria-hidden />
          <span className={cn("grid size-8 place-items-center rounded-lg border", tone.tile)}>
            <active.view.icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              {active.view.label}
              <span className={cn("text-[10px] font-semibold uppercase", tone.text)}>
                {active.section.label}
              </span>
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{active.view.hint}</p>
          </div>
          {/* Every other feature, one click away without going back to the cards. */}
          <nav aria-label="Switch feature" className="flex flex-wrap items-center gap-0.5">
            {all.map(({ view: v, section }) => {
              const on = v.value === active.view.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => open(v.value)}
                  aria-current={on ? "page" : undefined}
                  aria-label={v.label}
                  title={`${v.label} — ${section.label}`}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg border transition",
                    on
                      ? SECTION_TONE[section.value]!.tile
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <v.icon className="size-3.5" />
                </button>
              );
            })}
          </nav>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 p-3 sm:p-4",
            fillsFrame ? "flex flex-col" : "custom-scrollbar overflow-y-auto",
          )}
        >
          {overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
          ) : (
            <ActiveView view={active.view.value} overview={overview.data} />
          )}
        </div>
      </section>
    </div>
  );
}

/** The landing view: every feature as a card, grouped by what you are doing. */
function OntologyHub({
  stat,
  counts,
  onOpen,
}: {
  stat: Record<string, string | undefined>;
  counts: OntologyOverview["counts"] | undefined;
  onOpen: (view: string) => void;
}) {
  return (
    <div className="space-y-8 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">
            <span className="text-gradient-brand">Ontology</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            A shared vocabulary the planner narrows on before it chooses agents. Concepts live in
            schemes; annotations bind them to agents, tools, connectors, workflows and libraries.
          </p>
        </div>
        {counts ? (
          <dl className="flex gap-2">
            {(
              [
                ["Concepts", counts.concepts],
                ["Schemes", counts.schemes],
                ["Annotations", counts.annotations],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border/60 bg-background-elevated/60 px-3.5 py-2"
              >
                <dd className="font-display text-lg font-bold text-foreground tabular-nums">
                  {value}
                </dd>
                <dt className="text-[10px] font-semibold text-muted-foreground uppercase">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      {SECTIONS.map((section) => {
        const tone = SECTION_TONE[section.value]!;
        return (
          <section key={section.value} className="space-y-3">
            <h2
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-semibold uppercase",
                tone.text,
              )}
            >
              <section.icon className="size-3.5" />
              {section.label}
            </h2>
            {section.views.length === 1 ? (
              <FeatureBanner
                view={section.views[0]!}
                tone={tone}
                onOpen={() => onOpen(section.views[0]!.value)}
              />
            ) : (
              <div
                className={cn(
                  "grid gap-3 sm:grid-cols-2",
                  // Rows always fill the width: three across only when there are three.
                  section.views.length >= 3 && "lg:grid-cols-3",
                )}
              >
                {section.views.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => onOpen(v.value)}
                    className={cn(
                      "group glass relative flex min-h-[9.5rem] flex-col overflow-hidden rounded-2xl p-4 text-left transition duration-200 hover:-translate-y-0.5",
                      tone.hover,
                    )}
                  >
                    <span
                      className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-0 blur-2xl transition duration-300 group-hover:opacity-25"
                      style={{ background: tone.glow }}
                      aria-hidden
                    />
                    <span
                      className={cn("grid size-10 place-items-center rounded-xl border", tone.tile)}
                    >
                      <v.icon className="size-5" />
                    </span>
                    <span className="mt-3 text-sm font-semibold text-foreground">{v.label}</span>
                    <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {v.hint}
                    </span>
                    <span className="mt-auto flex items-center justify-between pt-3 text-[11px]">
                      <span className="text-muted-foreground tabular-nums">
                        {stat[v.value] ?? ""}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-medium opacity-70 transition group-hover:opacity-100",
                          tone.text,
                        )}
                      >
                        Open{" "}
                        <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The levels the application graph draws, in the colours it draws them. */
const GRAPH_COVERS = ["industry", "domain", "subdomain", "agent", "workflow"];

function FeatureBanner({
  view,
  tone,
  onOpen,
}: {
  view: ViewDef;
  tone: { text: string; tile: string; glow: string; hover: string };
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group glass relative flex w-full flex-col gap-4 overflow-hidden rounded-2xl p-5 text-left transition duration-200 hover:-translate-y-0.5 sm:flex-row sm:items-center",
        tone.hover,
      )}
    >
      <span
        className="pointer-events-none absolute -top-24 -right-10 size-72 rounded-full opacity-10 blur-3xl transition duration-300 group-hover:opacity-25"
        style={{ background: tone.glow }}
        aria-hidden
      />
      <span
        className={cn("grid size-14 shrink-0 place-items-center rounded-2xl border", tone.tile)}
      >
        <view.icon className="size-7" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block font-display text-lg font-bold text-foreground">{view.label}</span>
        <span className="mt-1 block max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {view.hint}
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {GRAPH_COVERS.map((kind) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <span className="size-1.5 rounded-full" style={{ background: kindColor(kind) }} />
              {kindLabel(kind)}
            </span>
          ))}
        </span>
      </span>
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border px-4 py-2 text-xs font-semibold transition sm:self-center",
          tone.tile,
        )}
      >
        Open graph <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </button>
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
