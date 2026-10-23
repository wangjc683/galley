import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * While the main chat runs (main chat ticket 90, PRD ruling 134): the
 * typing bubble, the header's identity row and the sidebar card, as
 * today's markup — snapshots taken before the switcher was written, so
 * 「现状」 can be held to them byte for byte.
 */

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
    expect(card(sidebar("s-side"))).toMatchSnapshot("away");
    seeded.typing = false;
    expect(card(sidebar("s-main"))).toMatchSnapshot("woken, open");
    expect(card(sidebar("s-side"))).toMatchSnapshot("woken, away");
  });
});
