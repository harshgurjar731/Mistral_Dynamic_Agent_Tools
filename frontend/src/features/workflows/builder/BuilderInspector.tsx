/**
 * BuilderInspector — the right-hand editor for whatever is selected.
 *
 * With no selection it edits workflow-level settings (name, description, input
 * schema, entry step). With a step selected it edits that step's identity,
 * binding, config and wiring. Every change goes through the store, so the
 * canvas and the generated script follow immediately.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Flag,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Variable,
  X,
  XCircle,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogAgent,
  CatalogConnector,
  CatalogTool,
  InputField,
  WorkflowStep,
} from '../../../api/workflowBuilder';
import { connectorsApi } from '../../../api/connectors';
import { QK } from '../../../lib/queryClient';
import { useBuilderStore } from './useBuilderStore';
import { STEP_META, availableVariables, unresolvedPlaceholders } from './graphModel';
import { CreateToolModal } from './CreateModals';
import { cn } from '../../../lib/utils';

interface Props {
  agents: CatalogAgent[];
  /** Agent capabilities — used by the agent-step tool picker. */
  tools: CatalogTool[];
  /** Standalone workflow steps — used by the Activity-step picker. */
  activities: CatalogTool[];
  connectors: CatalogConnector[];
  tiers: string[];
  /** Replace the tool set on a Mistral agent. Attach and detach both go through here. */
  onSetAgentTools: (agentId: string, toolNames: string[]) => void;
  /** Replace the connector set on a Mistral agent. Same contract as tools. */
  onSetAgentConnectors: (agentId: string, connectorIds: string[]) => void;
  /** An agent tool update is in flight. */
  toolsPending: boolean;
  /** An agent connector update is in flight. */
  connectorsPending: boolean;
}

const inputClass =
  'minimal-input w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-[var(--color-border-focus)]';

const labelClass =
  'block text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2.5">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function IssueList({ issues }: { issues: { severity: string; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {issues.map((issue, i) => (
        <div
          key={i}
          className={cn(
            'flex items-start gap-1.5 rounded-md px-2 py-1.5 border',
            issue.severity === 'error'
              ? 'bg-red-500/8 border-red-500/25'
              : 'bg-amber-400/8 border-amber-400/25',
          )}
        >
          {issue.severity === 'error' ? (
            <XCircle size={11} className="text-red-400 shrink-0 mt-px" />
          ) : (
            <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-px" />
          )}
          <p
            className={cn(
              'text-[10px] leading-relaxed',
              issue.severity === 'error' ? 'text-red-300' : 'text-amber-300',
            )}
          >
            {issue.message}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Clickable variable chips — inserting beats remembering the exact name. */
