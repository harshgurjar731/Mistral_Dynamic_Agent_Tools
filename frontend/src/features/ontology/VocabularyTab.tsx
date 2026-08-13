import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import { ontologyApi, type Concept, type ConceptScheme } from '../../api/ontology';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

/**
 * Vocabulary — browse and edit the terms themselves.
 *
 * The YAML seed ships a starting vocabulary; this is how it grows in place.
 * Deleting is the one operation that can quietly destroy work, because a
 * concept id is what annotations point at — so every delete shows what it
 * would take with it before it does anything.
 */

const LEVEL_TINT: Record<string, string> = {
  industry: 'text-purple-300',
  domain: 'text-indigo-300',
  subdomain: 'text-sky-300',
};

interface EditorState {
  mode: 'create' | 'edit';
  schemeId: string;
  parentId?: string | null;
  concept?: Concept;
}

export default function VocabularyTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Concept | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: schemeData } = useQuery({
    queryKey: ['ontology', 'schemes'],
    queryFn: () => ontologyApi.schemes().then((r) => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: QK.ontologyConcepts(),
    queryFn: () => ontologyApi.concepts().then((r) => r.data),
  });

  const concepts = useMemo(() => (data?.concepts ?? []) as Concept[], [data]);
  const schemes = (schemeData?.schemes ?? []) as ConceptScheme[];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ontology'] });
  };

  const byScheme = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? new Set(
          concepts
            .filter(
              (c) =>
                c.label.toLowerCase().includes(needle) ||
                c.id.toLowerCase().includes(needle) ||
                (c.synonyms ?? []).some((s) => s.toLowerCase().includes(needle)),
            )
            // A match is only useful with its ancestors, or it appears as a
            // root with no context.
            .flatMap((c) => {
              const chain = [c.id];
              let cursor = c.parent_id;
              const index = new Map(concepts.map((x) => [x.id, x]));
              while (cursor) {
                chain.push(cursor);
                cursor = index.get(cursor)?.parent_id ?? null;
              }
              return chain;
            }),
        )
      : null;

    const visible = matching ? concepts.filter((c) => matching.has(c.id)) : concepts;
    const grouped = new Map<string, Concept[]>();
    for (const concept of visible) {
      grouped.set(concept.scheme_id, [...(grouped.get(concept.scheme_id) ?? []), concept]);
    }
    return grouped;
  }, [concepts, query]);

  const deleteMut = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) =>
      ontologyApi.deleteConcept(id, cascade),
    onSuccess: () => { setPendingDelete(null); invalidate(); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-text-muted)]">
        <Loader2 size={16} className="animate-spin" /> Loading vocabulary…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms and synonyms…"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-1.5 pl-8 pr-2 text-xs text-white focus:border-indigo-500/50 focus:outline-none"
          />
        </div>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {concepts.length} concepts across {schemes.length} schemes
        </span>
      </div>

      {[...byScheme.entries()].map(([schemeId, list]) => {
        const scheme = schemes.find((s) => s.id === schemeId);
        const roots = list.filter((c) => !c.parent_id || !list.some((x) => x.id === c.parent_id));
        const childrenOf = (id: string) => list.filter((c) => c.parent_id === id);

        const render = (concept: Concept, depth: number): React.ReactNode => {
          const kids = childrenOf(concept.id);
          const isCollapsed = collapsed.has(concept.id);
          return (
            <div key={concept.id}>
              <div
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]"
                style={{ paddingLeft: 8 + depth * 18 }}
              >
                {kids.length > 0 ? (
                  <button
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        next.has(concept.id) ? next.delete(concept.id) : next.add(concept.id);
                        return next;
                      })
                    }
                    className="shrink-0 text-[var(--color-text-muted)] hover:text-white"
                  >
                    <ChevronRight
                      size={12}
                      className={cn('transition-transform', !isCollapsed && 'rotate-90')}
                    />
                  </button>
                ) : (
                  <span className="w-3 shrink-0" />
                )}

                <span className="truncate text-sm text-white">{concept.label}</span>
                {concept.level_name && (
                  <span className={cn('shrink-0 text-[9px] uppercase tracking-wider',
                    LEVEL_TINT[concept.level_name] ?? 'text-[var(--color-text-muted)]')}>
                    {concept.level_name}
                  </span>
                )}
                <code className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {concept.id}
                </code>
                {concept.definition && (
                  <span className="truncate text-xs text-[var(--color-text-muted)]">
                    {concept.definition}
                  </span>
                )}

                <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => setEditor({ mode: 'create', schemeId, parentId: concept.id })}
                    title="Add a child concept"
                    className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-emerald-300"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={() => setEditor({ mode: 'edit', schemeId, concept })}
                    title="Edit"
                    className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-indigo-300"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setPendingDelete(concept)}
                    title="Delete"
                    className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {!isCollapsed && kids.map((child) => render(child, depth + 1))}
            </div>
          );
        };

        return (
          <section
            key={schemeId}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {scheme?.label ?? schemeId} · {list.length}
                </h2>
                {scheme?.description && (
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                    {scheme.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => setEditor({ mode: 'create', schemeId, parentId: null })}
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-emerald-400/40 hover:text-emerald-300"
              >
                <Plus size={11} /> Add concept
              </button>
            </div>
            <div>{roots.map((root) => render(root, 0))}</div>
          </section>
        );
      })}

      {editor && (
        <ConceptEditor
          state={editor}
          concepts={concepts}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); invalidate(); }}
        />
      )}

      {pendingDelete && (
        <DeleteConceptDialog
          concept={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(cascade) => deleteMut.mutate({ id: pendingDelete.id, cascade })}
          isPending={deleteMut.isPending}
          error={(deleteMut.error as any)?.response?.data?.detail}
        />
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────

function ConceptEditor({
  state, concepts, onClose, onSaved,
}: {
  state: EditorState;
  concepts: Concept[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === 'edit' ? state.concept! : null;
  const [id, setId] = useState(editing?.id ?? '');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [definition, setDefinition] = useState(editing?.definition ?? '');
  const [parentId, setParentId] = useState(editing?.parent_id ?? state.parentId ?? '');
  const [synonyms, setSynonyms] = useState((editing?.synonyms ?? []).join(', '));

  const save = useMutation({
    mutationFn: () => {
      const list = synonyms.split(',').map((s) => s.trim()).filter(Boolean);
      if (editing) {
        return ontologyApi.updateConcept(editing.id, {
          label, definition, synonyms: list,
          parent_id: parentId || undefined,
          clear_parent: !parentId,
        });
      }
      return ontologyApi.createConcept({
        id: id.trim(), scheme_id: state.schemeId, label,
        parent_id: parentId || null, definition, synonyms: list,
      });
    },
    onSuccess: onSaved,
  });

  const parentOptions = concepts.filter(
    (c) => c.scheme_id === state.schemeId && c.id !== editing?.id,
  );
  const detail = (save.error as any)?.response?.data?.detail;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {editing ? 'Edit concept' : 'New concept'}
          </h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          {!editing && (
            <Field label="Concept id" hint="Dotted and unique, e.g. domain.bfsi.banking">
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="domain.bfsi.banking"
                className="minimal-input w-full rounded-lg px-2.5 py-1.5 font-mono text-xs"
              />
            </Field>
          )}
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
            />
          </Field>
          <Field label="Parent" hint="Leave empty to make this a top-level term">
            <select
              value={parentId ?? ''}
              onChange={(e) => setParentId(e.target.value)}
              className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
            >
              <option value="">— none —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {' '.repeat((c.level ?? 0) * 3)}{c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Definition">
            <textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={2}
              className="minimal-input w-full resize-none rounded-lg px-2.5 py-1.5 text-xs"
            />
          </Field>
          <Field
            label="Synonyms"
            hint="Comma separated. These are what a goal is matched against — prefix with ! to replace the defaults."
          >
            <input
              value={synonyms}
              onChange={(e) => setSynonyms(e.target.value)}
              className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs"
            />
          </Field>
        </div>

        {detail && (
          <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {detail}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary rounded-lg px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !label.trim() || (!editing && !id.trim())}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {save.isPending && <Loader2 size={12} className="animate-spin" />}
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConceptDialog({
  concept, onCancel, onConfirm, isPending, error,
}: {
  concept: Concept;
  onCancel: () => void;
  onConfirm: (cascade: boolean) => void;
  isPending: boolean;
  error?: string;
}) {
  const { data: usage, isLoading } = useQuery({
    queryKey: ['ontology', 'usage', concept.id],
    queryFn: () => ontologyApi.conceptUsage(concept.id).then((r) => r.data),
  });

  const blocking = !!usage && (usage.children.length > 0 || usage.annotations > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5">
        <h3 className="mb-1 text-sm font-semibold text-white">Delete “{concept.label}”?</h3>
        <code className="text-[10px] font-mono text-[var(--color-text-muted)]">{concept.id}</code>

        {isLoading ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Loader2 size={12} className="animate-spin" /> Checking what depends on it…
          </p>
        ) : blocking ? (
          <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <AlertTriangle size={12} /> This would remove more than one term
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {usage!.children.length > 0 && <li>· {usage!.children.length} child concepts</li>}
              {usage!.annotations > 0 && (
                <li>· {usage!.annotations} annotations, including any a person confirmed</li>
              )}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
            Nothing references this concept. Safe to remove.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary rounded-lg px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(blocking)}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/30 disabled:opacity-40"
          >
            {isPending && <Loader2 size={12} className="animate-spin" />}
            {blocking ? 'Delete everything' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)] opacity-70">{hint}</p>}
    </div>
  );
}
