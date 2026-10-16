import { isMac, isWindows } from "@/lib/platform";

/**
 * Width-driven layout of the Sidebar's top two rows, as container-query
 * classes against the `@container/sidebar` on the Sidebar root. That
 * container's width is the sidebar panel width minus the `<aside>`'s
 * 1px border-r (AppShell), and both SidebarHeader and the new-chat row
 * span it edge to edge, so one number serves both.
 *
 * Wide (≥ threshold): SidebarHeader is the wordmark plus the 搜索 /
 * 定时 / 项目 icons; the new-chat row is 新对话 alone with a ⌘N hint.
 * Narrow (< threshold): the header is the wordmark alone and the three
 * icons sit in the new-chat row, the 2026-09-28 one-row layout. The
 * row exists in both states, so crossing the threshold never moves the
 * session list vertically.
 *
 * Threshold = what the header needs: pl + wordmark 46.8 (Newsreader
 * italic 500 at 17px, tracking 0.005em, measured from the font file) +
 * gap-3 12 + icons 3 × 28 + 2 × gap-1 4 (= 92) + pr.
 *   mac      88 + 46.8 + 12 + 92 + 12 = 250.8 -> 251px
 *   Windows  16 + 46.8 + 12 + 92 + 22 = 188.8 -> 189px
 *   other    16 + 46.8 + 12 + 92 + 12 = 178.8 -> 179px
 * Windows' pr is 12 + the 10px scrollbar lane (globals.css
 * `::-webkit-scrollbar` width): the session list reserves it with
 * `scrollbar-gutter: stable`, which pulls the rows' `⋯` column 10px
 * left, and the 项目 icon must stay centred over that column.
 * macOS overlay scrollbars and Linux (no `.scrollbar-stable` rule)
 * reserve nothing.
 *
 * Every class is written out in full so Tailwind emits it. The
 * defaults (no container-query support) are the narrow state, which
 * is the old one-row layout.
 *
 * This is the external runtime's masthead; with a main chat it has no
 * wordmark and its own numbers (`ASSISTANT_*`, at the end).
 */

/** SidebarHeader right padding: 项目 sits over the rows' `⋯` column
 * (row mx-1.5 + trigger right-1.5 = 12px, both 28px wide). */
export const SIDEBAR_HEADER_PR = isWindows ? "pr-[22px]" : "pr-3";

/** The icon group's copy in SidebarHeader. */
export const HEADER_NAV_ICONS_DISPLAY = isMac
  ? "hidden @min-[251px]/sidebar:flex"
  : isWindows
    ? "hidden @min-[189px]/sidebar:flex"
    : "hidden @min-[179px]/sidebar:flex";

/** The icon group's copy in the new-chat row — the complement. */
export const ROW_NAV_ICONS_DISPLAY = isMac
  ? "flex @min-[251px]/sidebar:hidden"
  : isWindows
    ? "flex @min-[189px]/sidebar:hidden"
    : "flex @min-[179px]/sidebar:hidden";

/** ⌘N hint at the new-chat row's end: only while the row is alone. */
export const NEW_CHAT_HINT_DISPLAY = isMac
  ? "hidden @min-[251px]/sidebar:block"
  : isWindows
    ? "hidden @min-[189px]/sidebar:block"
    : "hidden @min-[179px]/sidebar:block";

/**
 * Where 新对话's text hides, leaving only the plus. Only the narrow
 * state can need this: alone, the row needs ~96px (zh) / ~116px (en),
 * under the 134px minimum sidebar. With the icons in the row it needs
 * row mx-1.5 12 + [pl-3 12 + plus column 16 + gap-2 8 + text + pr-2 8] +
 * 3 gaps × 2 + 3 icons × 32 = 158px + text: 新对话 is 3 × 13 = 39px
 * -> 197px, kept at 198; New chat is 58.8px (Inter 500 13px, measured)
 * -> 216.8, rounded up to 220px. (Before 2026-10-08 the plus was 15px
 * + gap-2.5, 1px more.) Each value is capped at the platform's narrow
 * threshold, since above that the icons have left the row: on mac
 * both fit under 251 and stand as is; Windows (189) and other (179)
 * cap both locales, so the narrow state there is always plus-only.
 */
