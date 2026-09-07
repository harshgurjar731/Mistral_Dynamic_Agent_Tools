import { cn } from '../../lib/utils';

/**
 * Track/thumb dimensions per size. Both scale from the same left-0.5 base
 * offset, so the "on" translate distance is just track width - thumb width -
 * (2 * base offset) — keeping every size visually proportional.
 */
const SIZES = {
  sm: { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-[18px]' },
  xs: { track: 'h-3.5 w-6', thumb: 'h-2.5 w-2.5', on: 'translate-x-3' },
} as const;

export type SwitchSize = keyof typeof SIZES;

/**
 * The one toggle-switch implementation for the whole app — same track color,
 * thumb color and motion everywhere it appears. Every call site used to
 * hand-roll its own (slightly differently each time, and in a few places as
 * a plain checkbox instead), which is what made switches look inconsistent
 * from page to page. `size="xs"` is for tight inline contexts (e.g. a filter
 * panel); everything else uses the default.
 */
export function Switch({
  checked,
  onChange,
  size = 'sm',
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: SwitchSize;
  disabled?: boolean;
  className?: string;
}) {
  const dims = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        dims.track,
        checked ? 'bg-indigo-500' : 'bg-white/10',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 rounded-full bg-white shadow-sm transition-transform',
          dims.thumb,
          checked && dims.on,
        )}
      />
    </button>
  );
}
