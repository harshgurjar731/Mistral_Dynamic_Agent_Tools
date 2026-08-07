import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Plus, Activity, Wifi, WifiOff, X, Trash2, Unplug, PlugZap, ChevronRight, Wrench, Globe, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { mcpApi } from '../../api/mcp';
import { remoteServersApi } from '../../api/remoteServers';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

export default function McpRegistry() {
  const [section, setSection] = useState<'mcp' | 'remote'>('mcp');

  const sectionTabs = [
    { key: 'mcp' as const, label: 'MCP Servers', icon: Server },
    { key: 'remote' as const, label: 'Remote Servers', icon: Globe },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">MCP Servers</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Connect, manage, and test Model Context Protocol servers.</p>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit mb-8">
        {sectionTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className={cn(
              'relative px-4 py-1.5 text-sm font-medium rounded-md transition-colors z-10 flex items-center gap-2',
              section === t.key ? 'text-[var(--color-bg-base)]' : 'text-[var(--color-text-muted)] hover:text-white'
            )}
          >
            {section === t.key && (
              <motion.div
                layoutId="mcp-section-tab"
                className="absolute inset-0 bg-white rounded-md"
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{ zIndex: -1 }}
              />
            )}
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
        >
          {section === 'mcp' && <McpServersTab />}
          {section === 'remote' && <RemoteServersTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   MCP Servers Tab — original MCP server management (unchanged logic)
   ═══════════════════════════════════════════════════════════════════════════ */

function McpServersTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: servers = [], isLoading } = useQuery({
    queryKey: QK.mcpServers(),
    queryFn: () => mcpApi.listServers().then(r => Array.isArray(r.data) ? r.data : r.data.servers ?? []),
    staleTime: 0,
  });

  const registerMut = useMutation({
    mutationFn: () => mcpApi.register(form),
    onSuccess: () => { qc.refetchQueries({ queryKey: QK.mcpServers() }); setShowRegister(false); setForm({ name: '', url: '', description: '' }); },
  });

  const healthMut = useMutation({
    mutationFn: () => mcpApi.healthCheck().then(r => r.data),
    onSuccess: () => qc.refetchQueries({ queryKey: QK.mcpServers() }),
  });

  const disconnectMut = useMutation({
    mutationFn: (name: string) => mcpApi.disconnect(name),
    onSuccess: () => qc.refetchQueries({ queryKey: QK.mcpServers() }),
  });

  const reconnectMut = useMutation({
    mutationFn: (name: string) => mcpApi.reconnect(name),
    onSuccess: () => qc.refetchQueries({ queryKey: QK.mcpServers() }),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => mcpApi.deleteServer(name),
    onSuccess: () => { qc.refetchQueries({ queryKey: QK.mcpServers() }); setDeleteConfirm(null); },
  });

  return (
    <>
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 mb-6 w-full border-b border-[var(--color-border-subtle)] pb-4">
        <button onClick={() => healthMut.mutate()} disabled={healthMut.isPending} className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md shadow-sm hover:shadow-md transition-all">
          <Activity size={14} className={healthMut.isPending ? 'animate-spin' : ''} />
          {healthMut.isPending ? 'Pinging' : 'Ping All'}
        </button>
        <button onClick={() => setShowRegister(true)} className="btn-primary flex items-center gap-2 px-5 py-2 text-sm rounded-md shadow-sm hover:shadow-md transition-all">
          <Plus size={16} /> Register Server
        </button>
      </div>

      {/* Register form Modal */}
      {createPortal(
        <AnimatePresence>
          {showRegister && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowRegister(false)}>
              <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                  <Server size={16} /> Register MCP Server
                </h2>
                <button onClick={() => setShowRegister(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server Name</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. github-mcp" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Endpoint URL</label>
                    <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What does this server provide?" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <button onClick={() => setShowRegister(false)} className="btn-secondary px-4 py-2 text-sm rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">Cancel</button>
                <button onClick={() => registerMut.mutate()} disabled={!form.name || !form.url || registerMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                  {registerMut.isPending ? 'Registering...' : 'Register Server'}
                </button>
              </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-base font-semibold text-white mb-2">Delete Server?</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                Are you sure you want to delete <span className="font-mono text-white">{deleteConfirm}</span>? This will remove it from the registry.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
                <button
                  onClick={() => deleteMut.mutate(deleteConfirm)}
                  disabled={deleteMut.isPending}
                  className="px-4 py-2 text-sm rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
                >
                  {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
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
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="relative overflow-hidden text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-[var(--color-bg-surface)] backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-xl w-full mt-2 group"
        >
          {/* Background Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-bg-base)] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-700" />
          
          <div className="relative z-10 w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-[rgba(99,102,241,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(99,102,241,0.15)] group-hover:scale-110 transition-transform duration-500">
            <Server size={32} className="text-indigo-400" />
          </div>
          <div className="relative z-10">
            <p className="text-xl font-semibold text-[var(--color-text-primary)]">No MCP servers registered</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-sm mx-auto">Register an MCP server to extend capabilities across the system.</p>
          </div>
          <button 
            onClick={() => setShowRegister(true)} 
            className="relative z-10 btn-primary flex items-center gap-2 px-6 py-3 text-sm rounded-lg mt-4 shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] transition-all"
          >
            <Plus size={16} /> Register Server
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((srv: Record<string, unknown>, i: number) => {
            const name = String(srv.name ?? '');
            const isHealthy = Boolean(srv.healthy);
            const isEnabled = srv.enabled !== false;

            return (
              <motion.div
                key={name || i}
                variants={itemVariants}
                className="surface-card rounded-xl p-5 group hover:border-[var(--color-border-focus)] transition-all"
              >
                {/* Header */}
                <div
                  className="flex items-center gap-3 mb-3 cursor-pointer"
                  onClick={() => navigate(`/mcp/${encodeURIComponent(name)}`)}
                >
                  <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                    <Server size={14} className="text-[var(--color-text-primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] block truncate">{name}</span>
                    {!!srv.url && <span className="text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] block truncate">{String(srv.url)}</span>}
                  </div>
                  <ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Status row */}
                <div className="flex items-center gap-3 mb-3">
                  {isEnabled ? (
                    isHealthy ? (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
                        <Wifi size={10} className="text-[var(--color-accent-success)]" />
                        <span className="text-[10px] font-medium text-[var(--color-accent-success)] uppercase tracking-wider">Healthy</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(251,191,36,0.1)] border border-[rgba(251,191,36,0.2)]">
                        <WifiOff size={10} className="text-amber-400" />
                        <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">Unreachable</span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)]">
                      <Unplug size={10} className="text-red-400" />
                      <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Disconnected</span>
                    </div>
                  )}

                  {typeof srv.tools_count === 'number' && srv.tools_count > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)]">
                      <Wrench size={10} className="text-indigo-400" />
                      <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider">{srv.tools_count as number} tools</span>
                    </div>
                  )}
                </div>

                {!!srv.description && <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3 line-clamp-2">{String(srv.description)}</p>}

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--color-border-subtle)] w-full">
                  {isEnabled ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); disconnectMut.mutate(name); }}
                      disabled={disconnectMut.isPending}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-amber-400 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      <Unplug size={12} /> Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); reconnectMut.mutate(name); }}
                      disabled={reconnectMut.isPending}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent-success)] px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      <PlugZap size={12} /> {reconnectMut.isPending ? 'Connecting...' : 'Reconnect'}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(name); }}
                    className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-400 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Remote Servers Tab — manage servers that receive tool code
   ═══════════════════════════════════════════════════════════════════════════ */

function RemoteServersTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [reachability, setReachability] = useState<Record<number, { status: 'checking' | 'reachable' | 'unreachable', data?: any }>>({});

  const { data: servers = [], isLoading } = useQuery({
    queryKey: QK.remoteServers(),
    queryFn: () => remoteServersApi.list().then(r => Array.isArray(r.data) ? r.data : []),
    staleTime: 0,
  });

  const addMut = useMutation({
    mutationFn: () => remoteServersApi.add(form),
    onSuccess: () => { qc.refetchQueries({ queryKey: QK.remoteServers() }); setShowAdd(false); setForm({ name: '', url: '', description: '' }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => remoteServersApi.delete(id),
    onSuccess: () => { qc.refetchQueries({ queryKey: QK.remoteServers() }); setDeleteConfirm(null); },
  });

  const checkServer = async (id: number, url: string) => {
    setReachability(prev => ({ ...prev, [id]: { status: 'checking' } }));
    try {
      const res = await remoteServersApi.check(url);
      setReachability(prev => ({ ...prev, [id]: { status: res.data.reachable ? 'reachable' : 'unreachable', data: res.data.health } }));
    } catch {
      setReachability(prev => ({ ...prev, [id]: { status: 'unreachable' } }));
    }
  };

  const checkAll = async () => {
    for (const srv of servers) {
      checkServer(srv.id, srv.url);
    }
  };

  return (
    <>
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 mb-6 w-full border-b border-[var(--color-border-subtle)] pb-4">
        {servers.length > 0 && (
          <button onClick={checkAll} className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md shadow-sm hover:shadow-md transition-all">
            <Activity size={14} /> Check All
          </button>
        )}
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 px-5 py-2 text-sm rounded-md shadow-sm hover:shadow-md transition-all">
          <Plus size={16} /> Add Server
        </button>
      </div>

      {/* Add form Modal */}
      {createPortal(
        <AnimatePresence>
          {showAdd && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
              <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                  <Globe size={16} className="text-cyan-400" /> Add Remote Server
                </h2>
                <button onClick={() => setShowAdd(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server Name</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. my-remote-runner" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server URL</label>
                    <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://my-server.com/receive-tool" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What does this server do?" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <button onClick={() => setShowAdd(false)} className="btn-secondary px-4 py-2 text-sm rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">Cancel</button>
                <button onClick={() => addMut.mutate()} disabled={!form.name || !form.url || addMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                  {addMut.isPending ? 'Adding...' : 'Add Server'}
                </button>
              </div>
            </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-base font-semibold text-white mb-2">Delete Remote Server?</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                Are you sure? This will remove the server from your saved list.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
                <button
                  onClick={() => deleteMut.mutate(deleteConfirm)}
                  disabled={deleteMut.isPending}
                  className="px-4 py-2 text-sm rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
                >
                  {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Server list */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="surface-card rounded-xl p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-[var(--color-bg-hover)]" />
                  <div className="h-3 w-1/2 rounded bg-[var(--color-bg-hover)]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="relative overflow-hidden text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-[var(--color-bg-surface)] backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-xl w-full mt-2 group"
        >
          {/* Background Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-bg-base)] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-700" />

          <div className="relative z-10 w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-[rgba(6,182,212,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(6,182,212,0.15)] group-hover:scale-110 transition-transform duration-500">
            <Globe size={32} className="text-cyan-400" />
          </div>
          <div className="relative z-10">
            <p className="text-xl font-semibold text-[var(--color-text-primary)]">No remote servers configured</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-md mx-auto">
              Add a remote server to send tool code. Once added, you can select it from the tool detail modal to push code directly.
            </p>
          </div>
          <button 
            onClick={() => setShowAdd(true)} 
            className="relative z-10 btn-primary flex items-center gap-2 px-6 py-3 text-sm rounded-lg mt-4 shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] transition-all"
          >
            <Plus size={16} /> Add Remote Server
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((srv: Record<string, unknown>) => {
            const id = srv.id as number;
            const statusObj = reachability[id];
            const status = statusObj?.status;

            return (
              <motion.div
                key={id}
                variants={itemVariants}
                className="surface-card rounded-xl p-5 group hover:border-[var(--color-border-focus)] transition-all flex flex-col"
              >
                {/* Header */}
                <div 
                  className="flex items-center gap-3 mb-3 cursor-pointer"
                  onClick={() => navigate(`/remote-servers/${id}`)}
                >
                  <div className="w-8 h-8 rounded-md bg-gradient-to-br from-cyan-500/15 to-teal-500/15 border border-cyan-500/20 flex items-center justify-center">
                    <Globe size={14} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] block truncate">{String(srv.name)}</span>
                    <span className="text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] block truncate">{String(srv.url)}</span>
                  </div>
                  <ChevronRight size={16} className="text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Status */}
                <div className="flex items-center gap-3 mb-3">
                  {status === 'reachable' && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
                      <CheckCircle size={10} className="text-[var(--color-accent-success)]" />
                      <span className="text-[10px] font-medium text-[var(--color-accent-success)] uppercase tracking-wider">Reachable</span>
                    </div>
                  )}
                  {status === 'unreachable' && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)]">
                      <AlertCircle size={10} className="text-red-400" />
                      <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Unreachable</span>
                    </div>
                  )}
                  {status === 'checking' && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)]">
                      <Loader2 size={10} className="text-indigo-400 animate-spin" />
                      <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider">Checking</span>
                    </div>
                  )}
                  {!status && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(148,163,184,0.1)] border border-[rgba(148,163,184,0.2)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Not checked</span>
                    </div>
                  )}
                </div>

                {status === 'reachable' && statusObj?.data && (
                  <div className="mb-3 text-[10px] text-[var(--color-text-muted)] bg-black/20 p-2 rounded border border-[var(--color-border-subtle)] font-mono">
                    <div className="text-emerald-400/80 font-semibold mb-1">Server Health Info</div>
                    {statusObj.data.service && <div>Service: {statusObj.data.service}</div>}
                    {statusObj.data.tools_loaded !== undefined && <div>Tools Loaded: {statusObj.data.tools_loaded}</div>}
                    {statusObj.data.tool_names && Array.isArray(statusObj.data.tool_names) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {statusObj.data.tool_names.map((t: string) => (
                          <span key={t} className="px-1 py-0.5 bg-black/40 rounded text-emerald-400/70 border border-emerald-500/10">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!!srv.description && <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3 line-clamp-2">{String(srv.description)}</p>}

                <div className="flex-1" />

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--color-border-subtle)] w-full mt-auto">
                  <button
                    onClick={() => checkServer(id, String(srv.url))}
                    disabled={status === 'checking'}
                    className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-cyan-400 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <Activity size={12} /> Check
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-400 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </>
  );
}
