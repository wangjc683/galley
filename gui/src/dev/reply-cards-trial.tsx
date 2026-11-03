/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { previewKindByPath } from "@/lib/local-file-path";
import type { SubtaskCardState, SubtaskDispatch } from "@/lib/subtasks";
import { cn } from "@/lib/utils";
import type { PendingAskUser } from "@/types/conversation";

/*
 * TEMP variant switcher (main chat 131, 132) — the cards under a main
 * chat reply (files, subtasks, to-dos, reminders, memos; main chat PRD
 * rulings 180, 181): how they are drawn (样式), and under 有框 how wide
 * and how tall, compared live in `pnpm --dir gui tauri dev`. Everything the trial needs is in this file;
 * three places reach it in a dev build only (`import.meta.env.DEV`):
 * MainView mounts the pill and passes the files through
 * `useReplyCardsMixedFiles`, SubtaskCards passes a card's state through
 * `useReplyCardsDemoState`. A production build has no pill and draws the
 * cards as written (现状). The wrapper the cards hang in
 * (Conversation.tsx `afterAnswer`) carries `data-role="reply-cards"` for
 * good; it changes nothing by itself.
 *
 * The pill, at the window's bottom-right corner, 4px off its bottom
 * edge, starts folded: one small button, 「临时 · 卡片 · 」 and the style
 * (the main chat's composer sits 24px off the edge, so the button never
 * covers its send button). Open, it is two columns — 样式 / 状态 / 数据 on
 * the left, 宽度 and 高度 on the right, greyed and still unless the
 * style is 有框 (their pick is kept for when it is again) — and 收起
 * folds it. Every level is a button, the current one lit; the pick and
 * the fold are kept in localStorage, so a reload keeps them:
 *
 *   样式  有框        the cards as ticket 131 left them, each its own
 *                     frame, 宽度 and 高度 below in force;
 *         一框列表    (default) the process card's way (ruling 181,
 *                     ProcessCard.tsx): one frame round all the cards of
 *                     a reply — `rounded-md border border-line bg-app`,
 *                     4px inside (`p-1`), as wide as its widest line
 *                     (`fit-content`), up to the bubble's cap, 12px off
 *                     the bubble — and one 24px line a card (`h-6 px-2
 *                     rounded-sm`): the 16px icon column, 6px, the name
 *                     at `--conversation-step-size` in ink-soft, cut to
 *                     the line; then 8px on, in ink-muted, what sat on the
 *                     card's right (the folder, at most 40%; a to-do's day
 *                     and reminder, at most 40%; a reminder's time and
 *                     state, its words now first), a subtask's word in its
 *                     own colour; 「取消」 at the line's end, 20px tall
 *                     (`h-5`, 6px across). No card frame, ground, radius
 *                     or 40px, no 8px between cards or groups;
 *         无框行      no frame at all: one 28px line a card (`min-h-7
 *                     px-2 rounded-sm`), each as wide as its own words
 *                     (`w-fit max-w-full`), no gap between lines, the
 *                     first 8px off the bubble; names 13px in ink-soft,
 *                     the light things 12px, 8px after the name, as in
 *                     一框列表; 「取消」 24px (`h-6`).
 *                     In both: a line that opens something lights whole
 *                     (`bg-hover`) on hover and keyboard focus, its name
 *                     to ink, with no underline and no focus ring; a line
 *                     that opens nothing does not light. A click anywhere
 *                     on a line that opens something opens it: a file
 *                     line is one button as before; a subtask, a to-do, a
 *                     memo, a reminder whose title or words are a button
 *                     have that button stretched over the line (a
 *                     `::after`, `inset: 0`), so its icon, the light
 *                     things, a word without a reason (「等你回复」
 *                     「没有跑完」) and the empty end open it too; the
 *                     to-do's box, 「取消」 and a word with a reason on
 *                     hover (「出错」「没有开始」) sit above it
 *                     (`relative z-index 1`) and keep their own click and
 *                     hover. Tab still lands on the title's button.
 *                     「在文件夹中显示」 floats just outside the right edge
 *                     (of the frame in 一框列表: 9px past the line, the
 *                     frame's 4px and border then 4px; of the line in
 *                     无框行), on the file's line, the hover unbroken on
 *                     the way. A subtask answered in place opens under
 *                     its line on its faint amber, the question and the
 *                     reply field from the name's edge (30px), and the
 *                     frame (一框列表) or that card (无框行) goes to the
 *                     cap; a failed to-do's or reminder's reason stays
 *                     under its line, from the same edge. Strikes, fades,
 *                     「已删除」, 「已移走或删除」 as the cards draw them.
 *                     A row of image thumbnails is a band of its own, 4px
 *                     above and below, its left on the icon column (8px
 *                     in).
 *   宽度  现状        as written: every card as wide as the bubble's cap
 *                     (`max-w-[88%]`, 669px in the 760 column, 1056 in
 *                     the 1200 one), the file card's right end giving way
 *                     to 「在文件夹中显示」 on hover;
 *         甲 随字宽    each card as wide as its own words, on the left;
 *         乙 同组同宽  (default) the cards under one reply all as wide as
 *                     the widest one's words: the wrapper `w-fit`;
 *         丙 固定 320  each card 320px, on the left.
 *                     The cap is the bubble's in all four, past it the
 *                     words are cut as before (a file name in the middle,
 *                     a title at its end). Image thumbnails (96px) stay
 *                     as they are; under 乙 a row of them counts toward
 *                     the group's width like any card. In 甲 and 乙 a file
 *                     card no longer makes room for 「在文件夹中显示」:
 *                     the button floats just outside its right edge, the
 *                     hover unbroken on the way (the button holder starts
 *                     at the edge, still inside `group/file-card`; it
 *                     takes the pointer only while the card is hovered or
 *                     focused, so the empty space beside a card does not
 *                     light it). 丙 keeps it inside, as written. A subtask
 *                     card answered in place (ruling 101, `answering`)
 *                     goes to the cap in 甲 and 丙, and under 乙 its whole
 *                     group does, so the question and the reply field
 *                     are never squeezed.
 *   高度  40          (default) as written (`min-h-10 py-1.5`): the file
 *                     card 40px, the other four 42 (their 40px line sits
 *                     inside the card's 1px border);
 *         32          every card 32px tall, borders included: the line
 *                     of a subtask / to-do / reminder / memo card 30px
 *                     with no vertical padding (its 1px border makes 32),
 *                     the file card's button `min-height: 32px` with no
 *                     vertical padding, and a reminder's 「取消」 24px tall
 *                     (`h-6`, no vertical padding) so the card is as tall
 *                     with it as without (ReminderCards.tsx). Horizontal
 *                     padding, the icon column and the type stay.
 *   状态  真实        (default) the subtask cards as the stores say;
 *         在问你      under every reply, its first subtask card (tag
 *                     ordinal 0) waits for you (「等你回复」), the rest run;
 *         出错        the first failed (「出错」, the hover a made-up
 *                     reason, 「出错：网页打不开」), the second did not
 *                     finish (「没有跑完」), the rest run.
 *                     Drawn through the card's own word and icon
 *                     (`subtaskCardWord`, `CardIcon`), in memory only:
 *                     nothing is written, no IPC.
 *   数据  真实        (default) the files as the replies delivered them;
 *         混排        the conversation's delivered file with the longest
 *                     path (not an image: that would draw as a
 *                     thumbnail) is also drawn under the latest reply that
 *                     has subtask cards, above them as files always are —
 *                     the case 乙 pays for: a long file card widening the
 *                     short subtask cards under the same reply. A real
 *                     path from the conversation, so the card asks Core
 *                     whether the file is there as any card does (the
 *                     only IPC); nothing else is sent or written. With no
 *                     delivered file it adds nothing.
 *
 * The styles, widths and heights are a <style> laid over the
 * components' classes (unlayered, so it beats Tailwind's utilities layer,
 * as ticket 128's switcher did), keyed on `data-reply-cards-style`,
 * `-width` and `-height` on <html>, which the pill sets; the components
 * stay as written.
 *
 * Removal, after the ruling: delete this file and reply-cards-trial.test.ts;
 * in MainView.tsx drop its import, `useCardFiles` (use `deliveredFiles`
 * again) and `<ReplyCardsTrial />`; in SubtaskCards.tsx drop its import
 * and `useShownState`, and name `derived` `state` again. The wrapper's
 * `data-role="reply-cards"` may stay. Then write the pick in:
 *
 *   甲  the root of each of the five cards `w-fit max-w-full` (FileCards'
 *       FileCard div, SubtaskCard, TodoCard, ReminderCard, MemoCard);
 *       SubtaskCard `w-auto` while `answering`; the file card as below.
 *   乙  Conversation.tsx `afterAnswer`'s wrapper `w-fit`, back to the cap
 *       while a subtask card in it is answered in place
 *       (`has-[[data-role=ask-user-bubble]]:w-auto`); the file card as
 *       below.
 *   丙  the five cards' roots `w-80 max-w-full`; SubtaskCard `w-auto`
 *       while `answering`.
 *   甲 / 乙, the file card (FileCards.tsx): drop the button's
 *       `group-focus-within/file-card:pr-11 group-hover/file-card:pr-11`;
 *       the 「在文件夹中显示」 holder `left-full right-auto pl-1` instead of
 *       `right-1.5`, plus `pointer-events-none
 *       group-hover/file-card:pointer-events-auto
 *       group-focus-within/file-card:pointer-events-auto`.
 *   32  the line of SubtaskCard, TodoCard, ReminderCard and MemoCard
 *       `min-h-[30px] py-0` instead of `min-h-10 py-1.5`; FileCard's
 *       button `min-h-8 py-0`; ReminderCard's 「取消」 `h-6 py-0`.
 *
 *   一框列表  Conversation.tsx `afterAnswer`'s wrapper `mt-3 w-fit
 *       rounded-md border border-line bg-app p-1
 *       has-[[data-role=ask-user-bubble]]:w-auto`; the five groups
 *       (FileCards, SubtaskCards, TodoCards, ReminderCards, MemoCards) lose
 *       `gap-2` and their `mt-2` / `mt-3` (MainView's `afterFiles` /
 *       `afterSubtasks` / `afterCards` go); the four cards' roots
 *       `rounded-sm` instead of `rounded-md border border-line bg-app`
 *       (SubtaskCard keeps its amber while `answering`); every line `flex
 *       h-6 items-center rounded-sm px-2
 *       [font-size:var(--conversation-step-size)]`, its icon span `mr-1.5`,
 *       its name `min-w-0` (no `flex-1`) in `text-ink-soft`, the light
 *       things `ml-2 shrink-0 text-ink-muted` (FileCard's FolderPathText
 *       and TodoCard's meta `max-w-[40%]`, the meta `truncate`), the
 *       subtask word `ml-2`; a line that opens something `group
 *       hover:bg-hover has-[button:focus-visible]:bg-hover`, its name
 *       `group-hover:text-ink`, its title button without `hover:underline`
 *       and the focus ring, stretched over the line (the line `relative`,
 *       the button `after:absolute after:inset-0 after:content-['']`),
 *       TodoCheck's label, 「取消」 and CardWord when it has a reason
 *       `relative z-10`; ReminderCard's spans reordered (words, time,
 *       state) and 「取消」 `ml-auto h-5 px-1.5 py-0`; FileCard's button the
 *       line's classes without its frame, its 在文件夹中显示 holder
 *       `left-full right-auto pl-[9px]` with the pointer-events gating
 *       above; the thumbnails' run `px-2 py-1`; SubtaskAnswer's bubble and
 *       the to-do / reminder failure lines `pl-[30px]`.
 *   无框行  the same without the wrapper's frame, `w-fit` and `p-1`
 *       (`mt-2` instead of `mt-3`); each card root `w-fit max-w-full`
 *       (`w-auto` while `answering`); lines `min-h-7` instead of `h-6`,
 *       names at 13px as now, the light things `text-[12px]`, 「取消」
 *       `h-6 py-0`; the 在文件夹中显示 holder `pl-1`.
 *
 * and docs/design/conversation.md: under 有框, the five cards'
 * 「最宽同气泡」, and their heights if 32 wins; under 一框列表 or 无框行,
 * 「助手的对话」's line on the subtask cards (they sit under the bubble,
 * 12px), and the sections 「子任务卡片」「提醒卡片」「待办卡片」「备忘卡片」
 * (each says `rounded-md`, `border-line`, 40px); the file cards have no
 * section of their own there. 状态 and 数据 have nothing to write in.
 */

