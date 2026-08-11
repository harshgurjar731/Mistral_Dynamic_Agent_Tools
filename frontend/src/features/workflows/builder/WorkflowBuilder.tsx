/**
 * WorkflowBuilder — the visual authoring page.
 *
 * Serves two routes with one component:
 *   /workflows/new/visual        create mode
 *   /workflows/:workflowName/edit  edit mode (any workflow, however authored)
 *
 * Save and publish are separate on purpose. Saving stores the definition
 * locally; publishing compiles it, writes the module the worker loads, and
 * registers it on Mistral. Until you publish, the live version keeps serving.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  GitBranch,
  Loader2,
  Play,
  Save,
  Workflow,
} from 'lucide-react';
import {
  workflowBuilderApi,
  type BuilderCatalog,
  type CatalogConnector,
  type CatalogTool,
  type ValidationResult,
  type WorkflowDefinition,
} from '../../../api/workflowBuilder';
import { agentsApi, type Agent } from '../../../api/agents';
import { workflowsApi } from '../../../api/workflows';
import { QK } from '../../../lib/queryClient';
import { cn } from '../../../lib/utils';
import { useBuilderStore } from './useBuilderStore';
import { slugifyWorkflowName } from './graphModel';
import BuilderCanvas from './BuilderCanvas';
import BuilderPalette from './BuilderPalette';
import BuilderInspector from './BuilderInspector';
import { JsonPanel, ScriptPanel, ValidationBar } from './BuilderPanels';
import { CreateAgentModal, CreateToolModal } from './CreateModals';

const EMPTY_CATALOG: BuilderCatalog = {
  agents: [], tools: [], connectors: [], models: [], tiers: [],
};

function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = anyErr?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return anyErr?.message ?? fallback;
}

type Toast = { kind: 'success' | 'error'; message: string } | null;

export default function WorkflowBuilder() {
  const { workflowName } = useParams<{ workflowName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(workflowName);

  const definition = useBuilderStore((s) => s.definition);
  const semanticRevision = useBuilderStore((s) => s.semanticRevision);
  const tab = useBuilderStore((s) => s.tab);
  const setTab = useBuilderStore((s) => s.setTab);
  const validation = useBuilderStore((s) => s.validation);
  const setValidation = useBuilderStore((s) => s.setValidation);
  const reset = useBuilderStore((s) => s.reset);
  const markSaved = useBuilderStore((s) => s.markSaved);
  const select = useBuilderStore((s) => s.select);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const isDirtyAgainstSaved = useBuilderStore((s) => s.isDirtyAgainstSaved);

  const [toast, setToast] = useState<Toast>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4000);
  }, []);

  /* ── Catalog ──────────────────────────────────────────────────────── */

  const { data: catalog = EMPTY_CATALOG, isLoading: catalogLoading, refetch: refetchCatalog } =
    useQuery({
      queryKey: QK.builderCatalog(),
      queryFn: () => workflowBuilderApi.catalog().then((r) => r.data),
      staleTime: 30_000,
    });

  const agentsById = useMemo(
    () => Object.fromEntries(catalog.agents.map((a) => [a.id, a])),
    [catalog.agents],
  );

  const connectorsById = useMemo(
    () => Object.fromEntries(catalog.connectors.map((c) => [c.id, c])),
    [catalog.connectors],
  );

  /* ── Agent tool binding ───────────────────────────────────────────── */

  // Tools live on the Mistral agent, not on the workflow step: `run_agent_step`
  // passes only agent_id, and the model can call whatever the agent was created
  // with. So attaching a tool has to update the agent itself, immediately —
  // there is nothing in the definition that could carry it.
  const setAgentToolsMutation = useMutation({
    mutationFn: ({ agentId, toolNames }: { agentId: string; toolNames: string[] }) =>
      agentsApi.update(agentId, { tools: toolNames as unknown as Agent['tools'] }),
    onSuccess: (_data, { agentId, toolNames }) => {
      const name = agentsById[agentId]?.name ?? 'agent';
      queryClient.invalidateQueries({ queryKey: QK.builderCatalog() });
      queryClient.invalidateQueries({ queryKey: QK.agents() });
      showToast(
        'success',
        toolNames.length === 0
          ? `Removed all tools from ${name}.`
          : `${name} now has ${toolNames.length} tool${toolNames.length === 1 ? '' : 's'}.`,
      );
    },
    onError: (err) => showToast('error', errorMessage(err, 'Could not update the agent’s tools.')),
  });

  const setAgentTools = useCallback(
    (agentId: string, toolNames: string[]) =>
      setAgentToolsMutation.mutate({ agentId, toolNames }),
    [setAgentToolsMutation],
  );

  const attachToolToStep = useCallback(
    (stepId: string, tool: CatalogTool) => {
      const step = definition.steps.find((s) => s.id === stepId);
      const agentId = step?.config?.agent_id as string | undefined;
      if (!agentId) return;

      const existing = agentsById[agentId]?.tools ?? [];
      if (existing.includes(tool.name)) {
        showToast('error', `${agentsById[agentId]?.name ?? 'That agent'} already has ${tool.name}.`);
        return;
      }
      setAgentTools(agentId, [...existing, tool.name]);
    },
    [definition.steps, agentsById, setAgentTools, showToast],
  );

  // Connectors live on the Mistral agent exactly as tools do, so attaching one
  // is the same immediate write. `connectors` is sent alone: the backend leaves
  // the tool set untouched when the key is absent.
  const setAgentConnectorsMutation = useMutation({
    mutationFn: ({ agentId, connectorIds }: { agentId: string; connectorIds: string[] }) =>
      agentsApi.update(agentId, {
        connectors: connectorIds.map((connector_id) => ({ connector_id })),
      }),
    onSuccess: (_data, { agentId, connectorIds }) => {
      const name = agentsById[agentId]?.name ?? 'agent';
      queryClient.invalidateQueries({ queryKey: QK.builderCatalog() });
      queryClient.invalidateQueries({ queryKey: QK.agents() });
      showToast(
        'success',
        connectorIds.length === 0
          ? `Removed all connectors from ${name}.`
          : `${name} now has ${connectorIds.length} connector${connectorIds.length === 1 ? '' : 's'}.`,
      );
    },
    onError: (err) =>
      showToast('error', errorMessage(err, 'Could not update the agent’s connectors.')),
  });

  const setAgentConnectors = useCallback(
    (agentId: string, connectorIds: string[]) =>
      setAgentConnectorsMutation.mutate({ agentId, connectorIds }),
    [setAgentConnectorsMutation],
  );

  const attachConnectorToStep = useCallback(
    (stepId: string, connector: CatalogConnector) => {
      const step = definition.steps.find((s) => s.id === stepId);
      const agentId = step?.config?.agent_id as string | undefined;
      if (!agentId) return;

      const existing = agentsById[agentId]?.connectors ?? [];
      if (existing.includes(connector.id)) {
        showToast(
          'error',
          `${agentsById[agentId]?.name ?? 'That agent'} already has ${connector.name}.`,
        );
        return;
      }
      setAgentConnectors(agentId, [...existing, connector.id]);
    },
    [definition.steps, agentsById, setAgentConnectors, showToast],
  );

  /* ── Load existing workflow in edit mode ──────────────────────────── */

  const { data: existing, isLoading: loadingWorkflow } = useQuery({
    queryKey: QK.workflow(workflowName ?? ''),
    queryFn: () => workflowsApi.get(workflowName!).then((r) => r.data.workflow as WorkflowDefinition),
    enabled: isEditMode,
  });

  // Load once per workflow name; re-running on every refetch would discard edits.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (isEditMode) {
      if (existing && loadedFor.current !== workflowName) {
        loadedFor.current = workflowName ?? null;
        reset(existing, workflowName ?? null);
      }
    } else if (loadedFor.current !== '__new__') {
      loadedFor.current = '__new__';
      reset(undefined, null);
    }
  }, [isEditMode, existing, workflowName, reset]);

  /* ── Live validation (debounced) ──────────────────────────────────── */

  // Keyed on semanticRevision, not the definition object. Moving a node does
  // not change what the workflow *does*, so it must not re-run validation —
  // and when this depended on `definition`, every frame of a drag reset the
  // debounce and queued another POST.
  const definitionRef = useRef(definition);
  definitionRef.current = definition;

  useEffect(() => {
    if (definitionRef.current.steps.length === 0) {
      setValidation(null);
      return;
    }
    const handle = setTimeout(() => {
      workflowBuilderApi
        .validate(definitionRef.current)
        .then((r) => setValidation(r.data as ValidationResult))
        .catch(() => {
          /* validation is advisory; save/publish re-checks server-side */
        });
    }, 400);
    return () => clearTimeout(handle);
  }, [semanticRevision, setValidation]);

  /* ── Script compilation ───────────────────────────────────────────── */

  // Keyed on semanticRevision so switching to the Script tab after an edit
  // recompiles and flipping back and forth serves the cached result. Keying on
  // the definition object made React Query JSON-hash the entire graph on every
  // render, enabled or not.
  const scriptQuery = useQuery({
    queryKey: [...QK.workflowScript(workflowName ?? '__draft__'), semanticRevision],
    queryFn: async () => {
      // A saved workflow reports whether the module on disk is stale; an
      // unsaved one can only be compiled in memory.
      const res =
        isEditMode && !isDirtyAgainstSaved()
          ? await workflowBuilderApi.script(workflowName!)
          : await workflowBuilderApi.previewScript(definition);
      return res.data;
    },
    enabled: tab === 'script' && definition.steps.length > 0,
    retry: false,
    staleTime: 15_000,
  });

  /* ── Save ─────────────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: WorkflowDefinition = { ...definition, source: 'builder' };
      if (isEditMode) {
        await workflowBuilderApi.update(workflowName!, payload);
        return workflowName!;
      }
      await workflowBuilderApi.create(payload);
      return payload.name;
    },
    onSuccess: (name) => {
      markSaved();
      queryClient.invalidateQueries({ queryKey: QK.workflows() });
      queryClient.invalidateQueries({ queryKey: QK.workflow(name) });
      showToast('success', isEditMode ? 'Saved. Publish to push the change live.' : 'Workflow created.');
      if (!isEditMode) navigate(`/workflows/${encodeURIComponent(name)}/edit`, { replace: true });
    },
    onError: (err) => showToast('error', errorMessage(err, 'Save failed.')),
  });

  /* ── Publish ──────────────────────────────────────────────────────── */

  const publishMutation = useMutation({
    mutationFn: async () => {
      // Publishing always saves first, so what goes live is exactly what is
      // on screen — never a stale server-side copy.
      const payload: WorkflowDefinition = { ...definition, source: 'builder' };
      const name = isEditMode ? workflowName! : payload.name;
      if (isEditMode) {
        await workflowBuilderApi.update(name, payload);
      } else {
        await workflowBuilderApi.create(payload);
      }
      const res = await workflowBuilderApi.publish(name);
      return { name, result: res.data as { registration_pending?: boolean; detail?: string } };
    },
    onSuccess: ({ name, result }) => {
      markSaved();
      queryClient.invalidateQueries({ queryKey: QK.workflows() });
      queryClient.invalidateQueries({ queryKey: QK.workflow(name) });
      // A code workflow is registered by the worker, not by this request, so a
      // publish can legitimately return before Mistral has caught up. Say so
      // rather than claiming it is live.
      showToast(
        'success',
        result.registration_pending
          ? 'Compiled and deployed. The worker is still registering it with Mistral — this usually takes a few seconds.'
          : 'Published to Mistral.',
      );
      if (!isEditMode) navigate(`/workflows/${encodeURIComponent(name)}/edit`, { replace: true });
      // Publishing writes the module to disk, so any cached script (and its
      // staleness flag) is now wrong.
      queryClient.invalidateQueries({ queryKey: QK.workflowScript(name) });
    },
    onError: (err) => showToast('error', errorMessage(err, 'Publish failed.')),
  });

  /* ── Leave guard ──────────────────────────────────────────────────── */

  const hasUnsavedEdits = isDirtyAgainstSaved();

  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedEdits]);

  const leave = () => {
    if (hasUnsavedEdits && !window.confirm('You have unsaved changes. Leave without saving?')) {
      return;
    }
    navigate(isEditMode ? `/workflows/${encodeURIComponent(workflowName!)}` : '/workflows');
  };

  /* ── Derived state ────────────────────────────────────────────────── */

  const errors = validation?.error_count ?? 0;
  const nameValid = slugifyWorkflowName(definition.name) === definition.name && definition.name.length >= 3;
  const canSave = definition.steps.length > 0 && errors === 0 && nameValid && !saveMutation.isPending;
  const canPublish = canSave && !publishMutation.isPending;
  const isPublished = Boolean(existing?.is_deployed);
  const needsPublish = isPublished && (hasUnsavedEdits || existing?.has_unpublished_changes);

  const blockReason = useMemo(() => {
    if (definition.steps.length === 0) return 'Add at least one step';
    if (!definition.name) return 'Give the workflow a name';
    if (!nameValid) return 'Name must be lowercase letters, digits and underscores (min 3)';
    if (errors > 0) return `Fix ${errors} error${errors > 1 ? 's' : ''} first`;
    return null;
  }, [definition.steps.length, definition.name, nameValid, errors]);

  if (isEditMode && loadingWorkflow) {
    return (
      <div className="h-full flex items-center justify-center bg-[rgba(8,11,19,0.95)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={22} className="text-[#6366f1] animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading workflow…</p>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: 'canvas' as const, label: 'Canvas', icon: <Workflow size={12} /> },
    { id: 'json' as const, label: 'Definition', icon: <GitBranch size={12} /> },
    { id: 'script' as const, label: 'Script', icon: <CloudUpload size={12} /> },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgba(8,11,19,0.95)]">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)] shrink-0">
        <button
          type="button"
          onClick={leave}
          aria-label="Back"
          className="text-[var(--color-text-muted)] hover:text-white p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
          <Workflow size={14} className="text-white" />
        </div>

        <div className="min-w-0">
          {isEditMode ? (
            <p className="text-sm font-semibold text-white font-mono truncate">{definition.name}</p>
          ) : (
            <input
              value={definition.name}
              onChange={(e) => setMeta({ name: slugifyWorkflowName(e.target.value) })}
              placeholder="workflow_name"
              aria-label="Workflow name"
              className="bg-transparent text-sm font-semibold text-white font-mono outline-none border-b border-dashed border-[var(--color-border-subtle)] focus:border-[var(--color-border-focus)] w-[190px] pb-0.5"
            />
          )}
          <p className="text-[10px] text-[var(--color-text-muted)]">
            {definition.steps.length} step{definition.steps.length === 1 ? '' : 's'}
            {isEditMode && ` · ${isPublished ? 'published' : 'draft'}`}
          </p>
        </div>

        {/* Status pill */}
        {needsPublish ? (
          <span className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/25 text-amber-400 shrink-0">
            <AlertTriangle size={10} /> Unpublished changes
          </span>
        ) : hasUnsavedEdits ? (
          <span className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.25)] text-[#a5b4fc] shrink-0">
            Unsaved
          </span>
        ) : isPublished ? (
          <span className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 shrink-0">
            <CheckCircle2 size={10} /> Live
          </span>
        ) : null}

        {/* Tabs */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[var(--color-border-subtle)] ml-auto shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-[rgba(99,102,241,0.18)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-white',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isEditMode && isPublished && (
            <button
              type="button"
              onClick={() => navigate(`/workflows/${encodeURIComponent(workflowName!)}/execute`)}
              className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg"
            >
              <Play size={12} /> Run
            </button>
          )}
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
            title={blockReason ?? 'Save without publishing'}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish}
            title={blockReason ?? 'Compile and register on Mistral'}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CloudUpload size={12} />
            )}
            Publish
          </button>
        </div>
      </header>

      {/* Blocking reason */}
      {blockReason && definition.steps.length > 0 && (
        <div className="px-4 py-1.5 bg-[rgba(251,191,36,0.06)] border-b border-[rgba(251,191,36,0.2)] shrink-0">
          <p className="text-[11px] text-amber-400">{blockReason} to save or publish.</p>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        <BuilderPalette
          agents={catalog.agents}
          tools={catalog.tools}
          connectors={catalog.connectors}
          isLoading={catalogLoading}
          onRefresh={() => void refetchCatalog()}
          onCreateAgent={() => setShowAgentModal(true)}
          onCreateTool={() => setShowToolModal(true)}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Canvas stays mounted across tabs so ReactFlow keeps its viewport
              and node instances instead of remounting on every switch. */}
          <div className={cn('flex-1 flex flex-col min-h-0', tab !== 'canvas' && 'hidden')}>
            <BuilderCanvas
              agentsById={agentsById}
              connectorsById={connectorsById}
              onAttachTool={attachToolToStep}
              onAttachConnector={attachConnectorToStep}
              onNotify={showToast}
            />
          </div>
          {tab === 'json' && <JsonPanel />}
          {tab === 'script' && (
            <ScriptPanel
              code={scriptQuery.data?.code ?? null}
              stale={scriptQuery.data?.stale ?? false}
              isLoading={scriptQuery.isFetching}
              error={
                scriptQuery.error
                  ? errorMessage(scriptQuery.error, 'Could not compile this workflow.')
                  : null
              }
              isPublished={isPublished}
              onRefresh={() => void scriptQuery.refetch()}
            />
          )}

          <ValidationBar
            issues={validation?.issues ?? []}
            onSelectStep={(stepId) => {
              setTab('canvas');
              select(stepId);
            }}
          />
        </div>

        <BuilderInspector
          agents={catalog.agents}
          tools={catalog.tools}
          connectors={catalog.connectors}
          tiers={catalog.tiers}
          onSetAgentTools={setAgentTools}
          onSetAgentConnectors={setAgentConnectors}
          toolsPending={setAgentToolsMutation.isPending}
          connectorsPending={setAgentConnectorsMutation.isPending}
        />
      </div>

      {/* ── Toast ───────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-5 right-5 z-50 flex items-start gap-2.5 max-w-md px-4 py-3 rounded-xl border backdrop-blur-md shadow-2xl',
            toast.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30',
          )}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-px" />
          ) : (
            <AlertTriangle size={15} className="text-red-400 shrink-0 mt-px" />
          )}
          <p
            className={cn(
              'text-xs leading-relaxed break-words',
              toast.kind === 'success' ? 'text-emerald-300' : 'text-red-300',
            )}
          >
            {toast.message}
          </p>
        </div>
      )}

      {/* ── Inline creation ─────────────────────────────────────────── */}
      {showAgentModal && (
        <CreateAgentModal
          models={catalog.models}
          tiers={catalog.tiers}
          tools={catalog.tools}
          onClose={() => setShowAgentModal(false)}
          onCreated={() => {
            setShowAgentModal(false);
            void refetchCatalog();
            showToast('success', 'Agent created and added to the palette.');
          }}
        />
      )}
      {showToolModal && (
        <CreateToolModal
          onClose={() => setShowToolModal(false)}
          onCreated={(toolName) => {
            setShowToolModal(false);
            void refetchCatalog();
            showToast(
              'success',
              `Tool "${toolName}" synthesised. Drop it onto an agent to let that agent call it.`,
            );
          }}
        />
      )}
    </div>
  );
}
