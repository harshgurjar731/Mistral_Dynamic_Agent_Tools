/**
 * Day / night toggle, shown in the sidebar (and the phone header) so it is on
 * every page. Click cycles light → dark → system; the menu picks one directly
 * or goes back to the default set on the Settings page.
 */
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const META: Record<ThemeMode, { label: string; icon: LucideIcon }> = {
  light: { label: "Day", icon: Sun },
  dark: { label: "Night", icon: Moon },
  system: { label: "Match system", icon: Monitor },
};

export function ThemeToggle({
  variant = "icon",
  collapsed = false,
}: {
  /** rail: a full-width sidebar row; icon: a small square button. */
  variant?: "rail" | "icon";
  collapsed?: boolean;
}) {
  const { mode, resolved, chosen, setMode } = useTheme();
  // The icon shows what is on screen; "system" adds the monitor badge.
  const Icon = resolved === "light" ? Sun : Moon;
  const label =
    mode === "system"
      ? `Match system (${resolved === "light" ? "day" : "night"})`
      : META[mode].label;
  const title = `Theme: ${label}. Change the look of every page.`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={cn(
            variant === "rail"
              ? "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              : "relative rounded-md border border-border bg-secondary p-2 text-foreground transition hover:bg-surface-hover",
            variant === "rail" && collapsed && "justify-center",
          )}
        >
          <span className="relative shrink-0">
            <Icon className="size-4" />
            {mode === "system" ? (
              <Monitor className="absolute -right-1.5 -bottom-1 size-2.5 rounded-sm bg-background" />
            ) : null}
          </span>
          {variant === "rail" && !collapsed ? (
            <span className="truncate">{resolved === "light" ? "Day mode" : "Night mode"}</span>
          ) : null}
          {variant === "rail" && !collapsed ? (
            <kbd className="ml-auto rounded border border-border px-1 font-mono text-[9px] text-muted-foreground">
              ⇧Alt L
            </kbd>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === "rail" ? "right" : "bottom"}
        align="end"
        className="w-52"
      >
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        {(Object.keys(META) as ThemeMode[]).map((m) => {
          const ItemIcon = META[m].icon;
          return (
            <DropdownMenuItem key={m} onSelect={() => setMode(m)} className="gap-2 text-xs">
              <ItemIcon className="size-3.5" />
              {META[m].label}
              {chosen && mode === m ? <Check className="ml-auto size-3.5 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setMode(null)} className="gap-2 text-xs">
          <span className="size-3.5" />
          Use the platform default
          {!chosen ? <Check className="ml-auto size-3.5 text-primary" /> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