type Style = "box" | "list" | "rows";
type Width = "now" | "jia" | "yi" | "bing";
type Height = "40" | "32";
type Demo = "real" | "asking" | "error";
type Data = "real" | "mixed";

export interface ReplyCardsPick {
  style: Style;
  width: Width;
  height: Height;
  demo: Demo;
  data: Data;
  /** The pill folded into its small button. */
  folded: boolean;
}

type Options<T extends string> = readonly (readonly [T, string])[];

const STYLES: Options<Style> = [
  ["box", "有框"],
  ["list", "一框列表"],
  ["rows", "无框行"],
];
const WIDTHS: Options<Width> = [
  ["now", "现状"],
  ["jia", "甲 随字宽"],
  ["yi", "乙 同组同宽"],
  ["bing", "丙 固定 320"],
];
const HEIGHTS: Options<Height> = [
  ["40", "40"],
  ["32", "32"],
];
const DEMOS: Options<Demo> = [
  ["real", "真实"],
  ["asking", "在问你"],
  ["error", "出错"],
];
const DATAS: Options<Data> = [
  ["real", "真实"],
  ["mixed", "混排"],
];

export const DEFAULT_PICK: ReplyCardsPick = {
  style: "list",
  width: "yi",
  height: "40",
  demo: "real",
  data: "real",
  folded: true,
};

