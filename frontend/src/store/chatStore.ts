import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  streaming?: boolean;
  timestamp?: string;
}

interface ChatStore {
  messages:        Message[];
  conversationId:  string | null;
  selectedAgentId: string | null;
  mode:            'orchestrate' | 'direct';
  streaming:       boolean;
  appendChunk:     (chunk: string) => void;
  addMessage:      (msg: Message) => void;
  setConversation: (id: string | null) => void;
  setAgent:        (id: string | null) => void;
  setMode:         (m: 'orchestrate' | 'direct') => void;
  setStreaming:     (v: boolean) => void;
  finalizeStreaming: () => void;
  reset:           () => void;
}

export const useChatStore = create<ChatStore>()((set) => ({
  messages:        [],
  conversationId:  null,
  selectedAgentId: null,
  mode:            'orchestrate',
  streaming:       false,
  appendChunk: (chunk) => set((s) => {
    const last = s.messages[s.messages.length - 1];
    if (last?.role === 'assistant' && last?.streaming) {
      return {
        messages: [
          ...s.messages.slice(0, -1),
          { ...last, content: last.content + chunk },
        ],
      };
    }
    return {
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'assistant', content: chunk, streaming: true }],
    };
  }),
  addMessage:      (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setConversation: (id)  => set({ conversationId: id }),
  setAgent:        (id)  => set({ selectedAgentId: id }),
  setMode:         (m)   => set({ mode: m }),
  setStreaming:     (v)   => set({ streaming: v }),
  finalizeStreaming: () => set((s) => ({
    messages: s.messages.map((m) => m.streaming ? { ...m, streaming: false } : m),
  })),
  reset: () => set({ messages: [], conversationId: null, streaming: false }),
}));
