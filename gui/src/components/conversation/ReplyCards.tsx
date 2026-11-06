import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Everything a main chat reply carries under its bubble, in one frame
 * (main chat PRD rulings 181, 182, ticket 133; spec: conversation.md
 * 「回复下的卡片（一框列表）」): the files it handed over, the subtasks
 * it sent off, the to-dos, reminders and memos it noted, in that order,
 * one line each (FileCards, SubtaskCards, TodoCards, ReminderCards,
 * MemoCards draw the lines).
 *
 * The frame is the process card's (ProcessCard.tsx): a hairline
 * `border-line`, `rounded-md`, the page ground, 4px inside. It is as wide
 * as its widest line (`w-fit`), up to the bubble's cap (Conversation
 * wraps it in `ASSISTANT_BUBBLE_MAX`), 4px under the bubble: one thing of
 * the reply's side after another, as two of its bubbles (main chat PRD
 * ruling 199). At 12px, with the next bubble 4px under it, the frame read
 * as the next message's (a reply, its to-do, the reply of the round that
 * woke it); and the action row no longer comes between. While a
 * subtask's question is answered in its line (ruling 101) the frame goes
 * to the cap, so the question and the reply field are never squeezed.
 * No `overflow-hidden`: a file line's 「在文件夹中显示」 floats just
 * outside the frame's right edge.
 */
export function ReplyCards({ children }: { children: ReactNode }) {
  return (
    <div
      data-role="reply-cards"
      className="mt-1 w-fit max-w-full rounded-md border border-line bg-app p-1 has-[[data-role=ask-user-bubble]]:w-auto"
    >
      {children}
    </div>
  );
}

/**
 * The line of an item that opens something, the process card's step row
 * (ProcessCard.tsx `ProcessStepRow`): 24px, the whole line lit on hover
 * and while its title has keyboard focus. `overflow-hidden` clips the
 * title button's reach (`REPLY_CARD_TITLE_REACH`).
 */
export const REPLY_CARD_LINE =
  "flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)]";
export const REPLY_CARD_LINE_OPENS =
  "group/line overflow-hidden hover:bg-hover has-[>span>button:focus-visible]:bg-hover";

/** The 16px icon column, 6px to the name. */
export const REPLY_CARD_ICON =
  "mr-1.5 flex h-5 w-4 shrink-0 items-center justify-center";

/**
 * The title of a line that opens something, as a button that opens it
 * from anywhere on the line: it reaches 30px back over the icon column
 * (the line's 8px, the 16px column, 6px) and on past the line's end by
 * padding that a negative margin of the same size takes back, so it lays
 * out and sizes itself as its words; the line (`REPLY_CARD_LINE_OPENS`)
 * clips the rest. A flex item of its wrapper, so it shrinks to the room
 * the line leaves it (a block `<button>` would size itself to its words
 * and run past the line, cut without an ellipsis); its words are a span
 * of their own that cuts them, which is also what the hover measures —
 * the button's own scroll width counts the reach's padding differently
 * in WebKit and Chrome.
 *
 * Not a stretched `::after`: WebKit leaves the CJK / Latin autospace out
 * of the max-content of a box holding an absolutely positioned child,
 * so a title like 「制作76人赛季战况网页」 came out a few pixels short in
 * a frame as wide as its content and was cut (ticket 132b). What comes
 * after the title and should open the line lets the pointer through
 * (`pointer-events-none`); what acts on its own keeps it (a word with a
 * reason on hover, 「取消」), and the to-do's box, before the title, is
 * lifted over it. The name is ink-soft, ink while its line is hovered or
 * it has focus (`className`); no underline, no focus ring: the line's
 * ground says it.
 */
export const REPLY_CARD_TITLE_REACH =
  "-ml-[30px] -mr-[100vw] min-w-0 pl-[30px] pr-[100vw] text-left outline-none";

export function ReplyCardTitle({
  text,
  onClick,
  className,
  role,
  children,
}: {
  /** The whole title, the hover's while the line cuts it. */
  text: string;
  onClick: () => void;
  className?: string;
  /** The button's `data-role`. */
  role?: string;
  /** What the line shows; `text` when absent. */
  children?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 leading-5">
      <button
        type="button"
        data-role={role}
        onClick={onClick}
        onPointerEnter={(e) => {
          const words = e.currentTarget.firstElementChild;
          if (
            words instanceof HTMLElement &&
            words.scrollWidth > words.clientWidth
          ) {
            e.currentTarget.title = text;
          } else e.currentTarget.removeAttribute("title");
        }}
        className={cn(REPLY_CARD_TITLE_REACH, className)}
      >
        <span className="block truncate">{children ?? text}</span>
      </button>
    </span>
  );
}