const STORAGE_KEY = "galley.dev.reply-cards-trial";

function oneOf<T extends string>(
  options: Options<T>,
  value: unknown,
  fallback: T,
): T {
  const hit = options.find(([level]) => level === value);
  return hit ? hit[0] : fallback;
}

/** The pick saved in localStorage; anything unreadable is the default. */
export function parsePick(raw: string | null): ReplyCardsPick {
  if (!raw) return DEFAULT_PICK;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return DEFAULT_PICK;
  }
  if (!saved || typeof saved !== "object") return DEFAULT_PICK;
  const s = saved as Record<string, unknown>;
  return {
    style: oneOf(STYLES, s.style, DEFAULT_PICK.style),
    width: oneOf(WIDTHS, s.width, DEFAULT_PICK.width),
    height: oneOf(HEIGHTS, s.height, DEFAULT_PICK.height),
    demo: oneOf(DEMOS, s.demo, DEFAULT_PICK.demo),
    data: oneOf(DATAS, s.data, DEFAULT_PICK.data),
    folded: typeof s.folded === "boolean" ? s.folded : DEFAULT_PICK.folded,
  };
}

// The pick, shared by the pill and every card that reads it. Read from
// localStorage on first use, not at import, so the module has no top-
// level effect and a production build drops it whole.
let current: ReplyCardsPick | null = null;
const listeners: (() => void)[] = [];

