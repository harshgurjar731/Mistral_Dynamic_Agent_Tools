import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Cpu, Search, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { agentsApi, type Agent } from '../../api/agents';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

function AgentCard({ agent, onDelete, onClick }: { agent: Agent; onDelete: (id: string) => void; onClick: () => void }) {
  return (
    <motion.div 
      variants={itemVariants}
      onClick={onClick}
      className="surface-card rounded-xl p-5 group flex flex-col h-full cursor-pointer hover:border-[var(--color-border-focus)] transition-all hover:scale-[1.01]"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
            <Cpu size={18} className="text-[var(--color-text-primary)]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{agent.name}</h3>
            <span className="inline-block mt-1 px-2 py-0.5 rounded bg-[var(--color-bg-hover)] text-[10px] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] font-[family-name:var(--font-mono)]">
              {agent.model}
            </span>
          </div>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(agent.id); }} 
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-accent-danger)] transition-colors opacity-0 group-hover:opacity-100 z-10"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed line-clamp-4 flex-1">
        {agent.description || <span className="italic opacity-50">No description provided</span>}
      </p>
      {agent.created_at && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
          <p className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] uppercase tracking-wider">
            Created {new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      )}
    </motion.div>
  );
}

export default function AgentStudio() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', model: 'mistral-large-latest', instructions: '', description: '' });

  const { data, isLoading } = useQuery({
    queryKey: [...QK.agents(), search],
    queryFn: () => agentsApi.list(0, 50).then(r => r.data),
  });
  const agents = (data?.items ?? []).filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()));

  const createMut = useMutation({
    mutationFn: () => agentsApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.agents() }); setShowCreate(false); setForm({ name: '', model: 'mistral-large-latest', instructions: '', description: '' }); },
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
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Agent Studio</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Create and manage specialized Mistral AI agents.</p>
        </div>
        <button 
          onClick={() => setShowCreate(true)} 
          className="btn-primary shrink-0 flex items-center gap-2 px-4 py-2 text-sm rounded-md self-start sm:self-auto"
        >
          <Plus size={16} /> New Agent
        </button>
      </div>

      {/* Create form Modal/Panel */}
      <AnimatePresence>
        {showCreate && (
          <motion.div 
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div className="surface-card rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-white" />
                  <h2 className="text-sm font-medium text-white">Create New Agent</h2>
                </div>
                <button onClick={() => setShowCreate(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Name</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Code Reviewer" className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Model</label>
                  <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    <option className="bg-[var(--color-bg-surface)] text-white">mistral-large-latest</option>
                    <option className="bg-[var(--color-bg-surface)] text-white">mistral-medium-latest</option>
                    <option className="bg-[var(--color-bg-surface)] text-white">mistral-small-latest</option>
                    <option className="bg-[var(--color-bg-surface)] text-white">codestral-latest</option>
                  </select>
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description of the agent's purpose" className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="mb-6">
                <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">System Instructions</label>
                <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} rows={4} placeholder="You are a helpful assistant that…" className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)] resize-y min-h-[100px]" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border-subtle)]">
                <button onClick={() => setShowCreate(false)} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
                <button onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50">
                  {createMut.isPending ? 'Creating…' : 'Create Agent'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-20 border border-dashed border-[var(--color-border-subtle)] rounded-xl flex flex-col items-center gap-4 bg-[var(--color-bg-surface)]"
        >
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mb-2">
            <Cpu size={28} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No agents found</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">Create a specialized AI agent to handle specific tasks and workflows.</p>
          </div>
          <button 
            onClick={() => setShowCreate(true)} 
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg mt-2"
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
