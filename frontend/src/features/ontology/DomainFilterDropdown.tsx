import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Tag } from 'lucide-react';
import type { Concept } from '../../api/ontology';
import { cn } from '../../lib/utils';
import DomainCascadeSelect from './DomainCascadeSelect';

/**
 * "Domain ▾" — a popover button wrapping `DomainCascadeSelect` for filtering
 * a list rather than editing one subject's classification. Purely
 * controlled: the caller owns `selected` and decides what matching a filter
 * means (see `domainTree.ts`'s `expandedMatchSet` — picking an industry here
 * should also match a resource tagged with one of its subdomains).
 */
export default function DomainFilterDropdown({
  concepts,
  selected,
  onChange,
}: {
  concepts: Concept[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const add = (id: string) => onChange(new Set(selected).add(id));
  const remove = (id: string) => {
    const next = new Set(selected);
    next.delete(id);
    onChange(next);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
          selected.size > 0
            ? 'border-indigo-400/40 bg-indigo-500/10 text-white'
            : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-white',
        )}
      >
        <Tag size={13} />
        Domain
        {selected.size > 0 && (
          <span className="rounded-full bg-indigo-500/25 px-1.5 py-px font-mono text-[10px] text-indigo-200">
            {selected.size}
          </span>
        )}
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        // Right-aligned: the trigger sits toward the right edge of its row in
        // every place this is used (after a flex-1 search box), so anchoring
        // from the left pushed a fixed-width panel straight off the page.
        <div className="absolute right-0 top-full z-20 mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Filter by domain
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-[10px] text-indigo-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
          <DomainCascadeSelect
            concepts={concepts}
            selected={[...selected]}
            onAdd={add}
            onRemove={remove}
          />
        </div>
      )}
    </div>
  );
}