function readPick(): ReplyCardsPick {
  if (current) return current;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // No storage (a private window, blocked site data): the default.
  }
  current = parsePick(raw);
  return current;
}

function setPick(next: ReplyCardsPick): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not kept past this page; the pick still holds until a reload.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

const serverPick = () => DEFAULT_PICK;

function usePick(): ReplyCardsPick {
  return useSyncExternalStore(subscribe, readPick, serverPick);
}

// ---- 状态: demo states for the subtask cards ----------------------------

const DEMO_QUESTION: PendingAskUser = {
  question: "两家店都有货，要选哪一家？",
  candidates: [],
};
const RUNNING: SubtaskCardState = {
  kind: "running",
  step: null,
  summary: null,
};
const ASKING: SubtaskCardState = {
  kind: "asking",
  pending: DEMO_QUESTION,
  inCard: false,
};
const FAILED: SubtaskCardState = {
  kind: "failed",
  failure: { kind: "error", message: "网页打不开" },
};
const CUT_SHORT: SubtaskCardState = {
  kind: "failed",
  failure: { kind: "didNotFinish" },
};

/** The state a subtask card draws under the 状态 level: the store's
 * under 真实; otherwise by its place in the reply (the tag's ordinal). */
export function demoSubtaskState(
  demo: Demo,
  state: SubtaskCardState,
  ordinal: number,
): SubtaskCardState {
  switch (demo) {
    case "real":
      return state;
    case "asking":
      return ordinal === 0 ? ASKING : RUNNING;
    case "error":
      return ordinal === 0 ? FAILED : ordinal === 1 ? CUT_SHORT : RUNNING;
  }
}

