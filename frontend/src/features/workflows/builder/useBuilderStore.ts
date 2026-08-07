/**
 * useBuilderStore — authoritative client state for the visual workflow builder.
 *
 * The WorkflowDefinition is the single source of truth. The canvas, inspector,
 * JSON panel and script panel are all projections of it, so any of them can
 * mutate it through these actions and every other view updates coherently.
 *
 * History model
 * -------------
 * Every semantic mutation pushes the previous definition onto an undo stack.
 * Node drags are excluded: dragging emits a position update per frame, and
 * recording those would make undo useless. `commitLayout` is called once on
 * drag end for anything that should be undoable.
 */

import { create } from 'zustand';
import type {
  NodeLayout,
  ValidationIssue,
  ValidationResult,
  WorkflowDefinition,
  WorkflowStep,
} from '../../../api/workflowBuilder';
import {
  autoLayout,
  connectSteps,
  disconnectSteps,
  emptyDefinition,
  findFreePosition,
  removeStep as removeStepFrom,
  renameStep as renameStepIn,
  slugifyStepId,
} from './graphModel';

const HISTORY_LIMIT = 100;

export type BuilderTab = 'canvas' | 'json' | 'script';

interface BuilderState {
  definition: WorkflowDefinition;
  /** Definition as last persisted, for dirty detection. Null before first save. */
  savedSnapshot: string | null;
  selectedStepId: string | null;
  tab: BuilderTab;
  validation: ValidationResult | null;
  /** True once the user has edited anything — gates the leave-confirmation. */
  dirty: boolean;
  past: WorkflowDefinition[];
  future: WorkflowDefinition[];
  /** Set when editing an existing workflow; null in create mode. */
  editingName: string | null;

  // Lifecycle
  reset: (definition?: WorkflowDefinition, editingName?: string | null) => void;
  markSaved: (definition?: WorkflowDefinition) => void;

  // Definition-level
  setMeta: (patch: Partial<Pick<WorkflowDefinition, 'name' | 'description'>>) => void;
  setInputSchema: (schema: WorkflowDefinition['input_schema']) => void;
  setEntryStep: (stepId: string) => void;
  replaceDefinition: (definition: WorkflowDefinition) => void;

  // Steps
  addStep: (step: WorkflowStep, position: NodeLayout) => void;
  updateStep: (stepId: string, patch: Partial<WorkflowStep>) => void;
  updateStepConfig: (stepId: string, patch: Record<string, unknown>) => void;
  removeStep: (stepId: string) => void;
  renameStep: (fromId: string, toId: string) => boolean;
  duplicateStep: (stepId: string) => void;

  // Edges
  connect: (sourceId: string, targetId: string, branch?: 'true' | 'false') => void;
  disconnect: (sourceId: string, targetId: string, kind?: 'next' | 'true' | 'false') => void;

  // Layout
  moveNode: (stepId: string, position: NodeLayout) => void;
  commitLayout: () => void;
  runAutoLayout: (direction?: 'TB' | 'LR') => void;

