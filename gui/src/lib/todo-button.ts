import type { AppCopy } from "@/i18n/types";
import type { TodoItem, YourTodos } from "@/lib/assistant-todo";
import type { ResolvedLanguage } from "@/lib/language";
import { todoMetaParts } from "@/lib/todo-panel";

/**
 * The top bar's 「待办」 button as a capsule (main chat ticket 104, PRD
 * ruling 150): the first row of the panel's 你的事 — 「时间 · 标题」, and
 * 「+N」 after it while that row is one of today's — so the button always
 * says the one thing worth saying now, its weight earned; 「待办」 only
 * when there is nothing to write, which is where a new user starts.
 * Galley's own work (its reminders, its subtasks) stays out: what it is
 * on, the face in the sidebar says (point 4).
 *
 * Pure: the row and the words here (`todoCapsule`), the header widths it
 * gives way at (`todoButtonFit`); TodoToggleButton draws it, and which
 * look draws a capsule at all is the trial's (todo-button-variants.ts).
 */

/** Which of Core's three lists of the user's to-dos a row is in. */
export type YourGroup = "today" | "later" | "anytime";

export interface TodoFirstRow {
  item: TodoItem;
  group: YourGroup;
}

/** The first of the user's to-dos as the panel lists them — today's
 * (overdue first), then later, then anytime: Core's three lists end to
 * end, each in Core's order (lib/todo-panel.ts `yourTodos`). Null when
 * there are none. */
export function todoFirstRow(yours: YourTodos): TodoFirstRow | null {
  for (const group of ["today", "later", "anytime"] as const) {
    const item = yours[group][0];
    if (item) return { item, group };
  }
  return null;
}

/** What the capsule writes. */
export interface TodoCapsule {
  /** When it is due as the panel's row writes it, or 「随时」. */
  when: string;
  /** Warning once it is overdue, as on the panel's row. */
  tone: "muted" | "warning";
  title: string;
  /** Today's others (「+N」): `todayCount - 1` while the first row is one
   * of today's, else 0 — none written at 0. */
  more: number;
}

/**
 * The capsule's words (ruling 150 point 2): the first row
 * (`todoFirstRow`), its time the due part of the panel row's second line
 * (`todoMetaParts`: 「今天 15:00」, 「明天」, 「周五 15:00」, 「10月30日」,
 * 「逾期 2 天」 in warning) without the bell and its time; one from the
 * anytime list writes the list's name, 「随时」. Null when the user has
 * no to-do: the button writes 「待办」 then.
 */
export function todoCapsule(
  yours: YourTodos,
  todayCount: number,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): TodoCapsule | null {
  const first = todoFirstRow(yours);
  if (!first) return null;
  const due =
    first.group === "anytime"
      ? undefined
      : todoMetaParts(first.item, false, todayStartMs, language, copy).find(
          (part) => !part.bell,
        );
  return {
    when: due?.text ?? copy.topbar.todoAnytime,
    tone: due?.tone ?? "muted",
    title: first.item.text,
    more: first.group === "today" ? Math.max(todayCount - 1, 0) : 0,
  };
}

/** The capsule at its widest, px (ruling 150 point 6): the title is cut
 * past it. */
export const TODO_CAPSULE_MAX_PX = 220;

/**
 * The header widths the button's word and capsule give way at (ruling
 * 150 point 5; ticket 103 for the word): the capsule's title is cut
 * first, then, with under four characters of it left, the whole capsule
 * folds to 甲 (the icon and today's count); the word simply goes; only
 * then is Galley's identity on the left cut, as before. Ticket 103's
 * way: the header is a size container (`@container/main-header`; its
 * content box is the main area less the header's `pr-3` on macOS, the
 * whole main area on Windows / Linux, whose window controls are inside
 * it) and the thresholds are what that box needs in the busiest common
 * state, so that while the word or the capsule shows, the identity is
 * never cut for it. TodoToggleButton writes them out as classes
 * (`WORD`, `CAPSULE`; Tailwind needs them literal), pinned to these
 * numbers by its test.
 *
 * - **The rest**: everything in that box but the 待办 button. The left:
 *   pl 10 + the sidebar toggle 28 + gap 6 + Galley's identity with its
 *   longest second line (6 + avatar 28 + 8 + 子任务在问你 66 / A subtask
 *   is asking you 123.69 + 8) + pr 12 = 172 / 229.69. The rest of the
 *   right: four gaps of 8 and two dividers, the status cluster with
 *   浏览器控制 · 待解锁, Channels and 新版本 (242.05 / 284.3), the tools
 *   改动, 显示, 设置 (92) = 368.05 / 410.3. On Windows / Linux the window
 *   controls and their gap too (146). `rest` rounds it up.
 * - `word`: the rest plus the button with its word and a two-digit N
 *   (1 + 5 + icon 16 + 4 + 待办 26 / To-do 36.91 + 4 + 15.6 + 7 + 1).
 *   Under it the word goes.
 * - `fold`: the rest plus the capsule at its narrowest — its frame (1 +
 *   5 + icon 16 + 4, then 9 + 1 = 36), a usual time of today's
 *   (「今天 15:00」 61.58 / 「Today 3:00 PM」 86.19), 「 · 」 10.22, four
 *   characters and the ellipsis (4 × 12 + 10.38 = 58.38, the same box
 *   in English) and 「+N」 (4 + 15.56). Under it the capsule folds;
 *   above it the capsule is at most `min(220px, 100cqw - rest)` wide,
 *   narrowing, its title cut, as the header does. A longer time
 *   (「逾期 · 今天 15:00」 95.64, 「Overdue · Today 3:00 PM」 145.84)
 *   leaves fewer characters before it folds.
 *
 * Laid out in Chrome with the app's built CSS and fonts (Inter with cv11
 * and ss01, PingFang SC, tabular figures, `text-autospace`): the real
 * header in that state, scanned from 560 to 1300px wide. Ticket 103
 * added English's word up to 721 / 867; the sum is 731 / 877.
 */
export function todoButtonFit(
  language: "zh" | "en",
  platform: "mac" | "other",
): { word: number; rest: number; fold: number } {
  const zh = language === "zh";
  const left = zh ? 172 : 229.69;
  const right = zh ? 368.05 : 410.3;
  const windowControls = platform === "mac" ? 0 : 8 + 138;
  const rest = left + right + windowControls;
  const withWord = 1 + 5 + 16 + 4 + (zh ? 26 : 36.91) + 4 + 15.6 + 7 + 1;
  const frame = 1 + 5 + 16 + 4 + 9 + 1;
  const when = zh ? 61.58 : 86.19;
  const narrowest = frame + when + 10.22 + (4 * 12 + 10.38) + (4 + 15.56);
  return {
    word: Math.ceil(rest + withWord),
    rest: Math.ceil(rest),
    fold: Math.ceil(rest + narrowest),
  };
}