/** SubtaskCard's hook (dev build only): the card's state, or a demo. */
export function useReplyCardsDemoState(
  state: SubtaskCardState,
  ordinal: number,
): SubtaskCardState {
  const { demo } = usePick();
  return demoSubtaskState(demo, state, ordinal);
}

// ---- 数据 · 混排 --------------------------------------------------------

/**
 * Under 混排, the files by reply with the conversation's longest
 * delivered path (not an image) added under the latest reply that has
 * subtask cards, after that reply's own files; `files` itself when there
 * is no such file or reply, or the reply already shows it.
 */
export function mixedFiles(
  files: ReadonlyMap<string, readonly string[]>,
  dispatches: ReadonlyMap<string, readonly SubtaskDispatch[]>,
): ReadonlyMap<string, readonly string[]> {
  let latest: { messageId: string; turnIndex: number } | null = null;
  for (const [messageId, group] of dispatches) {
    const turnIndex = group[0]?.turnIndex;
    if (turnIndex === undefined) continue;
    if (!latest || turnIndex > latest.turnIndex) {
      latest = { messageId, turnIndex };
    }
  }
  let longest: string | null = null;
  for (const paths of files.values()) {
    for (const path of paths) {
      if (previewKindByPath(path) === "image") continue;
      if (!longest || path.length > longest.length) longest = path;
    }
  }
  if (!latest || !longest) return files;
  const own = files.get(latest.messageId) ?? [];
  if (own.includes(longest)) return files;
  const next = new Map(files);
  next.set(latest.messageId, [...own, longest]);
  return next;
}

/** MainView's hook (dev build only): the files by reply, or 混排's. */
export function useReplyCardsMixedFiles(
  files: ReadonlyMap<string, readonly string[]>,
  dispatches: ReadonlyMap<string, readonly SubtaskDispatch[]>,
): ReadonlyMap<string, readonly string[]> {
  const { data } = usePick();
  return useMemo(
    () => (data === "mixed" ? mixedFiles(files, dispatches) : files),
    [data, files, dispatches],
  );
}

// ---- 样式 / 宽度 / 高度: the style ------------------------------------

/**
 * The style laid over the cards: for each width and height but 现状 / 40
 * (those match nothing; both are written onto <html> only under 有框),
 * and for the styles 一框列表 and 无框行 (有框 matches nothing of its
 * own). A function, not a top-level string, so the module keeps no
 * top-level work.
 */
export function replyCardsTrialCss(): string {
  const wrap = '[data-role="reply-cards"]';
  const file = '[data-role="file-card"]:not([data-file-kind])';
  const cards = `:is(${file},[data-role="subtask-card"],[data-role="todo-card"],[data-role="reminder-card"],[data-role="memo-card"])`;
  const lines =
    ':is([data-role="subtask-card"],[data-role="todo-card"],[data-role="reminder-card"],[data-role="memo-card"])>div:first-child';
  const answering =
    '[data-role="subtask-card"]:has([data-role="ask-user-bubble"])';
  const width = (level: Width) =>
    `html[data-reply-cards-width="${level}"] ${wrap}`;
  const floating = `html:is([data-reply-cards-width="jia"],[data-reply-cards-width="yi"]) ${wrap} ${file}`;
  const tall32 = `html[data-reply-cards-height="32"] ${wrap}`;
  return [
    // 甲: each card as wide as its words; 丙: each 320px.
    `${width("jia")} ${cards}{width:fit-content;max-width:100%}`,
    `${width("bing")} ${cards}{width:320px;max-width:100%}`,
    // …but a card answered in place goes to the cap (same specificity
    // as the two above: it wins by coming after them).
    `html:is([data-reply-cards-width="jia"],[data-reply-cards-width="bing"]) ${wrap} ${answering}{width:auto}`,
    // 乙: the group as wide as its widest card, the cap while answering
    // (:has() cannot nest, so the bubble is matched inside the card).
    `${width("yi")}{width:fit-content}`,
    `${width("yi")}:has([data-role="subtask-card"] [data-role="ask-user-bubble"]){width:auto}`,
    // 甲 / 乙: 在文件夹中显示 floats outside the file card's right edge.
    `${floating}>button{padding-right:0.625rem}`,
    `${floating}>div{right:auto;left:100%;padding-left:0.25rem;pointer-events:none}`,
    `${floating}:is(:hover,:focus-within)>div{pointer-events:auto}`,
    // 32.
    `${tall32} ${lines}{min-height:30px;padding-top:0;padding-bottom:0}`,
    `${tall32} ${file}>button{min-height:2rem;padding-top:0;padding-bottom:0}`,
    `${tall32} [data-role="reminder-card"]>div:first-child>button{height:1.5rem;padding-top:0;padding-bottom:0}`,
    ...styleCss(),
  ].join("\n");
}

