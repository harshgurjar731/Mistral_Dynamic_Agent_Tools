import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatSession, Message } from "@/types";

interface SessionState {
  sessions: ChatSession[];
  createSession: (type: ChatSession["type"], agentId?: string | null) => string;
  removeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setConversationId: (id: string, conversationId: string) => void;
  appendMessage: (id: string, message: Message) => void;
  updateMessage: (id: string, messageId: string, patch: Partial<Message>) => void;
  clearMessages: (id: string) => void;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessions: [],
      createSession: (type, agentId = null) => {
        const id = newId();
        const session: ChatSession = {
          id,
          type,
          agentId,
          conversationId: null,
          title: type === "agent" ? "Agent session" : "New session",
          messages: [],
          updatedAt: Date.now(),
        };
        set((s) => ({ sessions: [session, ...s.sessions] }));
        return id;
      },
      removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
      renameSession: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, title, updatedAt: Date.now() } : x)),
        })),
      setConversationId: (id, conversationId) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, conversationId } : x)),
        })),
      appendMessage: (id, message) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  messages: [...x.messages, message],
                  title:
                    x.messages.length === 0 && message.role === "user"
                      ? message.content.slice(0, 48) || x.title
                      : x.title,
                  updatedAt: Date.now(),
                }
              : x,
          ),
        })),
      updateMessage: (id, messageId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  messages: x.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
                  updatedAt: Date.now(),
                }
              : x,
          ),
        })),
      clearMessages: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, messages: [] } : x)),
        })),
    }),
    { name: "mistral-chat-sessions" },
  ),
);