function VariablePicker({
  variables,
  onInsert,
}: {
  variables: { name: string; origin: string }[];
  onInsert: (token: string) => void;
}) {
  if (variables.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
        <Variable size={9} /> Insert variable
      </p>
      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <button
            key={v.name}
            type="button"
            title={v.origin}
            onClick={() => onInsert(`{{${v.name}}}`)}
            className="px-1.5 py-0.5 rounded border border-[rgba(99,102,241,0.25)] bg-[rgba(99,102,241,0.08)] text-[9px] font-mono text-[#a5b4fc] hover:bg-[rgba(99,102,241,0.18)] transition-colors"
          >
            {v.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Workflow-level settings ────────────────────────────────────────────── */

function WorkflowSettings() {
  const definition = useBuilderStore((s) => s.definition);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const setInputSchema = useBuilderStore((s) => s.setInputSchema);
  const setEntryStep = useBuilderStore((s) => s.setEntryStep);
  const editingName = useBuilderStore((s) => s.editingName);

  // Planner-created workflows may not include input_schema.
  const inputSchema = definition.input_schema ?? [];

  const updateField = (index: number, patch: Partial<InputField>) => {
    const next = [...inputSchema];
    next[index] = { ...next[index], ...patch };
    setInputSchema(next);
  };

  return (
    <>
      <Group title="Workflow">
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={definition.name ?? ''}
            onChange={(e) => setMeta({ name: e.target.value })}
            disabled={Boolean(editingName)}
            placeholder="loan_approval_flow"
            className={cn(inputClass, 'font-mono', editingName && 'opacity-60 cursor-not-allowed')}
          />
          <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            {editingName
              ? 'The name is baked into the compiled module and the Mistral registration, so it cannot change after creation.'
              : 'Lowercase letters, digits and underscores. Becomes the compiled module and function names.'}
          </p>
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={definition.description ?? ''}
            onChange={(e) => setMeta({ description: e.target.value })}
            rows={3}
            placeholder="What this workflow does"
            className={cn(inputClass, 'resize-none leading-relaxed')}
          />
        </div>

        <div>
          <label className={labelClass}>Entry step</label>
          <select
            value={definition.entry_step ?? ''}
            onChange={(e) => setEntryStep(e.target.value)}
            className={cn(inputClass, 'font-mono')}
          >
            <option value="" className="bg-[#0d121e]">
              — select —
            </option>
            {(definition.steps ?? []).map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0d121e]">
                {s.id}
              </option>
            ))}
          </select>
        </div>
      </Group>

      <Group title="Workflow inputs">
        {inputSchema.length === 0 && (
          <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
            No inputs declared. Add one to pass data in at execution time.
          </p>
        )}
        {inputSchema.map((field, index) => (
          <div
            key={index}
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] p-2 space-y-1.5"
          >
            <div className="flex items-center gap-1.5">
              <input
                value={field.name}
                onChange={(e) => updateField(index, { name: e.target.value })}
                placeholder="name"
                className={cn(inputClass, 'font-mono flex-1')}
              />
              <select
                value={field.type}
                onChange={(e) => updateField(index, { type: e.target.value })}
                className={cn(inputClass, 'w-[86px]')}
              >
                {['string', 'number', 'boolean', 'object', 'array'].map((t) => (
                  <option key={t} value={t} className="bg-[#0d121e]">
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setInputSchema(inputSchema.filter((_, i) => i !== index))
                }
                aria-label={`Remove input ${field.name || index + 1}`}
                className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
              >
                <X size={12} />
              </button>
            </div>
            <input
              value={field.description ?? ''}
              onChange={(e) => updateField(index, { description: e.target.value })}
              placeholder="description"
              className={inputClass}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setInputSchema([
              ...inputSchema,
              { name: '', type: 'string', description: '', required: true },
            ])
          }
          className="btn-secondary w-full py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5"
        >
          <Plus size={11} /> Add input
        </button>
      </Group>
    </>
  );
}

/* ── Step editors ───────────────────────────────────────────────────────── */

function AgentStepEditor({
  step,
  agents,
  tools,
  connectors,
  variables,
  onSetAgentTools,
  onSetAgentConnectors,
  toolsPending,
  connectorsPending,
}: {
  step: WorkflowStep;
  agents: CatalogAgent[];
  tools: CatalogTool[];
  connectors: CatalogConnector[];
  variables: { name: string; origin: string }[];
  onSetAgentTools: (agentId: string, toolNames: string[]) => void;
  onSetAgentConnectors: (agentId: string, connectorIds: string[]) => void;
  toolsPending: boolean;
  connectorsPending: boolean;
}) {
  const updateStepConfig = useBuilderStore((s) => s.updateStepConfig);
  const cfg = step.config ?? {};
  const queryTemplate = (cfg.query_template as string) ?? '';

  const unresolved = useMemo(
    () => unresolvedPlaceholders(queryTemplate, variables),
    [queryTemplate, variables],
  );

  return (
    <Group title="Agent">
      <div>
        <label className={labelClass}>Bound agent</label>
        <select
          value={(cfg.agent_id as string) ?? ''}
          onChange={(e) => {
            const agent = agents.find((a) => a.id === e.target.value);
            updateStepConfig(step.id, {
              agent_id: e.target.value,
              agent_name: agent?.name ?? '',
              model: agent?.model ?? cfg.model,
              tools: agent?.tools ?? [],
            });
          }}
          className={inputClass}
        >
          <option value="" className="bg-[#0d121e]">
            — select an agent —
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#0d121e]">
              {a.name} · {a.model}
            </option>
          ))}
        </select>
        {Boolean(cfg.agent_id) && !agents.some((a) => a.id === cfg.agent_id) && (
          <p className="text-[9.5px] text-amber-400 mt-1 leading-relaxed">
            This agent id is not in the current catalog — it may have been deleted on Mistral.
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>Prompt template</label>
        <textarea
          value={queryTemplate}
          onChange={(e) => updateStepConfig(step.id, { query_template: e.target.value })}
          rows={5}
          placeholder="Assess the application in {{step_intake_output}} and return a decision."
          className={cn(inputClass, 'resize-none font-mono leading-relaxed custom-scrollbar')}
        />
        {unresolved.length > 0 && (
          <p className="text-[9.5px] text-amber-400 mt-1 leading-relaxed">
            Unknown variable{unresolved.length > 1 ? 's' : ''}: {unresolved.join(', ')} — nothing
            upstream produces {unresolved.length > 1 ? 'these' : 'this'}.
          </p>
        )}
        <VariablePicker
          variables={variables}
          onInsert={(token) =>
            updateStepConfig(step.id, { query_template: `${queryTemplate}${token}` })
          }
        />
      </div>

      <AgentToolManager
        agent={agents.find((a) => a.id === cfg.agent_id) ?? null}
        tools={tools}
        onSetTools={onSetAgentTools}
        pending={toolsPending}
      />

      <AgentConnectorManager
        agent={agents.find((a) => a.id === cfg.agent_id) ?? null}
        connectors={connectors}
        onSetConnectors={onSetAgentConnectors}
        pending={connectorsPending}
      />
    </Group>
  );
}

/**
 * Connector attachment for the bound agent — the tool manager's twin.
 *
 * Same storage (the agent's `tools` array on Mistral), same blast radius, and
 * so the same warning. The difference worth surfacing is authentication: an
 * unauthenticated connector attaches fine and then fails at call time, which is
 * a far more confusing failure than a missing tool.
 */
function AgentConnectorManager({
  agent,
  connectors,
  onSetConnectors,
  pending,
}: {
  agent: CatalogAgent | null;
  connectors: CatalogConnector[];
  onSetConnectors: (agentId: string, connectorIds: string[]) => void;
  pending: boolean;
}) {
  const [adding, setAdding] = useState('');

  if (!agent) return null;

  const attached = agent.connectors ?? [];
  const available = connectors.filter((c) => !attached.includes(c.id));
  const byId = new Map(connectors.map((c) => [c.id, c]));

  return (
    <div>
      <label className={labelClass}>
        Connectors the agent may reach
        {pending && <Loader2 size={9} className="inline ml-1.5 animate-spin align-baseline" />}
      </label>

      {attached.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed mb-2">
          No connectors attached. This agent cannot reach any external service.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 mb-2">
          {attached.map((connectorId) => {
            const connector = byId.get(connectorId);
            const name = connector?.name ?? connectorId;
            const unauthenticated = connector && !connector.is_authenticated;
            return (
              <span
                key={connectorId}
                title={
                  unauthenticated
                    ? `${name} — not authenticated; calls will fail at run time`
                    : name
                }
                className={cn(
                  'group inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[9.5px] font-mono border',
                  unauthenticated
                    ? 'bg-amber-400/10 border-amber-400/25 text-amber-300'
                    : 'bg-[rgba(52,211,153,0.1)] border-[rgba(52,211,153,0.25)] text-[#6ee7b7]',
                )}
              >
                {name}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    onSetConnectors(
                      agent.id,
                      attached.filter((c) => c !== connectorId),
                    )
                  }
                  title={`Detach ${name}`}
                  aria-label={`Detach ${name}`}
                  className="opacity-60 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  <X size={9} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <select
        value={adding}
        disabled={pending || available.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          onSetConnectors(agent.id, [...attached, id]);
          setAdding('');
        }}
        className={cn(inputClass, 'font-mono')}
      >
        <option value="" className="bg-[#0d121e]">
          {connectors.length === 0
            ? '— no connectors registered —'
            : available.length === 0
              ? '— all connectors attached —'
              : '+ attach a connector…'}
        </option>
        {available.map((c) => (
          <option key={c.id} value={c.id} className="bg-[#0d121e]">
            {c.name}
            {c.is_authenticated ? '' : ' · not connected'}
          </option>
        ))}
      </select>

      <p className="flex items-start gap-1 text-[9.5px] text-amber-400/90 mt-1.5 leading-relaxed">
        <AlertTriangle size={10} className="shrink-0 mt-px" />
        <span>
          Connectors belong to the agent, not this step — changing them affects every workflow
          that uses <strong>{agent.name}</strong>.
        </span>
      </p>
    </div>
  );
}

/**
 * Tool attachment for the bound agent.
 *
 * The list is read from the catalog rather than step config because the tools
 * live on the Mistral agent — that is what the model actually sees at runtime.
 * Editing here therefore updates the agent itself, which is why the warning
 * about other workflows is not optional.
 */
function AgentToolManager({
  agent,
  tools,
  onSetTools,
  pending,
}: {
  agent: CatalogAgent | null;
  tools: CatalogTool[];
  onSetTools: (agentId: string, toolNames: string[]) => void;
  pending: boolean;
}) {
  const [adding, setAdding] = useState('');

  if (!agent) {
    return (
      <div>
        <label className={labelClass}>Tools</label>
        <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
          Bind an agent above, then attach the tools it may call.
        </p>
      </div>
    );
  }

  const attached = agent.tools ?? [];
  const available = tools.filter((t) => !attached.includes(t.name));

  return (
    <div>
      <label className={labelClass}>
        Tools the agent may call
        {pending && <Loader2 size={9} className="inline ml-1.5 animate-spin align-baseline" />}
      </label>

      {attached.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed mb-2">
          No tools attached. This agent can only reason and write text.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 mb-2">
          {attached.map((toolName) => (
            <span
              key={toolName}
              className="group inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.25)] text-[9.5px] font-mono text-[#f9a8d4]"
            >
              {toolName}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  onSetTools(
                    agent.id,
                    attached.filter((t) => t !== toolName),
                  )
                }
                title={`Detach ${toolName}`}
                aria-label={`Detach ${toolName}`}
                className="text-[#f9a8d4]/60 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <select
        value={adding}
        disabled={pending || available.length === 0}
        onChange={(e) => {
          const name = e.target.value;
          if (!name) return;
          onSetTools(agent.id, [...attached, name]);
          setAdding('');
        }}
        className={cn(inputClass, 'font-mono')}
      >
        <option value="" className="bg-[#0d121e]">
          {available.length === 0 ? '— all tools attached —' : '+ attach a tool…'}
        </option>
        {available.map((t) => (
          <option key={`${t.source}:${t.name}`} value={t.name} className="bg-[#0d121e]">
            {t.name} · {t.source}
          </option>
        ))}
      </select>

      <p className="flex items-start gap-1 text-[9.5px] text-amber-400/90 mt-1.5 leading-relaxed">
        <AlertTriangle size={10} className="shrink-0 mt-px" />
        <span>
          Tools belong to the agent, not this step — changing them affects every workflow that uses{' '}
          <strong>{agent.name}</strong>.
        </span>
      </p>
    </div>
  );
}

const SYNTHESIZE_OPTION = '__synthesize_new_activity__';

function ToolStepEditor({
  step,
  activities,
  variables,
}: {
  step: WorkflowStep;
  activities: CatalogTool[];
  variables: { name: string; origin: string }[];
}) {
  const updateStepConfig = useBuilderStore((s) => s.updateStepConfig);
  const queryClient = useQueryClient();
  const cfg = step.config ?? {};
  const toolName = (cfg.tool_name as string) ?? '';
  // `arguments` is what `run_tool_step` reads at execution time
  // (step_runners.py) — `arguments_template` is a legacy key some older saved
  // steps still carry, read here only as a display fallback.
  const args = ((cfg.arguments ?? cfg.arguments_template) as Record<string, unknown>) ?? {};
  const selectedTool = activities.find((t) => t.name === toolName);
  const [showSynthesize, setShowSynthesize] = useState(false);

  // Remembered so the variable picker knows which argument to append into.
  const [activeArg, setActiveArg] = useState<string | null>(null);

  const setArg = (key: string, value: string) =>
    updateStepConfig(step.id, { arguments: { ...args, [key]: value } });

  return (
    <Group title="Activity">
      <div className="flex items-start gap-1.5 rounded-md px-2 py-1.5 border border-[rgba(244,114,182,0.25)] bg-[rgba(244,114,182,0.06)]">
        <Sparkles size={11} className="text-pink-300 shrink-0 mt-px" />
        <p className="text-[9.5px] text-pink-200 leading-relaxed">
          This step runs the activity directly with the arguments below — an isolated, retryable
          unit of work with no agent in the loop.
        </p>
      </div>

      <div>
        <label className={labelClass}>Activity</label>
        <select
          value={toolName}
          onChange={(e) => {
            if (e.target.value === SYNTHESIZE_OPTION) {
              setShowSynthesize(true);
              return;
            }
            const tool = activities.find((t) => t.name === e.target.value);
            // Reseed argument keys from the new tool's schema; keeping the old
            // keys would send parameters the tool does not accept.
            const seeded: Record<string, string> = {};
            for (const param of Object.keys(tool?.parameters ?? {})) {
              seeded[param] = (args[param] as string) ?? `{{${param}}}`;
            }
            updateStepConfig(step.id, {
              tool_name: e.target.value,
              arguments: seeded,
            });
          }}
          className={cn(inputClass, 'font-mono')}
        >
          <option value="" className="bg-[#0d121e]">
            — select an activity —
          </option>
          <option value={SYNTHESIZE_OPTION} className="bg-[#0d121e]">
            + Synthesise new activity…
          </option>
          {activities.map((t) => (
            <option key={`${t.source}:${t.name}`} value={t.name} className="bg-[#0d121e]">
              {t.name}
            </option>
          ))}
        </select>
        {selectedTool?.description && (
          <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            {selectedTool.description}
          </p>
        )}
      </div>

      {selectedTool && Object.keys(selectedTool.parameters ?? {}).length > 0 && (
        <div>
          <label className={labelClass}>Arguments</label>
          <div className="space-y-2">
            {Object.entries(selectedTool.parameters).map(([param, schema]) => {
              const required = selectedTool.required?.includes(param);
              const value = (args[param] as string) ?? '';
              return (
                <div key={param}>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
                      {param}
                    </span>
                    <span className="text-[9px] text-[var(--color-text-muted)]">
                      {schema?.type ?? 'string'}
                    </span>
                    {required && <span className="text-[9px] text-red-400">required</span>}
                  </div>
                  <input
                    value={value}
                    onChange={(e) => setArg(param, e.target.value)}
                    onFocus={() => setActiveArg(param)}
                    placeholder={`{{${param}}}`}
                    title={schema?.description}
                    className={cn(inputClass, 'font-mono')}
                  />
                </div>
              );
            })}
          </div>
          {activeArg && (
            <VariablePicker
              variables={variables}
              onInsert={(token) => setArg(activeArg, `${(args[activeArg] as string) ?? ''}${token}`)}
            />
          )}
        </div>
      )}

      {selectedTool && Object.keys(selectedTool.parameters ?? {}).length === 0 && (
        <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
          This activity takes no parameters.
        </p>
      )}

      {showSynthesize && (
        <CreateToolModal
          purpose="activity"
          onClose={() => setShowSynthesize(false)}
          onCreated={(newName) => {
            setShowSynthesize(false);
            if (!newName) return;
            // The catalog fetch is owned by the builder page; invalidating here
            // picks up the new activity's schema so re-selecting it seeds
            // arguments correctly.
            queryClient.invalidateQueries({ queryKey: QK.builderCatalog() });
            updateStepConfig(step.id, { tool_name: newName, arguments: {} });
          }}
        />
      )}
    </Group>
  );
}

/**
 * Editor for a connector step — pick the service, pick one of its tools, then
 * template the arguments.
 *
 * The tool list is fetched here rather than shipped in the builder catalog:
 * expanding every connector's tools would cost one API call per connector on
 * every builder open, and only the selected one is ever needed.
 */
function ConnectorStepEditor({
  step,
  connectors,
  variables,
}: {
  step: WorkflowStep;
  connectors: CatalogConnector[];
  variables: { name: string; origin: string }[];
}) {
  const updateStepConfig = useBuilderStore((s) => s.updateStepConfig);
  const cfg = step.config ?? {};
  const connectorId = (cfg.connector_id as string) ?? '';
  const toolName = (cfg.tool_name as string) ?? '';
  const args = (cfg.arguments as Record<string, unknown>) ?? {};
  const credentialsName = (cfg.credentials_name as string) ?? '';

  const [activeArg, setActiveArg] = useState<string | null>(null);

  const connector = connectors.find((c) => c.id === connectorId);

  const { data: toolData, isLoading: toolsLoading } = useQuery({
    queryKey: QK.connectorTools(connectorId),
    queryFn: () => connectorsApi.tools(connectorId).then((r) => r.data),
    enabled: Boolean(connectorId),
  });

  const connectorTools = toolData?.tools ?? [];
  const selectedTool = connectorTools.find((t) => t.name === toolName);

  const setArg = (key: string, value: string) =>
    updateStepConfig(step.id, { arguments: { ...args, [key]: value } });

  return (
    <Group title="Connector">
      {connector && !connector.is_authenticated && (
        <div className="flex items-start gap-1.5 rounded-md px-2 py-1.5 border border-amber-400/25 bg-amber-400/8">
          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-px" />
          <p className="text-[9.5px] text-amber-300 leading-relaxed">
            <strong>{connector.name}</strong> is not authenticated. This step will fail at run
            time until credentials are added on the Connectors page.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass}>Service</label>
        <select
          value={connectorId}
          onChange={(e) => {
            const picked = connectors.find((c) => c.id === e.target.value);
            // Changing the service invalidates the tool and its arguments —
            // they belong to a schema that no longer applies.
            updateStepConfig(step.id, {
              connector_id: e.target.value,
              connector_name: picked?.name ?? '',
              tool_name: '',
              arguments: {},
            });
          }}
          className={cn(inputClass, 'font-mono')}
        >
          <option value="" className="bg-[#0d121e]">
            — select a connector —
          </option>
          {connectors.map((c) => (
            <option key={c.id} value={c.id} className="bg-[#0d121e]">
              {c.name}
              {c.is_authenticated ? '' : ' (not connected)'}
            </option>
          ))}
        </select>
        {connector?.description && (
          <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            {connector.description}
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>Tool</label>
        {toolsLoading ? (
          <p className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] py-1">
            <Loader2 size={10} className="animate-spin" />
            Loading tools…
          </p>
        ) : (
          <select
            value={toolName}
            disabled={!connectorId}
            onChange={(e) => {
              const tool = connectorTools.find((t) => t.name === e.target.value);
              const seeded: Record<string, string> = {};
              for (const param of Object.keys(tool?.parameters ?? {})) {
                seeded[param] = (args[param] as string) ?? `{{${param}}}`;
              }
              updateStepConfig(step.id, { tool_name: e.target.value, arguments: seeded });
            }}
            className={cn(inputClass, 'font-mono disabled:opacity-40')}
          >
            <option value="" className="bg-[#0d121e]">
              — select a tool —
            </option>
            {connectorTools.map((t) => (
              <option key={t.name} value={t.name} className="bg-[#0d121e]">
                {t.name}
              </option>
            ))}
          </select>
        )}
        {connectorId && !toolsLoading && connectorTools.length === 0 && (
          <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            No tools listed — the connector may need authenticating, or its server is unreachable.
          </p>
        )}
        {selectedTool?.description && (
          <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            {selectedTool.description}
          </p>
        )}
      </div>

      {selectedTool && Object.keys(selectedTool.parameters ?? {}).length > 0 && (
        <div>
          <label className={labelClass}>Arguments</label>
          <div className="space-y-2">
            {Object.entries(selectedTool.parameters).map(([param, schema]) => {
              const required = selectedTool.required?.includes(param);
              const value = (args[param] as string) ?? '';
              const info = schema as { type?: string; description?: string } | undefined;
              return (
                <div key={param}>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
                      {param}
                    </span>
                    <span className="text-[9px] text-[var(--color-text-muted)]">
                      {info?.type ?? 'string'}
                    </span>
                    {required && <span className="text-[9px] text-red-400">required</span>}
                  </div>
                  <input
                    value={value}
                    onChange={(e) => setArg(param, e.target.value)}
                    onFocus={() => setActiveArg(param)}
                    placeholder={`{{${param}}}`}
                    title={info?.description}
                    className={cn(inputClass, 'font-mono')}
                  />
                </div>
              );
            })}
          </div>
          {activeArg && (
            <VariablePicker
              variables={variables}
              onInsert={(token) => setArg(activeArg, `${(args[activeArg] as string) ?? ''}${token}`)}
            />
          )}
        </div>
      )}

      {selectedTool && Object.keys(selectedTool.parameters ?? {}).length === 0 && (
        <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
          This tool takes no parameters.
        </p>
      )}

      <div>
        <label className={labelClass}>Credentials</label>
        <input
          value={credentialsName}
          onChange={(e) =>
            updateStepConfig(step.id, { credentials_name: e.target.value.trim() || null })
          }
          placeholder="default"
          className={cn(inputClass, 'font-mono')}
        />
        <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
          Name of a stored credential to pin this call to. Leave blank to use the default for
          whoever triggers the workflow.
        </p>
      </div>
    </Group>
  );
}

function ConditionStepEditor({
  step,
  variables,
}: {
  step: WorkflowStep;
  variables: { name: string; origin: string }[];
}) {
  const updateStepConfig = useBuilderStore((s) => s.updateStepConfig);
  const definition = useBuilderStore((s) => s.definition);
  const cfg = step.config ?? {};
  const expression = (cfg.expression as string) ?? '';

  const others = definition.steps.filter((s) => s.id !== step.id);

  return (
    <Group title="Condition">
      <div>
        <label className={labelClass}>Expression</label>
        <textarea
          value={expression}
          onChange={(e) => updateStepConfig(step.id, { expression: e.target.value })}
          rows={3}
          placeholder="{{credit_score}} > 700"
          className={cn(inputClass, 'resize-none font-mono leading-relaxed')}
        />
        <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
          Evaluated against workflow variables after substitution.
        </p>
        <VariablePicker
          variables={variables}
          onInsert={(token) => updateStepConfig(step.id, { expression: `${expression}${token}` })}
        />
      </div>

      {(['true_step', 'false_step'] as const).map((branch) => (
        <div key={branch}>
          <label className={labelClass}>
            {branch === 'true_step' ? 'If true → go to' : 'If false → go to'}
          </label>
          <select
            value={(cfg[branch] as string) ?? ''}
            onChange={(e) => updateStepConfig(step.id, { [branch]: e.target.value })}
            className={cn(inputClass, 'font-mono')}
          >
            <option value="" className="bg-[#0d121e]">
              — end workflow —
            </option>
            {others.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0d121e]">
                {s.id}
              </option>
            ))}
          </select>
        </div>
      ))}
    </Group>
  );
}

function TransformStepEditor({ step }: { step: WorkflowStep }) {
  const updateStepConfig = useBuilderStore((s) => s.updateStepConfig);
  const cfg = step.config ?? {};

  return (
    <Group title="Transform">
      <div>
        <label className={labelClass}>Transform code</label>
        <textarea
          value={(cfg.transform_code as string) ?? ''}
          onChange={(e) => updateStepConfig(step.id, { transform_code: e.target.value })}
          rows={5}
          placeholder="{'decision': {{step_risk_output}}, 'reviewed': True}"
          className={cn(inputClass, 'resize-none font-mono leading-relaxed custom-scrollbar')}
        />
        <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
          An expression producing the variables to merge into the workflow state.
        </p>
      </div>
    </Group>
  );
}

/* ── Root ───────────────────────────────────────────────────────────────── */

export default function BuilderInspector({
  agents,
  tools,
  activities,
  connectors,
  tiers,
  onSetAgentTools,
  onSetAgentConnectors,
  toolsPending,
  connectorsPending,
}: Props) {
  const definition = useBuilderStore((s) => s.definition);
  const selectedStepId = useBuilderStore((s) => s.selectedStepId);
  const updateStep = useBuilderStore((s) => s.updateStep);
  const renameStep = useBuilderStore((s) => s.renameStep);
  const removeStep = useBuilderStore((s) => s.removeStep);
  const duplicateStep = useBuilderStore((s) => s.duplicateStep);
  const setEntryStep = useBuilderStore((s) => s.setEntryStep);
  const issuesForStep = useBuilderStore((s) => s.issuesForStep);

  const [idDraft, setIdDraft] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const step = (definition.steps ?? []).find((s) => s.id === selectedStepId) ?? null;
  const variables = useMemo(
    () => availableVariables(definition, selectedStepId),
    [definition, selectedStepId],
  );

  const panelClass = cn(
    'shrink-0 flex flex-col border-l border-[var(--color-border-subtle)] bg-[rgba(11,15,22,0.75)] backdrop-blur-md min-h-0 transition-[width] duration-150 ease-in-out overflow-hidden',
    collapsed ? 'w-10' : 'w-[300px]',
  );

  const toggleButton = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      title={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
    >
      {collapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
    </button>
  );

  if (collapsed) {
    return (
      <aside className={panelClass}>
        <div className="flex items-center justify-center py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          {toggleButton}
        </div>
      </aside>
    );
  }

  if (!step) {
    return (
      <aside className={panelClass}>
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          <Settings2 size={13} className="text-[var(--color-text-muted)]" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] flex-1 min-w-0 truncate">
            Workflow settings
          </p>
          {toggleButton}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
          <WorkflowSettings />
        </div>
      </aside>
    );
  }

  const meta = STEP_META[step.type];
  const issues = issuesForStep(step.id);
  const isEntry = definition.entry_step === step.id;

  return (
    <aside className={panelClass}>
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.accent }} />
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] flex-1 min-w-0 truncate">
          {meta.label} step
        </p>
        <button
          type="button"
          onClick={() => duplicateStep(step.id)}
          title="Duplicate step"
          aria-label="Duplicate step"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          onClick={() => removeStep(step.id)}
          title="Delete step"
          aria-label="Delete step"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={12} />
        </button>
        {toggleButton}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {issues.length > 0 && (
          <div className="px-3.5 py-3 border-b border-[var(--color-border-subtle)]">
            <IssueList issues={issues} />
          </div>
        )}

        <Group title="Identity">
          <div>
            <label className={labelClass}>Step id</label>
            <input
              value={idDraft ?? step.id}
              onChange={(e) => setIdDraft(e.target.value)}
              onBlur={() => {
                if (idDraft && idDraft !== step.id) renameStep(step.id, idDraft);
                setIdDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setIdDraft(null);
              }}
              className={cn(inputClass, 'font-mono')}
            />
            <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
              Used in generated function names and in <code>{'{{step_<id>_output}}'}</code>.
              Renaming rewrites every reference.
            </p>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <input
              value={step.description ?? ''}
              onChange={(e) => updateStep(step.id, { description: e.target.value })}
              placeholder="What this step does"
              className={inputClass}
            />
          </div>

          <button
            type="button"
            onClick={() => setEntryStep(step.id)}
            disabled={isEntry}
            className={cn(
              'w-full py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 border transition-colors',
              isEntry
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400 cursor-default'
                : 'border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[var(--color-text-muted)] hover:text-white hover:border-[rgba(99,102,241,0.4)]',
            )}
          >
            <Flag size={11} />
            {isEntry ? 'Entry step' : 'Make entry step'}
          </button>
        </Group>

        {step.type === 'agent' && (
          <AgentStepEditor
            step={step}
            agents={agents}
            tools={tools}
            connectors={connectors}
            variables={variables}
            onSetAgentTools={onSetAgentTools}
            onSetAgentConnectors={onSetAgentConnectors}
            toolsPending={toolsPending}
            connectorsPending={connectorsPending}
          />
        )}
        {step.type === 'tool' && (
          <ToolStepEditor step={step} activities={activities} variables={variables} />
        )}
        {step.type === 'connector' && (
          <ConnectorStepEditor step={step} connectors={connectors} variables={variables} />
        )}
        {step.type === 'condition' && (
          <ConditionStepEditor step={step} variables={variables} />
        )}
        {step.type === 'transform' && <TransformStepEditor step={step} />}

        <Group title="Execution">
          <div>
            <label className={labelClass}>Parallel group</label>
            <input
              value={step.parallel_group ?? ''}
              onChange={(e) =>
                updateStep(step.id, { parallel_group: e.target.value.trim() || null })
              }
              placeholder="none"
              className={cn(inputClass, 'font-mono')}
            />
            <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
              Steps sharing a group name run concurrently. They must all continue to the same next
              step.
            </p>
          </div>

          {step.type === 'agent' && (
            <div>
              <label className={labelClass}>Tier</label>
              <select
                value={step.tier ?? ''}
                onChange={(e) => updateStep(step.id, { tier: e.target.value || null })}
                className={inputClass}
              >
                <option value="" className="bg-[#0d121e]">
                  — none —
                </option>
                {tiers.map((t) => (
                  <option key={t} value={t} className="bg-[#0d121e]">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelClass}>Continues to</label>
            {(step.next_steps ?? []).length === 0 && step.type !== 'condition' && (
              <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
                Nothing — this is a terminal step.
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {(step.next_steps ?? []).map((target) => (
                <span
                  key={target}
                  className="px-1.5 py-0.5 rounded bg-[rgba(148,163,184,0.1)] border border-[rgba(148,163,184,0.25)] text-[9px] font-mono text-[var(--color-text-secondary)]"
                >
                  {target}
                </span>
              ))}
            </div>
            {step.type === 'condition' && (
              <p className="text-[9.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                Conditions route through their true and false branches above.
              </p>
            )}
          </div>
        </Group>
      </div>
    </aside>
  );
}
