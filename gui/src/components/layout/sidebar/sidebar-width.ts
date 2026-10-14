import { createContext, useContext } from "react";

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
 */

/** SidebarHeader right padding: 项目 sits over the rows' `⋯` column
 * (row mx-1.5 + trigger right-1.5 = 12px, both 28px wide). */
export const SIDEBAR_HEADER_PR = isWindows ? "pr-[22px]" : "pr-3";

/** One platform's set of the width-driven classes. */
export interface SidebarWidthClasses {
  /** SidebarHeader left padding: 88px under the macOS traffic lights,
   * the 16px gutter elsewhere (the reason is in SidebarHeader). */
  headerPadding: string;
  /** The icon group's copy in SidebarHeader. */
  headerNavIcons: string;
  /** The icon group's copy in the new-chat row — the complement. The
   * sectioned sidebar (with a main chat) has no new-chat row: below the
   * threshold the three icons get a row of their own under the masthead
   * (SidebarNarrowNavRow), which exists only in the narrow state —
   * crossing the threshold there moves the list by one row height. */
  rowNavIcons: string;
  /** ⌘N hint at the new-chat row's end: only while the row is alone. */
  newChatHint: string;
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
  newChatLabelHidden: { zh: string; en: string };
}

const MAC: SidebarWidthClasses = {
  headerPadding: "pl-[88px]",
  headerNavIcons: "hidden @min-[251px]/sidebar:flex",
  rowNavIcons: "flex @min-[251px]/sidebar:hidden",
  newChatHint: "hidden @min-[251px]/sidebar:block",
  newChatLabelHidden: {
    zh: "@max-[198px]/sidebar:hidden",
    en: "@max-[220px]/sidebar:hidden",
  },
};

const WINDOWS: SidebarWidthClasses = {
  headerPadding: "pl-4",
  headerNavIcons: "hidden @min-[189px]/sidebar:flex",
  rowNavIcons: "flex @min-[189px]/sidebar:hidden",
  newChatHint: "hidden @min-[189px]/sidebar:block",
  newChatLabelHidden: {
    zh: "@max-[189px]/sidebar:hidden",
    en: "@max-[189px]/sidebar:hidden",
  },
};

const OTHER: SidebarWidthClasses = {
  headerPadding: "pl-4",
  headerNavIcons: "hidden @min-[179px]/sidebar:flex",
  rowNavIcons: "flex @min-[179px]/sidebar:hidden",
  newChatHint: "hidden @min-[179px]/sidebar:block",
  newChatLabelHidden: {
    zh: "@max-[179px]/sidebar:hidden",
    en: "@max-[179px]/sidebar:hidden",
  },
};

/**
 * This platform's set. `trafficLights: false` is a macOS sidebar whose
 * header does not sit under the traffic lights (TEMPORARY, ticket 16:
 * the 甲 trial's icon rail carries them): no 88px to clear, and with no
 * scrollbar lane either it is the 16px-gutter set Linux uses.
 *
 * `navIconsInRow` (TEMPORARY, ticket 16: the 乙 trial, whose masthead
 * holds the space switch in the wordmark's place): the three icons stay
 * in the new-chat row at every width — the narrow state's one-row
 * layout — so the header never shows them and ⌘N never has the row to
 * itself; the label still hides at the narrow thresholds.
 */
export function sidebarWidthClasses({
  trafficLights = isMac,
  navIconsInRow = false,
}: {
  trafficLights?: boolean;
  navIconsInRow?: boolean;
} = {}): SidebarWidthClasses {
  const base = isMac && trafficLights ? MAC : isWindows ? WINDOWS : OTHER;
  if (!navIconsInRow) return base;
  return {
    ...base,
    headerNavIcons: "hidden",
    rowNavIcons: "flex",
    newChatHint: "hidden",
  };
}

/** The set the top rows read (SidebarHeader, SidebarNavIcons, the
 * new-chat row, SidebarNarrowNavRow). Without a provider it is this
 * platform's, as it always was; App provides another only while the
 * spaces trial (TEMPORARY, ticket 16) moves the masthead's contents. */
export const SidebarWidthContext = createContext<SidebarWidthClasses>(
  sidebarWidthClasses(),
);

export function useSidebarWidthClasses(): SidebarWidthClasses {
  return useContext(SidebarWidthContext);
}
