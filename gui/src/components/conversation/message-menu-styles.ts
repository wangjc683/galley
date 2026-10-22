import { cn } from "@/lib/utils";

/**
 * The register of the message menu (MessageMenu.tsx, main chat ticket
 * 38): the sidebar row menus' surface (`galley-pop-in`, 200px, 13px),
 * its rows, and 删除 in the destructive style after a separator. Shared
 * with the to-do panel's row menu (components/todo/TodoRowMenu.tsx, main
 * chat ticket 88), so a 删除 reads the same wherever it is.
 */

export const MENU_CONTENT_CLASS =
  "galley-pop-in z-50 w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated";

// rounded-callout (8px) = the menu surface's rounded-md (12px) minus its
// p-1 (4px), as the sidebar's rows.
export const MENU_ITEM_CLASS = cn(
  "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-ink-soft outline-none",
  "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
);

export const MENU_DELETE_CLASS = cn(
  "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-error outline-none",
  "data-[highlighted]:bg-error/[var(--opacity-soft)] data-[highlighted]:text-error",
  "data-[disabled]:text-ink-muted",
);
