import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Cpu, Search, Sparkles, X, Thermometer, Gauge , Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { agentsApi, type Agent } from '../../api/agents';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';

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

function AgentCard({ agent, onDelete, onClick }: { agent: Agent; onDelete: (id: string) => void; onClick: () => void }) {
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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', model: 'mistral-large-latest', instructions: '', description: '', tier: 'foundation', industry_knowledge: true });

  const { data, isLoading } = useQuery({
    // Keyed on the request, not on `search` — the filter below is client-side,
    // so keying on it refetched the identical page on every keystroke.
    queryKey: QK.agentsPage(0, 200),
    queryFn: () => agentsApi.list(0, 200).then(r => r.data),
  });
  const agents = (data?.items ?? []).filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()));

  const createMut = useMutation({
    mutationFn: () => agentsApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.agents() }); setShowCreate(false); setForm({ name: '', model: 'mistral-large-latest', instructions: '', description: '', tier: 'foundation', industry_knowledge: true }); },
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
              
              <div className="p-6">
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
                  <label className="flex items-start gap-2.5 cursor-pointer rounded-md border border-[var(--color-border-subtle)] bg-[rgba(99,102,241,0.05)] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={form.industry_knowledge}
                      onChange={e => setForm({ ...form, industry_knowledge: e.target.checked })}
                      className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                    />
                    <span className="text-xs leading-relaxed">
                      <span className="font-medium text-white">Industry knowledge</span>
                      <span className="block text-[var(--color-text-muted)] mt-0.5">
                        Lets this agent look up regulations, processes and metrics for the
                        industry it serves, and ground its answers in them. Scoped automatically
                        from the agent's domain — leave on unless it has no industry.
                      </span>
                    </span>
                  </label>
                </div>
                <div className="mb-2">
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">System Instructions</label>
                  <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} rows={4} placeholder="You are a helpful assistant that…" className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)] resize-y min-h-[100px] focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all outline-none" />
                </div>
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

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents…" className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2.5 text-sm" />
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
            <p className="text-xl font-semibold text-[var(--color-text-primary)]">No agents found</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-sm mx-auto">Create a specialized AI agent to handle specific tasks and workflows.</p>
          </div>
          <button 
            onClick={() => setShowCreate(true)} 
            className="relative z-10 btn-primary flex items-center gap-2 px-6 py-3 text-sm rounded-lg mt-4 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all"
          >
            <Plus size={16} /> Create Agent
          </button>
        </motion.div>
      ) : (
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {agents.map(a => <AgentCard key={a.id} agent={a} onClick={() => navigate(`/agents/${a.id}`)} onDelete={(id) => deleteMut.mutate(id)} />)}
        </motion.div>
      )}
    </div>
  );
}
