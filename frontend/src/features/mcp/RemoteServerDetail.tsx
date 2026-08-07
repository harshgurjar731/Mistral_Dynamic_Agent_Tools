import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { ArrowLeft, Globe, Wrench, Activity, CheckCircle, AlertCircle, Loader2, Edit2, X, Send } from 'lucide-react';
import { remoteServersApi } from '../../api/remoteServers';
import { toolsApi } from '../../api/tools';
import { QK } from '../../lib/queryClient';

export default function RemoteServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', url: '', description: '' });
  const [selectedToolToPush, setSelectedToolToPush] = useState<string>('');

  // 1. Fetch Remote Server Details
  const { data: server, isLoading: isServerLoading } = useQuery({
    queryKey: ['remote-server', id],
    queryFn: () => remoteServersApi.get(id!).then(r => r.data),
    enabled: !!id,
  });

  // 2. Check Reachability & Fetch Deployed Tools
  const { data: healthData, isLoading: isHealthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['remote-server-health', id],
    queryFn: () => remoteServersApi.check(server?.url).then(r => r.data),
    enabled: !!server?.url,
    staleTime: 30000,
  });

  // 3. Fetch All Local Tools (for the "Push" dropdown)
  const { data: localToolsData } = useQuery({
    queryKey: QK.tools(),
    queryFn: () => toolsApi.list().then(r => r.data),
  });
  
  const localTools = Array.isArray(localToolsData) ? localToolsData : (localToolsData?.tools ?? []);
  
  // Mutations
  const editMut = useMutation({
    mutationFn: () => remoteServersApi.update(id!, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remote-server', id] });
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
      setShowEdit(false);
    }
  });

  const pushToolMut = useMutation({
    mutationFn: (toolId: string) => remoteServersApi.sendTool(id!, toolId),
    onSuccess: () => {
      alert("Tool pushed successfully!");
      refetchHealth();
      setSelectedToolToPush('');
    },
    onError: (err: any) => {
      alert("Failed to push tool: " + (err.response?.data?.message || err.message));
    }
  });

  if (isServerLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex justify-center py-20">
        <Loader2 className="animate-spin text-cyan-400" size={32} />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center py-20">
        <p className="text-xl text-[var(--color-text-primary)]">Remote Server not found.</p>
        <button onClick={() => navigate('/mcp')} className="mt-4 text-cyan-400 hover:underline">Return to Registry</button>
      </div>
    );
  }

  const isReachable = healthData?.reachable === true;
  const isChecking = isHealthLoading;
  const deployedToolNames = healthData?.health?.tool_names ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/mcp')}
        className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-white transition-colors mb-6"
      >
        <ArrowLeft size={16} /> Back to Registry
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8 bg-[var(--color-bg-surface)] p-6 rounded-2xl border border-[var(--color-border-subtle)] shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-teal-500/5 pointer-events-none" />
        <div className="flex items-start sm:items-center gap-5 relative z-10">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <Globe size={24} className="text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{server.name}</h1>
              {isChecking ? (
                 <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)] text-[10px] font-medium text-indigo-400 uppercase tracking-wider">
                   <Loader2 size={12} className="animate-spin" /> Checking
                 </div>
              ) : isReachable ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] text-[10px] font-medium text-[var(--color-accent-success)] uppercase tracking-wider">
                  <CheckCircle size={12} /> Reachable
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-[10px] font-medium text-red-400 uppercase tracking-wider">
                  <AlertCircle size={12} /> Unreachable
                </div>
              )}
            </div>
            <p className="text-sm text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] mt-1 truncate max-w-[300px] sm:max-w-[400px]">
              {server.url}
            </p>
            {server.description && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-2">{server.description}</p>
            )}
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 relative z-10 shrink-0">
          <button 
            onClick={() => refetchHealth()} 
            disabled={isHealthLoading}
            className="btn-secondary flex justify-center items-center gap-2 px-4 py-2 text-sm rounded-lg transition-all border border-[var(--color-border-focus)] shadow-sm hover:shadow-md bg-[var(--color-bg-base)]"
          >
            <Activity size={16} className={isHealthLoading ? 'animate-spin' : ''} />
            {isHealthLoading ? 'Pinging...' : 'Ping Server'}
          </button>
          <button 
            onClick={() => {
              setEditForm({ name: server.name, url: server.url, description: server.description || '' });
              setShowEdit(true);
            }} 
            className="btn-primary flex justify-center items-center gap-2 px-4 py-2 text-sm rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] hover:shadow-[0_0_25px_rgba(6,182,212,0.4)]"
          >
            <Edit2 size={16} /> Edit Details
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-12 mt-4">
        {/* Top Section: Push Tool */}
        <div className="w-full max-w-xl">
          <div className="surface-card p-8 rounded-2xl border border-[var(--color-border-subtle)] shadow-sm">
            <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <Send size={20} className="text-teal-400" />
              Deploy Local Tool
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-8">
              Select an active local tool to deploy it to this remote server instance. The source code will be securely injected.
            </p>

            <div className="mb-8 space-y-3">
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)]">
                Select Tool to Deploy
              </label>
              <select 
                value={selectedToolToPush}
                onChange={e => setSelectedToolToPush(e.target.value)}
                className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-white text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5 outline-none cursor-pointer"
              >
                <option value="" disabled>Choose a tool...</option>
                {localTools.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <button 
              onClick={() => {
                if (selectedToolToPush) pushToolMut.mutate(selectedToolToPush);
              }}
              disabled={!selectedToolToPush || pushToolMut.isPending || !isReachable}
              className="w-full btn-primary flex justify-center items-center gap-2 px-4 py-4 text-sm rounded-lg transition-all disabled:opacity-50 bg-teal-600 hover:bg-teal-500 text-white font-medium border-none shadow-lg hover:shadow-teal-500/25 mt-2"
            >
              {pushToolMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {pushToolMut.isPending ? 'Deploying...' : 'Deploy to Remote'}
            </button>

            {!isReachable && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-2 text-red-400">
                <AlertCircle size={14} /> 
                <span className="text-xs font-medium">Server is unreachable</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Section: Deployed Tools */}
        <div className="w-full space-y-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Wrench size={20} className="text-cyan-400" />
              Tools Deployed to Remote
            </h2>
            <span className="text-xs font-medium bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-full text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
              {deployedToolNames.length} Total
            </span>
          </div>

          {deployedToolNames.length === 0 ? (
            <div className="text-center py-16 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[250px] gap-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] shadow-sm">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/10 to-teal-500/10 border border-cyan-500/20 flex items-center justify-center mb-1">
                <Wrench size={24} className="text-cyan-400/50" />
              </div>
              <div>
                <p className="text-base font-medium text-[var(--color-text-primary)]">No tools deployed</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">This remote server has no tools currently loaded. Push a local tool to make it available.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
              {deployedToolNames.map((toolName: string, i: number) => (
                <div key={i} className="surface-card rounded-xl p-4 border border-[var(--color-border-subtle)] hover:border-cyan-500/30 transition-all flex items-center gap-4 group">
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0 group-hover:bg-cyan-500/10 group-hover:border-cyan-500/30 transition-colors">
                    <Wrench size={16} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white mb-0.5 truncate" title={toolName}>{toolName}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Deployed dynamically</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {createPortal(
        <AnimatePresence>
          {showEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowEdit(false)}>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={e => e.stopPropagation()}
                className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                  <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                    <Edit2 size={16} className="text-cyan-400" /> Edit Remote Server
                  </h2>
                  <button onClick={() => setShowEdit(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]">
                    <X size={16} />
                  </button>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                    <div>
                      <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server Name</label>
                      <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Server URL</label>
                      <input value={editForm.url} onChange={e => setEditForm({ ...editForm, url: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                    </div>
                  </div>
                  <div className="mb-2">
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                    <input value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                  <button onClick={() => setShowEdit(false)} className="btn-secondary px-4 py-2 text-sm rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">Cancel</button>
                  <button onClick={() => editMut.mutate()} disabled={!editForm.name || !editForm.url || editMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                    {editMut.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
