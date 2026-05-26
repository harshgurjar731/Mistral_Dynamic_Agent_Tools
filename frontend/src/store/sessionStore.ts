import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  streaming?: boolean;
  timestamp?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageMime?: string;
}

export interface ChatSession {
  id: string;
  type: 'general' | 'agent';
  agentId?: string | null;
  conversationId?: string | null; // Mistral backend conversation ID
  title: string;
  messages: Message[];
  updatedAt: number;
}

interface SessionStore {
  sessions: Record<string, ChatSession>;
  activeSessionId: string | null;
  
  // Actions
  createSession: (type: 'general' | 'agent', agentId?: string | null, conversationId?: string | null) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  
  // Message actions for active session
  addMessage: (msg: Message) => void;
  appendChunk: (chunk: string) => void;
  setStreaming: (v: boolean) => void;
  finalizeStreaming: () => void;
  setConversationId: (conversationId: string) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: {},
      activeSessionId: null,

      createSession: (type, agentId = null, conversationId = null) => {
        const id = crypto.randomUUID();
        const newSession: ChatSession = {
          id,
          type,
          agentId,
          conversationId,
          title: 'New Chat',
          messages: [],
          updatedAt: Date.now(),
        };
        set((state) => ({
          sessions: { ...state.sessions, [id]: newSession },
          activeSessionId: id,
        }));
        return id;
      },

      switchSession: (id) => set({ activeSessionId: id }),

      deleteSession: (id) => set((state) => {
        const { [id]: _, ...rest } = state.sessions;
        return {
          sessions: rest,
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        };
      }),

      renameSession: (id, title) => set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: { ...state.sessions[id], title, updatedAt: Date.now() }
        }
      })),

      addMessage: (msg) => set((state) => {
        const id = state.activeSessionId;
        if (!id) return state;
        const session = state.sessions[id];
        
        // Auto-generate title from first user message if it's "New Chat"
        let title = session.title;
        if (session.messages.length === 0 && msg.role === 'user') {
            title = msg.content.slice(0, 30) + (msg.content.length > 30 ? '...' : '');
        }

        return {
          sessions: {
            ...state.sessions,
            [id]: { 
                ...session, 
                title,
                messages: [...session.messages, { ...msg, timestamp: new Date().toISOString() }],
                updatedAt: Date.now()
            }
          }
        };
      }),

      appendChunk: (chunk) => set((state) => {
        const id = state.activeSessionId;
        if (!id) return state;
        const session = state.sessions[id];
        const last = session.messages[session.messages.length - 1];

        if (last?.role === 'assistant' && last?.streaming) {
          const updatedMessages = [
            ...session.messages.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
          return {
            sessions: {
              ...state.sessions,
              [id]: { ...session, messages: updatedMessages, updatedAt: Date.now() }
            }
          };
        }

        const newMessages: Message[] = [...session.messages, { 
            id: crypto.randomUUID(), 
            role: 'assistant' as const, 
            content: chunk, 
            streaming: true,
            timestamp: new Date().toISOString()
        }];

        return {
          sessions: {
            ...state.sessions,
            [id]: { ...session, messages: newMessages, updatedAt: Date.now() }
          }
        };
      }),

      setStreaming: (v) => set((state) => {
        const id = state.activeSessionId;
        if (!id) return state;
        const session = state.sessions[id];
        // If false, finalize all
        if (!v) {
            const finalMessages = session.messages.map(m => m.streaming ? { ...m, streaming: false } : m);
            return { sessions: { ...state.sessions, [id]: { ...session, messages: finalMessages } } };
        }
        return state;
      }),

      finalizeStreaming: () => set((state) => {
        const id = state.activeSessionId;
        if (!id) return state;
        const session = state.sessions[id];
        const finalMessages = session.messages.map(m => m.streaming ? { ...m, streaming: false } : m);
        return { sessions: { ...state.sessions, [id]: { ...session, messages: finalMessages } } };
      }),

      setConversationId: (conversationId) => set((state) => {
        const id = state.activeSessionId;
        if (!id) return state;
        const session = state.sessions[id];
        return {
          sessions: {
            ...state.sessions,
            [id]: { ...session, conversationId, updatedAt: Date.now() }
          }
        };
      }),
    }),
    {
      name: 'mistral-chat-sessions',
    }
  )
);
