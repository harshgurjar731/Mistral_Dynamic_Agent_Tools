import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, CheckCircle2, RefreshCw, ChevronDown, Cpu, Wrench, History } from 'lucide-react';
import { orchestratorApi } from '../../api/orchestrator';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../../lib/utils';
import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';
import PipelineTimeline from '../../components/pipeline/PipelineTimeline';
import { usePipelineRun } from '../../components/pipeline/usePipelineRun';
import RunHistoryPanel from '../../components/pipeline/RunHistoryPanel';
import GuardrailCard from '../../components/pipeline/GuardrailCard';
import LibraryProvisionedCard from '../../components/pipeline/LibraryProvisionedCard';
import { useRunHistory, type RunHistoryEntry } from '../../components/pipeline/useRunHistory';

/* ── Decision cards ───────────────────────────────────────────────────────
 * Each attaches to the layer that produced it, so the reasoning sits beside
 * the decision rather than in a separate log.
 */

function RequirementsCard({ data }: { data: Record<string, any> }) {
  const criteria = (data.success_criteria as string[]) ?? [];
  const risks = (data.risk_factors as string[]) ?? [];
  return (
    <div className="surface-card rounded-xl p-4 mt-3 border border-[var(--color-border-subtle)]">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] mb-3">
        <span className="text-[var(--color-text-muted)]">
          Task: <strong className="text-[var(--color-text-primary)]">{data.task_type}</strong>
        </span>
        <span className="text-[var(--color-text-muted)]">
          Domain: <strong className="text-[var(--color-text-primary)]">{data.domain}</strong>
        </span>
        <span className="text-[var(--color-text-muted)]">
          Complexity: <strong className="text-[var(--color-text-primary)]">{data.complexity}</strong>
        </span>
      </div>
      {!!data.deliverable && (
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">
          <span className="text-[var(--color-text-muted)]">Deliverable — </span>{data.deliverable}
        </p>
      )}
      {criteria.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">Done when</p>
          <ul className="space-y-1">
            {criteria.map((c, i) => (
              <li key={i} className="text-[11px] text-[var(--color-text-secondary)] flex gap-1.5">
                <span className="text-[var(--color-text-muted)]">&middot;</span>{c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {risks.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-amber-400/70 mb-1.5">Risks noted</p>
          <p className="text-[11px] text-[var(--color-text-secondary)]">{risks.join('; ')}</p>
        </div>
      )}
    </div>
  );
}

function ToolBuiltCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="surface-card rounded-lg px-4 py-2.5 mt-3 border border-[rgba(236,72,153,0.2)] flex items-center gap-2.5">
      <Wrench size={13} className="text-[#f9a8d4]" />
      <span className="text-xs font-mono text-[var(--color-text-primary)]">{data.tool_name}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wider text-[#f9a8d4]">built</span>
    </div>
  );
}

function AgentConfigCard({ data }: { data: Record<string, any> }) {
  const cfg = getTierConfig(data.tier as string | undefined);
  const tools = (data.tools as string[]) ?? [];
  const connectors = (data.connectors as string[]) ?? [];
  // Prefer the named form; fall back to bare ids for history entries recorded
  // before names were published.
  const namedLibraries: Array<{ id: string; name: string; created?: boolean }> =
    (data.libraries as Array<{ id: string; name: string; created?: boolean }>) ??
    ((data.document_library_ids as string[]) ?? []).map(id => ({ id, name: id }));
  return (
    <div className={cn('rounded-xl p-5 mt-3 border shadow-lg', cfg.cardBg, cfg.cardBorder)}>
      <div className="flex items-center gap-3 mb-4">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', cfg.bg, cfg.border)}>
          <Cpu size={16} className={cfg.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white">{data.agent_name}</h3>
            <TierBadge tier={data.tier as string | undefined} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)] font-mono">
            {data.model}{data.temperature !== undefined ? ` · temp ${data.temperature}` : ''}
          </p>
        </div>
      </div>
      {!!data.description && (
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">{data.description}</p>
      )}
      <div className="space-y-2.5">
        {tools.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-1.5">Tools</p>
            <div className="flex flex-wrap gap-1.5">
              {tools.map(t => (
                <span key={t} className="px-2 py-0.5 rounded bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.15)] text-[11px] font-mono text-[#f9a8d4]">{t}</span>
              ))}
            </div>
          </div>
        )}
        {connectors.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-1.5">Integrations</p>
            <div className="flex flex-wrap gap-1.5">
              {connectors.map(c => (
                <span key={c} className="px-2 py-0.5 rounded bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.15)] text-[11px] font-mono text-emerald-300">{c}</span>
              ))}
            </div>
          </div>
        )}
        {(namedLibraries.length > 0 || data.knowledge_graph) && (
          <div>
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-1.5">Knowledge</p>
            <div className="flex flex-wrap gap-1.5">
              {/* Names, not ids — a uuid does not tell anyone what their agent
                  can read, and whether it was just created matters because a
                  new one is empty until documents are uploaded. */}
              {namedLibraries.map(l => (
                <span
                  key={l.id}
                  title={l.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] text-[11px] text-[#a5b4fc]"
                >
                  {l.name}
                  <span className={cn(
                    'text-[9px] uppercase tracking-wider',
                    l.created ? 'text-amber-300' : 'text-[var(--color-text-muted)]',
                  )}>
                    {l.created ? 'new · empty' : 'existing'}
                  </span>
                </span>
              ))}
              {!!data.knowledge_graph && (
                <span className="px-2 py-0.5 rounded bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] text-[11px] text-[#a5b4fc]">
                  knowledge graph
                </span>
              )}
            </div>
            {namedLibraries.some(l => l.created) && (
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                Upload documents to the new library and this agent will use them — no changes needed.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Orchestrator() {
  const [input, setInput] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('domain');
  const [showTierMenu, setShowTierMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  // Decision payloads keyed by the layer that produced them.
  const [decisions, setDecisions] = useState<Record<string, any>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  // The prompt this run was launched with. `input` keeps changing as the user
  // types the next one, so it cannot be trusted when the run finishes.
  const [runPrompt, setRunPrompt] = useState('');

  const { run, reset, restore, handleEvent, settle, failRunning } = usePipelineRun();
  const { history, save: saveRun, clear: clearHistory } =
    useRunHistory('agent_orchestrator_history');

  // Guards the save effect below so a finished run is recorded exactly once,
  // however many times its state settles afterwards.
  const savedRef = useRef(true);

  const openHistoryEntry = (entry: RunHistoryEntry) => {
    // Re-hydrate the run exactly as it executed, so a past run is inspected
    // through the same timeline that watched it happen.
    setRunPrompt(entry.prompt);
    setDecisions(entry.decisions as Record<string, any>);
    setStreamingResponse(entry.response ?? '');
    setCreatedAgentId(entry.agentId ?? null);
    setErrorText(null);
    setActiveHistoryId(entry.id);
    savedRef.current = true;
    restore(entry.manifest, entry.runtime);
  };
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tierMenuRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close tier menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tierMenuRef.current && !tierMenuRef.current.contains(e.target as Node)) {
        setShowTierMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run, streamingResponse]);

  // Record the run once it has fully settled.
  //
  // Deliberately an effect rather than the stream's completion callback: that
  // callback fires in the same tick as the last layer events and `settle()`,
  // so the state it can see is one render behind. By the time this effect runs
  // React has flushed all of it.
  useEffect(() => {
    if (isProcessing || savedRef.current || !run.started) return;
    savedRef.current = true;
    saveRun({
      prompt: runPrompt,
      manifest: run.manifest,
      runtime: run.runtime,
      decisions,
      title: decisions.agent_config?.agent_name ?? null,
      agentId: createdAgentId,
      response: streamingResponse,
      failed: Boolean(errorText),
    });
  }, [isProcessing, run, decisions, runPrompt, createdAgentId, streamingResponse, errorText, saveRun]);

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q || isProcessing) return;

    setIsProcessing(true);
    setCreatedAgentId(null);
    setStreamingResponse('');
    setErrorText(null);
    setDecisions({});
    setActiveHistoryId(null);
    setRunPrompt(q);
    savedRef.current = false;
    reset();

    let currentResponse = '';

    orchestratorApi.stream(
      { query: q, tier: selectedTier },
      (event) => {
        // The manifest and the layer lifecycle are handled centrally; only
        // this screen's own payloads need handling here.
        if (handleEvent(event.type, event.data)) return;

        if (event.type === 'requirements' || event.type === 'guardrails'
            || event.type === 'agent_config' || event.type === 'tool_new'
            || event.type === 'library_provisioned') {
          try {
            const parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            setDecisions(prev => ({ ...prev, [event.type]: parsed }));
          } catch { /* a card we cannot parse simply does not render */ }
        }
        else if (event.type === 'text_chunk') {
          currentResponse += event.data;
          setStreamingResponse(currentResponse);
        }
        else if (event.type === 'error') {
          setErrorText(event.data);
          failRunning(event.data);
        }
        else if (event.type === 'done') {
          try {
            const data = JSON.parse(event.data);
            if (data.agent_id) setCreatedAgentId(data.agent_id);
          } catch { /* ignore */ }
        }
      },
      () => {
        setIsProcessing(false);
        settle();
      }
    );
  };

  return (
    <div className="flex w-full h-full overflow-hidden">
    <div className="flex flex-col flex-1 min-w-0 h-full overflow-y-auto px-4 py-12 relative">
      {/* History toggle — the run and its whole timeline are kept, so a past
          run is reopened rather than re-run. */}
      <button
        onClick={() => setShowHistory(v => !v)}
        title="Past runs"
        className={cn(
          'absolute top-4 right-4 z-20 p-2 rounded-lg border transition-colors',
          showHistory
            ? 'bg-[var(--color-bg-hover)] text-white border-[var(--color-border-focus)]'
            : 'text-[var(--color-text-muted)] border-[var(--color-border-subtle)] hover:text-white hover:bg-[var(--color-bg-hover)]',
        )}
      >
        <History size={16} />
      </button>

      
      {/* Hero / Input Area */}
      <motion.div 
        layout
        className={cn(
          "max-w-3xl mx-auto w-full transition-all duration-500",
          run.started ? "mt-0 mb-12" : "mt-[20vh]"
        )}
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(255,255,255,0.1)]">
            <Sparkles size={32} className="text-black" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">What do you want to build?</h1>
          <p className="text-[var(--color-text-muted)]">Describe your task, and AI will dynamically assemble the perfect agent and tools for it.</p>
        </div>

        <div className="surface-card rounded-2xl p-2 shadow-2xl focus-within:ring-2 focus-within:ring-[var(--color-border-focus)] transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="e.g. Create a database agent that can execute SQL queries to manage my local users..."
            rows={6}
            className="w-full bg-transparent px-4 py-3 text-base text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none overflow-y-auto custom-scrollbar min-h-[180px]"
            disabled={isProcessing}
          />
          <div className="flex items-center justify-between p-2 border-t border-[var(--color-border-subtle)] mt-2 gap-3">
            {/* Tier Selector */}
            <div className="relative" ref={tierMenuRef}>
              <button
                type="button"
                onClick={() => setShowTierMenu(!showTierMenu)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all',
                  getTierConfig(selectedTier).bg,
                  getTierConfig(selectedTier).border,
                  getTierConfig(selectedTier).color,
                  'hover:brightness-125'
                )}
              >
                <span>{getTierConfig(selectedTier).icon}</span>
                <span>{getTierConfig(selectedTier).label}</span>
                <ChevronDown size={12} className={cn('transition-transform', showTierMenu && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {showTierMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full mt-2 left-0 z-50 min-w-[220px] bg-[rgba(15,20,28,0.85)] backdrop-blur-2xl border border-[rgba(255,255,255,0.1)] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] overflow-hidden"
                  >
                    <div className="p-1.5">
                      {(['foundation', 'domain', 'use_case'] as const).map(t => {
                        const cfg = getTierConfig(t);
                        const isSelected = selectedTier === t;
                        return (
                          <button
                            key={t}
                            onClick={() => { setSelectedTier(t); setShowTierMenu(false); }}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                              isSelected ? cn(cfg.bg, cfg.border, 'border') : 'hover:bg-[var(--color-bg-hover)] border border-transparent'
                            )}
                          >
                            <span className="text-base">{cfg.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-xs font-bold', isSelected ? cfg.color : 'text-white')}>{cfg.label}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">
                                {t === 'foundation' && 'Guardrails, moderation, safety'}
                                {t === 'domain' && 'Business logic, data processing'}
                                {t === 'use_case' && 'Product-specific workflows'}
                              </p>
                            </div>
                            {isSelected && (
                              <CheckCircle2 size={14} className={cfg.color} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={handleSubmit} 
              disabled={!input.trim() || isProcessing} 
              className="btn-primary px-6 py-2 rounded-lg font-medium shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing ? (
                <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> Processing</>
              ) : (
                <>Generate Agent <ArrowRight size={16} /></>
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Timeline Area — the pipeline as the chain of decisions it is */}
      {run.started && (
        <div className="max-w-3xl mx-auto w-full pb-32">
          <PipelineTimeline
            manifest={run.manifest}
            runtime={run.runtime}
            activeNote={run.activeNote}
            raw={{
              requirement_analysis: decisions.requirements,
              capability_gap: decisions.tool_new,
              library_provisioning: decisions.library_provisioned,
              guardrail_config: decisions.guardrails,
              agent_assembly: decisions.agent_config,
            }}
            cards={{
              requirement_analysis: decisions.requirements
                ? <RequirementsCard data={decisions.requirements} /> : null,
              capability_gap: decisions.tool_new
                ? <ToolBuiltCard data={decisions.tool_new} /> : null,
              library_provisioning: decisions.library_provisioned
                ? <LibraryProvisionedCard data={decisions.library_provisioned} /> : null,
              guardrail_config: decisions.guardrails
                ? <GuardrailCard data={decisions.guardrails} /> : null,
              agent_assembly: decisions.agent_config
                ? <AgentConfigCard data={decisions.agent_config} /> : null,
            }}
          />

          <div className="relative border-l border-[var(--color-border-subtle)] ml-4 md:ml-8">
            {errorText && (
              <div className="relative pl-8 md:pl-12 pt-6">
                <div className="surface-card rounded-xl p-5 border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] flex flex-col items-start gap-4">
                  <p className="text-sm font-mono text-[var(--color-accent-danger)] break-words">{errorText}</p>
                  <button
                    onClick={handleSubmit}
                    className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2 border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.1)] hover:text-white transition-colors"
                  >
                    <RefreshCw size={14} /> Retry Generation
                  </button>
                </div>
              </div>
            )}

            {/* Streaming Response Area */}
            {streamingResponse && (
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="relative pl-8 md:pl-12 mt-8"
                >
                    <div className="absolute left-[-9px] top-1 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 border-[var(--color-border-subtle)] flex items-center justify-center">
                        <CheckCircle2 size={16} className="text-[var(--color-accent-success)] absolute bg-[var(--color-bg-base)] rounded-full" />
                    </div>
                    <div className="surface-card rounded-xl p-6 prose prose-invert max-w-none text-sm text-[var(--color-text-secondary)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}
                            components={{
                                code({ node, inline, className, children, ...rest }: any) {
                                    const match = /language-(\w+)/.exec(className || '')
                                    return !inline && match ? (
                                    <SyntaxHighlighter
                                        {...rest}
                                        PreTag="div"
                                        children={String(children).replace(/\n$/, '')}
                                        language={match[1]}
                                        style={vscDarkPlus as any}
                                        className="rounded-md !bg-[#000000] !mt-2 !mb-4 border border-[var(--color-border-subtle)] text-xs"
                                    />
                                    ) : (
                                    <code {...rest} className={cn("bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded-md text-xs font-mono text-[#E2E8F0]", className)}>
                                        {children}
                                    </code>
                                    )
                                }
                            }}
                        >
                            {streamingResponse + (isProcessing ? ' ▊' : '')}
                        </ReactMarkdown>
                    </div>
                </motion.div>
            )}

            {/* Final Action */}
            {createdAgentId && !isProcessing && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="relative pl-8 md:pl-12 pt-8"
              >
                <button 
                  onClick={() => navigate(`/agents/${createdAgentId}`)}
                  className="btn-primary w-full py-4 rounded-xl font-bold text-base shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform"
                >
                  Start Chatting with Agent <ArrowRight size={20} />
                </button>
              </motion.div>
            )}

          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>

    <AnimatePresence>
      {showHistory && (
        <RunHistoryPanel
          history={history}
          activeId={activeHistoryId}
          onClose={() => setShowHistory(false)}
          onSelect={openHistoryEntry}
          onClear={clearHistory}
          emptyHint="Agents you generate will be kept here with the decisions that produced them."
        />
      )}
    </AnimatePresence>
    </div>
  );
}
