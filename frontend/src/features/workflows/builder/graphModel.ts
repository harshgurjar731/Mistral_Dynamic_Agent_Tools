/**
 * graphModel — the translation layer between a WorkflowDefinition (the source
 * of truth, what the backend stores and compiles) and the ReactFlow node/edge
 * arrays the canvas renders.
 *
 * Everything here is pure: no React, no store access. That keeps the mapping
 * testable and makes it obvious that the canvas holds no authoritative state
 * of its own — it is a projection of the definition.
 */

import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type {
  CatalogAgent,
  NodeLayout,
  StepType,
  ValidationIssue,
  WorkflowDefinition,
  WorkflowStep,
} from '../../../api/workflowBuilder';

/* ── Node geometry ──────────────────────────────────────────────────────── */

export const NODE_SIZE: Record<StepType, { width: number; height: number }> = {
  // Agents are taller than the rest: they carry a row of attached tool chips.
  agent: { width: 260, height: 156 },
  tool: { width: 260, height: 128 },
  condition: { width: 260, height: 126 },
  transform: { width: 260, height: 112 },
};

export const STEP_META: Record<
  StepType,
  { label: string; accent: string; glow: string; hint: string }
> = {
  agent: {
    label: 'Agent',
    accent: '#818cf8',
    glow: '129,140,248',
    hint: 'Runs a Mistral agent with a templated prompt',
  },
  tool: {
    label: 'Tool',
    accent: '#f472b6',
    glow: '244,114,182',
    hint: 'Calls a single tool with templated arguments',
  },
  condition: {
    label: 'Condition',
    accent: '#fbbf24',
    glow: '251,191,36',
    hint: 'Branches on an expression over workflow variables',
  },
  transform: {
    label: 'Transform',
    accent: '#22d3ee',
    glow: '34,211,238',
    hint: 'Reshapes variables between steps',
  },
};

/* ── Identifiers ────────────────────────────────────────────────────────── */

/** Step ids are interpolated into generated Python names, so keep them strict. */
export function slugifyStepId(raw: string): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  const safe = cleaned || 'step';
  return /^[a-z_]/.test(safe) ? safe : `s_${safe}`;
}

export function uniqueStepId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugifyStepId(base).slice(0, 48);
  if (!used.has(root)) return root;
  let n = 2;
  while (used.has(`${root}_${n}`)) n += 1;
  return `${root}_${n}`;
}

/** Workflow names follow the backend's `^[a-z][a-z0-9_]{2,63}$`. */
export function slugifyWorkflowName(raw: string): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 64);
  if (!cleaned) return '';
  return /^[a-z]/.test(cleaned) ? cleaned : `w_${cleaned}`.slice(0, 64);
}

/* ── Step factories ─────────────────────────────────────────────────────── */

export function makeAgentStep(agent: CatalogAgent, id: string): WorkflowStep {
  return {
    id,
    type: 'agent',
    tier: agent.tier ?? null,
    description: agent.name,
    config: {
      agent_id: agent.id,
      agent_name: agent.name,
      model: agent.model,
      // {{variable}} is the engine's substitution syntax (substitute_double_brackets).
      query_template: '{{input}}',
    },
    next_steps: [],
    parallel_group: null,
  };
}

// NOTE: there is deliberately no makeToolStep.
//
// A tool cannot run on its own — `run_agent_step` passes only `agent_id` to
// `client.agents.complete`, and the tools the model may call come from the
// agent's own definition on Mistral. Tools are therefore attached to agents,
// not dropped onto the canvas as standalone steps. Legacy `tool` steps from
// older definitions still render and execute; the builder just never creates
// new ones.

export function makeLogicStep(type: 'condition' | 'transform', id: string): WorkflowStep {
  if (type === 'condition') {
    return {
      id,
      type: 'condition',
      description: 'Branch',
      config: { expression: '', true_step: '', false_step: '' },
      next_steps: [],
      parallel_group: null,
    };
  }
  return {
    id,
    type: 'transform',
    description: 'Transform',
    config: { transform_code: '', mappings: {} },
    next_steps: [],
    parallel_group: null,
  };
}

