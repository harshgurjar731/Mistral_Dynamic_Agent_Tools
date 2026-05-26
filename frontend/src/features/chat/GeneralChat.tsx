import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Settings, Sparkles, Paperclip, X } from 'lucide-react';
import { chatApi } from '../../api/chat';
import { uploadsApi } from '../../api/uploads';
import { useSessionStore } from '../../store/sessionStore';

import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../../lib/utils';

export default function GeneralChat() {
  const { sessions, activeSessionId, createSession, addMessage, appendChunk, setStreaming, finalizeStreaming } = useSessionStore();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Settings
  const [model, setModel] = useState('mistral-large-latest');
  const [temperature, setTemperature] = useState(0.7);
  const [safePrompt, setSafePrompt] = useState(false);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearPendingImage = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage(null);
    }
  };

  const activeSession = activeSessionId ? sessions[activeSessionId] : null;

  useEffect(() => {
    if (!activeSessionId) {
      createSession('general');
    }
  }, [activeSessionId, createSession]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  const handleSubmit = async () => {
    if ((!input.trim() && !pendingImage) || !activeSessionId || isUploading) return;
    const q = input.trim() || (pendingImage ? 'Analyze this image' : '');
    const currentImage = pendingImage;
    setInput('');
    clearPendingImage();

    let imageBase64: string | undefined;
    let imageMime: string | undefined;

    // Upload image first if present
    if (currentImage) {
      try {
        setIsUploading(true);
        const res = await uploadsApi.uploadImage(currentImage.file);
        imageBase64 = res.data.image_base64;
        imageMime = res.data.image_mime;
        setIsUploading(false);
      } catch (err) {
        setIsUploading(false);
        setStreaming(true);
        appendChunk('\n\n**Upload Error:** Failed to upload image. Please try again.');
        finalizeStreaming();
        return;
      }
    }

    const userMsg: any = { id: crypto.randomUUID(), role: 'user', content: q };
    if (currentImage) {
      userMsg.imageUrl = currentImage.previewUrl;
      userMsg.imageBase64 = imageBase64;
      userMsg.imageMime = imageMime;
    }
    addMessage(userMsg);
    setStreaming(true);

    const messages = activeSession!.messages.map(m => {
      if (m.imageBase64 && m.imageMime) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.imageMime};base64,${m.imageBase64}` } }
          ]
        };
      }
      return { role: m.role, content: m.content };
    });

    if (imageBase64 && imageMime) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: q },
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } }
        ] as any
      });
    } else {
      messages.push({ role: 'user', content: q });
    }

    try {
      chatApi.stream(
        {
          model,
          messages,
          temperature,
          safe_prompt: safePrompt,
        },
        (event) => {
          if (event.type === 'text_chunk') appendChunk(event.data.replace(/\\n/g, '\n'));
          if (event.type === 'error') appendChunk('\n\n**System Error:** ' + event.data);
        },
        () => finalizeStreaming()
      );
    } catch (e) {
      appendChunk('\n\n**Error:** ' + String(e));
      finalizeStreaming();
    }
  };

  return (
    <div className="flex w-full h-full flex-col md:flex-row overflow-hidden bg-transparent">
      <div className="flex flex-col flex-1 relative min-w-0">
        {/* Header */}
        <header className="h-14 px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between shrink-0 bg-transparent z-10 sticky top-0">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">Playground (Chat Completions)</span>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className={cn("p-2 rounded-md transition-colors", showSettings ? "bg-[var(--color-bg-hover)] text-white" : "text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)]")}>
            <Settings size={16} />
          </button>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <Sparkles size={32} className="mb-4 text-[var(--color-text-muted)]" />
              <h2 className="text-lg font-medium text-white mb-1">Standard Chat</h2>
              <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Chat directly with standard AI models without dynamic agent wrappers or tool synthesis.</p>
            </div>
          )}

          {activeSession?.messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[80%] rounded-2xl px-5 py-3 text-sm",
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
                id="playground-image-upload"
              />
              <textarea
                value={input}
                onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder={isUploading ? "Uploading image..." : "Type your message..."}
                rows={1}
                className="w-full bg-transparent px-4 py-4 text-sm text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none min-h-[56px] custom-scrollbar"
                disabled={isUploading}
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
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex flex-col overflow-hidden whitespace-nowrap shrink-0"
          >
            <div className="p-6 w-[300px]">
              <h3 className="text-sm font-semibold text-white mb-6 tracking-tight">Chat Settings</h3>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)} className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    <option value="mistral-large-latest" className="bg-[var(--color-bg-surface)] text-white">mistral-large-latest</option>
                    <option value="mistral-small-latest" className="bg-[var(--color-bg-surface)] text-white">mistral-small-latest</option>
                    <option value="open-mistral-nemo" className="bg-[var(--color-bg-surface)] text-white">open-mistral-nemo</option>
                    <option value="codestral-latest" className="bg-[var(--color-bg-surface)] text-white">codestral-latest</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">
                    Temperature: {temperature.toFixed(2)}
                  </label>
                  <input type="range" min="0" max="1" step="0.01" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} className="w-full accent-white" />
                </div>

                <div className="flex items-center gap-3">
                  <input type="checkbox" id="safeprompt" checked={safePrompt} onChange={e => setSafePrompt(e.target.checked)} className="rounded border-[var(--color-border-subtle)] bg-transparent accent-white w-4 h-4" />
                  <label htmlFor="safeprompt" className="text-sm text-[var(--color-text-secondary)]">Enable Safe Prompt</label>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
