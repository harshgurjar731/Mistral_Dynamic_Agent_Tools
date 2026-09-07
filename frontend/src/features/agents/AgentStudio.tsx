import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Cpu, Search, Sparkles, X, Thermometer, Gauge , Lock, RotateCcw, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { agentsApi, type Agent, type GuardrailConfig } from '../../api/agents';
import { ontologyApi } from '../../api/ontology';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';
import { Switch } from '../../components/ui/Switch';
import DomainFilterDropdown from '../ontology/DomainFilterDropdown';
import { buildDomainTree, expandedMatchSet, intersects } from '../ontology/domainTree';
import AgentClassificationModal from './AgentClassificationModal';
import GuardrailEditor from './GuardrailEditor';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function AgentCard({
  agent, domains, onDelete, onClick, onClassify,
}: {
  agent: Agent;
  domains: string[];
  onDelete: (id: string) => void;
  onClick: () => void;
  onClassify: () => void;
}) {
  const tier = agent.tier || 'foundation';
  const cfg = getTierConfig(tier);

  return (
    <motion.div
      variants={itemVariants}
      onClick={onClick}
      className={cn('rounded-xl p-5 group flex flex-col h-full cursor-pointer hover:scale-[1.01] transition-all shadow-lg', cfg.cardBg, cfg.cardBorder, 'border')}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border', cfg.bg, cfg.border)}>
          <Cpu size={18} className={cfg.color} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] break-words">{agent.name}</h3>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <TierBadge tier={tier} />
            <span className="inline-block px-2 py-0.5 rounded bg-[var(--color-bg-hover)] text-[10px] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] font-[family-name:var(--font-mono)]">
              {agent.model}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClassify(); }}
              title={domains.length ? `Domain: ${domains.join(', ')} — click to edit` : 'Click to classify this agent by domain'}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-400/10 hover:bg-indigo-400/20 text-indigo-300 border border-indigo-400/20 hover:border-indigo-400/40 text-[10px] font-medium transition-colors"
            >
              <Tag size={10} />
              {domains.length === 0
                ? 'Classify'
                : domains.length > 2
                  ? `${domains.slice(0, 2).join(', ')} +${domains.length - 2}`
                  : domains.join(', ')}
            </button>
          </div>
          {(agent.temperature != null || agent.top_p != null) && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {agent.temperature != null && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(251,146,60,0.1)] border border-[rgba(251,146,60,0.2)] text-[10px] font-[family-name:var(--font-mono)] text-orange-400">
                  <Thermometer size={10} /> {agent.temperature}
                </span>
              )}
              {agent.top_p != null && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(45,212,191,0.1)] border border-[rgba(45,212,191,0.2)] text-[10px] font-[family-name:var(--font-mono)] text-teal-400">
                  <Gauge size={10} /> {agent.top_p}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed line-clamp-4 flex-1">
        {agent.description || <span className="italic opacity-50">No description provided</span>}
      </p>
      <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
        <p className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] uppercase tracking-wider">
          {agent.created_at
            ? `Created ${new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : '\u00A0'}
        </p>
        {agent.protected ? (
          // Platform-owned. The backend refuses the delete anyway; showing a
          // control that always fails is worse than showing why it is missing.
          <span
            title="Platform-owned — every knowledge-graph retrieval passes through this agent. Edit its instructions to change how it behaves."
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
          >
            <Lock size={9} /> System
          </span>
        ) : (
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(agent.id); }} 
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-accent-danger)] transition-colors opacity-0 group-hover:opacity-100 z-10"
        >
          <Trash2 size={14} />
        </button>
        )}
      </div>
    </motion.div>
  );
}

export default function AgentStudio() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [classifyAgent, setClassifyAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState({ name: '', model: 'mistral-large-latest', instructions: '', description: '', tier: 'foundation', industry_knowledge: true, guardrail: null as GuardrailConfig | null });

  const { data, isLoading } = useQuery({
    // Keyed on the request, not on `search` — the filter below is client-side,
    // so keying on it refetched the identical page on every keystroke.
    queryKey: QK.agentsPage(0, 200),
    queryFn: () => agentsApi.list(0, 200).then(r => r.data),
  });
  const allAgents = data?.items ?? [];

  const { data: domainConceptData } = useQuery({
    queryKey: QK.ontologyConcepts('domain'),
    queryFn: () => ontologyApi.concepts('domain').then(r => r.data),
  });
  // `?? []` alone would hand useMemo a fresh array every render while the
  // query is still loading — memoized here so the fallback stays referentially
  // stable too.
  const domainConcepts = useMemo(() => domainConceptData?.concepts ?? [], [domainConceptData]);
  const domainTree = useMemo(() => buildDomainTree(domainConcepts), [domainConcepts]);

  // Which domain each agent serves — fetched once for the whole list (one
  // request instead of one per card) and used both by the filter and by
  // each card's own classification badge.
  const { data: domainBulk } = useQuery({
    queryKey: ['ontology', 'annotations', 'agent', 'bulk', allAgents.map(a => a.id).join(',')],
    queryFn: () => ontologyApi.annotationsBulk('agent', allAgents.map(a => a.id)).then(r => r.data),
    enabled: allAgents.length > 0,
  });

  const domainMatchSet = useMemo(
    () => expandedMatchSet(domainTree, domainFilter),
    [domainTree, domainFilter],
  );

  const domainLabelById = useMemo(
    () => new Map(domainConcepts.map((c) => [c.id, c.label])),
    [domainConcepts],
  );
  const domainsFor = (id: string): string[] =>
    (domainBulk?.annotations[id]?.serves_domain ?? []).map((cid) => domainLabelById.get(cid) ?? cid);

  const agents = allAgents.filter(a => {
    if (search && !a.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (domainFilter.size > 0) {
      const domains = domainBulk?.annotations[a.id]?.serves_domain;
      if (!intersects(domains, domainMatchSet)) return false;
    }
    return true;
  });

  const filtersActive = !!search || domainFilter.size > 0;
  const clearFilters = () => { setSearch(''); setDomainFilter(new Set()); };

  const createMut = useMutation({
    mutationFn: () => {
      const { guardrail, ...rest } = form;
      return agentsApi.create({ ...rest, guardrails: guardrail ? [guardrail] : [] });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.agents() }); setShowCreate(false); setForm({ name: '', model: 'mistral-large-latest', instructions: '', description: '', tier: 'foundation', industry_knowledge: true, guardrail: null }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.agents() }),
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err.message || 'Failed to delete agent';
      alert(msg);
    }
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Agent <span className="text-gradient-vibrant">Studio</span></h1>
          <p className="text-sm text-[var(--color-text-muted)]">Create and manage specialized AI agents.</p>
        </div>
        <button 
          onClick={() => setShowCreate(true)} 
          className="btn-primary shrink-0 flex items-center gap-2 px-4 py-2 text-sm rounded-md self-start sm:self-auto"
        >
          <Plus size={16} /> New Agent
        </button>
      </div>

      {/* Create form Modal */}
      {createPortal(
        <AnimatePresence>
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-white" />
                  <h2 className="text-sm font-medium text-white">Create New Agent</h2>
                </div>
                <button onClick={() => setShowCreate(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]">
                  <X size={16} />
                </button>
              </div>
              
              <div className="p-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Name</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Code Reviewer" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Model</label>
                    <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all">
                      <option className="bg-[var(--color-bg-surface)] text-white">mistral-large-latest</option>
                      <option className="bg-[var(--color-bg-surface)] text-white">mistral-medium-latest</option>
                      <option className="bg-[var(--color-bg-surface)] text-white">mistral-small-latest</option>
                      <option className="bg-[var(--color-bg-surface)] text-white">codestral-latest</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Tier</label>
                    <select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all">
                      <option value="foundation" className="bg-[var(--color-bg-surface)] text-white">Foundation</option>
                      <option value="domain" className="bg-[var(--color-bg-surface)] text-white">Domain</option>
                      <option value="use_case" className="bg-[var(--color-bg-surface)] text-white">Use Case</option>
                    </select>
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description of the agent's purpose" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                </div>
                <div className="mb-6">
                  <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[rgba(99,102,241,0.05)] px-3 py-2.5">
                    <span className="text-xs leading-relaxed">
                      <span className="font-medium text-white">Industry knowledge</span>
                      <span className="block text-[var(--color-text-muted)] mt-0.5">
                        Lets this agent look up regulations, processes and metrics for the
                        industry it serves, and ground its answers in them. Scoped automatically
                        from the agent's domain — leave on unless it has no industry.
                      </span>
                    </span>
                    <Switch
                      checked={form.industry_knowledge}
                      onChange={(industry_knowledge) => setForm({ ...form, industry_knowledge })}
                      className="mt-0.5"
                    />
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">System Instructions</label>
                  <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} rows={4} placeholder="You are a helpful assistant that…" className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)] resize-y min-h-[100px] focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all outline-none" />
                </div>
                <GuardrailEditor value={form.guardrail} onChange={(guardrail) => setForm({ ...form, guardrail })} />
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] mt-auto">
                <button onClick={() => setShowCreate(false)} className="btn-secondary px-4 py-2 text-sm rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">Cancel</button>
                <button onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                  {createMut.isPending ? 'Creating…' : 'Create Agent'}
                </button>
              </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Search + filters — its own row, kept separate from the primary
          actions above so "narrow the list" and "do something" don't blur
          into one dense button row. */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents…" className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2 text-sm" />
        </div>
        <DomainFilterDropdown concepts={domainConcepts} selected={domainFilter} onChange={setDomainFilter} />
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            <RotateCcw size={13} /> Clear
          </button>
        )}
        {!isLoading && (
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
            {filtersActive ? `${agents.length} of ${allAgents.length}` : `${allAgents.length} agent${allAgents.length === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="surface-card rounded-xl p-5 flex flex-col h-full gap-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 w-3/4 rounded bg-[var(--color-bg-hover)]" />
                  <div className="h-3 w-1/3 rounded bg-[var(--color-bg-hover)]" />
                </div>
              </div>
              <div className="space-y-2 mt-2">
                <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
                <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
                <div className="h-3 w-4/5 rounded bg-[var(--color-bg-hover)]" />
              </div>
              <div className="mt-auto pt-4 border-t border-[var(--color-border-subtle)]">
                <div className="h-3 w-1/2 rounded bg-[var(--color-bg-hover)]" />
              </div>
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-[var(--color-bg-surface)] backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-xl w-full mt-2 group"
        >
          {/* Background Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-bg-base)] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-700" />
          
          <div className="relative z-10 w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-[rgba(6,182,212,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(6,182,212,0.15)] group-hover:scale-110 transition-transform duration-500">
            <Cpu size={32} className="text-cyan-400" />
          </div>
          <div className="relative z-10">
            <p className="text-xl font-semibold text-[var(--color-text-primary)]">
              {filtersActive ? 'No agents match your filters' : 'No agents found'}
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-sm mx-auto">
              {filtersActive
                ? 'Try a different search term, or widen the domain filter.'
                : 'Create a specialized AI agent to handle specific tasks and workflows.'}
            </p>
          </div>
          <button
            onClick={filtersActive ? clearFilters : () => setShowCreate(true)}
            className="relative z-10 btn-primary flex items-center gap-2 px-6 py-3 text-sm rounded-lg mt-4 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all"
          >
            {filtersActive ? <RotateCcw size={16} /> : <Plus size={16} />}
            {filtersActive ? 'Clear filters' : 'Create Agent'}
          </button>
        </motion.div>
      ) : (
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {agents.map(a => (
            <AgentCard
              key={a.id}
              agent={a}
              domains={domainsFor(a.id)}
              onClick={() => navigate(`/agents/${a.id}`)}
              onDelete={(id) => deleteMut.mutate(id)}
              onClassify={() => setClassifyAgent(a)}
            />
          ))}
        </motion.div>
      )}

      {classifyAgent && (
        <AgentClassificationModal
          agentId={classifyAgent.id}
          agentName={classifyAgent.name}
          onClose={() => setClassifyAgent(null)}
        />
      )}
    </div>
  );
}
