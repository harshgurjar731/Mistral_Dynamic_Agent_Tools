/**
 * toolGalleryShared — pieces reused by every gallery view over the Tool
 * Service's CRUD API (`toolsApi`): the generic "chat tool" gallery
 * (ToolLifecycle) and the workflow-scoped Activity Gallery. Both sit on the
 * same underlying records — a dynamically synthesised, sandboxed function —
 * so the card, detail modal, and empty/loading states are identical; only the
 * page framing (title, copy, which records count as "yours") differs.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Wrench, Shield, FlaskConical, Sparkles, Edit2, Trash2, Code2, Globe, Send, CheckCircle, AlertCircle, Loader2, ArrowRight, Zap } from 'lucide-react';
import type { ToolPurpose } from '../../api/tools';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toolsApi } from '../../api/tools';
import { remoteServersApi } from '../../api/remoteServers';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

export const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

export const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

/**
 * Tools the platform ships with — Mistral's own built-ins ("builtin-" id
 * prefix), hardcoded backend tools ("native-" id prefix), and the handful of
 * pre-approved seed tools (see tool-service/app/seed_native_tools.py) that
 * carry an ordinary dynamic id but are still not user-deletable. Everything
 * else is a Codestral-synthesized tool the user created and can remove.
 */
export type ToolKind = 'builtin' | 'synthesized';

const PROTECTED_TOOL_NAMES = new Set([
  'get_weather', 'calculate', 'search_knowledge', 'create_document', 'send_email',
]);

export function isBuiltIn(tool: Record<string, unknown>): boolean {
  const id = String(tool.id ?? '');
  if (id.startsWith('builtin-') || id.startsWith('native-')) return true;
  return PROTECTED_TOOL_NAMES.has(String(tool.name ?? ''));
}

export function toolKind(tool: Record<string, unknown>): ToolKind {
  return isBuiltIn(tool) ? 'builtin' : 'synthesized';
}

export const KIND_CONFIG: Record<ToolKind, { label: string; icon: typeof Wrench; color: string; bg: string; border: string }> = {
  builtin: {
    label: 'Built-in',
    icon: Shield,
    color: 'text-[#a5b4fc]',
    bg: 'bg-[rgba(99,102,241,0.1)]',
    border: 'border-[rgba(99,102,241,0.2)]',
  },
  synthesized: {
    label: 'Synthesized',
    icon: FlaskConical,
    color: 'text-[#34d399]',
    bg: 'bg-[rgba(52,211,153,0.1)]',
    border: 'border-[rgba(52,211,153,0.2)]',
  },
};

export function ToolKindBadge({ kind }: { kind: ToolKind }) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', cfg.color, cfg.bg, cfg.border)}>
      <Icon size={9} /> {cfg.label}
    </span>
  );
}

/** Where a tool record is meant to be used — read with a "tool" fallback so a
 * record fetched before the purpose field existed still renders correctly. */
export function toolPurpose(tool: Record<string, unknown>): ToolPurpose {
  return (tool.purpose as ToolPurpose | undefined) === 'activity' ? 'activity' : 'tool';
}

export const PURPOSE_CONFIG: Record<ToolPurpose, { label: string; icon: typeof Wrench; color: string; bg: string; border: string }> = {
  tool: {
    label: 'Tool',
    icon: Wrench,
    color: 'text-[#818cf8]',
    bg: 'bg-[rgba(129,140,248,0.1)]',
    border: 'border-[rgba(129,140,248,0.25)]',
  },
  activity: {
    label: 'Activity',
    icon: Zap,
    color: 'text-pink-300',
    bg: 'bg-[rgba(244,114,182,0.1)]',
    border: 'border-[rgba(244,114,182,0.25)]',
  },
};

export function PurposeBadge({ purpose }: { purpose: ToolPurpose }) {
  const cfg = PURPOSE_CONFIG[purpose];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', cfg.color, cfg.bg, cfg.border)}>
      <Icon size={9} /> {cfg.label}
    </span>
  );
}

