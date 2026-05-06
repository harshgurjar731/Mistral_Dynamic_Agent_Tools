import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MessageSquare, Trash2, Clock, ArrowRight } from 'lucide-react';
import { conversationsApi } from '../../api/conversations';
import { QK } from '../../lib/queryClient';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export default function ConversationManager() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QK.conversations(),
    queryFn: () => conversationsApi.list().then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : d.conversations ?? d.data ?? [];
    }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => conversationsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.conversations() }),
  });

  const conversations = data ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Conversations</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">View and manage conversation threads.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="surface-card rounded-xl px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-[var(--color-bg-hover)]" />
                <div className="h-3 w-1/4 rounded bg-[var(--color-bg-hover)]" />
              </div>
              <div className="flex gap-2 shrink-0">
                <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)]" />
                <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)]" />
              </div>
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-20 border border-dashed border-[var(--color-border-subtle)] rounded-xl flex flex-col items-center gap-4 bg-[var(--color-bg-surface)]"
        >
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mb-2">
            <MessageSquare size={28} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No conversations found</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">Start chatting with an agent from the Agent Studio to create a conversation.</p>
          </div>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
          {conversations.map((conv: Record<string, unknown>) => (
            <motion.div key={String(conv.id)} variants={itemVariants} className="surface-card rounded-xl px-5 py-4 flex items-center gap-4 group">
              <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center flex-shrink-0">
                <MessageSquare size={14} className="text-[var(--color-text-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-[family-name:var(--font-mono)] text-[var(--color-text-primary)] truncate">{String(conv.id)}</p>
                <div className="flex items-center gap-3 mt-1">
                  {conv.model && <span className="text-[10px] text-[var(--color-text-secondary)] font-medium uppercase tracking-wider">{String(conv.model)}</span>}
                  {conv.created_at && (
                    <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 font-[family-name:var(--font-mono)]">
                      <Clock size={10} />{new Date(String(conv.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
                  <ArrowRight size={14} />
                </button>
                <button onClick={() => deleteMut.mutate(String(conv.id))} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-accent-danger)] transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
