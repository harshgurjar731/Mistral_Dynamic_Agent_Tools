import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Database,
  Info,
  Loader2,
  Network,
  Play,
  Table2,
  Terminal,
} from "lucide-react";
import { errorMessage, ragApi } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { GraphCanvas, type GraphLayout, type SimpleEdge, type SimpleNode } from "./GraphCanvas";
import { kindColor, kindLabel } from "./graphTones";

const EXAMPLES = [
  { label: "Sample Nodes", query: "MATCH (n) RETURN n LIMIT 50" },
  {
    label: "Entity Relations",
    query: "MATCH (e:Entity)-[r:REL]->(t:Entity)\nRETURN e.name, type(r), t.name\nLIMIT 100",
  },
  {
    label: "Domain Taxonomy",
    query: "MATCH (c:Concept)-[r:BROADER]->(p:Concept)\nRETURN c.label, p.label",
  },
  {
    label: "Libraries by Domain",
    query: "MATCH (l:Library)-[r:SERVES_DOMAIN]->(c:Concept)\nRETURN l.name, c.label",
  },
  {
    label: "Node Counts by Label",
    query: "MATCH (n)\nRETURN labels(n) AS labels, count(*) AS count\nORDER BY count DESC",
  },
  {
    label: "Entity Neighbourhood",
    query: "MATCH (e:Entity)\nMATCH (e)-[r]-(other)\nRETURN e.name, type(r), other.name\nLIMIT 50",
  },
];

export function QueryTab() {
  const [query, setQuery] = useState(EXAMPLES[0]?.query ?? "");
  const [limit, setLimit] = useState(100);
  const [view, setView] = useState<"table" | "graph">("table");

  const runMutation = useMutation({
    mutationFn: () => ragApi.queryCypher(query, {}, limit),
  });

  const result = runMutation.data;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!runMutation.isPending && query.trim()) runMutation.mutate();
    }
  };

  const columns = useMemo(() => {
    if (!result?.rows || result.rows.length === 0) return [];
    if (result.columns && result.columns.length > 0) return result.columns;
    const firstRow = result.rows[0];
    return firstRow ? Object.keys(firstRow) : [];
  }, [result]);

  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-cyan" />
            <span className="text-sm font-semibold text-foreground">Cypher Query Console</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Examples:</span>
            <select
              onChange={(e) => {
                if (e.target.value) setQuery(e.target.value);
              }}
              className="h-8 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
              defaultValue=""
            >
              <option value="" disabled>
                Select query template…
              </option>
              {EXAMPLES.map((ex) => (
                <option key={ex.label} value={ex.query}>
                  {ex.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          rows={5}
          spellCheck={false}
          placeholder="MATCH (n) RETURN n LIMIT 50"
          className="w-full resize-y rounded-lg border border-border bg-background-elevated/80 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-cyan focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Limit:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
            >
              {[25, 50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              Press <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5">Ctrl</kbd> +{" "}
              <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5">Enter</kbd> to run
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border bg-background-elevated p-0.5">
              <button
                type="button"
                onClick={() => setView("table")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
                  view === "table"
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Table2 className="size-3.5" /> Table
              </button>
              <button
                type="button"
                onClick={() => setView("graph")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
                  view === "graph"
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Network className="size-3.5" /> Graph
              </button>
            </div>

            <Button
              size="sm"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || !query.trim()}
              className="flex items-center gap-1.5"
            >
              {runMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run Query
            </Button>
          </div>
        </div>
      </GlassPanel>

      {runMutation.isError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red/30 bg-red/10 p-3.5 text-xs text-red">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Query Execution Failed</p>
            <p className="mt-1 font-mono text-[11px]">{errorMessage(runMutation.error)}</p>
          </div>
        </div>
      )}

      {result && (
        <GlassPanel>
          <GlassPanelHeader
            title="Results"
            description={
              result.execution_time_ms
                ? `${result.rows?.length ?? 0} records returned in ${result.execution_time_ms.toFixed(1)} ms`
                : `${result.rows?.length ?? 0} records returned`
            }
          />
          <div className="p-4">
            {(!result.rows || result.rows.length === 0) ? (
              <EmptyState title="No records returned" description="The query completed successfully with 0 rows." />
            ) : view === "table" ? (
              <div className="custom-scrollbar max-h-[500px] overflow-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-background-elevated/95 backdrop-blur-sm border-b border-border">
                    <tr>
                      {columns.map((col) => (
                        <th key={col} className="px-3 py-2 font-mono text-[11px] font-bold text-foreground">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-hover/60 transition-colors">
                        {columns.map((col) => {
                          const val = row[col];
                          const display =
                            val === null || val === undefined
                              ? "null"
                              : typeof val === "object"
                                ? JSON.stringify(val)
                                : String(val);
                          return (
                            <td key={col} className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ResultGraph nodes={result.nodes ?? []} edges={result.edges ?? []} />
            )}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

interface CypherNode {
  id: string;
  label?: string;
  type?: string;
  labels?: string[];
  degree?: number;
}
interface CypherEdge {
  source: string;
  target: string;
  predicate?: string;
}

/** The nodes and relationships a query touched, on the same canvas as the ontology. */
function ResultGraph({ nodes, edges }: { nodes: CypherNode[]; edges: CypherEdge[] }) {
  const [layout, setLayout] = useState<GraphLayout>("network");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const kindOf = (n: CypherNode) => (n.labels?.[0] ?? n.type ?? "node").toLowerCase();
  const simpleNodes = useMemo<SimpleNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        sublabel: n.labels?.join(" · ") ?? n.type ?? "",
        color: kindColor(kindOf(n)),
        group: kindOf(n),
        weight: n.degree ?? 0,
      })),
    [nodes],
  );
  const simpleEdges = useMemo<SimpleEdge[]>(
    () =>
      edges.map((e, i) => ({
        id: `${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        label: e.predicate ?? "",
      })),
    [edges],
  );
  const kinds = useMemo(() => [...new Set(nodes.map(kindOf))], [nodes]);

  if (nodes.length === 0) {
    return (
      <EmptyState
        title="Nothing to draw"
        description="This query returned values, not nodes or relationships. Switch to Table, or RETURN whole nodes (e.g. RETURN n, r, m)."
      />
    );
  }

  return (
    <GraphCanvas
      nodes={simpleNodes}
      edges={simpleEdges}
      layout={layout}
      nodeStyle="dot"
      selectedId={selectedId}
      onNodeClick={(id) => setSelectedId((cur) => (cur === id ? null : id))}
      onPaneClick={() => setSelectedId(null)}
      className="h-[min(70vh,44rem)]"
      toolbar={
        <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated/90 p-0.5 backdrop-blur-md">
          {(["network", "hierarchy"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                layout === l
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      }
      legend={
        <div className="flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background-elevated/90 px-2.5 py-1.5 backdrop-blur-md">
          {kinds.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: kindColor(k) }} />
              {kindLabel(k)}
            </span>
          ))}
        </div>
      }
    />
  );
}
