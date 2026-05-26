import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Cpu, Server } from 'lucide-react';
import { healthApi } from '../../api/health';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function StatusDot({ status }: { status: 'healthy' | 'unreachable' | 'unknown' }) {
  if (status === 'healthy') {
    return (
      <div className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent-success)] opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-accent-success)]"></span>
      </div>
    );
  }
  return <div className="h-2 w-2 rounded-full bg-[var(--color-accent-danger)]" />;
}

function ServiceCard({ label, port, icon: Icon, data, error }: {
  label: string; port: number;
  icon: React.ComponentType<{ size: number; className?: string }>;
  data?: Record<string,unknown>; error: boolean;
}) {
  const online = !error && data?.status === 'healthy';
  
  return (
    <motion.div variants={itemVariants} className="surface-card rounded-xl p-6 relative overflow-hidden">
      {/* Top subtle gradient line for healthy services */}
      {online && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--color-accent-success)] to-transparent opacity-50" />}
      
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
          <Icon size={18} className="text-[var(--color-text-primary)]" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
          <p className="text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-mono)]">:{port}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusDot status={online ? 'healthy' : 'unreachable'} />
          <span className={cn('text-xs font-medium uppercase tracking-wider', online ? 'text-[var(--color-accent-success)]' : 'text-[var(--color-accent-danger)]')}>
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-3 pt-4 border-t border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-text-muted)]">Status</span>
          <span className={cn("text-xs font-medium uppercase tracking-wider", online ? "text-[var(--color-accent-success)]" : "text-[var(--color-accent-danger)]")}>
            {online ? 'Healthy' : 'Down'}
          </span>
        </div>
        {!!data?.version && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Version</span>
            <span className="text-[var(--color-text-secondary)] font-[family-name:var(--font-mono)]">{String(data.version)}</span>
          </div>
        )}
        {!!data?.docker_tool_service && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Tool Service</span>
            <span className={cn("text-xs font-medium uppercase tracking-wider", data.docker_tool_service === 'reachable' ? "text-[var(--color-accent-success)]" : "text-[var(--color-accent-danger)]")}>
              {data.docker_tool_service === 'reachable' ? 'Reachable' : 'Unreachable'}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function HealthDashboard() {
  const { data: health, isError } = useQuery({
    queryKey: QK.health(),
    queryFn: () => healthApi.orchestrator(),
    refetchInterval: 15_000,
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">System Health</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Live status of all core microservices.</p>
      </div>

      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <ServiceCard
          label="Backend Orchestrator"
          port={8000}
          icon={Cpu}
          data={health as Record<string,unknown>}
          error={isError}
        />
        <ServiceCard
          label="Docker Tool Service"
          port={9000}
          icon={Server}
          data={health?.docker_tool_service === 'reachable' ? { status: 'healthy' } as Record<string,unknown> : undefined}
          error={health?.docker_tool_service !== 'reachable'}
        />
      </motion.div>

      {/* Connection Diagram */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="surface-card rounded-xl p-6 text-center"
      >
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <div className="w-16 h-px bg-[var(--color-border-subtle)]" />
          <div className="w-2 h-2 rounded-full bg-white animate-pulse" style={{ animationDelay: '200ms' }} />
          <div className="w-16 h-px bg-[var(--color-border-subtle)]" />
          <div className="w-2 h-2 rounded-full bg-white animate-pulse" style={{ animationDelay: '400ms' }} />
        </div>
        <div className="flex justify-center gap-[60px] text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] uppercase tracking-widest">
          <span>Frontend</span>
          <span>Orchestrator</span>
          <span>Tool Service</span>
        </div>
      </motion.div>
    </div>
  );
}
