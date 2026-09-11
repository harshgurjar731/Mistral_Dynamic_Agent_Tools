import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Concept } from "@/types";
import { breadcrumb, buildDomainTree } from "./domainTree";
import { Button } from "@/components/ui/button";

export function DomainCascadeSelect({
  concepts,
  selected,
  onAdd,
  onRemove,
  disabled,
}: {
  concepts: Concept[];
  selected: string[];
  onAdd: (conceptId: string) => void;
  onRemove: (conceptId: string) => void;
  disabled?: boolean;
}) {
  const tree = useMemo(() => buildDomainTree(concepts), [concepts]);
  const [industryId, setIndustryId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [subdomainId, setSubdomainId] = useState("");

  const domains = industryId ? (tree.childrenOf.get(industryId) ?? []) : [];
  const subdomains = domainId ? (tree.childrenOf.get(domainId) ?? []) : [];
  const deepest = subdomainId || domainId || industryId;

  const reset = () => {
    setIndustryId("");
    setDomainId("");
    setSubdomainId("");
  };

  const add = () => {
    if (!deepest || selected.includes(deepest)) return;
    onAdd(deepest);
    reset();
  };

  if (!concepts.length) {
    return <p className="text-xs text-muted-foreground">No domain vocabulary loaded.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 min-h-[26px]">
        {selected.length === 0 ? (
          <span className="text-[11px] italic text-muted-foreground">Not classified yet</span>
        ) : (
          selected.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-[11px] text-primary"
            >
              {breadcrumb(tree, id)}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="rounded-full p-0.5 text-primary/70 hover:bg-primary/20 hover:text-primary"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={industryId}
          disabled={disabled}
          onChange={(e) => {
            setIndustryId(e.target.value);
            setDomainId("");
            setSubdomainId("");
          }}
          className="h-8 rounded-md border border-border bg-background-elevated px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        >
          <option value="">Industry…</option>
          {tree.roots.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        {domains.length > 0 && (
          <select
            value={domainId}
            disabled={disabled}
            onChange={(e) => {
              setDomainId(e.target.value);
              setSubdomainId("");
            }}
            className="h-8 rounded-md border border-border bg-background-elevated px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            <option value="">Domain…</option>
            {domains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        {subdomains.length > 0 && (
          <select
            value={subdomainId}
            disabled={disabled}
            onChange={(e) => setSubdomainId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background-elevated px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            <option value="">Subdomain…</option>
            {subdomains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        {deepest && !selected.includes(deepest) && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={add}
            disabled={disabled}
            className="h-8 px-2.5 text-xs gap-1"
          >
            <Plus className="size-3" /> Add
          </Button>
        )}
      </div>
    </div>
  );
}
