import type { SidebarTopDemo } from "@/components/layout/sidebar/sidebar-top-trial";
import { useAssistantState } from "@/hooks/useAssistantState";
import { useCopy } from "@/lib/i18n";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

import { AssistantAvatar } from "./AssistantAvatar";

/**
 * The assistant in the main header's title place while it is open
 * (main chat ticket 17; first drawn for ticket 16): its avatar, its
 * name 「Galley」 and, under the name, what it is doing now — the line
 * its sidebar entry shows (lib/assistant.ts): running, a question, an
 * error, a subtask's too, and nothing at rest. No title menu: there is
 * nothing to rename and no session to act on.
 *
 * The name is the session title's register (Inter 13px medium); the
 * line takes the row subline's (11px, brand while running, warning,
 * error) and its fade when cut. Every piece carries the drag region (it
 * does not bubble), so the header still drags the window from its left.
 */
export function AssistantIdentity({
  mainChat,
  subtasks,
  demo,
}: {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** TEMPORARY (ticket 17): the trial's 「演示」. */
  demo?: SidebarTopDemo;
}) {
  const copy = useCopy();
  const { line } = useAssistantState({
    mainChat,
    subtasks,
    open: true,
    demo,
  });
  return (
    <span
      data-tauri-drag-region
      data-role="assistant-identity"
      className="flex min-w-0 items-center gap-2"
    >
      <AssistantAvatar size={28} />
      <span
        data-tauri-drag-region
        className="flex min-w-0 flex-col justify-center"
      >
        <span
          data-tauri-drag-region
          className="truncate text-[13px] font-medium leading-4 text-ink"
        >
          {copy.assistant.name}
        </span>
        {line && (
          <span
            data-tauri-drag-region
            data-role="assistant-status-line"
            ref={truncationFadeRef}
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, line.text)
            }
            className={cn(
              "truncate-fade text-[11px] leading-[1.4] tabular-nums",
              line.tone === "error"
                ? "font-medium text-error"
                : line.tone === "warning"
                  ? "font-medium text-warning"
                  : "text-brand-strong/85",
            )}
          >
            {line.text}
          </span>
        )}
      </span>
    </span>
  );
}
