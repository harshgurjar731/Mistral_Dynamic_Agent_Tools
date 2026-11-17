import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { canOpen, useCurrentUser } from "@/lib/auth";
import { useUiConfig } from "@/lib/uiConfig";
import { arrangeNav, groupRows, navLabel, parseNavLayout, type NavItem } from "./nav-items";

export type ShownNavItem = NavItem & { label: string };

/**
 * The menu as this user sees it — sections, pages in the saved order with
 * their renamed labels, only what their role can open — and the current page.
 * Shared by the sidebar (the tabs) and the header (the breadcrumb).
 */
export function useNavSections() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ui = useUiConfig();
  const user = useCurrentUser();

  const sections = useMemo(
    () =>
      // Order, visibility and labels come from Settings → Layout → Navigation menu.
      groupRows(
        arrangeNav(parseNavLayout(ui.UI_NAV_LAYOUT))
          .filter((r) => !r.hidden)
          .filter((r) => canOpen(user, r.item.to)),
      ).map(({ group, rows }) => ({
        group,
        items: rows.map((r): ShownNavItem => ({ ...r.item, label: navLabel(r) })),
      })),
    [ui.UI_NAV_LAYOUT, user],
  );

  const matches = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  // Only the most specific item lights up (/workflows/activities/x → Activities, not Workflows).
  const active = sections
    .flatMap((s) => s.items.map((item) => ({ item, group: s.group })))
    .filter(({ item }) => matches(item.to))
    .sort((a, b) => b.item.to.length - a.item.to.length)[0];

  return { sections, active, pathname };
}
