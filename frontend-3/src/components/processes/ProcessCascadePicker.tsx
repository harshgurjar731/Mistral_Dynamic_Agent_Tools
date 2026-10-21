/**
 * Industry › Domain › Subdomain › Process › Subprocess — the ontology cascade
 * extended by the two process levels. Used to pick a stored process document
 * on the orchestration pages and to file an upload under a process.
 */
import { useMemo, useState } from "react";
import type { ProcessTree, TreeConcept, TreeProcess } from "@/api/processes";
import { cn } from "@/lib/utils";

export interface ProcessIndex {
  domainsByParent: Map<string, TreeConcept[]>;
  rootsByDomain: Map<string, TreeProcess[]>;
  subsByParent: Map<string, TreeProcess[]>;
  byId: Map<string, TreeConcept | TreeProcess>;
}

export function indexTree(tree: ProcessTree | undefined): ProcessIndex {
  const domainsByParent = new Map<string, TreeConcept[]>();
  const rootsByDomain = new Map<string, TreeProcess[]>();
  const subsByParent = new Map<string, TreeProcess[]>();
  const byId = new Map<string, TreeConcept | TreeProcess>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const d of tree?.domains ?? []) {
    byId.set(d.id, d);
    push(domainsByParent, d.parent_id ?? "", d);
  }
  for (const p of tree?.processes ?? []) {
    byId.set(p.id, p);
    if (p.parent_id) push(subsByParent, p.parent_id, p);
    else if (p.domain_id) push(rootsByDomain, p.domain_id, p);
  }
  const byLabel = (a: TreeConcept, b: TreeConcept) => a.label.localeCompare(b.label);
  for (const m of [domainsByParent, rootsByDomain, subsByParent]) {
    for (const [k, v] of m) m.set(k, [...v].sort(byLabel));
  }
  return { domainsByParent, rootsByDomain, subsByParent, byId };
}

const SELECT =
  "h-8 min-w-0 max-w-[11rem] rounded-md border border-border bg-background-elevated px-2 py-1 text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-40";

export function ProcessCascadePicker({
  tree,
  value,
  onChange,
  onlyWithDocuments,
  className,
}: {
  tree: ProcessTree | undefined;
  value: string;
  onChange: (processId: string) => void;
  /** Hide processes with no valid active document (picking one to use). */
  onlyWithDocuments?: boolean;
  className?: string;
}) {
  const idx = useMemo(() => indexTree(tree), [tree]);
  const [industry, setIndustry] = useState("");
  const [domain, setDomain] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [process, setProcess] = useState("");

  const keep = (p: TreeProcess) =>
    !onlyWithDocuments ||
    Boolean(p.documents.active_id) ||
    (idx.subsByParent.get(p.id) ?? []).some(keep);

  const domains = industry ? (idx.domainsByParent.get(industry) ?? []) : [];
  const subdomains = domain ? (idx.domainsByParent.get(domain) ?? []) : [];
  const processes = [
    ...(subdomain ? (idx.rootsByDomain.get(subdomain) ?? []) : []),
    ...(!subdomain && domain ? (idx.rootsByDomain.get(domain) ?? []) : []),
  ].filter(keep);
  const subprocesses = process ? (idx.subsByParent.get(process) ?? []).filter(keep) : [];

  const set = (id: string) => onChange(id);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <select
        className={SELECT}
        value={industry}
        onChange={(e) => {
          setIndustry(e.target.value);
          setDomain("");
          setSubdomain("");
          setProcess("");
          set("");
        }}
        aria-label="Industry"
      >
        <option value="">Industry…</option>
        {(idx.domainsByParent.get("") ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        value={domain}
        disabled={!domains.length}
        onChange={(e) => {
          setDomain(e.target.value);
          setSubdomain("");
          setProcess("");
          set("");
        }}
        aria-label="Domain"
      >
        <option value="">Domain…</option>
        {domains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        value={subdomain}
        disabled={!subdomains.length}
        onChange={(e) => {
          setSubdomain(e.target.value);
          setProcess("");
          set("");
        }}
        aria-label="Subdomain"
      >
        <option value="">{subdomains.length ? "Subdomain…" : "No subdomains"}</option>
        {subdomains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        value={process}
        disabled={!processes.length}
        onChange={(e) => {
          setProcess(e.target.value);
          set(e.target.value);
        }}
        aria-label="Process"
      >
        <option value="">{domain && !processes.length ? "No processes" : "Process…"}</option>
        {processes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.documents.active_id ? ` (v${c.documents.active_version})` : " — no document"}
          </option>
        ))}
      </select>
      {subprocesses.length ? (
        <select
          className={SELECT}
          value={value !== process ? value : ""}
          onChange={(e) => set(e.target.value || process)}
          aria-label="Subprocess"
        >
          <option value="">Whole process</option>
          {subprocesses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.documents.active_id ? ` (v${c.documents.active_version})` : " — no document"}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
