/**
 * ConnectorRegistry — the Connectors home.
 *
 * Connectors are MCP servers registered with *Mistral*: the platform stores
 * their credentials and runs their tools, so nothing here proxies through our
 * backend. That is what separates this page from /mcp, which manages the Docker
 * Tool Service's own MCP registry.
 *
 * Directory connectors (installed from Studio by an admin) are listed alongside
 * custom ones but cannot be edited or deleted from here.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle, CheckCircle2, ChevronRight, Loader2, Lock, Plug, Plus,
  Search, Sparkles, Trash2, X,
} from 'lucide-react';
import { connectorsApi, type Connector, type CreateConnectorBody } from '../../api/connectors';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

const EMPTY_FORM: CreateConnectorBody = {
  name: '',
  description: '',
  server: '',
  icon_url: '',
  system_prompt: '',
  visibility: 'shared_org',
};

export default function ConnectorRegistry() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateConnectorBody>(EMPTY_FORM);
  const [useOAuth, setUseOAuth] = useState(false);
  const [oauth, setOAuth] = useState({ client_id: '', client_secret: '' });
  const [query, setQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: QK.connectors(),
    queryFn: () => connectorsApi.list().then((r) => r.data),
  });

  const connectors = data?.items ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q),
    );
  }, [connectors, query]);

  const createMut = useMutation({
    mutationFn: () => {
      const body: CreateConnectorBody = {
        name: form.name.trim(),
        description: form.description.trim(),
        server: form.server.trim(),
        visibility: form.visibility,
      };
      if (form.icon_url?.trim()) body.icon_url = form.icon_url.trim();
      if (form.system_prompt?.trim()) body.system_prompt = form.system_prompt.trim();
      if (useOAuth && oauth.client_id && oauth.client_secret) body.auth_data = { ...oauth };
      return connectorsApi.create(body).then((r) => r.data);
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: QK.connectors() });
      qc.invalidateQueries({ queryKey: QK.builderCatalog() });
      closeCreate();
      if (created?.id) navigate(`/connectors/${created.id}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.connectors() });
      qc.invalidateQueries({ queryKey: QK.builderCatalog() });
      setDeleteId(null);
    },
  });

  function closeCreate() {
    setShowCreate(false);
    setForm(EMPTY_FORM);
    setOAuth({ client_id: '', client_secret: '' });
    setUseOAuth(false);
    createMut.reset();
  }

  const canSubmit =
    form.name.trim().length > 0 &&
    form.description.trim().length > 0 &&
    /^https?:\/\//.test(form.server.trim());

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Connectors
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            External services registered with Mistral. Attach one to an agent, or call its
            tools directly from a workflow.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[var(--color-bg-base)] text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={15} />
          New Connector
        </button>
      </div>

      <div className="relative mb-6">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
        />
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Loading connectors…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.06)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-red-300 font-medium">Could not load connectors.</p>
            <p className="text-[var(--color-text-muted)] mt-1">
              Check that MISTRAL_API_KEY is set and that your account has access to the
              Connectors beta.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[var(--color-border-subtle)] rounded-xl">
          <Plug size={28} className="mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {connectors.length === 0 ? 'No connectors yet.' : 'No connectors match that search.'}
          </p>
          {connectors.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)] mt-2 max-w-md mx-auto">
              Register an MCP server URL here, or ask an admin to add one from the Mistral
              connector directory in Studio.
            </p>
          )}
        </div>
      )}

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid gap-3"
      >
        {filtered.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            onOpen={() => navigate(`/connectors/${connector.id}`)}
            onDelete={() => setDeleteId(connector.id)}
          />
        ))}
      </motion.div>

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={closeCreate}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-white">New Connector</h2>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Register an MCP server with Mistral.
                  </p>
                </div>
                <button
                  onClick={closeCreate}
                  className="text-[var(--color-text-muted)] hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <Field
                  label="Name"
                  hint="Alphanumeric, dashes and underscores. Max 64 characters."
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="github_app"
                />
                <Field
                  label="Description"
                  hint="Shown to the model — describe what the service does."
                  value={form.description}
                  onChange={(v) => setForm({ ...form, description: v })}
                  placeholder="Read and write GitHub issues and pull requests."
                />
                <Field
                  label="MCP server URL"
                  value={form.server}
                  onChange={(v) => setForm({ ...form, server: v })}
                  placeholder="https://mcp.example.com/sse"
                />

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                    Visibility
                  </label>
                  <select
                    value={form.visibility}
                    onChange={(e) =>
                      setForm({ ...form, visibility: e.target.value as CreateConnectorBody['visibility'] })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-sm text-white focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
                  >
                    <option value="shared_org">Organisation</option>
                    <option value="shared_workspace">Workspace</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                <Field
                  label="System prompt (optional)"
                  hint="Extra guidance injected whenever an agent uses this connector."
                  value={form.system_prompt ?? ''}
                  onChange={(v) => setForm({ ...form, system_prompt: v })}
                  placeholder="Prefer read-only operations unless the user explicitly asks to write."
                  multiline
                />

                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useOAuth}
                    onChange={(e) => setUseOAuth(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  This server uses OAuth2
                </label>

                {useOAuth && (
                  <div className="space-y-3 pl-5 border-l border-[var(--color-border-subtle)]">
                    <Field
                      label="Client ID"
                      value={oauth.client_id}
                      onChange={(v) => setOAuth({ ...oauth, client_id: v })}
                    />
                    <Field
                      label="Client secret"
                      value={oauth.client_secret}
                      onChange={(v) => setOAuth({ ...oauth, client_secret: v })}
                      type="password"
                    />
                  </div>
                )}
              </div>

              {createMut.isError && (
                <p className="mt-4 text-xs text-red-400">
                  {(createMut.error as any)?.response?.data?.message ??
                    'Could not create the connector.'}
                </p>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={closeCreate}
                  className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => createMut.mutate()}
                  disabled={!canSubmit || createMut.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[var(--color-bg-base)] text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {createMut.isPending && <Loader2 size={14} className="animate-spin" />}
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      <AnimatePresence>
        {deleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setDeleteId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6"
            >
              <h3 className="text-base font-semibold text-white mb-2">Delete connector?</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-5">
                Agents and workflow steps that reference it will start failing at call time.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteId(null)}
                  className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteId)}
                  disabled={deleteMut.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm font-medium disabled:opacity-40 hover:bg-red-500 transition-colors"
                >
                  {deleteMut.isPending && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function ConnectorCard({
  connector,
  onOpen,
  onDelete,
}: {
  connector: Connector;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      variants={itemVariants}
      onClick={onOpen}
      className="group flex items-center gap-4 p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:border-[rgba(99,102,241,0.4)] transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0 overflow-hidden">
        {connector.icon_url ? (
          <img src={connector.icon_url} alt="" className="w-6 h-6 object-contain" />
        ) : (
          <Plug size={16} className="text-[var(--color-text-muted)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{connector.name}</span>
          {connector.is_directory && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.15)] text-indigo-300 shrink-0">
              <Sparkles size={9} />
              Directory
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
          {connector.description || connector.server || 'No description.'}
        </p>
      </div>

      <AuthBadge connector={connector} />

      {!connector.is_directory && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete connector"
          className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-red-400 transition-all shrink-0"
        >
          <Trash2 size={15} />
        </button>
      )}

      <ChevronRight size={16} className="text-[var(--color-text-muted)] shrink-0" />
    </motion.div>
  );
}

export function AuthBadge({ connector }: { connector: Connector }) {
  if (!connector.active) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] shrink-0">
        <Lock size={12} />
        Inactive
      </span>
    );
  }
  return connector.is_authenticated ? (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
      <CheckCircle2 size={12} />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-amber-400 shrink-0">
      <AlertCircle size={12} />
      Not connected
    </span>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
  multiline,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  const shared = cn(
    'w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]',
    'text-sm text-white placeholder:text-[var(--color-text-muted)]',
    'focus:outline-none focus:border-[rgba(99,102,241,0.5)]',
  );
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={cn(shared, 'resize-none')}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={shared}
        />
      )}
      {hint && <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{hint}</p>}
    </div>
  );
}
