import { cn } from "@/lib/utils";

/**
 * Non-component shares for the session-history browser dialogs
 * (EarlierDialog / ArchivedDialog) — split from session-browser-ui.tsx
 * so that file stays component-only for react-refresh.
 *
 * Elevation: these are workbench-style dialogs (foundations.md §bg-app
 * exception) — body/header/footer sit on `bg-app`, not `bg-elevated`.
 */
export const SESSION_BROWSER_CONTENT_CLASS = cn(
  "galley-pop-in fixed left-1/2 top-1/2 z-50 flex h-[520px] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col",
  "overflow-hidden rounded-lg border border-line bg-app shadow-elevated",
  "max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)]",
);

/** Local-timezone YYYY-MM-DD for a session activity timestamp. */
export function formatSessionDate(iso: string): string {
  try {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  } catch {
    return iso;
  }
}
