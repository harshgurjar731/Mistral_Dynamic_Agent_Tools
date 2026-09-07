import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Package, Bot, Wrench, Plug, Loader2, AlertTriangle, Download } from 'lucide-react';
import { workflowsApi } from '../../api/workflows';

interface DeploymentAgentSpec {
  name: string;
  model: string;
  tier?: string | null;
}
interface DeploymentDynamicTool {
  name: string;
}
interface DeploymentConnectorRef {
  connector_id?: string | null;
  connector_name?: string | null;
}
interface DeploymentManifest {
  workflow_name: string;
  agents: DeploymentAgentSpec[];
  native_tools: string[];
  dynamic_tools: DeploymentDynamicTool[];
  connectors: DeploymentConnectorRef[];
}

export default function DeployPackageModal({
  workflowName,
  onClose,
}: {
  workflowName: string;
  onClose: () => void;
}) {
  const { data: manifest, isLoading, isError } = useQuery<DeploymentManifest>({
    queryKey: ['workflow-deployment-manifest', workflowName],
    queryFn: () => workflowsApi.getDeploymentManifest(workflowName).then(r => r.data),
  });

  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={e => e.stopPropagation()}
          className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl max-h-[85vh]"
        >
          <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shrink-0">
            <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
              <Package size={16} className="text-indigo-400" /> Package for Deployment
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-6">
            <p className="text-xs text-[var(--color-text-muted)]">
              Produces a self-contained bundle — backend code, the compiled workflow, and a
              bootstrap script — that reproduces <span className="font-mono text-[var(--color-text-secondary)]">{workflowName}</span>'s
              agents and tools on any server pointed at a fresh Mistral API key.
            </p>

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] py-4">
                <Loader2 size={14} className="animate-spin" /> Building manifest…
              </div>
            )}

            {isError && (
              <div className="flex items-center gap-2 text-xs text-red-400 py-2">
                <AlertTriangle size={14} /> Could not load the deployment manifest.
              </div>
            )}

            {manifest && (
              <div className="space-y-4">
                <ManifestSection
                  icon={<Bot size={13} className="text-indigo-400" />}
                  title={`Agents (${manifest.agents.length})`}
                  empty="None"
                >
                  {manifest.agents.map(a => (
                    <li key={a.name} className="flex items-center justify-between gap-2">
                      <span className="font-mono truncate">{a.name}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{a.model}</span>
                    </li>
                  ))}
                </ManifestSection>

                <ManifestSection
                  icon={<Wrench size={13} className="text-emerald-400" />}
                  title={`Native tools (${manifest.native_tools.length})`}
                  empty="None"
                  hint="Ships with the backend code — nothing to provision."
                >
                  {manifest.native_tools.map(t => (
                    <li key={t} className="font-mono truncate">{t}</li>
                  ))}
                </ManifestSection>

                <ManifestSection
                  icon={<Wrench size={13} className="text-cyan-400" />}
                  title={`Dynamic tools (${manifest.dynamic_tools.length})`}
                  empty="None"
                  hint={manifest.dynamic_tools.length ? "Source code bundled — auto-installed by bootstrap_deploy.py." : undefined}
                >
                  {manifest.dynamic_tools.map(t => (
                    <li key={t.name} className="font-mono truncate">{t.name}</li>
                  ))}
                </ManifestSection>

                <ManifestSection
                  icon={<Plug size={13} className="text-amber-400" />}
                  title={`Connectors (${manifest.connectors.length})`}
                  empty="None"
                  hint={manifest.connectors.length ? "Must be authorized manually on the target workspace — credentials can't be exported." : undefined}
                  warn={manifest.connectors.length > 0}
                >
                  {manifest.connectors.map((c, i) => (
                    <li key={c.connector_id ?? c.connector_name ?? i} className="font-mono truncate">
                      {c.connector_name ?? c.connector_id}
                    </li>
                  ))}
                </ManifestSection>
              </div>
            )}
          </div>

          <div className="p-5 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shrink-0">
            <a
              href={workflowsApi.deploymentPackageUrl(workflowName)}
              className="btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md"
            >
              <Download size={14} /> Download deployment package (.zip)
            </a>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

function ManifestSection({
  icon,
  title,
  empty,
  hint,
  warn,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  hint?: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  const hasItems = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
        {icon} {title}
      </div>
      {hasItems ? (
        <ul className="space-y-1 text-xs text-[var(--color-text-secondary)] pl-1">{children}</ul>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)] pl-1">{empty}</p>
      )}
      {hint && (
        <p className={`text-[11px] mt-1.5 pl-1 ${warn ? 'text-amber-400' : 'text-[var(--color-text-muted)]'}`}>
          {hint}
        </p>
      )}
    </div>
  );
}
