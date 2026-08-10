import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Settings, Cpu, ArrowLeft, Save, Paperclip, X, ImageIcon, Thermometer, Library, Check, ChevronDown, Plug } from 'lucide-react';
import { agentsApi } from '../../api/agents';
import { connectorsApi } from '../../api/connectors';
import { librariesApi } from '../../api/libraries';
import { orchestratorApi } from '../../api/orchestrator';
import { uploadsApi } from '../../api/uploads';
import { useSessionStore } from '../../store/sessionStore';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  const [editForm, setEditForm] = useState({
    name: '', model: '', instructions: '', description: '', tier: '',
    temperature: null as number | null,
    top_p: null as number | null,
    max_tokens: null as number | null,
    random_seed: null as number | null,
    frequency_penalty: null as number | null,
    presence_penalty: null as number | null,
  });

  useEffect(() => {
    if (agent) {
      setEditForm({
        name: agent.name || '',
        model: agent.model || 'mistral-large-latest',
        instructions: (agent as any).agent_instructions || agent.instructions || '',
        description: agent.description || '',
        tier: agent.tier || 'foundation',
        temperature: agent.temperature ?? null,
        top_p: agent.top_p ?? null,
        max_tokens: agent.max_tokens ?? null,
        random_seed: agent.random_seed ?? null,
        frequency_penalty: agent.frequency_penalty ?? null,
        presence_penalty: agent.presence_penalty ?? null,
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
    editForm.tier !== (agent.tier || 'foundation') ||
    editForm.temperature !== (agent.temperature ?? null) ||
    editForm.top_p !== (agent.top_p ?? null) ||
    editForm.max_tokens !== (agent.max_tokens ?? null) ||
    editForm.random_seed !== (agent.random_seed ?? null) ||
    editForm.frequency_penalty !== (agent.frequency_penalty ?? null) ||
    editForm.presence_penalty !== (agent.presence_penalty ?? null)
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
            <div className="p-6 pb-32 w-[320px]">
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
                    <div className="flex items-center gap-2 mb-4">
                      <Thermometer size={14} className="text-orange-400" />
                      <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Completion Parameters</p>
                    </div>

                    {/* Temperature Slider */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] text-[var(--color-text-secondary)] font-medium">Temperature</label>
                        <span className="text-[11px] font-[family-name:var(--font-mono)] text-orange-400 bg-[rgba(251,146,60,0.1)] px-1.5 py-0.5 rounded">{editForm.temperature ?? '—'}</span>
                      </div>
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={editForm.temperature ?? 0.7}
                        onChange={e => setEditForm(f => ({...f, temperature: parseFloat(e.target.value)}))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-bg-hover)] accent-orange-400"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-0.5">
                        <span>Precise</span><span>Creative</span>
                      </div>
                    </div>

                    {/* Top P Slider */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] text-[var(--color-text-secondary)] font-medium">Top P</label>
                        <span className="text-[11px] font-[family-name:var(--font-mono)] text-teal-400 bg-[rgba(45,212,191,0.1)] px-1.5 py-0.5 rounded">{editForm.top_p ?? '—'}</span>
                      </div>
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={editForm.top_p ?? 1}
                        onChange={e => setEditForm(f => ({...f, top_p: parseFloat(e.target.value)}))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-bg-hover)] accent-teal-400"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-0.5">
                        <span>Focused</span><span>Diverse</span>
                      </div>
                    </div>

                    {/* Max Tokens */}
                    <div className="mb-4">
                      <label className="block text-[11px] text-[var(--color-text-secondary)] font-medium mb-1.5">Max Tokens</label>
                      <input
                        type="number" min="1" max="128000" step="1"
                        value={editForm.max_tokens ?? ''}
                        onChange={e => setEditForm(f => ({...f, max_tokens: e.target.value ? parseInt(e.target.value) : null}))}
                        placeholder="Default (model limit)"
                        className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)]"
                      />
                    </div>

                    {/* Random Seed */}
                    <div className="mb-4">
                      <label className="block text-[11px] text-[var(--color-text-secondary)] font-medium mb-1.5">Random Seed</label>
                      <input
                        type="number" min="0" step="1"
                        value={editForm.random_seed ?? ''}
                        onChange={e => setEditForm(f => ({...f, random_seed: e.target.value ? parseInt(e.target.value) : null}))}
                        placeholder="None (random)"
                        className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)]"
                      />
                    </div>

                    {/* Frequency Penalty Slider */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] text-[var(--color-text-secondary)] font-medium">Frequency Penalty</label>
                        <span className="text-[11px] font-[family-name:var(--font-mono)] text-violet-400 bg-[rgba(139,92,246,0.1)] px-1.5 py-0.5 rounded">{editForm.frequency_penalty ?? '—'}</span>
                      </div>
                      <input
                        type="range" min="-2" max="2" step="0.1"
                        value={editForm.frequency_penalty ?? 0}
                        onChange={e => setEditForm(f => ({...f, frequency_penalty: parseFloat(e.target.value)}))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-bg-hover)] accent-violet-400"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-0.5">
                        <span>-2.0</span><span>0</span><span>2.0</span>
                      </div>
                    </div>

                    {/* Presence Penalty Slider */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] text-[var(--color-text-secondary)] font-medium">Presence Penalty</label>
                        <span className="text-[11px] font-[family-name:var(--font-mono)] text-rose-400 bg-[rgba(251,113,133,0.1)] px-1.5 py-0.5 rounded">{editForm.presence_penalty ?? '—'}</span>
                      </div>
                      <input
                        type="range" min="-2" max="2" step="0.1"
                        value={editForm.presence_penalty ?? 0}
                        onChange={e => setEditForm(f => ({...f, presence_penalty: parseFloat(e.target.value)}))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-bg-hover)] accent-rose-400"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-0.5">
                        <span>-2.0</span><span>0</span><span>2.0</span>
                      </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-[var(--color-border-subtle)]">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium mb-3">Tools Equipped</p>
                    {agent.tools && agent.tools.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {agent.tools.map((t: any, i: number) => {
                                const tName = typeof t === 'string' ? t : (t?.function?.name || t?.type || t?.name || 'Unknown Tool');
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

                {/* Document Library Tool */}
                <DocumentLibrarySection agentId={id!} agent={agent} />

                {/* Mistral Connectors */}
                <ConnectorsSection agentId={id!} agent={agent} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


/* ─── Mistral Connectors Section ─────────────────────────────────────── */

/**
 * Attach connectors to this agent.
 *
 * A connector rides in the agent's `tools` array as an entry of type
 * "connector", so the platform runs its tools and holds its credentials. The
 * model decides which of the connector's tools to call — attaching one grants
 * the whole set unless it is narrowed on the Connectors page.
 */
function ConnectorsSection({ agentId, agent }: { agentId: string; agent: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const attachedIds: string[] = (agent.connectors || [])
    .map((c: any) => c?.connector_id)
    .filter(Boolean);

  const { data, isLoading } = useQuery({
    queryKey: QK.connectors(),
    queryFn: () => connectorsApi.list().then((r) => r.data),
  });

  const available = data?.items ?? [];

  const saveMut = useMutation({
    // Only `connectors` is sent: the backend leaves `tools` untouched when the
    // key is absent, so attaching a connector cannot clobber the agent's tools.
    mutationFn: (ids: string[]) =>
      agentsApi.update(agentId, {
        connectors: ids.map((connector_id) => ({ connector_id })),
      } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...QK.agents(), agentId] });
      qc.invalidateQueries({ queryKey: QK.agents() });
      qc.invalidateQueries({ queryKey: QK.builderCatalog() });
    },
  });

  const toggle = (connectorId: string) => {
    const next = attachedIds.includes(connectorId)
      ? attachedIds.filter((x) => x !== connectorId)
      : [...attachedIds, connectorId];
    saveMut.mutate(next);
  };

  const attached = available.filter((c) => attachedIds.includes(c.id));

  return (
    <div className="pt-4 border-t border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-emerald-400" />
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">
            Connectors
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-white transition-colors"
        >
          {open ? 'Done' : 'Manage'}
          <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {!open && (
        attached.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attached.map((c) => (
              <span
                key={c.id}
                title={c.is_authenticated ? c.description : `${c.name} — not connected`}
                className={cn(
                  'px-2 py-1 rounded border text-[10px] font-mono',
                  c.is_authenticated
                    ? 'bg-emerald-400/10 border-emerald-400/25 text-emerald-300'
                    : 'bg-amber-400/10 border-amber-400/25 text-amber-300',
                )}
              >
                {c.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] italic">No connectors attached.</p>
        )
      )}

      {open && (
        <div className="space-y-1.5">
          {isLoading && (
            <p className="text-xs text-[var(--color-text-muted)]">Loading connectors…</p>
          )}
          {!isLoading && available.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              No connectors registered. Add one from the Connectors page.
            </p>
          )}
          {available.map((c) => {
            const isOn = attachedIds.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                disabled={saveMut.isPending}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors disabled:opacity-50',
                  isOn
                    ? 'border-emerald-400/30 bg-emerald-400/8'
                    : 'border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
                )}
              >
                <div
                  className={cn(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    isOn
                      ? 'bg-emerald-400 border-emerald-400'
                      : 'border-[var(--color-border-subtle)]',
                  )}
                >
                  {isOn && <Check size={9} className="text-black" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-white truncate">{c.name}</p>
                  {c.description && (
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                      {c.description}
                    </p>
                  )}
                </div>
                {!c.is_authenticated && (
                  <span className="text-[9px] text-amber-400 shrink-0">not connected</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Document Library Tool Section ──────────────────────────────────── */

function DocumentLibrarySection({ agentId, agent }: { agentId: string; agent: any }) {
  const qc = useQueryClient();

  // Detect if the agent already has document_library equipped
  const existingDocLib = (agent.tools || []).find((t: any) => t?.type === 'document_library');
  const existingLibIds: string[] = existingDocLib?.library_ids || [];

  const [enabled, setEnabled] = useState(!!existingDocLib);
  const [selectedIds, setSelectedIds] = useState<string[]>(existingLibIds);
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch available libraries
  const { data: libraries = [] } = useQuery({
    queryKey: QK.libraries(),
    queryFn: () => librariesApi.list().then(r => r.data),
  });

  // Derive stable primitives for the dependency array to avoid infinite re-render loops.
  // existingDocLib and existingLibIds are new object/array refs every render — cannot be used as deps directly.
  const hasDocLib = !!existingDocLib;
  const libIdsKey = existingLibIds.join(',');

  useEffect(() => {
    setEnabled(hasDocLib);
    setSelectedIds(libIdsKey ? libIdsKey.split(',') : []);
    setShowDropdown(false);
  }, [agentId, hasDocLib, libIdsKey]);

  const toggleLibrary = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  // Build full tool list: keep non-document_library tools + optionally add document_library
  const buildToolKeys = (): string[] => {
    const existing = (agent.tools || [])
      // Connectors are carried over by the backend when `connectors` is
      // omitted; emitting them here as a tool key would be meaningless.
      .filter((t: any) => t?.type !== 'document_library' && t?.type !== 'connector')
      .map((t: any) => {
        if (typeof t === 'string') return t;
        if (t?.function?.name) return t.function.name;
        return t?.type || '';
      })
      .filter(Boolean);

    if (enabled && selectedIds.length > 0) {
      existing.push('document_library');
    }
    return existing;
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: any = {
        tools: buildToolKeys(),
      };
      if (enabled && selectedIds.length > 0) {
        payload.document_library_ids = selectedIds;
      }
      return agentsApi.update(agentId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...QK.agents(), agentId] });
      qc.invalidateQueries({ queryKey: QK.agents() });
    },
  });

  const hasLibChanges =
    (enabled !== !!existingDocLib) ||
    (enabled && JSON.stringify(selectedIds.sort()) !== JSON.stringify(existingLibIds.sort()));

  return (
    <div className="pt-4 border-t border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Library size={14} className="text-indigo-400" />
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">
            Document Library
          </p>
        </div>

        {/* Toggle Switch */}
        <button
          onClick={() => {
            const newEnabled = !enabled;
            setEnabled(newEnabled);
            if (!newEnabled) {
              // Toggling OFF — immediately save to remove document_library from agent
              setSelectedIds([]);
              setShowDropdown(false);
              const toolsWithout = (agent.tools || [])
                .filter((t: any) => t?.type !== 'document_library')
                .map((t: any) => {
                  if (typeof t === 'string') return t;
                  if (t?.function?.name) return t.function.name;
                  return t?.type || '';
                })
                .filter(Boolean);
              agentsApi.update(agentId, { tools: toolsWithout }).then(() => {
                qc.invalidateQueries({ queryKey: [...QK.agents(), agentId] });
                qc.invalidateQueries({ queryKey: QK.agents() });
              });
            }
          }}
          className={cn(
            'relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none',
            enabled ? 'bg-indigo-500' : 'bg-[var(--color-bg-hover)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
              enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={showDropdown ? "overflow-visible" : "overflow-hidden"}
          >
            <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
              Select libraries for the agent to search through when answering questions.
            </p>

            {/* Selected Libraries Chips */}
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selectedIds.map(id => {
                  const lib = libraries.find(l => l.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)] text-[10px] text-indigo-400 font-medium"
                    >
                      {lib?.name || id.slice(0, 8)}
                      <button
                        onClick={() => toggleLibrary(id)}
                        className="hover:text-white transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Library Multi-Select Dropdown */}
            <div className="relative mb-3">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="w-full minimal-input rounded-md px-3 py-2 text-sm text-left flex items-center justify-between"
              >
                <span className={selectedIds.length === 0 ? 'text-[var(--color-text-muted)]' : 'text-white'}>
                  {selectedIds.length === 0
                    ? 'Select libraries…'
                    : `${selectedIds.length} ${selectedIds.length === 1 ? 'library' : 'libraries'} selected`}
                </span>
                <ChevronDown
                  size={16}
                  className={cn('text-[var(--color-text-muted)] transition-transform duration-200', showDropdown ? 'rotate-180' : '')}
                />
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setShowDropdown(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-20 mt-1 w-full bg-[#121824] border border-[var(--color-border-subtle)] rounded-lg shadow-2xl overflow-hidden py-1 max-h-48 overflow-y-auto custom-scrollbar"
                    >
                      {libraries.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center italic">
                          No libraries available. Create one first.
                        </div>
                      ) : (
                        libraries.map(lib => {
                          const isSelected = selectedIds.includes(lib.id);
                          return (
                            <button
                              key={lib.id}
                              onClick={() => toggleLibrary(lib.id)}
                              className={cn(
                                'w-full px-3 py-2.5 text-left text-sm flex items-center gap-3 hover:bg-[var(--color-bg-hover)] transition-colors',
                                isSelected ? 'bg-[rgba(99,102,241,0.1)]' : '',
                              )}
                            >
                              <div
                                className={cn(
                                  'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                  isSelected
                                    ? 'bg-indigo-500 border-indigo-500'
                                    : 'border-[var(--color-border-subtle)]',
                                )}
                              >
                                {isSelected && <Check size={10} className="text-white" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-[var(--color-text-primary)] font-medium block truncate">
                                  {lib.name}
                                </span>
                                {lib.description && (
                                  <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
                                    {lib.description}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] shrink-0">
                                {lib.document_count ?? 0} docs
                              </span>
                            </button>
                          );
                        })
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Save Button */}
            {hasLibChanges && (
              <motion.button
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || (enabled && selectedIds.length === 0)}
                className="w-full btn-primary px-3 py-2 text-xs rounded-md flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Save size={12} />
                {saveMut.isPending ? 'Saving…' : 'Save Document Library'}
              </motion.button>
            )}
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
