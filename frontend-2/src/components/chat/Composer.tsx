import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isProcessing,
  placeholder = "Describe what you want to accomplish…",
  leading,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isProcessing?: boolean;
  placeholder?: string;
  leading?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <div
      className={cn(
        "glass-elevated rounded-2xl p-2.5 transition focus-within:glow-ring",
        className,
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!isProcessing && value.trim()) onSubmit();
          }
        }}
        className="custom-scrollbar max-h-[120px] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-2">
        {leading}
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
          Enter to send · Shift+Enter for newline
        </span>
        {isProcessing && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex size-8 items-center justify-center rounded-xl border border-border glass text-foreground transition hover:bg-surface-hover"
            aria-label="Stop generating"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={isProcessing || !value.trim()}
            aria-label="Send"
            className="inline-flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