export function emptyDefinition(): WorkflowDefinition {
  return {
    name: '',
    description: '',
    steps: [],
    entry_step: '',
    input_schema: [{ name: 'input', type: 'string', description: 'Initial user input', required: true }],
    variables: {},
    is_deployed: false,
    archived: false,
    source: 'builder',
    ui_layout: {},
    published_hash: null,
  };
}

/* ── Definition -> ReactFlow ────────────────────────────────────────────── */

/** All targets a step can hand control to, including condition branches. */
export function outgoingTargets(step: WorkflowStep): string[] {
  const targets = [...(step.next_steps ?? [])];
  if (step.type === 'condition') {
    for (const key of ['true_step', 'false_step'] as const) {
      const target = step.config?.[key];
      if (typeof target === 'string' && target) targets.push(target);
    }
  }
  return targets;
}

export interface BuildGraphOptions {
  selectedId: string | null;
  issues: ValidationIssue[];
  /**
   * Agents from the catalog, keyed by id. Agent nodes read their tool list from
   * here rather than from step config, because the tools live on the Mistral
   * agent — the catalog is the only thing that reflects reality.
   */
  agentsById?: Record<string, CatalogAgent>;
  /** Step id being hovered as a tool drop target. */
  toolDropTargetId?: string | null;
  /** Step ids currently executing/completed, when previewing a run. */
  highlight?: Record<string, string>;
}

/** Step ids an agent-bound tool can legally be dropped onto. */
export function isAgentStep(step: WorkflowStep | undefined): boolean {
  return step?.type === 'agent';
}

/**
 * The agent step at a canvas position, or null. Used to decide whether a tool
 * being dragged is over a valid target.
 */
export function agentStepAt(
  definition: WorkflowDefinition,
  point: NodeLayout,
): WorkflowStep | null {
  for (const step of definition.steps ?? []) {
    if (step.type !== 'agent') continue;
    const layout = definition.ui_layout?.[step.id];
    if (!layout) continue;
    const size = NODE_SIZE[step.type] ?? NODE_SIZE.agent;
    if (
      point.x >= layout.x &&
      point.x <= layout.x + size.width &&
      point.y >= layout.y &&
      point.y <= layout.y + size.height
    ) {
      return step;
    }
  }
  return null;
}

export function definitionToFlow(
  definition: WorkflowDefinition,
  options: BuildGraphOptions,
): { nodes: Node[]; edges: Edge[] } {
  const { selectedId, issues } = options;
  const steps = definition.steps ?? [];

  const issuesByStep = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (!issue.step_id) continue;
    const list = issuesByStep.get(issue.step_id) ?? [];
    list.push(issue);
    issuesByStep.set(issue.step_id, list);
  }

  const nodes: Node[] = steps.map((step) => {
    const layout = definition.ui_layout?.[step.id];
    const stepIssues = issuesByStep.get(step.id) ?? [];
    const size = NODE_SIZE[step.type] ?? NODE_SIZE.agent;

    // Tools come from the catalog agent, not step config: they live on the
    // Mistral agent, so the catalog is the only source that cannot go stale.
    const agentId = step.type === 'agent' ? (step.config?.agent_id as string) : undefined;
    const agent = agentId ? options.agentsById?.[agentId] : undefined;

    return {
      id: step.id,
      type: step.type,
      position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
      width: size.width,
      height: size.height,
      // Selection is driven by the store, not ReactFlow's internal flag, so the
      // inspector and canvas can never disagree about what is selected.
      selected: selectedId === step.id,
      data: {
        step,
        isEntry: definition.entry_step === step.id,
        issues: stepIssues,
        hasError: stepIssues.some((i) => i.severity === 'error'),
        hasWarning: stepIssues.some((i) => i.severity === 'warning'),
        agentTools: agent?.tools ?? [],
        agentMissing: Boolean(agentId) && options.agentsById !== undefined && !agent,
        isToolDropTarget: options.toolDropTargetId === step.id,
        highlight: options.highlight?.[step.id],
      },
    };
  });

  const edges: Edge[] = [];
  const stepById = new Map(steps.map((s) => [s.id, s]));

  for (const step of steps) {
    // Regular continuations
    for (const target of step.next_steps ?? []) {
      if (!stepById.has(target)) continue;
      edges.push(makeEdge(step, target, 'next'));
    }
    // Condition branches carry their own labels and colours
    if (step.type === 'condition') {
      for (const branch of ['true_step', 'false_step'] as const) {
        const target = step.config?.[branch];
        if (typeof target !== 'string' || !target || !stepById.has(target)) continue;
        edges.push(makeEdge(step, target, branch === 'true_step' ? 'true' : 'false'));
      }
    }
  }

  return { nodes, edges };
}