  // UI
  select: (stepId: string | null) => void;
  setTab: (tab: BuilderTab) => void;
  setValidation: (result: ValidationResult | null) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Derived
  issuesForStep: (stepId: string) => ValidationIssue[];
  isDirtyAgainstSaved: () => boolean;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

/** Stable serialisation for dirty checks — ignores presentation-only layout. */
function semanticKey(d: WorkflowDefinition): string {
  return JSON.stringify({
    name: d.name,
    description: d.description ?? '',
    steps: d.steps,
    entry_step: d.entry_step,
    input_schema: d.input_schema,
    variables: d.variables,
  });
}

export const useBuilderStore = create<BuilderState>((set, get) => {
  /** Apply a semantic mutation, recording history and marking dirty. */
  const mutate = (
    fn: (d: WorkflowDefinition) => WorkflowDefinition,
    { record = true }: { record?: boolean } = {},
  ) => {
    const { definition, past } = get();
    const next = fn(clone(definition));
    set({
      definition: next,
      dirty: true,
      past: record ? [...past, definition].slice(-HISTORY_LIMIT) : past,
      future: record ? [] : get().future,
    });
  };

  return {
    definition: emptyDefinition(),
    savedSnapshot: null,
    selectedStepId: null,
    tab: 'canvas',
    validation: null,
    dirty: false,
    past: [],
    future: [],
    editingName: null,

    // ── Lifecycle ────────────────────────────────────────────────────
    reset: (definition, editingName = null) => {
      const base = definition ? clone(definition) : emptyDefinition();
      // Normalize: API responses may omit steps or ui_layout entirely.
      if (!Array.isArray(base.steps)) base.steps = [];
      if (!base.ui_layout || typeof base.ui_layout !== 'object') base.ui_layout = {};
      // Definitions authored by the planner carry no layout; give them one so
      // they open as a readable graph rather than a pile at the origin.
      if (base.steps.length > 0 && Object.keys(base.ui_layout).length === 0) {
        base.ui_layout = autoLayout(base);
      }
      set({
        definition: base,
        savedSnapshot: definition ? semanticKey(base) : null,
        selectedStepId: null,
        validation: null,
        dirty: false,
        past: [],
        future: [],
        editingName,
        tab: 'canvas',
      });
    },

    markSaved: (definition) => {
      const next = definition ? clone(definition) : get().definition;
      set({ definition: next, savedSnapshot: semanticKey(next), dirty: false });
    },

    // ── Definition-level ─────────────────────────────────────────────
    setMeta: (patch) => mutate((d) => ({ ...d, ...patch })),

    setInputSchema: (schema) => mutate((d) => ({ ...d, input_schema: schema })),

    setEntryStep: (stepId) => mutate((d) => ({ ...d, entry_step: stepId })),

    replaceDefinition: (definition) =>
      mutate(() => ({
        ...clone(definition),
        // Layout and source are builder-owned; a pasted JSON body should not
        // be able to drop the canvas positions the user arranged.
        ui_layout:
          Object.keys(definition.ui_layout ?? {}).length > 0
            ? definition.ui_layout
            : get().definition.ui_layout,
        source: 'builder',
      })),

    // ── Steps ────────────────────────────────────────────────────────
    addStep: (step, position) =>
      mutate((d) => {
        const placed = findFreePosition(d.ui_layout ?? {}, position);
        return {
          ...d,
          steps: [...d.steps, step],
          ui_layout: { ...d.ui_layout, [step.id]: placed },
          // First step dropped becomes the entry point automatically.
          entry_step: d.entry_step || step.id,
        };
      }),

    updateStep: (stepId, patch) =>
      mutate((d) => ({
        ...d,
        steps: d.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
      })),

    updateStepConfig: (stepId, patch) =>
      mutate((d) => ({
        ...d,
        steps: d.steps.map((s) =>
          s.id === stepId ? { ...s, config: { ...s.config, ...patch } } : s,
        ),
      })),

    removeStep: (stepId) => {
      mutate((d) => {
        const steps = removeStepFrom(d.steps, stepId);
        const ui_layout = { ...d.ui_layout };
        delete ui_layout[stepId];
        return {
          ...d,
          steps,
          ui_layout,
          entry_step: d.entry_step === stepId ? (steps[0]?.id ?? '') : d.entry_step,
        };
      });
      if (get().selectedStepId === stepId) set({ selectedStepId: null });
    },

    renameStep: (fromId, toId) => {
      const renamed = renameStepIn(get().definition, fromId, toId);
      if (!renamed) return false;
      mutate(() => renamed);
      // renameStepIn slugifies its input, so derive the landed id the same way
      // rather than trusting the raw string.
      if (get().selectedStepId === fromId) set({ selectedStepId: slugifyStepId(toId) });
      return true;
    },

    duplicateStep: (stepId) => {
      const { definition } = get();
      const original = definition.steps.find((s) => s.id === stepId);
      if (!original) return;

      const taken = new Set(definition.steps.map((s) => s.id));
      let copyId = `${original.id}_copy`;
      let n = 2;
      while (taken.has(copyId)) copyId = `${original.id}_copy_${n++}`;

      const source = definition.ui_layout?.[stepId] ?? { x: 0, y: 0 };
      mutate((d) => ({
        ...d,
        // A copy starts disconnected — inheriting edges would silently fan out.
        steps: [...d.steps, { ...clone(original), id: copyId, next_steps: [] }],
        ui_layout: {
          ...d.ui_layout,
          [copyId]: findFreePosition(d.ui_layout ?? {}, { x: source.x + 48, y: source.y + 48 }),
        },
      }));
      set({ selectedStepId: copyId });
    },

    // ── Edges ────────────────────────────────────────────────────────
    connect: (sourceId, targetId, branch) =>
      mutate((d) => ({ ...d, steps: connectSteps(d.steps, sourceId, targetId, branch) })),

    disconnect: (sourceId, targetId, kind = 'next') =>
      mutate((d) => ({ ...d, steps: disconnectSteps(d.steps, sourceId, targetId, kind) })),

    // ── Layout ───────────────────────────────────────────────────────
    // Dragging fires continuously, so position updates skip the history stack
    // and do not set `dirty` on their own; commitLayout closes the gesture.
    moveNode: (stepId, position) =>
      set((state) => ({
        definition: {
          ...state.definition,
          ui_layout: { ...state.definition.ui_layout, [stepId]: position },
        },
      })),

    commitLayout: () => set({ dirty: true }),

    runAutoLayout: (direction = 'TB') =>
      mutate((d) => ({ ...d, ui_layout: autoLayout(d, direction) })),

    // ── UI ───────────────────────────────────────────────────────────
    select: (stepId) => set({ selectedStepId: stepId }),
    setTab: (tab) => set({ tab }),
    setValidation: (validation) => set({ validation }),

    // ── History ──────────────────────────────────────────────────────
    undo: () => {
      const { past, future, definition } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        definition: previous,
        past: past.slice(0, -1),
        future: [definition, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const { past, future, definition } = get();
      if (future.length === 0) return;
      set({
        definition: future[0],
        past: [...past, definition].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        dirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    // ── Derived ──────────────────────────────────────────────────────
    issuesForStep: (stepId) =>
      (get().validation?.issues ?? []).filter((i) => i.step_id === stepId),

    isDirtyAgainstSaved: () => {
      const { definition, savedSnapshot } = get();
      if (savedSnapshot === null) return definition.steps.length > 0;
      return semanticKey(definition) !== savedSnapshot;
    },
  };
});
