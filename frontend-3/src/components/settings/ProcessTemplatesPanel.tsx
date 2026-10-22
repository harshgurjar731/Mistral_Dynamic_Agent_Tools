/**
 * Settings → Process knowledge → Templates.
 *
 * A map of the classification on the left — every industry, domain, subdomain,
 * process and subprocess, each marked with its own template or "inherits" —
 * and the selected node on the right, with what applies there and what you can
 * do about it. Inheritance runs down the tree: a node without a template of its
 * own follows the nearest one above it, ending at the global default.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileJson } from "lucide-react";
import { processesApi, QK } from "@/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeletons";
import { buildMap, find, flatten, keyOf } from "./process-templates/model";
import { TemplateDetail } from "./process-templates/TemplateDetail";
import { TemplateMap } from "./process-templates/TemplateMap";

function HowItWorks() {
  const chain = ["Subprocess", "Process", "Subdomain", "Domain", "Industry", "Global default"];
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span className="mr-1">A document follows the first template found going up:</span>
      {chain.map((c, i) => (
        <span key={c} className="flex items-center gap-1">
          <span className="rounded-md border border-border/60 bg-background-elevated px-1.5 py-0.5 text-foreground/80">
            {c}
          </span>
          {i < chain.length - 1 ? <ChevronRight className="size-3 opacity-50" /> : null}
        </span>
      ))}
    </div>
  );
}

export function ProcessTemplatesPanel({ initialScope }: { initialScope?: string | undefined }) {
  const [selected, setSelected] = useState<string | null>(initialScope ?? null);

  const tree = useQuery({ queryKey: QK.processTree(), queryFn: processesApi.tree });
  const scopes = useQuery({
    queryKey: QK.processTemplateScopes(),
    queryFn: processesApi.templateScopes,
  });

  const root = useMemo(() => buildMap(tree.data, scopes.data), [tree.data, scopes.data]);
  const node = find(root, selected) ?? root;
  const parent = useMemo(
    () => flatten(root).find((n) => n.children.some((c) => keyOf(c.id) === keyOf(node.id))) ?? null,
    [root, node.id],
  );

  return (
    <section
      id="section-backend-process_templates"
      className="overflow-hidden rounded-2xl border border-border/60"
      style={{ background: "var(--surface)" }}
    >
      <header className="space-y-2 border-b border-border/50 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileJson className="size-4 text-primary" /> Document templates
        </h3>
        <p className="max-w-3xl text-xs text-muted-foreground">
          The format a process document must follow. Pick any part of the classification to see
          which template applies there, or give it a template of its own.
        </p>
        <HowItWorks />
      </header>

      {tree.isError || scopes.isError ? (
        <div className="p-5">
          <ErrorState
            error={tree.error ?? scopes.error}
            onRetry={() => {
              void tree.refetch();
              void scopes.refetch();
            }}
          />
        </div>
      ) : tree.isLoading || scopes.isLoading ? (
        <div className="grid gap-4 p-5 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex max-h-[34rem] min-h-[20rem] flex-col border-b border-border/50 lg:max-h-[40rem] lg:border-r lg:border-b-0">
            <TemplateMap root={root} selected={node.id} onSelect={setSelected} />
          </aside>
          <div className="min-w-0 p-5">
            <TemplateDetail
              key={keyOf(node.id)}
              node={node}
              parent={parent}
              onSelect={setSelected}
            />
          </div>
        </div>
      )}
    </section>
  );
}
