import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, CheckCircle2, AlertCircle, RefreshCw, ChevronDown, Cpu } from 'lucide-react';
import { orchestratorApi } from '../../api/orchestrator';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../../lib/utils';
import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';

interface TimelineStep {
  id: string;
  type: 'status' | 'agent_config' | 'response' | 'error';
  content: string | any;
  status: 'pending' | 'active' | 'completed';
}

export default function Orchestrator() {
  const [input, setInput] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('domain');
  const [showTierMenu, setShowTierMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [streamingResponse, setStreamingResponse] = useState('');
  
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
  }, [steps, streamingResponse]);

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q || isProcessing) return;
    
    setIsProcessing(true);
    setSteps([]);
    setCreatedAgentId(null);
    setStreamingResponse('');

    let currentResponse = '';

    orchestratorApi.stream(
      { query: q, tier: selectedTier },
      (event) => {
        if (event.type === 'status') {
          setSteps(prev => {
            const newSteps = [...prev];
            if (newSteps.length > 0) newSteps[newSteps.length - 1].status = 'completed';
            newSteps.push({ id: crypto.randomUUID(), type: 'status', content: event.data, status: 'active' });
            return newSteps;
          });
        }
        else if (event.type === 'agent_config') {
          setSteps(prev => {
            const newSteps = [...prev];
            if (newSteps.length > 0) newSteps[newSteps.length - 1].status = 'completed';
            try {
              newSteps.push({ id: crypto.randomUUID(), type: 'agent_config', content: JSON.parse(event.data), status: 'completed' });
            } catch { /* ignore */ }
            return newSteps;
          });
        }
        else if (event.type === 'text_chunk') {
            currentResponse += event.data;
            setStreamingResponse(currentResponse);
        }
        else if (event.type === 'error') {
            setSteps(prev => {
                const newSteps = [...prev];
                if (newSteps.length > 0) newSteps[newSteps.length - 1].status = 'completed';
                newSteps.push({ id: crypto.randomUUID(), type: 'error', content: event.data, status: 'completed' });
                return newSteps;
            });
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
        setSteps(prev => {
            const newSteps = [...prev];
            if (newSteps.length > 0 && newSteps[newSteps.length - 1].type !== 'error') {
                newSteps[newSteps.length - 1].status = 'completed';
            }
            return newSteps;
        });
      }
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-12">
      
      {/* Hero / Input Area */}
      <motion.div 
        layout
        className={cn(
          "max-w-3xl mx-auto w-full transition-all duration-500",
          steps.length > 0 ? "mt-0 mb-12" : "mt-[20vh]"
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

      {/* Timeline Area */}
      {steps.length > 0 && (
        <div className="max-w-3xl mx-auto w-full pb-32">
          <div className="relative border-l border-[var(--color-border-subtle)] ml-4 md:ml-8 space-y-8 pb-8">
            
            <AnimatePresence>
              {steps.map((step) => (
                <motion.div 
                  key={step.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative pl-8 md:pl-12"
                >
                  {/* Timeline Dot — color-coded for agent steps */}
                  {(() => {
                    const isAgentStep = step.type === 'agent_config';
                    const tierColor = isAgentStep
                      ? getTierConfig(step.content?.tier).dot
                      : undefined;
                    return (
                      <div
                        className={cn(
                          'absolute left-[-9px] top-1 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 flex items-center justify-center',
                          !tierColor && 'border-[var(--color-border-subtle)]'
                        )}
                        style={tierColor ? { borderColor: tierColor } : undefined}
                      >
                        {step.status === 'active' && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                        {step.status === 'completed' && step.type !== 'error' && (
                          <CheckCircle2
                            size={16}
                            className="absolute bg-[var(--color-bg-base)] rounded-full"
                            style={tierColor ? { color: tierColor } : { color: 'var(--color-accent-success)' }}
                          />
                        )}
                        {step.type === 'error' && <AlertCircle size={16} className="text-[var(--color-accent-danger)] absolute bg-[var(--color-bg-base)] rounded-full" />}
                      </div>
                    );
                  })()}

                  {/* Content */}
                  {step.type === 'status' && (
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-sm font-medium",
                        step.status === 'active' ? "text-white" : "text-[var(--color-text-muted)]"
                      )}>
                        {step.content}
                      </span>
                    </div>
                  )}

                  {step.type === 'agent_config' && (() => {
                    const agentTier = step.content?.tier as string | undefined;
                    const cfg = getTierConfig(agentTier);
                    return (
                      <div className={cn('rounded-xl p-5 mt-2 border shadow-lg transition-all', cfg.cardBg, cfg.cardBorder)}>
                        <div className="flex items-center gap-3 mb-4">
                          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', cfg.bg, cfg.border)}>
                            <Cpu size={16} className={cfg.color} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-bold text-white">{step.content.agent_name}</h3>
                              <TierBadge tier={agentTier} />
                            </div>
                            <p className="text-xs text-[var(--color-text-muted)] font-mono">{step.content.model}</p>
                          </div>
                        </div>
                        {step.content.tools && step.content.tools.length > 0 && (
                          <div>
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-2">Equipped Tools</p>
                            <div className="flex flex-wrap gap-2">
                              {step.content.tools.map((t: string) => (
                                <span key={t} className="px-2.5 py-1 rounded bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.15)] text-xs font-mono text-[#f9a8d4]">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {step.type === 'error' && (
                    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] flex flex-col items-start gap-4">
                      <p className="text-sm font-mono text-[var(--color-accent-danger)] break-words">{step.content}</p>
                      <button
                        onClick={handleSubmit}
                        className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2 border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.1)] hover:text-white transition-colors"
                      >
                        <RefreshCw size={14} /> Retry Generation
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

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
                        <ReactMarkdown
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
  );
}
