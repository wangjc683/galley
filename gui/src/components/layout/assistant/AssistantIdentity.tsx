// TEMP variant switcher (main chat 90): 「新」 has no second line in a run.
import { useLiveProgressVariant } from "@/components/conversation/live-progress-variants/live-progress-variants";
import { SessionTitleCaret } from "@/components/layout/header/SessionTitleMenu";
import { useAssistantState } from "@/hooks/useAssistantState";
import { useCopy } from "@/lib/i18n";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

import { AssistantAvatar } from "./AssistantAvatar";

/**
 * The assistant in the main header while it is open (main chat ticket
 * 18): its avatar, its name 「Galley」 with the title button's
 * caret, and under the name what it is doing now. MainHeader renders it
 * as the label of the title menu's trigger (SessionTitleMenu), so the
 * whole row hovers like the title button and opens the main chat's
 * menu — 重新注入工具, 桌面宠物, no rename — the way tapping a
 * contact's name opens their page in an IM app.
 *
 * The second line is a chat title bar's (lib/assistant.ts): while it
 * runs, what it is doing — the sentence of the newest step that settled
 * (lib/assistant-conversation.ts `assistantSettledSentence`: its
 * narration, else its summary), 「思考中」 before there is one, never
 * what streams and no clock (main chat PRD rulings 107, 110; the
 * conversation below shows only the typing bubble) — else a state:
 * 「等你回复」, an error, a subtask's question or error, and nothing at
 * rest. Unlike the sidebar card it never quotes the question, the last
 * message or a draft: here they are all on screen, in the conversation
 * and the composer below. Cut with a fade when too long; hovering the
 * cut line gives the whole of it (`syncTruncatedTitle`).
 *
 * The name is the session title's register (Inter 13px medium); the
 * line takes a row subline's (11px, brand while running, warning,
 * error) and its fade when cut. Nothing here carries the window drag
 * region: it sits inside a button.
 */
export function AssistantIdentity({
  mainChat,
  subtasks,
}: {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
}) {
  const copy = useCopy();
  const state = useAssistantState({
    mainChat,
    subtasks,
    open: true,
    header: true,
  });
  // TEMP variant switcher (main chat 90): 「新」 says nothing here while
  // it runs, as at rest — what it is doing is under the dots (ruling 134);
  // waiting for you, an error, a subtask's state as before.
  const liveProgressVariant = useLiveProgressVariant();
  const quiet = liveProgressVariant === "new" && state.kind === "running";
  const line = quiet ? null : state.line;
  // The avatar here stays still, whatever the sidebar's face does (main
  // chat PRD ruling 119 point 6): the line under the name says what it
  // is doing, and one face moving at a time is enough.
  return (
    <span
      data-role="assistant-identity"
      className="flex min-w-0 items-center gap-2"
    >
      <AssistantAvatar size={28} />
      <span className="flex min-w-0 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium leading-4 text-ink">
            {copy.assistant.name}
          </span>
          <SessionTitleCaret />
        </span>
        {line && (
          <span
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
