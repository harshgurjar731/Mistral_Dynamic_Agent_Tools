import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Settings, Cpu, ArrowLeft, Save, Paperclip, X, ImageIcon } from 'lucide-react';
import { agentsApi } from '../../api/agents';
import { orchestratorApi } from '../../api/orchestrator';
import { uploadsApi } from '../../api/uploads';
import { useSessionStore } from '../../store/sessionStore';

import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../../lib/utils';
import { QK } from '../../lib/queryClient';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: agent, isLoading: isLoadingAgent } = useQuery({
    queryKey: [...QK.agents(), id],
    queryFn: () => agentsApi.get(id!).then((r) => r.data),
    enabled: !!id,
  });

  const { sessions, activeSessionId, createSession, addMessage, appendChunk, setStreaming, finalizeStreaming, setConversationId } = useSessionStore();
  
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [agentStatus, setAgentStatus] = useState('');
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit State
  const [editForm, setEditForm] = useState({ name: '', model: '', instructions: '', description: '', tier: '' });

  useEffect(() => {
    if (agent) {
      setEditForm({
        name: agent.name || '',
        model: agent.model || 'mistral-large-latest',
        instructions: (agent as any).agent_instructions || agent.instructions || '',
        description: agent.description || '',
        tier: agent.tier || 'foundation'
      });
    }
  }, [agent]);

  const updateMut = useMutation({
    mutationFn: () => agentsApi.update(id!, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...QK.agents(), id] });
      qc.invalidateQueries({ queryKey: QK.agents() });
    }
  });

  const activeSession = activeSessionId ? sessions[activeSessionId] : null;

  useEffect(() => {
    // Check if the current session is for this agent. If not, don't auto-create, wait for user to select or create.
    if (!activeSessionId || sessions[activeSessionId]?.agentId !== id) {
      // Find the most recent session for this agent
      const agentSessions = Object.values(sessions)
        .filter(s => s.type === 'agent' && s.agentId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      
      if (agentSessions.length > 0) {
        useSessionStore.getState().switchSession(agentSessions[0].id);
      } else if (id) {
        createSession('agent', id);
      }
    }
  }, [id, activeSessionId, sessions, createSession]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      alert('Invalid file type. Allowed: JPG, PNG, WebP, GIF');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('File too large. Maximum size is 20MB.');
      return;
    }
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearPendingImage = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage(null);
    }
  };

  const handleSubmit = async () => {
    if ((!input.trim() && !pendingImage) || !activeSessionId || !id) return;
    const q = input.trim() || (pendingImage ? 'Analyze this image' : '');
    const currentImage = pendingImage;
    setInput('');
    clearPendingImage();

    // Build user message with optional image preview
    const userMsg: any = { id: crypto.randomUUID(), role: 'user', content: q };
    if (currentImage) userMsg.imageUrl = currentImage.previewUrl;
    addMessage(userMsg);
    setStreaming(true);
    setAgentStatus('Initializing...');

    let isAIError = false;
    let imageBase64: string | undefined;
    let imageMime: string | undefined;

    // Upload image first if present
    if (currentImage) {
      try {
        setAgentStatus('Uploading image...');
        setIsUploading(true);
        const res = await uploadsApi.uploadImage(currentImage.file);
        imageBase64 = res.data.image_base64;
        imageMime = res.data.image_mime;
        setIsUploading(false);
      } catch (err) {
        setIsUploading(false);
        appendChunk('\n\n**Upload Error:** Failed to upload image. Please try again.');
        finalizeStreaming();
        setAgentStatus('');
        return;
      }
    }

    orchestratorApi.stream(
      {
        query: q,
        agent_id: id,
        conversation_id: activeSession?.conversationId || undefined,
        cleanup_agent: false,
        image_base64: imageBase64,
        image_mime: imageMime,
      },
      (event) => {
        if (event.type === 'status') setAgentStatus(event.data);
        if (event.type === 'text_chunk') {
            appendChunk(event.data);
            setAgentStatus(''); // Clear status when model starts generating text
        }
        if (event.type === 'conversation_id') setConversationId(event.data);
        if (event.type === 'error') {
            appendChunk('\n\n**System Error:** ' + event.data);
            isAIError = true;
            setAgentStatus('');
        }
      },
      () => {
        finalizeStreaming();
        setAgentStatus('');
        // If it was a 400 error about missing function results, we reset the AI conversation ID to auto-recover next time
        if (isAIError) {
            setConversationId('');
        }
      }
    );
  };

  if (isLoadingAgent) return <AgentDetailSkeleton />;
  if (!agent) return <div className="p-8 text-white">Agent not found.</div>;

  const hasChanges = agent && (
    editForm.name !== agent.name ||
    editForm.model !== agent.model ||
    editForm.instructions !== ((agent as any).agent_instructions || agent.instructions || '') ||
    editForm.description !== (agent.description || '') ||
    editForm.tier !== (agent.tier || 'foundation')
  );

  return (
    <div className="flex w-full h-full absolute inset-0 overflow-hidden bg-transparent">

      
      <div className="flex flex-col flex-1 relative min-w-0">
        {/* Header */}
        <header className="h-14 px-4 md:px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between shrink-0 bg-transparent z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/agents')} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
              <ArrowLeft size={16} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                <Cpu size={12} className="text-[var(--color-text-primary)]" />
              </div>
              <span className="text-sm font-semibold text-white tracking-tight">{agent.name}</span>
            </div>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className={cn("p-2 rounded-md transition-colors", showSettings ? "bg-[var(--color-bg-hover)] text-white" : "text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)]")}>
            <Settings size={16} />
          </button>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50 px-4">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-hover)] flex items-center justify-center mb-4">
                <Cpu size={32} className="text-[var(--color-text-muted)]" />
              </div>
              <h2 className="text-lg font-medium text-white mb-1">Chat with {agent.name}</h2>
              <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
                This agent has specific instructions and tools. Any queries sent here will be routed to this dedicated agent.
              </p>
            </div>
          )}

          {activeSession?.messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-5 py-3 text-sm",
                msg.role === 'user' 
                  ? "bg-white text-black font-medium" 
                  : "surface-card border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] leading-relaxed shadow-lg"
              )}>
                {msg.role === 'user' ? (
                  <div>
                    {msg.imageUrl && (
                      <div className="mb-2 rounded-lg overflow-hidden border border-[rgba(0,0,0,0.1)] inline-block">
                        <img src={msg.imageUrl} alt="Uploaded" className="max-w-[240px] max-h-[180px] object-cover" />
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ) : (
                  <div className="prose prose-invert max-w-none text-sm">
                    <ReactMarkdown components={{
                      code({ node, inline, className, children, ...rest }: any) {
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <SyntaxHighlighter {...rest} PreTag="div" children={String(children).replace(/\n$/, '')} language={match[1]} style={vscDarkPlus as any} className="rounded-md !bg-[#000000] !mt-2 !mb-4 border border-[var(--color-border-subtle)] text-xs" />
                        ) : (
                          <code {...rest} className={cn("bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded-md text-xs font-mono text-[#E2E8F0]", className)}>{children}</code>
                        )
                      }
                    }}>{msg.content + (msg.streaming ? ' ▊' : '')}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Agent Status / Thinking Indicator */}
          <AnimatePresence>
            {agentStatus && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex w-full justify-start"
              >
                <div className="surface-card border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-2xl px-5 py-3 text-sm flex items-center gap-4 shadow-lg w-fit">
                  <div className="flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{agentStatus}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={endRef} className="h-4" />
        </div>

        {/* Input */}
        <div className="p-4 shrink-0 bg-transparent">
          <div className="max-w-4xl mx-auto">
            {/* Image Preview */}
            <AnimatePresence>
              {pendingImage && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="mb-2 flex items-start gap-2"
                >
                  <div className="relative group inline-block">
                    <img
                      src={pendingImage.previewUrl}
                      alt="Upload preview"
                      className="h-20 w-auto rounded-lg border border-[var(--color-border-subtle)] object-cover shadow-lg"
                    />
                    <button
                      onClick={clearPendingImage}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white font-mono truncate max-w-[120px]">
                      {pendingImage.file.name}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="surface-card rounded-xl flex items-end focus-within:border-[var(--color-border-focus)] focus-within:ring-1 focus-within:ring-[var(--color-border-focus)] transition-all shadow-xl">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageSelect}
                className="hidden"
                id="agent-image-upload"
              />
              <textarea
                value={input}
                onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder={`Message ${agent.name}...`}
                rows={1}
                className="w-full bg-transparent px-4 py-4 text-sm text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none min-h-[56px] custom-scrollbar"
              />
              <div className="p-2 shrink-0 flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className={cn(
                    "p-2 rounded-lg transition-colors flex items-center justify-center h-10 w-10 hover:scale-105 active:scale-95",
                    pendingImage
                      ? "text-[var(--color-accent-primary)] bg-[rgba(99,102,241,0.1)]"
                      : "text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)]"
                  )}
                  title="Attach image (JPG, PNG, WebP, GIF — max 20MB)"
                >
                  <Paperclip size={18} />
                </button>
                <button 
                  onClick={handleSubmit} 
                  disabled={(!input.trim() && !pendingImage) || isUploading} 
                  className="p-2 rounded-lg bg-white text-black disabled:opacity-30 disabled:bg-[var(--color-bg-surface)] disabled:text-[var(--color-text-muted)] transition-colors flex items-center justify-center h-10 w-10 hover:scale-105 active:scale-95"
                >
                  {isUploading ? (
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)] px-1">
              <ImageIcon size={10} className="inline mr-1 opacity-60" />
              Attach images with the <span className="font-medium">📎</span> button · Supports JPG, PNG, WebP, GIF up to 20MB
            </p>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex flex-col overflow-y-auto shrink-0 custom-scrollbar"
          >
            <div className="p-6 w-[320px]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold text-white tracking-tight">Agent Configuration</h3>
                {hasChanges && (
                    <button 
                        onClick={() => updateMut.mutate()} 
                        disabled={updateMut.isPending}
                        className="btn-primary px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 shadow-md"
                    >
                        <Save size={12} /> {updateMut.isPending ? 'Saving...' : 'Save'}
                    </button>
                )}
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Name</label>
                  <input value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))} className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Model</label>
                  <select value={editForm.model} onChange={e => setEditForm(f => ({...f, model: e.target.value}))} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    <option value="mistral-large-latest" className="bg-[var(--color-bg-surface)] text-white">mistral-large-latest</option>
                    <option value="mistral-small-latest" className="bg-[var(--color-bg-surface)] text-white">mistral-small-latest</option>
                    <option value="open-mistral-nemo" className="bg-[var(--color-bg-surface)] text-white">open-mistral-nemo</option>
                    <option value="codestral-latest" className="bg-[var(--color-bg-surface)] text-white">codestral-latest</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Tier</label>
                  <select value={editForm.tier} onChange={e => setEditForm(f => ({...f, tier: e.target.value}))} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    <option value="foundation" className="bg-[var(--color-bg-surface)] text-white">Foundation</option>
                    <option value="domain" className="bg-[var(--color-bg-surface)] text-white">Domain</option>
                    <option value="use_case" className="bg-[var(--color-bg-surface)] text-white">Use Case</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Description</label>
                  <input value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium flex justify-between">
                    <span>Instructions</span>
                  </label>
                  <textarea value={editForm.instructions} onChange={e => setEditForm(f => ({...f, instructions: e.target.value}))} rows={8} className="w-full minimal-input rounded-md px-3 py-2 text-sm font-mono resize-y min-h-[150px] custom-scrollbar text-[var(--color-text-secondary)]" />
                </div>

                <div className="pt-4 border-t border-[var(--color-border-subtle)]">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium mb-3">Tools Equipped</p>
                    {agent.tools && agent.tools.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {agent.tools.map((t: any, i: number) => {
                                const tName = typeof t === 'string' ? t : (t?.function?.name || t?.name || 'Unknown Tool');
                                return (
                                    <span key={`${tName}-${i}`} className="px-2 py-1 rounded bg-[rgba(255,255,255,0.05)] border border-[var(--color-border-subtle)] text-[10px] font-mono text-white">
                                        {tName}
                                    </span>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-[var(--color-text-muted)] italic">No tools equipped.</p>
                    )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentDetailSkeleton() {
  return (
    <div className="flex w-full h-full absolute inset-0 overflow-hidden bg-[var(--color-bg-base)] text-white animate-pulse">
      <div className="flex flex-col flex-1 relative min-w-0">
        {/* Header Skeleton */}
        <header className="h-14 px-4 md:px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between shrink-0 bg-transparent">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)]" />
            <div className="h-4 w-32 rounded bg-[var(--color-bg-hover)]" />
          </div>
          <div className="w-8 h-8 rounded bg-[var(--color-bg-hover)]" />
        </header>

        {/* Chat Skeleton */}
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center opacity-50">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-hover)] mb-4" />
          <div className="h-5 w-48 rounded bg-[var(--color-bg-hover)] mb-2" />
          <div className="h-3 w-64 rounded bg-[var(--color-bg-hover)] mb-1" />
          <div className="h-3 w-52 rounded bg-[var(--color-bg-hover)]" />
        </div>

        {/* Input Bar Skeleton */}
        <div className="p-4 shrink-0">
          <div className="max-w-4xl mx-auto h-14 rounded-xl bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)]" />
        </div>
      </div>

      {/* Settings Panel Skeleton */}
      <div className="border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] w-[320px] shrink-0 p-6 space-y-6 hidden md:block">
        <div className="h-4 w-1/2 rounded bg-[var(--color-bg-hover)] mb-8" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-1/3 rounded bg-[var(--color-bg-hover)]" />
            <div className="h-9 w-full rounded bg-[var(--color-bg-hover)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