export const NEW_CHAT_LABEL_HIDDEN = isMac
  ? { zh: "@max-[198px]/sidebar:hidden", en: "@max-[220px]/sidebar:hidden" }
  : isWindows
    ? { zh: "@max-[189px]/sidebar:hidden", en: "@max-[189px]/sidebar:hidden" }
    : { zh: "@max-[179px]/sidebar:hidden", en: "@max-[179px]/sidebar:hidden" };

/**
 * With a main chat (the managed runtime, main chat ticket 18) the
 * masthead has no wordmark — 「Galley」 is the assistant's name on the
 * card under it — and the new-chat row under the card is the scrolling
 * list's sticky first row. Since ticket 42 the masthead holds two icons,
 * 搜索 and 新建项目 (the 待办 icon gave way to the row under the card).
 * Same one-threshold rule as above, new numbers.
 *
 * Masthead: pl (80 under the macOS traffic lights, the collapse
 * toggle's 80; 16 elsewhere) + icons 2 × 28 + gap-1 4 (= 60) + pr (12;
 * Windows 22).
 *   mac      80 + 60 + 12 = 152px
 *   Windows  16 + 60 + 22 =  98px, under the 133.4px narrowest content
 *   other    16 + 60 + 12 =  88px  (14% of a 960 window, minus 1px)
 * so only macOS has a narrow state: below 152px the two icons move
 * into the new-chat row, the external runtime's one-row layout.
 *
 * New-chat row, alone: mx-1.5 12 + pl-3 12 + plus 16 + gap-2 8 + label
 * + pr-2 8 = 56 + label (新对话 39, New chat 58.84), and the hint adds
 * itself + its pr-3 12 (Chrome: ⌘N 16.6px, Ctrl+N 39.4px; ~1.5px over
 * for WebKit). On Windows the row gives up the list's 10px scrollbar
 * lane.
 *   mac      zh 123.6 / en 143.4 (+1.5) — under 152: the hint shows
 *            whenever the row is alone; in the narrow state the label
 *            beside the two icons needs 56 + 2 gaps × 2 + 2 × 32 = 124
 *            + label, zh 163 / en 182.84, both over 152, so the row is
 *            the plus and the icons.
 *   Windows  label: zh 105 / en 124.8, always fits; hint: zh 156.4 +
 *            1.5 -> 158px, en 176.2 + 1.5 -> 178px
 *   other    label always fits; hint: zh 146.4 + 1.5 -> 148px, en
 *            166.2 + 1.5 -> 168px
 */

/** The masthead's icon group, with a main chat. */
export const ASSISTANT_HEADER_NAV_ICONS_DISPLAY = isMac
  ? "hidden @min-[152px]/sidebar:flex"
  : "flex";

/** The new-chat row's icon group, with a main chat — the complement. */
export const ASSISTANT_ROW_NAV_ICONS_DISPLAY = isMac
  ? "flex @min-[152px]/sidebar:hidden"
  : "hidden";

/** The new-chat row's ⌘N, by UI language, with a main chat. */
export const ASSISTANT_NEW_CHAT_HINT_DISPLAY: { zh: string; en: string } = isMac
  ? {
      zh: "hidden @min-[152px]/sidebar:block",
      en: "hidden @min-[152px]/sidebar:block",
    }
  : isWindows
    ? {
        zh: "hidden @min-[158px]/sidebar:block",
        en: "hidden @min-[178px]/sidebar:block",
      }
    : {
        zh: "hidden @min-[148px]/sidebar:block",
        en: "hidden @min-[168px]/sidebar:block",
      };

/** Where 新对话's text hides, with a main chat: only in the macOS
 * narrow state, beside the icons. */
export const ASSISTANT_NEW_CHAT_LABEL_HIDDEN: { zh: string; en: string } = isMac
  ? { zh: "@max-[152px]/sidebar:hidden", en: "@max-[152px]/sidebar:hidden" }
  : { zh: "", en: "" };
