import {
  AlertCircle, Ban, CheckCircle2, CircleDot, Clock, Hourglass,
  Loader2, OctagonX, RefreshCw, Repeat,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '../../../lib/utils';

/**
 * One visual vocabulary for every status the Mistral executions API can report.
 *
 * Defined once and shared by the header, timeline, history list and dashboard
 * so a status never means two different colours in two different places.
 */
export interface StatusStyle {
  label: string;
  /** Tailwind classes for text/background/border, as one bundle. */
  chip: string;
  text: string;
  dot: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
  spin?: boolean;
  /** True while the run is still progressing. */
  active?: boolean;
}

const STYLES: Record<string, StatusStyle> = {
  PENDING: {
    label: 'Queued',
    chip: 'text-slate-300 bg-slate-500/10 border-slate-400/25',
    text: 'text-slate-300', dot: 'bg-slate-400',
    Icon: Hourglass, active: true,
  },
  RUNNING: {
    label: 'Running',
    chip: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
    text: 'text-amber-300', dot: 'bg-amber-400',
    Icon: Loader2, spin: true, active: true,
  },
  RETRYING_AFTER_ERROR: {
    label: 'Retrying',
    chip: 'text-orange-300 bg-orange-500/10 border-orange-400/30',
    text: 'text-orange-300', dot: 'bg-orange-400',
    Icon: Repeat, active: true,
  },
  COMPLETED: {
    label: 'Completed',
    chip: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
    text: 'text-emerald-300', dot: 'bg-emerald-400',
    Icon: CheckCircle2,
  },
  FAILED: {
    label: 'Failed',
    chip: 'text-red-300 bg-red-500/10 border-red-400/30',
    text: 'text-red-300', dot: 'bg-red-400',
    Icon: AlertCircle,
  },
  CANCELLED: {
    label: 'Cancelled',
    chip: 'text-slate-300 bg-slate-500/10 border-slate-400/25',
    text: 'text-slate-300', dot: 'bg-slate-400',
    Icon: Ban,
  },
  TERMINATED: {
    label: 'Terminated',
    chip: 'text-rose-300 bg-rose-500/10 border-rose-400/30',
    text: 'text-rose-300', dot: 'bg-rose-400',
    Icon: OctagonX,
  },
  TIMED_OUT: {
    label: 'Timed out',
    chip: 'text-yellow-300 bg-yellow-500/10 border-yellow-400/30',
    text: 'text-yellow-300', dot: 'bg-yellow-400',
    Icon: Clock,
  },
  CONTINUED_AS_NEW: {
    label: 'Continued',
    chip: 'text-indigo-300 bg-indigo-500/10 border-indigo-400/30',
    text: 'text-indigo-300', dot: 'bg-indigo-400',
    Icon: RefreshCw,
  },
};

const UNKNOWN: StatusStyle = {
  label: 'Unknown',
  chip: 'text-[var(--color-text-muted)] bg-white/5 border-[var(--color-border-subtle)]',
  text: 'text-[var(--color-text-muted)]', dot: 'bg-slate-500',
  Icon: CircleDot,
};

export function statusStyle(status?: string | null): StatusStyle {
  if (!status) return UNKNOWN;
  const key = status.toUpperCase().replace('CANCELED', 'CANCELLED');
  return STYLES[key] ?? { ...UNKNOWN, label: key.replace(/_/g, ' ').toLowerCase() };
}

export default function ExecutionStatusBadge({
  status,
  size = 'md',
  className,
}: {
  status?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const style = statusStyle(status);
  const { Icon } = style;
  const small = size === 'sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wider whitespace-nowrap',
        small ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1.5 text-xs',
        style.chip,
        className,
      )}
    >
      <Icon size={small ? 10 : 12} className={style.spin ? 'animate-spin' : undefined} />
      {style.label}
    </span>
  );
}
