import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Plus, Activity, Wifi, WifiOff, X } from 'lucide-react';
import { mcpApi } from '../../api/mcp';
import { QK } from '../../lib/queryClient';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

export default function McpRegistry() {
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', description: '' });

  const { data: servers = [], isLoading } = useQuery({
    queryKey: QK.mcpServers(),
    queryFn: () => mcpApi.listServers().then(r => Array.isArray(r.data) ? r.data : r.data.servers ?? []),
  });

  const registerMut = useMutation({
    mutationFn: () => mcpApi.register(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.mcpServers() }); setShowRegister(false); setForm({ name: '', url: '', description: '' }); },
  });

  const healthMut = useMutation({
    mutationFn: () => mcpApi.healthCheck().then(r => r.data),
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">MCP Servers</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Model Context Protocol connections.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => healthMut.mutate()} disabled={healthMut.isPending} className="btn-secondary flex items-center gap-2 px-3 py-2 text-sm rounded-md">
            <Activity size={14} className={healthMut.isPending ? 'animate-spin' : ''} />
            {healthMut.isPending ? 'Pinging' : 'Ping'}
          </button>
          <button onClick={() => setShowRegister(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-md">
            <Plus size={16} /> Register
          </button>
        </div>
      </div>

      {/* Register form */}
      <AnimatePresence>
        {showRegister && (
          <motion.div 
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div className="surface-card rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                  <Server size={16} /> Register MCP Server
                </h2>
                <button onClick={() => setShowRegister(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server Name</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. github-mcp" className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Endpoint URL</label>
                  <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/rpc" className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What does this server provide?" className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border-subtle)]">
                <button onClick={() => setShowRegister(false)} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
                <button onClick={() => registerMut.mutate()} disabled={!form.name || !form.url || registerMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50">
                  {registerMut.isPending ? 'Registering...' : 'Register'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Health check results */}
      <AnimatePresence>
        {healthMut.data && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="mb-8 surface-card rounded-xl p-5"
          >
            <p className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Ping Results</p>
            <div className="space-y-2">
              {typeof healthMut.data === 'object' && Object.entries(healthMut.data as Record<string, Record<string, unknown>>).map(([server, status]) => (
                <div key={server} className="flex items-center gap-3 px-3 py-2 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)]">
                  {status.reachable ? <Wifi size={14} className="text-[var(--color-accent-success)]" /> : <WifiOff size={14} className="text-[var(--color-accent-danger)]" />}
                  <span className="font-[family-name:var(--font-mono)] text-sm text-[var(--color-text-primary)] flex-1">{server}</span>
                  {!!status.latency_ms && (
                    <span className="text-[10px] text-[var(--color-text-secondary)] font-[family-name:var(--font-mono)]">{String(status.latency_ms)}ms</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Server grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="surface-card rounded-xl p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-[var(--color-bg-hover)]" />
                  <div className="h-3 w-1/2 rounded bg-[var(--color-bg-hover)]" />
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--color-border-subtle)] space-y-2">
                <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
                <div className="h-3 w-2/3 rounded bg-[var(--color-bg-hover)]" />
              </div>
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-20 border border-dashed border-[var(--color-border-subtle)] rounded-xl flex flex-col items-center gap-4 bg-[var(--color-bg-surface)]"
        >
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mb-2">
            <Server size={28} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No MCP servers registered</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">Register an MCP server to extend capabilities across the system.</p>
          </div>
          <button 
            onClick={() => setShowRegister(true)} 
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg mt-2"
          >
            <Plus size={16} /> Register Server
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((srv: Record<string, unknown>, i: number) => (
            <motion.div key={String(srv.name ?? i)} variants={itemVariants} className="surface-card rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                  <Server size={14} className="text-[var(--color-text-primary)]" />
                </div>
                <div>
                  <span className="text-sm font-medium text-[var(--color-text-primary)] block">{String(srv.name)}</span>
                  {!!srv.url && <span className="text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-mono)]">{String(srv.url)}</span>}
                </div>
              </div>
              {!!srv.description && <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mt-2 pt-2 border-t border-[var(--color-border-subtle)]">{String(srv.description)}</p>}
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
