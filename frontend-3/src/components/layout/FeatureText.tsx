/**
 * A feature's renamable texts (Settings → Layout → Navigation menu): sidebar
 * label, page title, page description and browser tab name.
 *
 * Pages keep their own styled defaults as children; these components swap in
 * the saved text only when one has been set, so an untouched page renders
 * exactly as it was designed.
 */
import { useMemo, type ReactNode } from "react";
import { useUiConfig } from "@/lib/uiConfig";
import { parseNavLayout, type FeatureTextOverride } from "./nav-items";

/** The saved overrides for one route ({} when none). */
export function useFeatureText(route: string): FeatureTextOverride {
  const { UI_NAV_LAYOUT } = useUiConfig();
  return useMemo(() => parseNavLayout(UI_NAV_LAYOUT).text[route] ?? {}, [UI_NAV_LAYOUT, route]);
}

/**
 * Renamed text in the page's style: the last line (or, on one line, the last
 * word) takes the brand gradient, the way the built-in headings do.
 */
function BrandText({ text, gradient }: { text: string; gradient: boolean }) {
  const value = text.trim();
  if (!gradient) return <span className="whitespace-pre-line">{value}</span>;
  const lines = value.split("\n");
  if (lines.length > 1) {
    const last = lines.pop()!;
    return (
      <>
        <span className="whitespace-pre-line">{lines.join("\n")}</span>
        <br />
        <span className="text-gradient-brand">{last}</span>
      </>
    );
  }
  const cut = value.lastIndexOf(" ");
  if (cut < 0) return <span className="text-gradient-brand">{value}</span>;
  return (
    <>
      {value.slice(0, cut + 1)}
      <span className="text-gradient-brand">{value.slice(cut + 1)}</span>
    </>
  );
}

/** The page heading: the renamed title, else the page's own `children`. */
export function FeatureTitle({
  route,
  gradient = true,
  children,
}: {
  route: string;
  /** Whether a renamed title gets the brand gradient, matching the built-in heading. */
  gradient?: boolean;
  children: ReactNode;
}) {
  const title = useFeatureText(route).title;
  return title?.trim() ? <BrandText text={title} gradient={gradient} /> : <>{children}</>;
}

/** The line under the heading: the renamed description, else `children`. */
export function FeatureDescription({ route, children }: { route: string; children: ReactNode }) {
  const description = useFeatureText(route).description;
  return description?.trim() ? (
    <span className="whitespace-pre-line">{description.trim()}</span>
  ) : (
    <>{children}</>
  );
}