export function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ size: number; className?: string }>; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-[var(--color-bg-surface)] backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-xl w-full mt-2 group"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-bg-base)] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-pink-500/10 rounded-full blur-[80px] pointer-events-none group-hover:bg-pink-500/20 transition-all duration-700" />

      <div className="relative z-10 w-20 h-20 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-[rgba(236,72,153,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(236,72,153,0.15)] group-hover:scale-110 transition-transform duration-500">
        <Icon size={32} className="text-pink-400" />
      </div>
      <div className="relative z-10">
        <p className="text-xl font-semibold text-[var(--color-text-primary)]">Nothing to show</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-sm mx-auto">{text}</p>
      </div>
    </motion.div>
  );
}

export function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="surface-card rounded-xl p-5 flex flex-col h-full gap-4 animate-pulse">
          <div className="flex items-start gap-3 mb-1">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-3/4 rounded bg-[var(--color-bg-hover)]" />
            </div>
            <div className="h-5 w-16 rounded-full bg-[var(--color-bg-hover)] shrink-0" />
          </div>
          <div className="space-y-2 flex-1">
            <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
            <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
            <div className="h-3 w-4/5 rounded bg-[var(--color-bg-hover)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ToolDetailsModal({ tool, onClose, isPending, onApprove, onReject }: { tool: Record<string, any>; onClose: () => void; isPending?: boolean; onApprove?: () => void; onReject?: () => void; }) {
  const qc = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showRemotePicker, setShowRemotePicker] = useState(false);
  const [selectedRemoteServer, setSelectedRemoteServer] = useState<number | null>(null);
  const [reachability, setReachability] = useState<Record<number, { status: 'checking' | 'reachable' | 'unreachable', data?: any }>>({});
  const [sendSuccess, setSendSuccess] = useState<{serverName: string, response?: any} | null>(null);
  const initialDesc = tool.schema?.function?.description || tool.description || '';
  const [editForm, setEditForm] = useState({
    description: initialDesc,
    source_code: tool.source_code || '',
    purpose: toolPurpose(tool),
  });

  // Remote servers for send picker
  const { data: remoteServers = [] } = useQuery({
    queryKey: QK.remoteServers(),
    queryFn: () => remoteServersApi.list().then(r => Array.isArray(r.data) ? r.data : []),
    enabled: showRemotePicker,
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

  const sendMut = useMutation({
    mutationFn: () => remoteServersApi.sendTool(selectedRemoteServer!, tool.id),
    onSuccess: (res) => {
      const serverName = (remoteServers as Record<string, unknown>[]).find(s => s.id === selectedRemoteServer)?.name;
      setSendSuccess({
        serverName: String(serverName || 'remote server'),
        response: res.data.remote_response
      });
      setShowRemotePicker(false);
      setSelectedRemoteServer(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => toolsApi.update(tool.id, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tools() });
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
      setIsEditing(false);
      if (!isPending) onClose();
    }
  });

  const deleteMut = useMutation({
    mutationFn: () => toolsApi.delete(tool.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tools() });
      onClose();
    }
  });

  const approveMut = useMutation({
    mutationFn: () => toolsApi.approve(tool.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tools() });
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
      if (onApprove) onApprove();
      onClose();
    }
  });

  const rejectMut = useMutation({
    mutationFn: () => toolsApi.reject(tool.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
      if (onReject) onReject();
      onClose();
    }
  });

  const handleSaveAndApprove = async () => {
    if (isEditing) {
      await updateMut.mutateAsync();
    }
    approveMut.mutate();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] flex items-center justify-center">
              <Wrench size={14} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white font-[family-name:var(--font-mono)]">{tool.name}</h3>
              <div className="mt-1 flex items-center gap-1.5">
                <ToolKindBadge kind={toolKind(tool)} />
                <PurposeBadge purpose={isEditing ? editForm.purpose : toolPurpose(tool)} />
                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Tool Definition</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 bg-transparent">
          {/* Remote Server Picker Dropdown */}
          <AnimatePresence>
            {showRemotePicker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-4 mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-cyan-300 font-semibold mb-3 flex items-center gap-2">
                    <Globe size={12} /> Select Remote Server
                  </h4>
                  {remoteServers.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs text-[var(--color-text-muted)]">No remote servers configured.</p>
                      <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg p-4">
                        <h5 className="text-xs font-semibold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
                          <ArrowRight size={12} className="text-cyan-400" /> How to add a remote server
                        </h5>
                        <ol className="text-xs text-[var(--color-text-secondary)] space-y-1.5 list-decimal list-inside">
                          <li>Navigate to <span className="text-cyan-400 font-medium">MCP Servers</span> page from the sidebar</li>
                          <li>Switch to the <span className="text-cyan-400 font-medium">Remote Servers</span> tab</li>
                          <li>Click <span className="text-cyan-400 font-medium">Add Server</span> and enter the server URL</li>
                          <li>Come back here and select your server to send the tool code</li>
                        </ol>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(remoteServers as Record<string, unknown>[]).map((s) => {
                        const sId = s.id as number;
                        const statusObj = reachability[sId];
                        const status = statusObj?.status;
                        return (
                          <label
                            key={sId}
                            className={cn(
                              'flex flex-col gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors border',
                              selectedRemoteServer === sId
                                ? 'bg-cyan-500/10 border-cyan-500/30'
                                : 'bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] hover:border-cyan-500/20'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="remote-server"
                                value={sId}
                                checked={selectedRemoteServer === sId}
                                onChange={() => setSelectedRemoteServer(sId)}
                                className="accent-cyan-400"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-white block">{String(s.name)}</span>
                                <span className="text-xs text-[var(--color-text-muted)] font-mono block truncate">{String(s.url)}</span>
                              </div>
                              {/* Reachability indicator */}
                              <div className="flex items-center gap-2">
                                {status === 'reachable' && <CheckCircle size={14} className="text-emerald-400" />}
                                {status === 'unreachable' && <AlertCircle size={14} className="text-red-400" />}
                                {status === 'checking' && <Loader2 size={14} className="text-indigo-400 animate-spin" />}
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); checkServer(sId, String(s.url)); }}
                                  disabled={status === 'checking'}
                                  className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium uppercase tracking-wider"
                                >
                                  Check
                                </button>
                              </div>
                            </div>

                            {status === 'reachable' && statusObj?.data && (
                              <div className="mt-1 ml-6 text-[10px] text-[var(--color-text-muted)] bg-black/20 p-2 rounded border border-[var(--color-border-subtle)] font-mono">
                                <div className="text-emerald-400/80 font-semibold mb-1">Server Health Info</div>
                                {statusObj.data.service && <div>Service: {statusObj.data.service}</div>}
                                {statusObj.data.tools_loaded !== undefined && <div>Tools Loaded: {statusObj.data.tools_loaded}</div>}
                              </div>
                            )}
                          </label>
                        );
                      })}
                      <button
                        onClick={() => sendMut.mutate()}
                        disabled={!selectedRemoteServer || sendMut.isPending}
                        className="w-full mt-2 px-4 py-2 text-sm rounded-md bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <Send size={14} />
                        {sendMut.isPending ? 'Sending...' : 'Send to ' + ((remoteServers as Record<string, unknown>[]).find(s => s.id === selectedRemoteServer)?.name || '...')}
                      </button>
                      {sendMut.isError && (
                        <p className="text-xs text-red-400 mt-1">Failed to send: {(sendMut.error as Error).message}</p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Send success banner */}
          <AnimatePresence>
            {sendSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex flex-col gap-3 px-4 py-3 rounded-lg bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.25)] w-full"
              >
                <div className="flex items-start gap-3 w-full">
                  <CheckCircle size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-emerald-300">
                      Tool code sent successfully to <span className="font-semibold text-white">{sendSuccess.serverName}</span>. It will be available as an MCP tool once the remote server processes it.
                    </p>
                  </div>
                  <button onClick={() => setSendSuccess(null)} className="text-[var(--color-text-muted)] hover:text-white shrink-0">
                    <X size={14} />
                  </button>
                </div>
                {sendSuccess.response && (
                  <div className="ml-7 bg-black/30 rounded border border-emerald-500/20 p-3 max-h-[150px] overflow-y-auto custom-scrollbar">
                    <h5 className="text-[10px] uppercase tracking-wider font-semibold text-emerald-500/70 mb-1">Remote Server Response</h5>
                    <pre className="text-[11px] font-mono text-emerald-100/70 whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify(sendSuccess.response, null, 2)}
                    </pre>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Purpose */}
          {isEditing && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-2">
                <Zap size={12} /> Where can this be used?
              </h4>
              <div className="flex items-center gap-1 bg-[var(--color-bg-base)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit">
                {(Object.keys(PURPOSE_CONFIG) as ToolPurpose[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, purpose: p })}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                      editForm.purpose === p
                        ? 'bg-[var(--color-bg-hover)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-white'
                    )}
                  >
                    {PURPOSE_CONFIG[p].label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
                Controls whether this shows up on the Tools page or in the Activity Gallery — never both.
              </p>
            </div>
          )}

          {/* Description */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-2">
              <Sparkles size={12} /> Description
            </h4>
            {isEditing ? (
              <textarea
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="w-full minimal-input rounded-md px-4 py-3 text-sm resize-none focus:bg-[var(--color-bg-hover)]"
              />
            ) : (
              <p className="text-sm text-[var(--color-text-primary)] leading-relaxed bg-[var(--color-bg-base)] p-4 rounded-lg border border-[var(--color-border-subtle)]">
                {initialDesc || 'No description available.'}
              </p>
            )}
          </div>

          {/* Source Code */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-2">
              <Code2 size={12} /> Source Code
            </h4>
            {isEditing ? (
              <textarea
                value={editForm.source_code}
                onChange={e => setEditForm({ ...editForm, source_code: e.target.value })}
                rows={12}
                className="w-full minimal-input font-mono rounded-md px-4 py-3 text-xs resize-none focus:bg-[var(--color-bg-hover)] whitespace-pre"
              />
            ) : (
              <div className="bg-[#000000] border border-[var(--color-border-subtle)] rounded-lg overflow-hidden shadow-inner text-xs">
                <SyntaxHighlighter
                  language="python"
                  style={vscDarkPlus}
                  customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent' }}
                >
                  {tool.source_code || '# No source code available'}
                </SyntaxHighlighter>
              </div>
            )}
          </div>

          {/* Schema Read-only */}
          {!isEditing && tool.schema?.function?.parameters && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2">Parameters Schema</h4>
              <div className="bg-[#000000] border border-[var(--color-border-subtle)] rounded-lg p-5 overflow-x-auto custom-scrollbar shadow-inner">
                <pre className="text-[13px] font-mono text-[#E2E8F0] leading-loose">
                  {JSON.stringify(tool.schema.function.parameters, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] mt-auto">
          {!isEditing && !isPending ? (
            <>
              {/* Send to Remote button — only for approved tools */}
              {tool.status === 'approved' && (
                <button
                  onClick={() => setShowRemotePicker(!showRemotePicker)}
                  className="flex items-center justify-center gap-2 text-xs font-medium bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 px-4 py-2 rounded-md transition-colors border border-cyan-500/30 w-full sm:w-auto"
                >
                  <Globe size={14} /> Send to Remote
                </button>
              )}
              <button onClick={() => setIsEditing(true)} className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-white px-4 py-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors w-full sm:w-auto">
                <Edit2 size={14} /> Edit
              </button>
              {!isBuiltIn(tool) && (
                <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-400 px-4 py-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors w-full sm:w-auto">
                  <Trash2 size={14} /> {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </>
          ) : isEditing ? (
            <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending} className="flex items-center justify-center gap-2 text-xs font-medium bg-[var(--color-bg-hover)] text-white hover:bg-[var(--color-bg-surface)] px-4 py-2 rounded-md transition-colors w-full sm:w-auto">
              <Check size={14} /> {updateMut.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          ) : null}

          {isPending && !isEditing && (
            <button onClick={() => setIsEditing(true)} className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-white px-4 py-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors w-full sm:w-auto">
                <Edit2 size={14} /> Edit
            </button>
          )}

          {isPending && (
            <>
              <button onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending} className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.1)] px-4 py-2 rounded-md transition-colors w-full sm:w-auto">
                <X size={14} /> Reject
              </button>
              <button onClick={handleSaveAndApprove} disabled={updateMut.isPending || approveMut.isPending} className="flex items-center justify-center gap-2 text-xs font-medium bg-[var(--color-accent-success)] text-black hover:bg-[#34d399] px-4 py-2 rounded-md transition-colors shadow-lg shadow-[rgba(16,185,129,0.2)] w-full sm:w-auto">
                <Check size={14} /> {updateMut.isPending || approveMut.isPending ? 'Processing...' : (isEditing ? 'Save & Approve' : 'Approve')}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
