import { searchMessages, type MessageSearchHit } from "@/lib/db";
import type { ResolvedLanguage } from "@/lib/language";
import {
  formatMessageTime,
  type MessageTimeDayWords,
} from "@/lib/message-time";
import type { RuntimeKind, Session } from "@/types/session";

/**
 * Finding in one conversation (main chat ticket 28, PRD ruling 77): ⌘F
 * and the title menu's 查找聊天记录 open ⌘K's palette with a scope — the
 * conversation open in the main area. The palette then searches only
 * its messages and dates each hit; Backspace in the empty input (or the
 * scope's ×) drops the scope and it is ⌘K again. Slack's ⌘F (`in:` the
 * current channel) and WeChat's 查找聊天记录 are the precedents.
 *
 * The rules live here as pure functions; the UI store, the shortcut
 * and the palette call them.
 */
export interface PaletteScope {
  sessionId: string;
  /** The main chat: 「在主对话里」, otherwise 「在这个对话里」. */
  mainChat: boolean;
}

export interface PaletteState {
  open: boolean;
  /** null: ⌘K, everywhere. */
  scope: PaletteScope | null;
}

/**
 * The conversation ⌘F finds in: the one open in the main area, unless
 * Settings is over it. null when none is (the new-chat empty state,
 * onboarding, Settings): ⌘F is then ⌘K.
 */
export function openConversationScope({
  screen,
  settingsOpen,
  activeSessionId,
  sessions,
}: {
  screen: string;
  settingsOpen: boolean;
  activeSessionId: string | undefined;
  sessions: readonly Session[];
}): PaletteScope | null {
  if (screen !== "main" || settingsOpen || !activeSessionId) return null;
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session || session.status === "archived") return null;
  return { sessionId: session.id, mainChat: session.mainChat === true };
}

/**
 * ⌘F, from whatever the palette is doing. With a conversation it opens
 * the palette inside it — a ⌘K palette already open takes the scope —
 * and a second ⌘F closes it, as a second ⌘K does. Without one it is
 * ⌘K: a toggle, everywhere.
 */
export function paletteAfterFind(
  current: PaletteState,
  target: PaletteScope | null,
): PaletteState {
  if (!target) {
    return current.open
      ? { open: false, scope: null }
      : { open: true, scope: null };
  }
  if (current.open && current.scope?.sessionId === target.sessionId) {
    return { open: false, scope: null };
  }
  return { open: true, scope: target };
}

/**
 * Backspace in the empty input drops the scope, the way it deletes a
 * Slack `in:` token. Never while an IME composes: that Backspace edits
 * the composition (the input can read empty while it does).
 */
export function dropsScope({
  scoped,
  key,
  value,
  composing,
}: {
  scoped: boolean;
  key: string;
  value: string;
  composing: boolean;
}): boolean {
  return scoped && key === "Backspace" && value === "" && !composing;
}

/** ⌘K's message hits share the list with sessions and actions. */
export const PALETTE_MESSAGE_HITS = 8;
/** Inside one conversation the hits are the whole list: as many as
 * `searchMessages` returns by default (and the CLI's search). */
export const SCOPED_MESSAGE_HITS = 20;

/** What the palette asks Core for a query. */
export function paletteSearchRequest(
  query: string,
  scope: PaletteScope | null,
  runtimeKind: RuntimeKind,
): {
  query: string;
  limit: number;
  runtimeKind: RuntimeKind;
  sessionId?: string;
} {
  return scope
    ? {
        query,
        limit: SCOPED_MESSAGE_HITS,
        runtimeKind,
        sessionId: scope.sessionId,
      }
    : { query, limit: PALETTE_MESSAGE_HITS, runtimeKind };
}

/** The palette's full-text search for a query: ⌘K's, or inside
 * `scope` (Core's `search_messages` with the session). */
export function paletteSearch(
  query: string,
  scope: PaletteScope | null,
  runtimeKind: RuntimeKind,
): Promise<MessageSearchHit[]> {
  const request = paletteSearchRequest(query, scope, runtimeKind);
  return searchMessages(
    request.query,
    request.limit,
    request.runtimeKind,
    request.sessionId,
  );
}

/**
 * What the scoped list shows:
 *
 *   hint     under two characters — nothing is searched yet
 *   hits     hits to show (the last query's, until the next arrive)
 *   pending  the query is out, nothing to show yet
 *   empty    the query came back with nothing
 *
 * `hitsFor` is the query the current hits answer. Waiting reads as
 * nothing rather than 「没找到」, which would flash while typing.
 */
export function scopedListView(
  query: string,
  hitsFor: string | null,
  hitCount: number,
): "hint" | "hits" | "pending" | "empty" {
  const q = query.trim();
  if (q.length < 2) return "hint";
  if (hitCount > 0) return "hits";
  return hitsFor === q ? "empty" : "pending";
}

/**
 * A scoped hit's first line: when it was said, in the conversation time
 * bar's shapes with the day word kept (「今天 21:40」「昨天 09:12」
 * 「10月13日 21:40」, the year when it is not this year's) — every hit
 * shares the session title, so the date is the clue. Null when the
 * timestamp does not parse.
 */
export function scopedHitDate(
  createdAt: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: MessageTimeDayWords,
): string | null {
  return formatMessageTime(createdAt, todayStartMs, language, {
    withTodayWord: true,
    words,
  });
}
