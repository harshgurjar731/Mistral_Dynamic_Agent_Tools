import { ArrowDownUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The sort control every list page uses. Built on the themed Select rather
 * than a native <select>, whose option list is drawn by the operating system
 * and ignores the app's theme.
 */
export function SortSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (key: string) => void;
  options: Array<{ key: string; label: string }>;
  className?: string | undefined;
}) {
  const known = options.some((o) => o.key === value) ? value : (options[0]?.key ?? "");
  return (
    <Select value={known} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Sort by"
        className={cn(
          "h-9 w-auto min-w-[10.5rem] gap-2 rounded-lg border-border/60 bg-background-elevated px-3 text-xs text-foreground shadow-none hover:border-border focus:ring-1 focus:ring-primary",
          className,
        )}
      >
        {/* A div, not a span: the trigger line-clamps its direct span children. */}
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <ArrowDownUp className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Sort:</span>
          <span className="truncate font-medium">
            <SelectValue />
          </span>
        </div>
      </SelectTrigger>
      <SelectContent
        align="end"
        className="rounded-lg border-border-strong bg-popover/95 backdrop-blur-xl"
      >
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key} className="cursor-pointer text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