type EdgeKind = 'next' | 'true' | 'false';

const EDGE_STYLE: Record<EdgeKind, { stroke: string; label?: string }> = {
  next: { stroke: 'rgba(148,163,184,0.55)' },
  true: { stroke: 'rgba(52,211,153,0.85)', label: 'true' },
  false: { stroke: 'rgba(248,113,113,0.85)', label: 'false' },
};

function makeEdge(step: WorkflowStep, target: string, kind: EdgeKind): Edge {
  const style = EDGE_STYLE[kind];
  const isParallel = Boolean(step.parallel_group);
  return {
    id: `${step.id}->${target}:${kind}`,
    source: step.id,
    target,
    type: 'smoothstep',
    animated: isParallel,
    label: style.label,
    labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: '#0b1018' },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    style: {
      stroke: style.stroke,
      strokeWidth: 1.6,
      strokeDasharray: isParallel ? '6 4' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 16, height: 16 },
    data: { kind },
  };
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

export function autoLayout(
  definition: WorkflowDefinition,
  direction: 'TB' | 'LR' = 'TB',
): Record<string, NodeLayout> {
  const steps = definition.steps ?? [];
  if (steps.length === 0) return {};

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: direction === 'LR' ? 48 : 60,
    ranksep: direction === 'LR' ? 90 : 74,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const step of steps) {
    const size = NODE_SIZE[step.type] ?? NODE_SIZE.agent;
    g.setNode(step.id, { width: size.width, height: size.height });
  }

  const known = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const target of outgoingTargets(step)) {
      if (known.has(target)) g.setEdge(step.id, target);
    }
  }

  dagre.layout(g);

  const layout: Record<string, NodeLayout> = {};
  for (const step of steps) {
    const positioned = g.node(step.id);
    if (!positioned) continue;
    const size = NODE_SIZE[step.type] ?? NODE_SIZE.agent;
    layout[step.id] = {
      x: Math.round(positioned.x - size.width / 2),
      y: Math.round(positioned.y - size.height / 2),
    };
  }
  return layout;
}

/** Free slot near a drop point that does not overlap an existing node. */
export function findFreePosition(
  layout: Record<string, NodeLayout>,
  desired: NodeLayout,
): NodeLayout {
  const OVERLAP = 40;
  const taken = Object.values(layout);
  const collides = (p: NodeLayout) =>
    taken.some((t) => Math.abs(t.x - p.x) < OVERLAP && Math.abs(t.y - p.y) < OVERLAP);

  const candidate = { ...desired };
  let guard = 0;
  while (collides(candidate) && guard < 50) {
    candidate.x += 28;
    candidate.y += 28;
    guard += 1;
  }
  return candidate;
}

/* ── Graph mutations ────────────────────────────────────────────────────── */

/**
 * Connect two steps. Conditions route via `true_step`/`false_step`; everything
 * else appends to `next_steps`. Returns a new step list — never mutates.
 */
export function connectSteps(
  steps: WorkflowStep[],
  sourceId: string,
  targetId: string,
  branch?: 'true' | 'false',
): WorkflowStep[] {
  if (sourceId === targetId) return steps;

  return steps.map((step) => {
    if (step.id !== sourceId) return step;

    if (step.type === 'condition') {
      // Default to filling the empty branch, true first.
      const key =
        branch === 'false'
          ? 'false_step'
          : branch === 'true'
            ? 'true_step'
            : !step.config?.true_step
              ? 'true_step'
              : 'false_step';
      return { ...step, config: { ...step.config, [key]: targetId } };
    }

    if ((step.next_steps ?? []).includes(targetId)) return step;
    return { ...step, next_steps: [...(step.next_steps ?? []), targetId] };
  });
}

