import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Wrench, FlaskConical, Sparkles, Shield, Edit2, Trash2, Code2 } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toolsApi } from '../../api/tools';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export default function ToolLifecycle() {
  const [tab, setTab] = useState<'active' | 'pending' | 'synthesize'>('active');
  const tabs = [
    { key: 'active' as const, label: 'Active Tools' },
    { key: 'pending' as const, label: 'Pending Review' },
    { key: 'synthesize' as const, label: 'Synthesize' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Tool Lifecycle</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Synthesize, review, and manage dynamic tools.</p>
      </div>

      {/* Segmented Control */}
      <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit mb-8">
        {tabs.map(t => (
          <button 
            key={t.key} 
            onClick={() => setTab(t.key)} 
            className={cn(
              'relative px-4 py-1.5 text-sm font-medium rounded-md transition-colors z-10',
              tab === t.key ? 'text-[var(--color-bg-base)]' : 'text-[var(--color-text-muted)] hover:text-white'
            )}
          >
            {tab === t.key && (
              <motion.div
                layoutId="tool-tab-indicator"
                className="absolute inset-0 bg-white rounded-md"
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{ zIndex: -1 }}
              />
            )}
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'active' && <ActiveTools />}
          {tab === 'pending' && <PendingTools />}
          {tab === 'synthesize' && <SynthesizePanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ActiveTools() {
  const { data = [], isLoading } = useQuery({
    queryKey: QK.tools(),
    queryFn: () => toolsApi.list().then(r => Array.isArray(r.data) ? r.data : r.data.tools ?? []),
  });
  const [selectedTool, setSelectedTool] = useState<Record<string, any> | null>(null);

  if (isLoading) return <SkeletonGrid />;
  if (!data.length) return <EmptyState icon={Wrench} text="No active tools. Synthesize one to get started." />;

  return (
    <>
      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map((tool: Record<string, unknown>, i: number) => (
          <motion.div 
            key={String(tool.id ?? i)} 
            variants={itemVariants} 
            className="surface-card rounded-xl p-5 group cursor-pointer hover:border-[var(--color-border-focus)] transition-all hover:scale-[1.01] flex flex-col h-full"
            onClick={() => setSelectedTool(tool)}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                <Wrench size={14} className="text-[var(--color-text-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-[family-name:var(--font-mono)] font-medium text-[var(--color-text-primary)] block truncate">{String(tool.name)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-success)]" />
                <span className="text-[10px] font-medium text-[var(--color-accent-success)] uppercase tracking-wider">Active</span>
              </div>
            </div>
            {tool.description && <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed flex-1 line-clamp-4">{String(tool.description)}</p>}
          </motion.div>
        ))}
      </motion.div>

      <AnimatePresence>
        {selectedTool && (
           <ToolDetailsModal tool={selectedTool} onClose={() => setSelectedTool(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

function PendingTools() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: QK.pendingTools(),
    queryFn: () => toolsApi.listPending().then(r => Array.isArray(r.data) ? r.data : r.data.tools ?? []),
    refetchInterval: 5_000,
  });

  const approve = useMutation({ mutationFn: (id: string) => toolsApi.approve(id), onSuccess: () => { qc.invalidateQueries({ queryKey: QK.pendingTools() }); qc.invalidateQueries({ queryKey: QK.tools() }); } });
  const reject  = useMutation({ mutationFn: (id: string) => toolsApi.reject(id), onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }) });

  if (isLoading) return <SkeletonGrid />;
  if (!data.length) return <EmptyState icon={Shield} text="No tools awaiting approval. All clear." />;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
      {data.map((tool: Record<string, unknown>) => (
        <motion.div key={String(tool.id)} variants={itemVariants} className="surface-card rounded-xl overflow-hidden">
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
              <Shield size={14} className="text-[var(--color-accent-warning)]" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-[family-name:var(--font-mono)] text-sm font-medium text-[var(--color-text-primary)] block mb-0.5">{String(tool.name)}</span>
              <span className="text-[10px] text-[var(--color-accent-warning)] uppercase tracking-wider font-medium">Pending Review</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => approve.mutate(String(tool.id))} disabled={approve.isPending} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-transparent">
                <Check size={14} /> Approve
              </button>
              <button onClick={() => reject.mutate(String(tool.id))} disabled={reject.isPending} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.1)] hover:border-[rgba(239,68,68,0.2)]">
                <X size={14} /> Reject
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function SynthesizePanel() {
  const [task, setTask] = useState('');
  const qc = useQueryClient();
  const synthesis = useMutation({
    mutationFn: () => toolsApi.synthesize(task).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }),
  });

  return (
    <div className="max-w-2xl">
      <div className="surface-card rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-md bg-white flex items-center justify-center">
            <Sparkles size={14} className="text-black" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text-primary)]">Tool Synthesizer</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Describe the utility — Codestral will generate, lint, and sandbox.</p>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Task Description</label>
          <textarea value={task} onChange={e => setTask(e.target.value)} rows={4} placeholder="e.g. A function that fetches the weather for a given city." className="w-full minimal-input rounded-md px-4 py-3 text-sm resize-none focus:bg-[var(--color-bg-hover)]" />
        </div>
        <button onClick={() => synthesis.mutate()} disabled={task.length < 10 || synthesis.isPending} className="w-full btn-primary px-4 py-2.5 text-sm rounded-md flex items-center justify-center gap-2 disabled:opacity-50">
          <FlaskConical size={16} />
          {synthesis.isPending ? 'Synthesizing...' : 'Synthesize Tool'}
        </button>
      </div>

      <AnimatePresence>
        {synthesis.data && synthesis.data.status !== 'error' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="mt-4 surface-card rounded-xl p-4 border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.02)] flex items-center gap-3"
          >
            <div className="w-6 h-6 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center flex-shrink-0">
              <Check size={12} className="text-[var(--color-accent-success)]" />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">Tool generated successfully and moved to the <span className="text-[var(--color-text-primary)] font-medium">Pending Review</span> queue.</p>
          </motion.div>
        )}
        {synthesis.data && synthesis.data.status === 'error' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="mt-4 surface-card rounded-xl p-4 border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.02)] flex items-start gap-3"
          >
            <div className="w-6 h-6 rounded-full bg-[rgba(239,68,68,0.1)] flex items-center justify-center flex-shrink-0 mt-0.5">
              <X size={12} className="text-[var(--color-accent-danger)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Synthesis Failed</p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">{synthesis.data.message || "An unknown error occurred."}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ size: number; className?: string }>; text: string }) {
  return (
    <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[400px] gap-4 bg-[rgba(15,20,28,0.4)] backdrop-blur-xl border border-[rgba(255,255,255,0.05)] shadow-[inset_0_0_30px_rgba(0,0,0,0.2)] w-full mt-2"
    >
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-[rgba(236,72,153,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(236,72,153,0.15)]">
        <Icon size={32} className="text-pink-400" />
      </div>
      <div>
        <p className="text-base font-semibold text-[var(--color-text-primary)]">Nothing to show</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">{text}</p>
      </div>
    </motion.div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[...Array(4)].map((_, i) => (
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
  const initialDesc = tool.schema?.function?.description || tool.description || '';
  const [editForm, setEditForm] = useState({
    description: initialDesc,
    source_code: tool.source_code || ''
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
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Tool Definition</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && !isPending ? (
              <>
                <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-white px-3 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
                  <Edit2 size={14} /> Edit
                </button>
                {!['get_weather', 'calculate', 'search_knowledge', 'create_document', 'send_email'].includes(tool.name) && (
                  <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-400 px-3 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
                    <Trash2 size={14} /> {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </>
            ) : isEditing ? (
              <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending} className="flex items-center gap-2 text-xs font-medium bg-[var(--color-bg-hover)] text-white hover:bg-[var(--color-bg-surface)] px-3 py-1.5 rounded-md transition-colors">
                <Check size={14} /> {updateMut.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            ) : null}

            {isPending && !isEditing && (
              <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-white px-3 py-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
                  <Edit2 size={14} /> Edit
              </button>
            )}

            {isPending && (
              <>
                <button onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending} className="flex items-center gap-2 text-xs font-medium text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.1)] px-3 py-1.5 rounded-md transition-colors ml-2">
                  <X size={14} /> Reject
                </button>
                <button onClick={handleSaveAndApprove} disabled={updateMut.isPending || approveMut.isPending} className="flex items-center gap-2 text-xs font-medium bg-[var(--color-accent-success)] text-black hover:bg-[#34d399] px-3 py-1.5 rounded-md transition-colors ml-2 shadow-lg shadow-[rgba(16,185,129,0.2)]">
                  <Check size={14} /> {updateMut.isPending || approveMut.isPending ? 'Processing...' : (isEditing ? 'Save & Approve' : 'Approve')}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors ml-2 border-l border-[var(--color-border-subtle)] pl-4">
              <X size={16} />
            </button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 bg-transparent">
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
      </motion.div>
    </div>,
    document.body
  );
}
