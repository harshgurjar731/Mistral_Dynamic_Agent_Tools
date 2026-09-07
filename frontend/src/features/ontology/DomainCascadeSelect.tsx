import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Concept } from '../../api/ontology';
import { breadcrumb, buildDomainTree } from './domainTree';

/**
 * Pick a domain by narrowing top-down — Industry, then Domain, then
 * Subdomain — instead of scanning the whole ~50-concept tree at once. Each
 * dropdown only appears once its parent is chosen, so it reads as three small
 * decisions rather than one long list, and it's the same `<select>` idiom the
 * rest of this app already uses for Tier and Model. Stopping early is valid:
 * picking just the industry and clicking Add is a complete classification.
 *
 * Multi-select happens through repetition — add one, the cascade resets, add
 * another — with each addition shown as a removable breadcrumb chip.
 */
export default function DomainCascadeSelect({
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
  const [industryId, setIndustryId] = useState('');
  const [domainId, setDomainId] = useState('');
  const [subdomainId, setSubdomainId] = useState('');

  const domains = industryId ? (tree.childrenOf.get(industryId) ?? []) : [];
  const subdomains = domainId ? (tree.childrenOf.get(domainId) ?? []) : [];
  const deepest = subdomainId || domainId || industryId;

  const reset = () => {
    setIndustryId('');
    setDomainId('');
    setSubdomainId('');
  };

  const add = () => {
    if (!deepest || selected.includes(deepest)) return;
    onAdd(deepest);
    reset();
  };

  if (!concepts.length) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">No domain vocabulary loaded.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className="text-[11px] italic text-[var(--color-text-muted)]">
            Not classified yet
          </span>
        ) : (
          selected.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 py-0.5 pl-2.5 pr-1 text-[11px] text-indigo-200"
            >
              {breadcrumb(tree, id)}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="rounded-full p-0.5 text-indigo-300 hover:bg-indigo-500/20 hover:text-white"
                >
                  <X size={10} />
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
            setDomainId('');
            setSubdomainId('');
          }}
          className="minimal-input rounded-md px-2 py-1.5 text-xs disabled:opacity-50"
        >
          <option value="">Industry…</option>
          {tree.roots.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        {domains.length > 0 && (
          <select
            value={domainId}
            disabled={disabled}
            onChange={(e) => {
              setDomainId(e.target.value);
              setSubdomainId('');
            }}
            className="minimal-input rounded-md px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="">All of {tree.byId.get(industryId)?.label}</option>
            {domains.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        )}

        {subdomains.length > 0 && (
          <select
            value={subdomainId}
            disabled={disabled}
            onChange={(e) => setSubdomainId(e.target.value)}
            className="minimal-input rounded-md px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="">All of {tree.byId.get(domainId)?.label}</option>
            {subdomains.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={add}
          disabled={disabled || !deepest || selected.includes(deepest)}
          className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={11} /> Add
        </button>
      </div>
    </div>
  );
}