export function disconnectSteps(
  steps: WorkflowStep[],
  sourceId: string,
  targetId: string,
  kind: EdgeKind = 'next',
): WorkflowStep[] {
  return steps.map((step) => {
    if (step.id !== sourceId) return step;
    if (step.type === 'condition' && kind !== 'next') {
      const key = kind === 'true' ? 'true_step' : 'false_step';
      return { ...step, config: { ...step.config, [key]: '' } };
    }
    return { ...step, next_steps: (step.next_steps ?? []).filter((t) => t !== targetId) };
  });
}

/** Remove a step and every reference to it, so no dangling edges survive. */
export function removeStep(steps: WorkflowStep[], stepId: string): WorkflowStep[] {
  return steps
    .filter((step) => step.id !== stepId)
    .map((step) => {
      const next = { ...step, next_steps: (step.next_steps ?? []).filter((t) => t !== stepId) };
      if (step.type === 'condition') {
        const config = { ...step.config };
        for (const key of ['true_step', 'false_step'] as const) {
          if (config[key] === stepId) config[key] = '';
        }
        next.config = config;
      }
      return next;
    });
}

/**
 * Rename a step, rewriting every inbound reference. Returns null when the new
 * id collides with an existing one.
 */
export function renameStep(
  definition: WorkflowDefinition,
  fromId: string,
  toRaw: string,
): WorkflowDefinition | null {
  const toId = slugifyStepId(toRaw);
  if (!toId || toId === fromId) return null;
  if (definition.steps.some((s) => s.id === toId)) return null;

  const steps = definition.steps.map((step) => {
    const renamed: WorkflowStep = step.id === fromId ? { ...step, id: toId } : { ...step };
    renamed.next_steps = (step.next_steps ?? []).map((t) => (t === fromId ? toId : t));
    if (step.type === 'condition') {
      const config = { ...step.config };
      for (const key of ['true_step', 'false_step'] as const) {
        if (config[key] === fromId) config[key] = toId;
      }
      renamed.config = config;
    }
    return renamed;
  });

  const ui_layout = { ...definition.ui_layout };
  if (ui_layout[fromId]) {
    ui_layout[toId] = ui_layout[fromId];
    delete ui_layout[fromId];
  }

  return {
    ...definition,
    steps,
    ui_layout,
    entry_step: definition.entry_step === fromId ? toId : definition.entry_step,
  };
}

/* ── Variable discovery ─────────────────────────────────────────────────── */

/**
 * Variables available to a step: workflow inputs plus the outputs of every
 * upstream step. Drives the inspector's autocomplete so users insert names
 * that actually resolve at runtime.
 */
export function availableVariables(
  definition: WorkflowDefinition,
  stepId: string | null,
): { name: string; origin: string }[] {
  const vars: { name: string; origin: string }[] = [];

  for (const field of definition.input_schema ?? []) {
    if (field?.name) vars.push({ name: field.name, origin: 'workflow input' });
  }
  for (const key of Object.keys(definition.variables ?? {})) {
    vars.push({ name: key, origin: 'workflow variable' });
  }

  // Ancestors of the target step, found by reverse traversal.
  const parents = new Map<string, string[]>();
  for (const step of definition.steps ?? []) {
    for (const target of outgoingTargets(step)) {
      parents.set(target, [...(parents.get(target) ?? []), step.id]);
    }
  }

  const ancestors = new Set<string>();
  if (stepId) {
    const frontier = [...(parents.get(stepId) ?? [])];
    while (frontier.length) {
      const current = frontier.pop()!;
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      frontier.push(...(parents.get(current) ?? []));
    }
  }

  for (const step of definition.steps ?? []) {
    if (stepId && !ancestors.has(step.id)) continue;
    if (step.id === stepId) continue;
    vars.push({ name: `step_${step.id}_output`, origin: `output of ${step.id}` });
  }

  return vars;
}

/** Template placeholders that will not resolve from the available variables. */
export function unresolvedPlaceholders(
  template: string,
  available: { name: string }[],
): string[] {
  const names = new Set(available.map((v) => v.name));
  const found = [...(template ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)];
  return [...new Set(found.map((m) => m[1]))].filter((n) => !names.has(n.split('.')[0]));
}
