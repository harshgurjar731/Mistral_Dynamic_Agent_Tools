import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Server, Wrench, Play, ChevronDown, Copy, Check, FlaskConical } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { mcpApi } from '../../api/mcp';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

export default function McpServerDetail() {
  const { serverName } = useParams<{ serverName: string }>();
  const navigate = useNavigate();
  const decodedName = decodeURIComponent(serverName ?? '');
  const [tab, setTab] = useState<'tools' | 'playground'>('tools');

  const { data: servers = [] } = useQuery({
    queryKey: QK.mcpServers(),
    queryFn: () => mcpApi.listServers().then(r => Array.isArray(r.data) ? r.data : r.data.servers ?? []),
  });

  const server = servers.find((s: Record<string, unknown>) => s.name === decodedName);

  const { data: toolsData, isLoading: toolsLoading } = useQuery({
    queryKey: QK.mcpServerTools(decodedName),
    queryFn: () => mcpApi.getServerTools(decodedName).then(r => r.data),
    enabled: !!decodedName,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const tools: MCPTool[] = toolsData?.tools ?? [];

  const tabs = [
    { key: 'tools' as const, label: 'Tools', icon: Wrench },
    { key: 'playground' as const, label: 'Test Playground', icon: FlaskConical },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/mcp')}
        className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-white transition-colors mb-6"
      >
        <ArrowLeft size={16} /> Back to MCP Servers
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center">
          <Server size={20} className="text-indigo-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">{decodedName}</h1>
          {server?.url && (
            <p className="text-sm text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] mt-0.5">{String(server.url)}</p>
          )}
        </div>
        {server && (
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium",
            server.healthy
              ? "bg-[rgba(16,185,129,0.1)] border-[rgba(16,185,129,0.2)] text-[var(--color-accent-success)]"
              : "bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)] text-red-400"
          )}>
            <span className={cn("w-2 h-2 rounded-full", server.healthy ? "bg-emerald-400" : "bg-red-400")} />
            {server.healthy ? 'Healthy' : 'Unreachable'}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit mb-8">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'relative px-4 py-1.5 text-sm font-medium rounded-md transition-colors z-10 flex items-center gap-2',
              tab === t.key ? 'text-[var(--color-bg-base)]' : 'text-[var(--color-text-muted)] hover:text-white'
            )}
          >
            {tab === t.key && (
              <motion.div
                layoutId="mcp-detail-tab"
                className="absolute inset-0 bg-white rounded-md"
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{ zIndex: -1 }}
              />
            )}
            <t.icon size={14} />
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
          {tab === 'tools' && <ToolsTab tools={tools} loading={toolsLoading} />}
          {tab === 'playground' && <PlaygroundTab tools={tools} serverName={decodedName} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}


function ToolsTab({ tools, loading }: { tools: MCPTool[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="surface-card rounded-xl p-5 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-[var(--color-bg-hover)]" />
                <div className="h-3 w-2/3 rounded bg-[var(--color-bg-hover)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[300px] gap-4 bg-[rgba(15,20,28,0.4)] backdrop-blur-xl border border-[rgba(255,255,255,0.05)]"
      >
        <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mb-2">
          <Wrench size={28} className="text-[var(--color-text-muted)]" />
        </div>
        <p className="text-base font-semibold text-[var(--color-text-primary)]">No tools discovered</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm">This server doesn't expose any MCP tools, or it may be unreachable.</p>
      </motion.div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
      {tools.map((tool) => (
        <motion.div
          key={tool.name}
          variants={itemVariants}
          className="surface-card rounded-xl overflow-hidden"
        >
          <div
            className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors"
            onClick={() => setExpanded(expanded === tool.name ? null : tool.name)}
          >
            <div className="w-8 h-8 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Wrench size={14} className="text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-[family-name:var(--font-mono)] text-sm font-medium text-[var(--color-text-primary)] block">{tool.name}</span>
              {tool.description && (
                <span className="text-xs text-[var(--color-text-secondary)] block mt-0.5 line-clamp-1">{tool.description}</span>
              )}
            </div>
            <ChevronDown
              size={16}
              className={cn(
                "text-[var(--color-text-muted)] transition-transform",
                expanded === tool.name && "rotate-180"
              )}
            />
          </div>

          <AnimatePresence>
            {expanded === tool.name && tool.inputSchema && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 pt-2 border-t border-[var(--color-border-subtle)]">
                  <h4 className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2">Input Schema</h4>
                  <div className="bg-[#000000] border border-[var(--color-border-subtle)] rounded-lg overflow-hidden text-xs">
                    <SyntaxHighlighter
                      language="json"
                      style={vscDarkPlus}
                      customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}
                    >
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </motion.div>
  );
}


function PlaygroundTab({ tools, serverName }: { tools: MCPTool[]; serverName: string }) {
  const [selectedTool, setSelectedTool] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [copied, setCopied] = useState(false);

  const executeMut = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(argsText);
      return mcpApi.execute(serverName, selectedTool, parsed).then(r => r.data);
    },
  });

  const resultText = executeMut.data
    ? JSON.stringify(executeMut.data, null, 2)
    : executeMut.error
    ? `Error: ${(executeMut.error as Error).message}`
    : null;

  const handleCopy = () => {
    if (resultText) {
      navigator.clipboard.writeText(resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Populate default args from schema when tool is selected
  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName);
    executeMut.reset();
    const tool = tools.find(t => t.name === toolName);
    if (tool?.inputSchema) {
      const props = (tool.inputSchema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        const defaults: Record<string, string> = {};
        Object.keys(props).forEach(k => {
          const type = props[k]?.type;
          if (type === 'string') defaults[k] = '';
          else if (type === 'number' || type === 'integer') defaults[k] = '0' as unknown as string;
          else if (type === 'boolean') defaults[k] = 'false' as unknown as string;
          else defaults[k] = '' as unknown as string;
        });
        setArgsText(JSON.stringify(defaults, null, 2));
      } else {
        setArgsText('{}');
      }
    } else {
      setArgsText('{}');
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="surface-card rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Play size={14} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text-primary)]">Tool Test Playground</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Execute MCP tools with custom arguments and inspect results.</p>
          </div>
        </div>

        {/* Tool selector */}
        <div className="mb-5">
          <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Select Tool</label>
          <select
            value={selectedTool}
            onChange={e => handleToolSelect(e.target.value)}
            className="w-full minimal-input rounded-md px-3 py-2.5 text-sm bg-[var(--color-bg-base)] cursor-pointer"
          >
            <option value="">— Choose a tool —</option>
            {tools.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Args editor */}
        <div className="mb-5">
          <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Arguments (JSON)</label>
          <textarea
            value={argsText}
            onChange={e => setArgsText(e.target.value)}
            rows={6}
            className="w-full minimal-input font-mono rounded-md px-4 py-3 text-xs resize-none focus:bg-[var(--color-bg-hover)] whitespace-pre"
            placeholder='{ "key": "value" }'
          />
        </div>

        {/* Execute button */}
        <button
          onClick={() => executeMut.mutate()}
          disabled={!selectedTool || executeMut.isPending}
          className="w-full btn-primary px-4 py-2.5 text-sm rounded-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Play size={16} />
          {executeMut.isPending ? 'Executing...' : 'Execute Tool'}
        </button>
      </div>

      {/* Result */}
      <AnimatePresence>
        {resultText && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 surface-card rounded-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Result</span>
              <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-white transition-colors">
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="bg-[#000000] text-xs overflow-auto max-h-[400px] custom-scrollbar">
              <SyntaxHighlighter
                language="json"
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent' }}
              >
                {resultText}
              </SyntaxHighlighter>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
