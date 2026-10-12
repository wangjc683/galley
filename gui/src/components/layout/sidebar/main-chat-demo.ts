import { createContext, useMemo } from "react";

import { findMainChat } from "@/lib/main-chat";
import { SCHEDULER_SUPERVISOR } from "@/lib/scheduled-tasks";
import { isHumanStarted } from "@/lib/sidebar-timeline";
import type { Session } from "@/types/session";

import { useMainChatLayoutStore } from "./main-chat-layout";

/**
 * TEMPORARY — the sidebar trial's demo states (ticket 07; see
 * main-chat-layout.ts). JC's own data is mostly idle, so the layouts
 * can't be judged in the states they are for. With the demo on, the
 * sidebar renders over the real list:
 *
 *   - the main chat 在问你 (standing in for a subtask asking);
 *   - four side chats (the newest a person started, outside projects
 *     and 置顶; fakes fill in when there are fewer): 在跑 with a step
 *     summary, 在问你, 出错, 有新回复;
 *   - two fake agent-started sessions — a scheduled task's and a CLI
 *     one that 在问你 — so B's 「其他来源」 row shows, with a row
 *     hanging out under it.
 *
 * Render layer only: copies of the session rows with display fields
 * patched, plus live flags the two status hooks read through
 * MainChatDemoLiveContext instead of the stores. Nothing is written to
 * a store and nothing reaches Core; Sidebar drops every action aimed
 * at a fake row (ids under DEMO_ID_PREFIX). Remove with the switcher.
 */

/** Live state the demo fakes for one session. */
export interface MainChatDemoLive {
  running?: boolean;
  ask?: boolean;
  error?: boolean;
}

export type MainChatDemoLiveMap = ReadonlyMap<string, MainChatDemoLive>;

/** Read by useSessionStatusView / useSessionsAttention; null = no demo. */
export const MainChatDemoLiveContext =
  createContext<MainChatDemoLiveMap | null>(null);

const DEMO_ID_PREFIX = "demo:";

export function isDemoSessionId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX);
}

export interface MainChatDemo {
  sessions: Session[];
  live: MainChatDemoLiveMap;
}

const SIDE_CHAT_FILL_TITLES = [
  "周末去杭州的行程",
  "整理九月的报销单",
  "显卡驱动报错",
  "给房东回邮件",
];

/** Build the overlay. `anchor` (ISO) is "now" for the fake sessions. */
export function buildMainChatDemo(
  sessions: Session[],
  anchor: string,
): MainChatDemo | null {
  const mainChat = findMainChat(sessions);
  if (!mainChat) return null;
  const anchorMs = new Date(anchor).getTime();
  const minutesAgo = (minutes: number) =>
    new Date(anchorMs - minutes * 60_000).toISOString();
  const fake = (id: string, title: string, minutes: number, extra = {}) =>
    ({
      id: `${DEMO_ID_PREFIX}${id}`,
      title,
      status: "idle",
      errorCount: 0,
      lastActivityAt: minutesAgo(minutes),
      createdAt: minutesAgo(minutes),
      updatedAt: minutesAgo(minutes),
      runtimeKind: mainChat.runtimeKind,
      runtimeLabel: mainChat.runtimeLabel,
      gaRuntimeKind: mainChat.gaRuntimeKind,
      origin: { via: "gui" },
      ...extra,
    }) as Session;

  const live = new Map<string, MainChatDemoLive>();
  live.set(mainChat.id, { ask: true });

  const candidates = sessions
    .filter(
      (s) =>
        !s.mainChat &&
        !s.pinned &&
        !s.projectId &&
        s.status !== "archived" &&
        isHumanStarted(s),
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, 4);
  const fills = SIDE_CHAT_FILL_TITLES.slice(candidates.length).map((title, i) =>
    fake(`side-${i}`, title, 20 + i * 15),
  );
  const [running, asking, erroring, unread] = [...candidates, ...fills];
  const patches = new Map<string, Partial<Session>>([
    [running.id, { lastStepIndex: 3, summary: "对比三家航司的退改规则" }],
    [erroring.id, { errorCount: 1 }],
    [unread.id, { hasUnread: true }],
  ]);
  live.set(running.id, { running: true });
  live.set(asking.id, { ask: true });
  live.set(erroring.id, { error: true });

  const agentFakes = [
    fake("agent-scheduled", "每日 GitHub 通知摘要", 45, {
      origin: { via: "supervisor", supervisor: SCHEDULER_SUPERVISOR },
      summary: "今天有 3 条新 issue",
    }),
    fake("agent-cli", "回归 #12：设置页截图", 10, {
      origin: { via: "cli" },
    }),
  ];
  live.set(agentFakes[1].id, { ask: true });

  const patched = sessions.map((s) => {
    const patch = patches.get(s.id);
    return patch ? { ...s, ...patch } : s;
  });
  const patchedFills = fills.map((s) => {
    const patch = patches.get(s.id);
    return patch ? { ...s, ...patch } : s;
  });
  return {
    sessions: [...patched, ...patchedFills, ...agentFakes],
    live,
  };
}

/** The overlay for `sessions` while the demo is on (and there is a main
 * chat), else null. */
export function useMainChatDemoOverlay(
  sessions: Session[],
): MainChatDemo | null {
  const demo = useMainChatLayoutStore((s) => s.demo);
  const anchor = useMainChatLayoutStore((s) => s.demoAnchor);
  return useMemo(
    () => (demo ? buildMainChatDemo(sessions, anchor) : null),
    [demo, sessions, anchor],
  );
}
