/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { previewKindByPath } from "@/lib/local-file-path";
import type { SubtaskCardState, SubtaskDispatch } from "@/lib/subtasks";
import { cn } from "@/lib/utils";
import type { PendingAskUser } from "@/types/conversation";

/*
 * TEMP variant switcher (main chat 131) — the cards under a main chat
 * reply (files, subtasks, to-dos, reminders, memos; main chat PRD ruling
 * 180): how wide and how tall they are, compared live in
 * `pnpm --dir gui tauri dev`. Everything the trial needs is in this file;
 * three places reach it in a dev build only (`import.meta.env.DEV`):
 * MainView mounts the pill and passes the files through
 * `useReplyCardsMixedFiles`, SubtaskCards passes a card's state through
 * `useReplyCardsDemoState`. A production build has no pill and draws the
 * cards as written (现状). The wrapper the cards hang in
 * (Conversation.tsx `afterAnswer`) carries `data-role="reply-cards"` for
 * good; it changes nothing by itself.
 *
 * The pill, at the window's bottom-right corner, has four columns; every
 * level is a button, the current one lit; the pick is kept in
 * localStorage, so a reload keeps it:
 *
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
 * Width and height are a <style> laid over the components' classes
 * (unlayered, so it beats Tailwind's utilities layer, as ticket 128's
 * switcher did), keyed on `data-reply-cards-width` / `-height` on <html>,
 * which the pill sets; the components stay as written.
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
 * and docs/design/conversation.md: the five cards' 「最宽同气泡」, and
 * their heights if 32 wins. 状态 and 数据 have nothing to write in.
 */

type Width = "now" | "jia" | "yi" | "bing";
type Height = "40" | "32";
type Demo = "real" | "asking" | "error";
type Data = "real" | "mixed";

export interface ReplyCardsPick {
  width: Width;
  height: Height;
  demo: Demo;
  data: Data;
}

type Options<T extends string> = readonly (readonly [T, string])[];

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
  width: "yi",
  height: "40",
  demo: "real",
  data: "real",
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
    width: oneOf(WIDTHS, s.width, DEFAULT_PICK.width),
    height: oneOf(HEIGHTS, s.height, DEFAULT_PICK.height),
    demo: oneOf(DEMOS, s.demo, DEFAULT_PICK.demo),
    data: oneOf(DATAS, s.data, DEFAULT_PICK.data),
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

// ---- 宽度 / 高度: the style ---------------------------------------------

/**
 * The style laid over the cards for each width and height but 现状 / 40
 * (those match nothing). A function, not a top-level string, so the
 * module keeps no top-level work.
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
  ].join("\n");
}

// ---- The pill -----------------------------------------------------------

const OPTION =
  "whitespace-nowrap rounded-sm px-1.5 py-px text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30";

function Column<T extends string>({
  name,
  options,
  value,
  onPick,
}: {
  name: string;
  options: Options<T>;
  value: T;
  onPick: (level: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex flex-col items-stretch gap-px"
    >
      <span className="select-none px-1.5 text-ink-muted">{name}</span>
      {options.map(([level, label]) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          data-trial-option={level}
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

/**
 * The pill and the style (portalled to <body>); MainView mounts it in a
 * dev build. It writes the width and height onto <html> for the style.
 */
export function ReplyCardsTrial() {
  const pick = usePick();
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.replyCardsWidth = pick.width;
    root.replyCardsHeight = pick.height;
    return () => {
      delete root.replyCardsWidth;
      delete root.replyCardsHeight;
    };
  }, [pick.width, pick.height]);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <style>{replyCardsTrialCss()}</style>
      <div
        role="group"
        aria-label="临时切换器：回复下的卡片"
        data-role="reply-cards-trial-pill"
        style={{ pointerEvents: "auto" }}
        className="fixed bottom-3 right-3 z-[1000] rounded-lg border border-dashed border-warning/70 bg-elevated px-1.5 pb-1.5 pt-1 text-[12px] leading-[18px] shadow-card"
      >
        <div className="select-none whitespace-nowrap px-1.5 pb-1 text-ink-muted">
          临时 · 回复下的卡片
        </div>
        <div className="flex items-stretch">
          <Column
            name="宽度"
            options={WIDTHS}
            value={pick.width}
            onPick={(width) => setPick({ ...pick, width })}
          />
          <Rule />
          <Column
            name="高度"
            options={HEIGHTS}
            value={pick.height}
            onPick={(height) => setPick({ ...pick, height })}
          />
          <Rule />
          <Column
            name="状态"
            options={DEMOS}
            value={pick.demo}
            onPick={(demo) => setPick({ ...pick, demo })}
          />
          <Rule />
          <Column
            name="数据"
            options={DATAS}
            value={pick.data}
            onPick={(data) => setPick({ ...pick, data })}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
