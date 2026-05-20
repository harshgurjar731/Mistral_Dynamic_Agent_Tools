import { cn } from '../../lib/utils';

export const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string; icon: string; cardBg: string; cardBorder: string }> = {
  foundation: {
    label: 'Foundation',
    color: 'text-[#a5b4fc]',
    bg: 'bg-[rgba(99,102,241,0.12)]',
    border: 'border-[rgba(99,102,241,0.25)]',
    cardBg: 'bg-gradient-to-br from-[rgba(99,102,241,0.15)] to-[rgba(99,102,241,0.02)] backdrop-blur-md',
    cardBorder: 'border-[rgba(99,102,241,0.3)]',
    dot: '#a5b4fc',
    icon: '🛡️',
  },
  domain: {
    label: 'Domain',
    color: 'text-[#fbbf24]',
    bg: 'bg-[rgba(251,191,36,0.12)]',
    border: 'border-[rgba(251,191,36,0.25)]',
    cardBg: 'bg-gradient-to-br from-[rgba(251,191,36,0.15)] to-[rgba(251,191,36,0.02)] backdrop-blur-md',
    cardBorder: 'border-[rgba(251,191,36,0.3)]',
    dot: '#fbbf24',
    icon: '🏢',
  },
  use_case: {
    label: 'Use-Case',
    color: 'text-[#34d399]',
    bg: 'bg-[rgba(52,211,153,0.12)]',
    border: 'border-[rgba(52,211,153,0.25)]',
    cardBg: 'bg-gradient-to-br from-[rgba(52,211,153,0.15)] to-[rgba(52,211,153,0.02)] backdrop-blur-md',
    cardBorder: 'border-[rgba(52,211,153,0.3)]',
    dot: '#34d399',
    icon: '🎯',
  },
};

export function getTierConfig(tier?: string) {
  return TIER_CONFIG[tier || 'foundation'] || TIER_CONFIG.foundation;
}

export function TierBadge({ tier }: { tier?: string }) {
  const cfg = getTierConfig(tier);
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', cfg.color, cfg.bg, cfg.border)}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
