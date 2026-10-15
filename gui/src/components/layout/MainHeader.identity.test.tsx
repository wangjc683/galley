import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { AssistantIdentity } from "./assistant/AssistantIdentity";
import { MainHeader } from "./MainHeader";

/**
 * The open main chat's header (main chat ticket 18): the assistant's
 * identity row is the trigger of the main chat's title menu — the
 * session's menu without rename — and its second line only says a
 * state. Static rendering never opens a Radix menu, so the menu renders
 * its items inline here.
 */
vi.mock("@radix-ui/react-dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Root: Pass,
    Portal: Pass,
    Trigger: ({ children }: { children: ReactElement }) => children,
    Content: ({ children }: { children?: ReactNode }) => (
      <div data-test-menu="">{children}</div>
    ),
    Item: ({ children }: { children?: ReactNode }) => (
      <div data-test-menu-item="">{children}</div>
    ),
    Separator: () => <hr />,
  };
});

const live = vi.hoisted(() => new Map<string, Partial<SessionStatusView>>());
vi.mock("@/hooks/useSessionStatusView", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionStatusView")>();
  return {
    ...actual,
    useSessionStatusView: (session: Session) => ({
      ...actual.useSessionStatusView(session),
      ...live.get(session.id),
    }),
  };
});

const subtaskAsking = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      return subtaskAsking.on && args[0].length > 0
        ? { ...view, kind: "ask" as const }
        : view;
    },
  };
});

// While it runs, the line says the conversation line's sentence, which
// the store holds and a static render cannot see; seed it here
// (hooks/useAssistantSentence.test.ts covers how it is worked out).
const running = vi.hoisted(() => ({ sentence: null as string | null }));
vi.mock("@/hooks/useAssistantSentence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantSentence")>();
  return {
    ...actual,
    useAssistantSentence: (_id: string, isRunning: boolean) =>
      isRunning ? running.sentence : null,
  };
});

afterEach(() => {
  live.clear();
  subtaskAsking.on = false;
  running.sentence = null;
});

const mainChat = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
  summary: "查厦门明天的天气",
  lastStepIndex: 2,
  hasUnread: true,
});
const subtask = makeSession({
  id: "s-sub",
  origin: { via: "subtask" },
  parentSessionId: "s-main",
});

function header(
  props: Partial<Parameters<typeof MainHeader>[0]> = {},
  subtasks: Session[] = [],
) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <MainHeader
        sessionTitle="Galley"
        identity={<AssistantIdentity mainChat={mainChat} subtasks={subtasks} />}
        onReinjectTools={() => {}}
        onTogglePet={() => {}}
        {...props}
      />
    </Tooltip.Provider>,
  );
}

const LINE = 'data-role="assistant-status-line"';
const statusLine = (html: string) => {
  const i = html.indexOf(LINE);
  return i < 0
    ? null
    : html.slice(html.indexOf(">", i) + 1, html.indexOf("<", i));
};

describe("the open main chat's header", () => {
  it("makes the identity row the title menu's trigger, without rename", () => {
    const html = header();
    // One button holds the avatar, the name and the caret after it.
    const trigger = html.slice(
      html.lastIndexOf(
        "<button",
        html.indexOf('data-role="assistant-identity"'),
      ),
      html.indexOf("</button>"),
    );
    expect(trigger).toContain('aria-label="Galley · 更多对话操作"');
    expect(trigger).toContain('data-role="assistant-avatar"');
    expect(trigger).toMatch(/>Galley<\/span><svg/);
    // It hovers like the title button.
    expect(trigger).toContain("hover:bg-hover data-[state=open]:bg-hover");
    // The menu: the session's, minus rename.
    const menu = html.slice(html.indexOf("data-test-menu"));
    expect(menu).toContain("重新注入工具");
    expect(menu).toContain("桌面宠物");
    expect(menu).not.toContain("重命名");
    // Nothing in it drags the window: it is a button.
    expect(trigger).not.toContain("data-tauri-drag-region");
  });

  it("keeps rename on an ordinary session's title menu", () => {
    const html = header({
      sessionTitle: "订机票",
      identity: undefined,
      onRenameSession: () => {},
    });
    expect(html).not.toContain('data-role="assistant-identity"');
    expect(html).toContain(">订机票<");
    expect(html.slice(html.indexOf("data-test-menu"))).toContain("重命名");
  });

  it("has no second line at rest, even with a new reply", () => {
    expect(statusLine(header())).toBeNull();
  });

  it("says only a state: running, waiting without the question, an error, a subtask's", () => {
    // Running: the conversation line's sentence (ruling 68), 「思考中」
    // before it says anything — not 「第 N 步 · 摘要」, though the main
    // chat has both.
    live.set("s-main", { status: "running" });
    expect(statusLine(header())).toBe("思考中");
    running.sentence = "我按 10 月 17 日和 18 日这两天查。";
    expect(statusLine(header())).toBe("我按 10 月 17 日和 18 日这两天查。");
    expect(header()).toMatch(
      /data-role="assistant-status-line"[^>]*text-brand-strong\/85/,
    );

    live.set("s-main", { status: "running", hasPendingAskUser: true });
    const asking = header();
    expect(statusLine(asking)).toBe("等你回复");
    expect(asking).toMatch(
      /data-role="assistant-status-line"[^>]*text-warning/,
    );

    live.set("s-main", { status: "error" });
    expect(statusLine(header())).toBe("出错");

    live.clear();
    subtaskAsking.on = true;
    expect(statusLine(header({}, [subtask]))).toBe("子任务在问你");
  });
});