/** 一框列表 and 无框行: the rules both share, then each one's own. */
function styleCss(): string[] {
  const wrap = '[data-role="reply-cards"]';
  const both = `html:is([data-reply-cards-style="list"],[data-reply-cards-style="rows"]) ${wrap}`;
  const list = `html[data-reply-cards-style="list"] ${wrap}`;
  const rows = `html[data-reply-cards-style="rows"] ${wrap}`;
  const groups =
    ':is([data-role="file-cards"],[data-role="subtask-cards"],[data-role="todo-cards"],[data-role="reminder-cards"],[data-role="memo-cards"])';
  const four =
    ':is([data-role="subtask-card"],[data-role="todo-card"],[data-role="reminder-card"],[data-role="memo-card"])';
  const file = '[data-role="file-card"]:not([data-file-kind])';
  const cards = `:is(${file},${four})`;
  // A card's line (the four), the file card's button (its line).
  const line = `${four}>div:first-child`;
  const fileLine = `${file}>button`;
  // A line whose title or words open something (a button in a span).
  const opens = `${line}:has(>span>button)`;
  const answering =
    '[data-role="subtask-card"]:has([data-role="ask-user-bubble"])';
  const reminder = '[data-role="reminder-card"]>div:first-child';
  // What sat on the card's right: now light, after the name.
  const objects = `:is([data-role="subtask-card-word"],[data-role="todo-meta"],[data-role="memo-card-state"],${reminder}>span:nth-child(2),${reminder}>span:nth-child(4),${fileLine}>span:nth-child(3))`;
  const ink = "var(--color-ink)";
  return [
    // No card's own frame, no gaps: one line after another.
    `${both} ${groups}{margin-top:0;gap:0}`,
    `${both} ${four}{border-width:0;border-radius:var(--radius-sm)}`,
    // The amber of a card answered in place stays (ruling 101).
    `${both} ${four}:not(:has([data-role="ask-user-bubble"])){background-color:transparent}`,
    `${both} ${line},${both} ${fileLine}{padding:0 0.5rem;gap:0;border-radius:var(--radius-sm)}`,
    `${both} ${fileLine}{border-width:0;background-color:transparent}`,
    // The 16px icon column, 6px to the name; the name as wide as its
    // words, so what follows it follows at 8px.
    `${both} ${line}>:first-child,${both} ${fileLine}>:first-child{margin-right:6px}`,
    `${both} ${line}>.flex-1,${both} ${fileLine}>.flex-1{flex:0 1 auto}`,
    `${both} ${line} .text-ink,${both} ${file} [data-role="file-name"].text-ink{color:var(--color-ink-soft)}`,
    `${both} ${objects}{margin-left:0.5rem}`,
    `${both} ${reminder}>span:nth-child(2){color:var(--color-ink-muted)}`,
    `${both} :is([data-role="todo-meta"],${fileLine}>span:nth-child(3)){max-width:40%}`,
    `${both} [data-role="todo-meta"]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    // A reminder: its words, then the time and the state, 取消 at the end.
    `${both} ${reminder}>span:nth-child(3){order:1}`,
    `${both} ${reminder}>span:nth-child(2){order:2}`,
    `${both} ${reminder}>span:nth-child(4){order:3}`,
    `${both} ${reminder}>button{order:4;margin-left:auto}`,
    `${both} ${reminder}:has(>button)>span:nth-child(4){margin-right:0.5rem}`,
    // A line that opens something: the whole line lights on hover and
    // keyboard focus, the name to ink; no underline, no ring.
    `${both} ${opens}:hover,${both} ${line}:has(>span>button:focus-visible){background-color:var(--color-hover)}`,
    `${both} ${opens}:hover .text-ink,${both} ${line}:has(>span>button:focus-visible) .text-ink{color:${ink}}`,
    `${both} ${line}>span>button:hover:not(.line-through){text-decoration-line:none}`,
    `${both} ${line}>span>button.line-through:hover{text-decoration-line:line-through}`,
    `${both} ${line}>span>button:focus-visible,${both} ${fileLine}:focus-visible{box-shadow:none}`,
    // …and it opens from anywhere on it: the title's button stretched
    // over the line (a ::after; the line, positioned, is its containing
    // block, so the button's own overflow does not clip it). What acts
    // on its own sits above it: the to-do's box, 「取消」, a word with a
    // reason on hover (「出错」「没有开始」). A line that opens nothing has
    // no such button, so no ::after.
    `${both} ${opens}{position:relative}`,
    `${both} ${line}>span>button::after{content:"";position:absolute;inset:0}`,
    `${both} [data-role="todo-card"]>div:first-child>[data-card-icon] label,${both} ${reminder}>button,${both} [data-role="subtask-card-word"][title]{position:relative;z-index:1}`,
    `${both} ${file}[data-file-state="present"]:hover>button,${both} ${file}[data-file-state="present"]>button:focus-visible{background-color:var(--color-hover)}`,
    `${both} ${file}[data-file-state="present"]:is(:hover,:has(>button:focus-visible)) [data-role="file-name"]{color:${ink}}`,
    // 在文件夹中显示 outside the right edge, the hover unbroken on the way.
    `${both} ${file}>div{right:auto;left:100%;pointer-events:none}`,
    `${both} ${file}:is(:hover,:focus-within)>div{pointer-events:auto}`,
    // Under the line, on the name's edge (8 + 16 + 6).
    `${both} [data-role="subtask-card"] [data-role="ask-user-bubble"]{padding-left:30px}`,
    `${both} :is([data-role="todo-card"],[data-role="reminder-card"])>[role="alert"]{padding-left:30px}`,
    // A row of image thumbnails: its own band, on the icon column's edge.
    `${both} [data-role="file-cards"]>div:not([data-role]){padding:0.25rem 0.5rem}`,

    // 一框列表: the process card's frame around them all, its 24px lines.
    `${list}{width:fit-content;margin-top:0.75rem;padding:0.25rem;border:1px solid var(--color-line);border-radius:var(--radius-md);background-color:var(--color-app)}`,
    // (:has() cannot nest: the bubble is matched inside the card.)
    `${list}:has([data-role="subtask-card"] [data-role="ask-user-bubble"]){width:auto}`,
    `${list} ${line},${list} ${fileLine}{min-height:0;height:1.5rem}`,
    `${list} ${line}>span,${list} ${fileLine} span{font-size:var(--conversation-step-size)}`,
    `${list} ${reminder}>button{height:1.25rem;padding:0 0.375rem;font-size:var(--conversation-step-size)}`,
    // past the frame's 4px and its border, then 4px
    `${list} ${file}>div{padding-left:9px}`,

    // 无框行: each line as wide as its words, 28px, 13px, 8px off the
    // bubble; a card answered in place to the cap.
    `${rows}{margin-top:0.5rem}`,
    `${rows} ${cards}{width:fit-content;max-width:100%}`,
    `${rows} ${answering}{width:auto}`,
    `${rows} ${line},${rows} ${fileLine}{min-height:1.75rem}`,
    `${rows} ${objects}{font-size:12px}`,
    `${rows} ${reminder}>button{height:1.5rem;padding-top:0;padding-bottom:0}`,
    `${rows} ${file}>div{padding-left:0.25rem}`,
  ];
}

// ---- The pill -----------------------------------------------------------

const OPTION =
  "whitespace-nowrap rounded-sm px-1.5 py-px text-left outline-none enabled:hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30";

function Column<T extends string>({
  name,
  options,
  value,
  onPick,
  disabled = false,
}: {
  name: string;
  options: Options<T>;
  value: T;
  onPick: (level: T) => void;
  /** Greyed and still (宽度 and 高度 outside 有框); the pick is kept. */
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-disabled={disabled || undefined}
      className={cn(
        "flex flex-col items-stretch gap-px",
        disabled && "opacity-40",
      )}
    >
      <span className="select-none px-1.5 text-ink-muted">{name}</span>
      {options.map(([level, label]) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          data-trial-option={level}
          disabled={disabled}
          onClick={() => onPick(level)}
          className={cn(
            OPTION,
            level === value
              ? "bg-selected font-medium text-ink"
              : "text-ink-soft",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const Rule = () => <span aria-hidden className="mx-1 w-px bg-line" />;
const Split = () => <span aria-hidden className="mx-1.5 h-px bg-line" />;

const PILL =
  "fixed bottom-1 right-3 z-[1000] border border-dashed border-warning/70 bg-elevated text-[12px] leading-[18px] shadow-card";

/**
 * The pill and the style (portalled to <body>); MainView mounts it in a
 * dev build. It writes the style onto <html>, and the width and height
 * under 有框 only. Folded, it is one small button with the style's name,
 * 4px off the window's bottom: under the main chat's composer, which
 * sits 24px off it.
 */
export function ReplyCardsTrial() {
  const pick = usePick();
  const boxed = pick.style === "box";
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.replyCardsStyle = pick.style;
    if (boxed) {
      root.replyCardsWidth = pick.width;
      root.replyCardsHeight = pick.height;
    } else {
      delete root.replyCardsWidth;
      delete root.replyCardsHeight;
    }
    return () => {
      delete root.replyCardsStyle;
      delete root.replyCardsWidth;
      delete root.replyCardsHeight;
    };
  }, [pick.style, boxed, pick.width, pick.height]);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  const styleName = STYLES.find(([level]) => level === pick.style)?.[1];
  return createPortal(
    <>
      <style>{replyCardsTrialCss()}</style>
      {pick.folded ? (
        <button
          type="button"
          data-role="reply-cards-trial-pill"
          aria-label="临时切换器：回复下的卡片，展开"
          aria-expanded={false}
          style={{ pointerEvents: "auto" }}
          onClick={() => setPick({ ...pick, folded: false })}
          className={cn(
            PILL,
            "flex h-5 items-center rounded-full px-2 text-[11px] leading-none text-ink-soft outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          临时 · 卡片 · {styleName}
        </button>
      ) : (
        <div
          role="group"
          aria-label="临时切换器：回复下的卡片"
          data-role="reply-cards-trial-pill"
          style={{ pointerEvents: "auto" }}
          className={cn(PILL, "rounded-lg px-1.5 pb-1.5 pt-1")}
        >
          <div className="flex items-center justify-between gap-2 pb-1 pl-1.5">
            <span className="select-none whitespace-nowrap text-ink-muted">
              临时 · 回复下的卡片
            </span>
            <button
              type="button"
              aria-expanded
              onClick={() => setPick({ ...pick, folded: true })}
              className={cn(OPTION, "text-ink-soft")}
            >
              收起
            </button>
          </div>
          <div className="flex items-stretch">
            <div className="flex flex-col gap-1.5">
              <Column
                name="样式"
                options={STYLES}
                value={pick.style}
                onPick={(style) => setPick({ ...pick, style })}
              />
              <Split />
              <Column
                name="状态"
                options={DEMOS}
                value={pick.demo}
                onPick={(demo) => setPick({ ...pick, demo })}
              />
              <Split />
              <Column
                name="数据"
                options={DATAS}
                value={pick.data}
                onPick={(data) => setPick({ ...pick, data })}
              />
            </div>
            <Rule />
            <div className="flex flex-col gap-1.5">
              <Column
                name="宽度"
                options={WIDTHS}
                value={pick.width}
                disabled={!boxed}
                onPick={(width) => setPick({ ...pick, width })}
              />
              <Split />
              <Column
                name="高度"
                options={HEIGHTS}
                value={pick.height}
                disabled={!boxed}
                onPick={(height) => setPick({ ...pick, height })}
              />
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
