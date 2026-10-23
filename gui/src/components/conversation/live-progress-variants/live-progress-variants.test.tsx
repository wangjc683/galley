import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunElapsedHud } from "@/components/conversation/RunElapsedHud";
import { AssistantIdentity } from "@/components/layout/assistant/AssistantIdentity";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainView } from "@/components/screens/MainView";
import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import type { AssistantLastMessage } from "@/lib/assistant";
import { CopyProvider } from "@/lib/i18n";
import { LocalFilesContext } from "@/lib/local-files";
import type { PerSessionMessages } from "@/stores/messages";
import { makeSession } from "@/test/factories";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * The temporary switcher for what the main chat says while it runs (main
 * chat ticket 90, PRD ruling 134), the real components rendered: 「现状」
 * is today's markup to the byte — the typing bubble, the header's
 * identity row and the sidebar card, snapshots taken before the switcher
 * was written — and 「新」 hangs 「{在做什么} · {用时}」 under the dots in
 * a round you started, leaves the header's second line empty while it
 * runs, and says 「正在工作…」 on the card (the minutes away from the main
 * chat); the workbench, a subtask and the external runtime are the same
 * in both; the switcher touches only the places its removal steps name.
 * The marker is spelt in two halves here so this file is not one of its
 * own hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 90)"].join(" ");

const NOW = Date.UTC(2026, 9, 23, 4, 0, 0);

// The live state MainView reads off the active session: a static render
// reads the stores' initial state, so the tests hand it in here.
const live = vi.hoisted(() => ({
  slice: {} as Partial<PerSessionMessages>,
}));
vi.mock("@/hooks/useActiveSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useActiveSession")>();
  const { EMPTY_MESSAGES } = await import("@/stores/messages");
  return {
    ...actual,
    useActiveMessages: <T,>(
      select: (m: PerSessionMessages) => T,
      fallback: T,
    ): T =>
      Object.keys(live.slice).length > 0
        ? select({ ...EMPTY_MESSAGES, ...live.slice })
        : fallback,
  };
});

// A session's live status, by id, on top of the real hook.
const status = vi.hoisted(() => new Map<string, Partial<SessionStatusView>>());
vi.mock("@/hooks/useSessionStatusView", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionStatusView")>();
  return {
    ...actual,
    useSessionStatusView: (session: Session) => ({
      ...actual.useSessionStatusView(session),
      ...status.get(session.id),
    }),
  };
});

// What the header and the card read from the messages store while it
// runs, seeded (hooks/useAssistantSentence.test.ts covers the rules).
const seeded = vi.hoisted(() => ({
  sentence: null as string | null,
  typing: true,
  lastMessage: null as AssistantLastMessage | null,
}));
vi.mock("@/hooks/useAssistantSentence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantSentence")>();
  return {
    ...actual,
    useAssistantSettledSentence: (_id: string, running: boolean) =>
      running ? seeded.sentence : null,
    useAssistantTyping: (_id: string, running: boolean) =>
      running && seeded.typing,
  };
});
vi.mock("@/hooks/useAssistantState", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantState")>();
  return {
    ...actual,
    usePendingQuestion: () => null,
    useAssistantLastMessage: () => seeded.lastMessage,
  };
});

// The variant, by hand: a static render reads a store's initial state.
const variant = vi.hoisted(() => ({ current: "now" as "now" | "new" }));
vi.mock("./live-progress-variants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./live-progress-variants")>();
  return { ...actual, useLiveProgressVariant: () => variant.current };
});

// 「新」's card reads, seeded the same way (the selector and the minutes'
// timer: hooks/useAssistantProgress.test.tsx).
const round = vi.hoisted(() => ({
  kind: "own" as "own" | "own-writing" | "woken",
  minutes: 0,
}));
vi.mock("@/hooks/useAssistantProgress", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantProgress")>();
  return {
    ...actual,
    useAssistantRound: (_id: string, running: boolean) =>
      running ? round.kind : null,
    useAssistantRunMinutes: (_id: string, active: boolean) =>
      active ? round.minutes : 0,
  };
});

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  live.slice = {};
  status.clear();
  seeded.sentence = null;
  seeded.typing = true;
  seeded.lastMessage = null;
  variant.current = "now";
  round.kind = "own";
  round.minutes = 0;
});

// ---- Fixtures ---------------------------------------------------------------

function tool(name: string): ConversationToolEvent {
  return {
    id: `t-${name}`,
    name,
    status: "success-historical",
    args: {},
  } as ConversationToolEvent;
}

