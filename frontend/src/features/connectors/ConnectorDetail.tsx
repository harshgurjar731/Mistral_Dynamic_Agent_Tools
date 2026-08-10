/**
 * ConnectorDetail — inspect one connector: its tools, its authentication state,
 * and its stored credentials.
 *
 * The tool list is the useful part: it is what an attached agent can call, and
 * what a workflow connector step picks from. "Run" invokes the tool through the
 * platform, which is the fastest way to confirm credentials actually work
 * before wiring the connector into a workflow.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, ExternalLink, Key, Loader2, Play, Plug, Trash2, Wrench,
} from 'lucide-react';
import { connectorsApi, type ConnectorTool } from '../../api/connectors';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import { AuthBadge } from './ConnectorRegistry';

export default function ConnectorDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [tokenName, setTokenName] = useState('default');
  const [tokenValue, setTokenValue] = useState('');

  const { data: connector, isLoading } = useQuery({
    queryKey: QK.connector(id),
    queryFn: () => connectorsApi.get(id).then((r) => r.data),
    enabled: Boolean(id),
  });

  const { data: toolData, isLoading: toolsLoading } = useQuery({
    queryKey: QK.connectorTools(id),
    queryFn: () => connectorsApi.tools(id).then((r) => r.data),
    enabled: Boolean(id),
  });

  const { data: credData } = useQuery({
    queryKey: QK.connectorCreds(id),
    queryFn: () => connectorsApi.listCredentials(id).then((r) => r.data),
    enabled: Boolean(id),
  });

  // The OAuth URL is short-lived, so it is fetched on click rather than with
  // the page and opened immediately.
  const authMut = useMutation({
    mutationFn: () => connectorsApi.authUrl(id).then((r) => r.data),
    onSuccess: (data) => {
      if (data.auth_url) window.open(data.auth_url, '_blank', 'noopener');
    },
  });

  const saveTokenMut = useMutation({
    mutationFn: () =>
      connectorsApi.setCredentials(id, {
        name: tokenName.trim() || 'default',
        credentials: { bearer_token: tokenValue.trim() },
        is_default: true,
      }),
    onSuccess: () => {
      setTokenValue('');
      qc.invalidateQueries({ queryKey: QK.connectorCreds(id) });
      qc.invalidateQueries({ queryKey: QK.connector(id) });
    },
  });

  const deleteCredMut = useMutation({
    mutationFn: (name: string) => connectorsApi.deleteCredentials(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.connectorCreds(id) }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] p-8 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Loading connector…
      </div>
    );
  }

  if (!connector) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Link to="/connectors" className="text-sm text-[var(--color-text-muted)] hover:text-white">
          ← Back to connectors
        </Link>
        <p className="mt-6 text-sm text-red-300">Connector not found.</p>
      </div>
    );
  }

  const tools = toolData?.tools ?? [];
  const credentials = credData?.credentials ?? [];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link
        to="/connectors"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-white transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Connectors
      </Link>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0 overflow-hidden">
          {connector.icon_url ? (
            <img src={connector.icon_url} alt="" className="w-7 h-7 object-contain" />
          ) : (
            <Plug size={20} className="text-[var(--color-text-muted)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-white">{connector.name}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {connector.description || 'No description.'}
          </p>
          {connector.server && (
            <p className="text-xs font-mono text-[var(--color-text-muted)] mt-2 truncate">
              {connector.server}
            </p>
          )}
        </div>
        <AuthBadge connector={connector} />
      </div>

      {/* ── Authentication ───────────────────────────────────────────────── */}
      <Section title="Authentication" icon={<Key size={13} />}>
        {connector.is_authenticated ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            This connector is authenticated and ready to use.
          </p>
        ) : (
          <p className="text-sm text-amber-300/90 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            Not authenticated. Agents and workflow steps using this connector will fail until
            credentials are in place.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            onClick={() => authMut.mutate()}
            disabled={authMut.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white text-[var(--color-bg-base)] text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {authMut.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ExternalLink size={12} />
            )}
            Connect with OAuth
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Opens Mistral's authorisation page. Complete it within 10 minutes.
          </span>
        </div>

        {authMut.isError && (
          <p className="mt-2 text-xs text-red-400">
            {(authMut.error as any)?.response?.data?.message ??
              'This connector does not offer an OAuth flow.'}
          </p>
        )}

        {/* Bearer tokens have no on-the-fly auth — they must be stored first. */}
        <div className="mt-5 pt-5 border-t border-[var(--color-border-subtle)]">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
            Or store a bearer token
          </p>
          <div className="flex gap-2">
            <input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="name"
              className="w-32 px-3 py-1.5 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-xs text-white focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
            />
            <input
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              type="password"
              placeholder="token"
              className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-xs text-white focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
            />
            <button
              onClick={() => saveTokenMut.mutate()}
              disabled={!tokenValue.trim() || saveTokenMut.isPending}
              className="px-3 py-1.5 rounded-lg border border-[var(--color-border-subtle)] text-xs text-white disabled:opacity-40 hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {saveTokenMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
            </button>
          </div>

          {credentials.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {credentials.map((cred, i) => {
                const name = String((cred as any).name ?? `credential-${i}`);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]"
                  >
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                      {name}
                    </span>
                    <button
                      onClick={() => deleteCredMut.mutate(name)}
                      className="text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* ── Tools ────────────────────────────────────────────────────────── */}
      <Section
        title={`Tools${tools.length ? ` (${tools.length})` : ''}`}
        icon={<Wrench size={13} />}
      >
        {toolsLoading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Loading tools…
          </div>
        )}

        {!toolsLoading && tools.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            No tools listed. This usually means the connector is not authenticated yet, or its
            MCP server is unreachable.
          </p>
        )}

        <div className="space-y-2">
          {tools.map((tool) => (
            <ToolRow key={tool.name} connectorId={id} tool={tool} />
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function ToolRow({ connectorId, tool }: { connectorId: string; tool: ConnectorTool }) {
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState('{}');

  const callMut = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || '{}');
      } catch {
        throw new Error('Arguments must be valid JSON.');
      }
      return connectorsApi.callTool(connectorId, tool.name, parsed).then((r) => r.data);
    },
  });

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <Wrench size={13} className="text-[var(--color-text-muted)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-white truncate">{tool.name}</p>
          {tool.description && (
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
              {tool.description}
            </p>
          )}
        </div>
        {tool.required.length > 0 && (
          <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0 mt-1">
            {tool.required.length} required
          </span>
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-[var(--color-border-subtle)]">
          {Object.keys(tool.parameters).length > 0 && (
            <p className="text-[11px] font-mono text-[var(--color-text-muted)] mb-2">
              {Object.keys(tool.parameters).join(', ')}
            </p>
          )}
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-xs font-mono text-white resize-none focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => callMut.mutate()}
              disabled={callMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border-subtle)] text-xs text-white disabled:opacity-40 hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {callMut.isPending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Play size={11} />
              )}
              Run
            </button>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              Calls the real service.
            </span>
          </div>

          {(callMut.data || callMut.isError) && (
            <pre
              className={cn(
                'mt-2 p-2.5 rounded-lg text-[11px] font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto',
                callMut.isError
                  ? 'bg-[rgba(248,113,113,0.06)] text-red-300'
                  : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]',
              )}
            >
              {callMut.isError
                ? ((callMut.error as any)?.response?.data?.message ??
                  (callMut.error as Error).message)
                : JSON.stringify(callMut.data?.output ?? callMut.data?.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
