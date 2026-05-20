import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Settings, Sparkles } from 'lucide-react';
import { chatApi } from '../../api/chat';
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

  // Settings
  const [model, setModel] = useState('default-large-latest');
  const [temperature, setTemperature] = useState(0.7);
  const [safePrompt, setSafePrompt] = useState(false);

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
    if (!input.trim() || !activeSessionId) return;
    const q = input.trim();
    setInput('');
    addMessage({ id: crypto.randomUUID(), role: 'user', content: q });
    setStreaming(true);

    const messages = activeSession!.messages.map(m => ({ role: m.role, content: m.content }));
    messages.push({ role: 'user', content: q });

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
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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
            <div className="surface-card rounded-xl flex items-end focus-within:border-[var(--color-border-focus)] focus-within:ring-1 focus-within:ring-[var(--color-border-focus)] transition-all shadow-xl">
              <textarea
                value={input}
                onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Type your message..."
                rows={1}
                className="w-full bg-transparent px-4 py-4 text-sm text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none min-h-[56px] custom-scrollbar"
              />
              <div className="p-2 shrink-0">
                <button 
                  onClick={handleSubmit} 
                  disabled={!input.trim()} 
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
                    <option value="default-large-latest" className="bg-[var(--color-bg-surface)] text-white">default-large-latest</option>
                    <option value="default-small-latest" className="bg-[var(--color-bg-surface)] text-white">default-small-latest</option>
                    <option value="open-default-nemo" className="bg-[var(--color-bg-surface)] text-white">open-default-nemo</option>
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
