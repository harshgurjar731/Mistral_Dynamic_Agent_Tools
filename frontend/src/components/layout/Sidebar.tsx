import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BotMessageSquare, Wrench, GitBranch, MessageSquare,
  Server, Activity, Cpu, ChevronLeft, Sparkles, Terminal, ChevronDown, Plus, MessageCircle, Trash2, Edit2, Check
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useState, useMemo } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { QK } from '../../lib/queryClient';

const NAV = [
  { to: '/',              icon: BotMessageSquare, label: 'Orchestrator' },
  { to: '/playground',    icon: Terminal,         label: 'Playground', expandable: true, type: 'general' },
  { to: '/agents',        icon: Cpu,              label: 'Agents', expandable: true, type: 'agent' },
  { to: '/tools',         icon: Wrench,           label: 'Tools' },
  { to: '/workflows',     icon: GitBranch,        label: 'Workflows' },
  { to: '/conversations', icon: MessageSquare,    label: 'Conversations' },
  { to: '/mcp',           icon: Server,           label: 'MCP Servers' },
  { to: '/health',        icon: Activity,         label: 'Health' },
] as const;

export default function Sidebar({ mobileMenuOpen, setMobileMenuOpen }: { mobileMenuOpen?: boolean, setMobileMenuOpen?: (open: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({
    '/playground': true,
    '/agents': true
  });
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  
  const location = useLocation();
  const navigate = useNavigate();

  const { sessions, activeSessionId, switchSession, createSession, deleteSession, renameSession } = useSessionStore();
  
  const { data = { items: [] } } = useQuery({
    queryKey: QK.agents(),
    queryFn: () => agentsApi.list().then(r => r.data),
  });
  const agents = Array.from(new Map((data.items || []).map((a: any) => [a.id, a])).values()) as any[];

  const generalSessions = useMemo(() => {
    return Object.values(sessions)
      .filter(s => s.type === 'general')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions]);

  const toggleNav = (to: string) => {
    setExpandedNav(prev => ({ ...prev, [to]: !prev[to] }));
  };

  const toggleAgent = (id: string) => {
    setExpandedAgents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSessionClick = (id: string, e: React.MouseEvent, type: 'general' | 'agent', agentId?: string) => {
    e.stopPropagation();
    switchSession(id);
    if (type === 'general') {
      navigate('/playground');
    } else if (type === 'agent' && agentId) {
      navigate(`/agents/${agentId}`);
    }
  };

  const SessionItem = ({ session, type, agentId }: { session: any, type: 'general'|'agent', agentId?: string }) => {
    const isActive = activeSessionId === session.id && (
      (type === 'general' && location.pathname.startsWith('/playground')) ||
      (type === 'agent' && location.pathname === `/agents/${agentId}`)
    );
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(session.title);

    const handleRename = () => {
      if (editTitle.trim() && editTitle !== session.title) {
        renameSession(session.id, editTitle.trim());
      }
      setIsEditing(false);
    };

    return (
      <div 
        onClick={(e) => handleSessionClick(session.id, e, type, agentId)}
        className={cn(
          "group flex items-center justify-between px-3 py-1.5 mx-2 rounded-md text-sm cursor-pointer transition-colors",
          isActive ? "bg-[var(--color-bg-hover)] text-white font-medium" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[rgba(255,255,255,0.02)]"
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessageCircle size={14} className="flex-shrink-0 opacity-70" />
          {isEditing ? (
            <input 
              autoFocus
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setEditTitle(session.title); setIsEditing(false); } }}
              className="bg-[var(--color-bg-surface)] text-white text-xs px-1.5 py-0.5 rounded outline-none border border-[var(--color-border-focus)] w-full"
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="truncate text-xs">{session.title}</span>
          )}
        </div>
        
        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-1 rounded text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-surface)]">
              <Edit2 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }} className="p-1 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-[var(--color-bg-surface)]">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen?.(false)}
            className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>
      <motion.aside
        layout
        className={cn(
          'flex flex-col flex-shrink-0 z-50',
          'bg-[var(--color-bg-base)] md:bg-transparent border-r border-[var(--color-border-subtle)]',
          'fixed inset-y-0 left-0 md:relative',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
        initial={false}
        animate={{ width: collapsed ? 72 : 280 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center flex-shrink-0">
            <Sparkles size={14} className="text-black" />
          </div>
          {!collapsed && (
            <motion.span 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-bold text-sm tracking-tight text-white whitespace-nowrap"
            >
              MISTRAL
            </motion.span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="absolute top-14 right-[-12px] p-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-muted)] hover:text-white z-50 transform translate-y-2"
        >
          <ChevronLeft size={12} className="rotate-180" />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
        {NAV.map((navItem) => {
          const { to, icon: Icon, label, expandable, type } = navItem;
          const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          const isExpanded = expandedNav[to];
          
          return (
            <div key={to} className="flex flex-col">
              <div className="flex items-center relative">
                <NavLink
                  to={to}
                  className={cn(
                    'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors group relative',
                    isActive ? 'text-white' : 'text-[var(--color-text-muted)] hover:text-white hover:bg-[rgba(255,255,255,0.02)]'
                  )}
                >
                  {isActive && !expandable && (
                    <motion.div layoutId="sidebar-active-indicator" className="absolute inset-0 bg-[var(--color-bg-hover)] rounded-md border border-[rgba(255,255,255,0.05)]" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                  )}
                  <Icon size={16} className={cn('relative z-10', isActive ? 'text-white' : 'text-[var(--color-text-muted)] group-hover:text-white')} />
                  {!collapsed && <span className="relative z-10 font-medium whitespace-nowrap">{label}</span>}
                </NavLink>

                {!collapsed && expandable && (
                  <button 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleNav(to); }}
                    className="absolute right-2 p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-white z-10 transition-colors"
                  >
                    <ChevronDown size={14} className={cn("transition-transform duration-200", isExpanded ? "rotate-180" : "")} />
                  </button>
                )}
              </div>

              {/* Sub-sections */}
              <AnimatePresence>
                {!collapsed && expandable && isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pl-4 py-1 space-y-1 relative before:content-[''] before:absolute before:left-5 before:top-0 before:bottom-0 before:w-[1px] before:bg-[var(--color-border-subtle)]">
                      {/* General Sessions */}
                      {type === 'general' && (
                        <div className="py-1">
                          <div className="flex items-center justify-between px-3 mb-1">
                            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider pl-4">Chats</span>
                            <button 
                              onClick={() => { const id = createSession('general'); switchSession(id); navigate('/playground'); }}
                              className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-white"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          {generalSessions.map(session => (
                            <div className="pl-4" key={session.id}>
                              <SessionItem session={session} type="general" />
                            </div>
                          ))}
                          {generalSessions.length === 0 && (
                            <div className="pl-7 pr-3 py-1 text-xs text-[var(--color-text-muted)] italic">No recent chats</div>
                          )}
                        </div>
                      )}

                      {/* Agents & their Sessions */}
                      {type === 'agent' && (
                        <div className="py-1">
                          <div className="flex items-center justify-between px-3 mb-1">
                            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider pl-4">Active Agents</span>
                            <button onClick={() => navigate('/agents')} className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-white">
                              <Plus size={12} />
                            </button>
                          </div>
                          {agents.length === 0 && (
                            <div className="pl-7 pr-3 py-1 text-xs text-[var(--color-text-muted)] italic">No agents created</div>
                          )}
                          <div className="max-h-[40vh] overflow-y-auto custom-scrollbar">
                          {agents.map(agent => {
                            const isAgentExpanded = expandedAgents[agent.id];
                            const agentSessions = Object.values(sessions)
                              .filter(s => s.type === 'agent' && s.agentId === agent.id)
                              .sort((a, b) => b.updatedAt - a.updatedAt);
                            
                            return (
                              <div key={agent.id} className="mb-1 pl-4">
                                <div className="flex items-center justify-between pr-2 group">
                                  <NavLink 
                                    to={`/agents/${agent.id}`}
                                    className={({ isActive }) => cn(
                                      "flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                                      isActive ? "text-white bg-[rgba(255,255,255,0.05)] font-medium" : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.02)]"
                                    )}
                                  >
                                    <Cpu size={12} className="opacity-70" />
                                    <span className="truncate">{agent.name}</span>
                                  </NavLink>
                                  <button 
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAgent(agent.id); }}
                                    className="p-1 rounded text-[var(--color-text-muted)] hover:text-white opacity-0 group-hover:opacity-100"
                                  >
                                    <ChevronDown size={12} className={cn("transition-transform", isAgentExpanded ? "rotate-180" : "")} />
                                  </button>
                                </div>
                                
                                <AnimatePresence>
                                  {isAgentExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden mt-1 pl-3 border-l border-[rgba(255,255,255,0.05)] ml-5 max-h-[30vh] overflow-y-auto custom-scrollbar"
                                    >
                                      <div className="flex items-center justify-between px-2 mb-1">
                                        <span className="text-[9px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Sessions</span>
                                        <button 
                                          onClick={() => { const id = createSession('agent', agent.id); switchSession(id); navigate(`/agents/${agent.id}`); }}
                                          className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-white"
                                        >
                                          <Plus size={10} />
                                        </button>
                                      </div>
                                      {agentSessions.map(session => (
                                        <div key={session.id} className="-ml-2">
                                           <SessionItem session={session} type="agent" agentId={agent.id} />
                                        </div>
                                      ))}
                                      {agentSessions.length === 0 && (
                                        <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] italic">No sessions</div>
                                      )}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-4 border-t border-[var(--color-border-subtle)]">
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--color-text-muted)] hover:text-white transition-colors flex items-center gap-2"
          >
            API Docs ↗
          </a>
        </div>
      )}
    </motion.aside>
    </>
  );
}
