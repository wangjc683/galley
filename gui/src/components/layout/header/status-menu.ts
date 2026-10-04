import { cn } from "@/lib/utils";

/**
 * Menu grammar for the status-cluster lamps (Browser Control, Channels).
 *
 * The lamps are menu-bar extras in the macOS sense — state on top, a
 * separator, then 设置… as an item, like Wi-Fi's "Wi-Fi Settings…" — so
 * they open a menu, on the same compact surface as the session title
 * menu, the Composer ＋ menu and 显示: p-1, 13px rows, whole-row items
 * that highlight on hover, hairline separators. Decision popovers with
 * real buttons and explanatory text (Goal, Update) stay cards
 * (2026-10-04: entry surfaces are menus, decision surfaces are cards).
 *
 * Both menus lay a status row out the same way: a 14px mark in the
 * action icons' column, a name, and the state word in a right-hand
 * column. Their floor is 168px rather than the 200px of the other
 * compact menus: those rows run about 166px, and any slack landed in
 * the gap between a name and its state.
 *
 * Kept in a .ts module so both indicator files can share it without
 * tripping react-refresh's only-export-components rule.
 */
export const STATUS_MENU_CONTENT = cn(
  "galley-pop-in z-[70] w-max min-w-[168px] max-w-[300px] rounded-md border border-line bg-elevated p-1",
  "text-ui-compact text-ink shadow-elevated outline-none",
);

/** A non-interactive status row: same insets as an item, no hover. */
export const STATUS_MENU_ROW = "px-2 py-1.5";

export const STATUS_MENU_ITEM = cn(
  "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
  "data-[highlighted]:bg-hover",
);

export const STATUS_MENU_SEPARATOR = "my-1 h-px bg-line";