function user(content: string, id: string): UserTurn {
  return { role: "user", content, messageId: id };
}

function answer(text: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${index}-${text}`,
  };
}

/** A tool step that wrote only its `<summary>` (no narration). */
function toolStep(summary: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    summary,
    tools: [tool("web_scan")],
    telemetry: { elapsedMs: 21_000 },
  };
}

/** Your message, nothing back yet. */
const SENT: Turn[] = [user("新赛季 NBA 东部你怎么预测？", "u-2")];

const STEPPED: Turn[] = [
  ...SENT,
  toolStep("已拿到东部各队休赛期动向；我查各队伤病与轮换。", 1),
];

/** It asked, and you answered: the run's first segment banked 26s. */
const ANSWERED: Turn[] = [
  ...STEPPED,
  {
    role: "agent",
    turnIndex: 2,
    finalAnswer: null,
    summary: "需要用户选东部还是西部；我问用户",
    tools: [tool("ask_user")],
    telemetry: { elapsedMs: 26_000 },
  },
  user("东部", "u-3"),
];

/** A round Core woke it for, after a reply. */
const REPORT: UserTurn = {
  role: "user",
  content: "[Galley — not a message from the user] …",
  messageId: "u-report",
  origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
};

/** GA's verbose dispatch marker after a reply (the runner drops the
 * 5-backtick output fence that follows it: workbench_bridge
 * `_FenceFilter`). */
const DISPATCH =
  '\n\n🛠️ Tool: `web_scan`  📥 args:\n````text\n{\n  "tabs_only": false\n}\n````\n';

const DISPATCHED_STREAM = `<thinking>先看伤病。</thinking>\n<summary>伤病已查完；我对比各队近三季的胜场</summary>${DISPATCH}`;

// ---- Renders ----------------------------------------------------------------

function mainView(props: Partial<ComponentProps<typeof MainView>>): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={SENT}
          llmDisplayName="model"
          activeSessionId="s-main"
          isMainChat
          isRunning
          {...props}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

const mainChat = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
});
const sideChat = makeSession({
  id: "s-side",
  title: "订机票",
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
  origin: { via: "gui" },
});

function identity(): string {
  return renderToStaticMarkup(
    <AssistantIdentity mainChat={mainChat} subtasks={[]} />,
  );
}

function sidebar(activeId: string): string {
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <Sidebar
          sessions={[mainChat, sideChat]}
          activeId={activeId}
          expandedProjectIds={[]}
          onNewChat={() => {}}
          onSelectSession={() => {}}
          onStartProjectConversation={() => {}}
          onArchiveSession={() => {}}
          onRenameSession={() => {}}
          onTogglePinSession={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** Every SVG as an empty one: the avatar's face and the icons are not
 * this ticket's, and drawn out they are most of the bytes. */
function withoutSvg(html: string): string {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
}

/** The card, from its button to the button's end. */
function card(html: string): string {
  const start = html.lastIndexOf(
    "<button",
    html.indexOf('data-role="assistant-card"'),
  );
  return withoutSvg(html.slice(start, html.indexOf("</button>", start) + 9));
}

/** The conversation area (the column, the corner clock's place, the
 * scroll button), up to the composer's stack. */
function conversationArea(html: string): string {
  const start = html.indexOf("<div data-conversation-area");
  const end = html.indexOf('<div class="bg-app px-8 pb-6">', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return withoutSvg(html.slice(start, end));
}

/** The `<div` at `start` up to its own `</div>`. */
function element(html: string, start: number): string {
  let depth = 0;
  const tag = /<div[\s>]|<\/div>/g;
  tag.lastIndex = start;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + 6);
  }
  throw new Error("unclosed <div>");
}

/** The typing bubble's row (its `role="status"` root), or null. */
function typingRow(html: string): string | null {
  const i = html.indexOf('<div data-role="assistant-typing"');
  return i < 0 ? null : element(html, i);
}

/** The line under the dots, or null. */
function progressLine(html: string): string | null {
  const i = html.indexOf('<div data-role="assistant-progress"');
  return i < 0 ? null : element(html, i);
}

const textOf = (fragment: string | null) =>
  fragment === null ? null : fragment.replace(/<[^>]*>/g, "");

/** The card's second line's words, or null. */
function cardLine(html: string): string | null {
  const body = card(html);
  const i = body.indexOf('data-role="assistant-card-line"');
  return i < 0 ? null : body.slice(body.lastIndexOf("<", i));
}

// ---- 现状 -------------------------------------------------------------------

describe("现状: today's markup while it runs, to the byte", () => {
  it("the conversation: the typing bubble from the send, between steps, at a dispatch, writing; a woken round writing", () => {
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    expect(conversationArea(mainView({}))).toMatchSnapshot("sent");
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    expect(conversationArea(mainView({ turns: STEPPED }))).toMatchSnapshot(
      "between steps",
    );
    live.slice = {
      currentRunStartedAtMs: NOW - 75_000,
      inFlightContent: DISPATCHED_STREAM,
    };
    expect(conversationArea(mainView({ turns: STEPPED }))).toMatchSnapshot(
      "dispatched",
    );
    live.slice = {
      currentRunStartedAtMs: NOW - 75_000,
      inFlightContent: "<summary>都查完了</summary>\n东部我看好",
    };
    expect(conversationArea(mainView({ turns: STEPPED }))).toMatchSnapshot(
      "writing",
    );
    live.slice = {
      currentRunStartedAtMs: NOW - 12_000,
      inFlightContent: "子任务查好了，",
    };
    expect(
      conversationArea(
        mainView({ turns: [...SENT, answer("交给子任务去查了。", 1), REPORT] }),
      ),
    ).toMatchSnapshot("woken, writing");
  });

  it("the header's identity row: 「思考中」, then the settled step's sentence", () => {
    status.set("s-main", { status: "running" });
    expect(identity()).toMatchSnapshot("thinking");
    seeded.sentence = "已拿到东部各队休赛期动向；我查各队伤病与轮换。";
    expect(identity()).toMatchSnapshot("sentence");
  });

  it("the card: running with the main chat open and away, a woken round between its words", () => {
    seeded.lastMessage = {
      fromUser: true,
      text: "新赛季 NBA 东部你怎么预测？",
    };
    status.set("s-main", { status: "running" });
    expect(card(sidebar("s-main"))).toMatchSnapshot("open");
    const away = card(sidebar("s-side"));
    expect(away).toMatchSnapshot("away");
    seeded.typing = false;
    expect(card(sidebar("s-main"))).toMatchSnapshot("woken, open");
    expect(card(sidebar("s-side"))).toMatchSnapshot("woken, away");
    // What 「新」 reads changes nothing here: its hooks are asked nothing.
    seeded.typing = true;
    round.minutes = 7;
    expect(card(sidebar("s-side"))).toBe(away);
  });
});

// ---- 新 ---------------------------------------------------------------------

describe("新: the line under the dots, in a round you started", () => {
  beforeEach(() => {
    variant.current = "new";
  });

  it("hangs 「{在做什么} · {用时}」 in the dots' row, under the bubble, from the send on", () => {
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    const row = typingRow(mainView({}))!;
    // The row is today's, the line after the bubble inside it.
    expect(row).toMatch(
      /^<div data-role="assistant-typing" role="status"><span class="sr-only">Galley 正在输入<\/span><div data-role="assistant-typing-bubble"/,
    );
    const line = progressLine(row)!;
    expect(row.endsWith(`${line}</div>`)).toBe(true);
    expect(textOf(line)).toBe("思考中 · 1 分 15 秒");
    // 6px under the bubble, one 18px line, 12px ink-soft, tabular
    // numbers, no wider than a reply bubble; no sweep, no motion.
    const box = line.slice(0, line.indexOf(">") + 1);
    for (const cls of [
      "mt-1.5",
      "flex",
      "h-[18px]",
      "text-[12px]",
      "leading-[18px]",
      "text-ink-soft",
      "tabular-nums",
      "max-w-[88%]",
    ]) {
      expect([cls, box.includes(cls)]).toEqual([cls, true]);
    }
    expect(line).not.toMatch(/shimmer|animate-|live-dot/);
    // The doing part gives way (fade, whole on hover); the time never.
    expect(line).toMatch(
      /<span data-role="assistant-progress-doing" class="truncate-fade min-w-0">思考中<\/span>/,
    );
    expect(line).toContain(
      '<span aria-hidden="true" data-role="assistant-progress-elapsed" class="shrink-0 whitespace-pre"> · 1 分 15 秒</span>',
    );
  });

  it("says what it is doing: before a dispatch, between steps, at a dispatch, writing", () => {
    for (const [turns, inFlightContent, said] of [
      [SENT, "<thinking>先想想", "思考中"],
      [STEPPED, "", "我查各队伤病与轮换"],
      [
        STEPPED,
        "<summary>伤病已查完；我对比各队近三季的胜场</summary>",
        "我查各队伤病与轮换",
      ],
      [STEPPED, DISPATCHED_STREAM, "我对比各队近三季的胜场"],
      [STEPPED, "<summary>都查完了</summary>\n东部我看好", "正在写回复"],
      [ANSWERED, "", "思考中"],
    ] as const) {
      live.slice = { currentRunStartedAtMs: NOW - 75_000, inFlightContent };
      const doing = progressLine(mainView({ turns: [...turns] }))!;
      expect(textOf(doing)?.split(" · ")[0]).toBe(said);
    }
  });

  it("has no time under a second, nor before the run has a clock", () => {
    live.slice = { currentRunStartedAtMs: NOW - 400 };
    expect(textOf(progressLine(mainView({})))).toBe("思考中");
    expect(mainView({})).not.toContain("assistant-progress-elapsed");
    live.slice = { inFlightContent: "<thinking>" };
    expect(textOf(progressLine(mainView({})))).toBe("思考中");
  });

  it("counts the time as the workbench's corner clock: its words, the answered segments added up", () => {
    const hud = (startedAtMs: number, baseMs = 0) =>
      textOf(
        renderToStaticMarkup(
          <RunElapsedHud startedAtMs={startedAtMs} baseMs={baseMs} />,
        ),
      )!.replace("工作中", "");
    for (const [ago, said] of [
      [1_000, "1 秒"],
      [59_000, "59 秒"],
      [60_000, "1 分 0 秒"],
      [75_000, "1 分 15 秒"],
    ] as const) {
      live.slice = { currentRunStartedAtMs: NOW - ago };
      expect(textOf(progressLine(mainView({})))).toBe(`思考中 · ${said}`);
      expect(hud(NOW - ago)).toBe(said);
    }
    // Answered its question: 26s banked, 10s since your answer; the time
    // it waited on you is in neither.
    live.slice = { currentRunStartedAtMs: NOW - 10_000 };
    expect(textOf(progressLine(mainView({ turns: ANSWERED })))).toBe(
      "思考中 · 36 秒",
    );
    expect(hud(NOW - 10_000, 26_000)).toBe("36 秒");
  });

  it("reads out what it is doing, never the ticking time", () => {
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    const row = typingRow(mainView({ turns: STEPPED }))!;
    // The row is the polite live region; inside it the time is hidden.
    expect(row).toMatch(/^<div[^>]*role="status"/);
    const elapsed = row.slice(
      row.lastIndexOf("<span", row.indexOf("assistant-progress-elapsed")),
    );
    expect(elapsed).toMatch(/^<span aria-hidden="true"/);
    expect(row).toMatch(/<span data-role="assistant-progress-doing"[^>]*>我查/);
    expect(row.match(/aria-hidden/g)).toHaveLength(2); // the dots, the time
  });

  it("draws no line in a round Core woke it for, nor while it asks; a woken round's dots as today", () => {
    live.slice = {
      currentRunStartedAtMs: NOW - 12_000,
      inFlightContent: "子任务查好了，",
    };
    const wokenArea = () =>
      conversationArea(
        mainView({ turns: [...SENT, answer("交给子任务去查了。", 1), REPORT] }),
      );
    const woken = wokenArea();
    expect(woken).toContain('data-role="assistant-typing"');
    expect(woken).not.toContain("assistant-progress");
    variant.current = "now";
    expect(wokenArea()).toBe(woken);
    variant.current = "new";
    live.slice = { currentRunStartedAtMs: NOW - 12_000 };
    const asking = mainView({
      turns: ANSWERED.slice(0, -1),
      pendingAskUser: { question: "看东部还是西部？", candidates: ["东部"] },
    });
    expect(asking).not.toContain('data-role="assistant-typing"');
    expect(asking).not.toContain("assistant-progress");
  });

  it("leaves the workbench, a subtask and the external runtime as they are", () => {
    live.slice = {
      currentRunStartedAtMs: NOW - 75_000,
      inFlightContent: DISPATCHED_STREAM,
    };
    const others = () =>
      [
        mainView({ turns: STEPPED, isMainChat: false }),
        mainView({
          turns: STEPPED,
          isMainChat: false,
          activeSessionId: "s-sub",
        }),
      ].join("\n");
    const now = others();
    variant.current = "new";
    expect(others()).toBe(now);
    expect(now).not.toContain("assistant-progress");
  });
});

describe("新: the header has no second line while it runs", () => {
  beforeEach(() => {
    variant.current = "new";
  });

  it("is a single line running, as at rest", () => {
    const rest = identity();
    expect(rest).not.toContain("assistant-status-line");
    status.set("s-main", { status: "running" });
    expect(identity()).toBe(rest);
    seeded.sentence = "已拿到东部各队休赛期动向；我查各队伤病与轮换。";
    expect(identity()).toBe(rest);
  });

  it("still says waiting for you and an error, as 现状 does", () => {
    for (const view of [
      { status: "running", hasPendingAskUser: true },
      { status: "error" },
    ] as const) {
      status.set("s-main", view);
      variant.current = "now";
      const today = identity();
      variant.current = "new";
      expect(identity()).toBe(today);
      expect(today).toContain("assistant-status-line");
    }
  });
});

describe("新: the card says 「正在工作…」, and away from the main chat what the screen would", () => {
  beforeEach(() => {
    variant.current = "new";
    seeded.lastMessage = {
      fromUser: true,
      text: "新赛季 NBA 东部你怎么预测？",
    };
    status.set("s-main", { status: "running" });
  });

  it("fills the six cells", () => {
    const say = (open: boolean) =>
      textOf(cardLine(sidebar(open ? "s-main" : "s-side")));
    for (const [kind, minutes, open, away] of [
      ["own-writing", 0, "正在工作…", "正在输入…"],
      ["own", 0, "正在工作…", "正在工作…"],
      ["own", 1, "正在工作…", "正在工作 · 1 分钟"],
      ["own", 3, "正在工作…", "正在工作 · 3 分钟"],
    ] as const) {
      round.kind = kind;
      round.minutes = minutes;
      expect([kind, minutes, say(true), say(false)]).toEqual([
        kind,
        minutes,
        open,
        away,
      ]);
    }
  });

  it("keeps the running tone and the face", () => {
    round.minutes = 2;
    const away = cardLine(sidebar("s-side"))!;
    expect(away).toContain('data-kind="running"');
    expect(away).toContain("text-brand-strong/85");
    expect(card(sidebar("s-side"))).toContain(
      'aria-label="Galley · 正在工作 · 2 分钟"',
    );
    // Everything above the line — the face, its badge, the name — as 现状.
    const upToLine = (html: string) =>
      card(html).slice(
        0,
        card(html).indexOf('data-role="assistant-card-line"'),
      );
    const now = sidebar("s-side");
    variant.current = "now";
    const today = sidebar("s-side");
    expect(upToLine(now).replace(/aria-label="[^"]*"/, "")).toBe(
      upToLine(today).replace(/aria-label="[^"]*"/, ""),
    );
  });

  it("leaves a woken round as 现状: 「正在输入…」 with the dots, else the last message", () => {
    round.kind = "woken";
    for (const typing of [false, true]) {
      seeded.typing = typing;
      for (const activeId of ["s-main", "s-side"]) {
        variant.current = "now";
        const today = card(sidebar(activeId));
        variant.current = "new";
        expect(card(sidebar(activeId))).toBe(today);
      }
    }
    expect(textOf(cardLine(sidebar("s-side")))).toBe("正在输入…");
    seeded.typing = false;
    expect(textOf(cardLine(sidebar("s-side")))).toBe(
      "你：新赛季 NBA 东部你怎么预测？",
    );
  });
});

// ---- The touch points ---------------------------------------------------------

describe("the switcher", () => {
  it("touches only the places its removal steps name", () => {
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          if (readFileSync(full, "utf8").includes(MARK)) {
            hits.push(path.relative(root, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(
      [
        "App.tsx",
        "components/conversation/TypingBubble.tsx",
        "components/conversation/live-progress-variants/LiveProgressVariantsPill.test.tsx",
        "components/conversation/live-progress-variants/LiveProgressVariantsPill.tsx",
        "components/conversation/live-progress-variants/live-progress-variants.ts",
        "components/layout/assistant/AssistantIdentity.tsx",
        "components/layout/sidebar/SidebarAssistant.tsx",
        "components/screens/MainView.tsx",
        "hooks/useAssistantProgress.test.tsx",
        "hooks/useAssistantProgress.ts",
        "hooks/useTypingBubbleHandoff.ts",
        "i18n/locales/en.ts",
        "i18n/locales/zh.ts",
        "lib/assistant-progress.test.ts",
        "lib/assistant-progress.ts",
        "lib/assistant.ts",
      ].sort(),
    );
  });
});
