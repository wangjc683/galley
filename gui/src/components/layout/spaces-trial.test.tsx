import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpacesTrial } from "@/hooks/useSpacesTrial";
import { CopyProvider, copyForLanguage } from "@/lib/i18n";
import { openMainChat } from "@/lib/main-chat";
import {
  assistantBadgeKind,
  assistantStatusLine,
  landAtLaunch,
  launchesInWorkbench,
  rememberWorkbench,
  showsBadge,
  spaceBadges,
  spaceForShortcut,
  spaceOf,
  spacesActive,
  spacesLayout,
  switchSpace,
  workbenchBadge,
} from "@/lib/spaces-trial";
import { subtaskBreadcrumb } from "@/lib/subtasks";
import type { SessionBriefWire } from "@/stores/sessions/shared";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { Session } from "@/types/session";

import { MainHeader } from "./MainHeader";
import { Sidebar } from "./Sidebar";
import { AssistantIdentity } from "./spaces/AssistantIdentity";
import { SpaceSwitch } from "./spaces/SpaceSwitch";
import { SpacesRail } from "./spaces/SpacesRail";

/**
 * TEMPORARY — the assistant / workbench shell trial (`.scratch/main-chat`
 * ticket 16, lib/spaces-trial.ts). Delete with the trial; the winner's
 * cases move into the permanent tests.
 */

// A session's question / error / run can't be seeded in a store under
// static rendering; mark ids on top of the real hook (its unread, from
// `hasUnread`, still works).
const attention = vi.hoisted(
  () => new Map<string, "error" | "ask" | "running">(),
);
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      const kinds = args[0].map((s) => attention.get(s.id));
      const kind =
        (["error", "ask", "running"] as const).find((k) =>
          kinds.includes(k),
        ) ?? view.kind;
      const marked = args[0]
        .filter((s) => {
          const k = attention.get(s.id);
          return k === "error" || k === "ask";
        })
        .map((s) => s.id);
      return {
        ...view,
        kind,
        needsYouIds: new Set([...view.needsYouIds, ...marked]),
      };
    },
  };
});

// The pill's store under static rendering would only ever give its
// initial state; the hook reads the shell from here instead.
const trial = vi.hoisted(() => ({
  variant: "甲" as "现状" | "乙" | "甲",
  demo: false,
}));
vi.mock("@/lib/spaces-trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spaces-trial")>();
  return {
    ...actual,
    useSpacesTrialStore: <T,>(select: (s: typeof trial) => T) =>
      select(trial),
  };
});

const copy = copyForLanguage("zh-CN");
const tauriMocks = getTauriMocks();
const NOW = "2026-10-14T08:00:00.000Z";

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    origin: { via: "gui" },
    ...extra,
  });

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const sideChat = managed("s-side", { title: "订机票" });
const cliChat = managed("s-cli", { origin: { via: "cli" } });
const subtask = managed("s-sub", {
  title: "查天气",
  parentSessionId: "s-main",
  origin: { via: "subtask" },
});
const promoted = managed("s-promoted", {
  parentSessionId: "s-main",
  promoted: true,
});

function wrap(node: ReactNode): string {
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>{node}</Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

afterEach(() => {
  attention.clear();
  trial.variant = "甲";
  trial.demo = false;
  vi.unstubAllGlobals();
});

describe("which shell, which space", () => {
  it("has two spaces only for a trial shell with a main chat", () => {
    expect(spacesActive("现状", true)).toBe(false);
    // The external runtime (or a main chat not loaded yet): none.
    expect(spacesActive("乙", false)).toBe(false);
    expect(spacesActive("甲", false)).toBe(false);
    expect(spacesActive("乙", true)).toBe(true);
    expect(spacesActive("甲", true)).toBe(true);
  });

  it("takes the space from what the main area shows", () => {
    expect(spaceOf(mainChat)).toBe("assistant");
    expect(spaceOf(sideChat)).toBe("workbench");
    // A subtask opened from its card is the workbench's.
    expect(spaceOf(subtask)).toBe("workbench");
    // The empty new-chat composer.
    expect(spaceOf(undefined)).toBe("workbench");
  });

  it("lays out each shell: no sidebar in the assistant, the rail in both of 甲's", () => {
    expect(spacesLayout("乙", "assistant", "204px")).toEqual({
      sidebarHidden: true,
      rail: false,
      switchIn: "header",
      identity: true,
      sidebarMinSize: "204px",
    });
    expect(spacesLayout("乙", "workbench", "204px")).toEqual({
      sidebarHidden: false,
      rail: false,
      switchIn: "masthead",
      identity: false,
      sidebarMinSize: "204px",
    });
    expect(spacesLayout("甲", "assistant", "204px")).toEqual({
      sidebarHidden: true,
      rail: true,
      switchIn: null,
      identity: true,
      sidebarMinSize: undefined,
    });
    expect(spacesLayout("甲", "workbench")).toMatchObject({
      sidebarHidden: false,
      rail: true,
      identity: false,
    });
  });
});

describe("the badges", () => {
  it("gives the assistant its main chat row's state, error over question over unread, none while running", () => {
    expect(assistantBadgeKind("error", "idle")).toBe("error");
    expect(assistantBadgeKind("running", "error")).toBe("error");
    expect(assistantBadgeKind("ask", "error")).toBe("error");
    expect(assistantBadgeKind("ask", "idle")).toBe("ask");
    expect(assistantBadgeKind("running", "ask")).toBe("ask");
    expect(assistantBadgeKind("unread", "ask")).toBe("ask");
    expect(assistantBadgeKind("unread", "idle")).toBe("unread");
    expect(assistantBadgeKind("running", "idle")).toBeNull();
    // A subtask running or unread is no badge (it never reaches the row).
    expect(assistantBadgeKind("idle", "running")).toBeNull();
    expect(assistantBadgeKind("idle", "unread")).toBeNull();
    expect(assistantBadgeKind("idle", "idle")).toBeNull();
  });

  it("counts the workbench's conversations that need you", () => {
    expect(workbenchBadge({ kind: "idle", needsYouIds: new Set() })).toBeNull();
    expect(
      workbenchBadge({ kind: "running", needsYouIds: new Set() }),
    ).toBeNull();
    expect(
      workbenchBadge({ kind: "ask", needsYouIds: new Set(["a", "b"]) }),
    ).toEqual({ count: 2, tone: "warning" });
    expect(
      workbenchBadge({ kind: "error", needsYouIds: new Set(["a", "b"]) }),
    ).toEqual({ count: 2, tone: "error" });
  });

  it("shows a space's badge only from the other space", () => {
    expect(showsBadge("assistant", "workbench")).toBe(true);
    expect(showsBadge("assistant", "assistant")).toBe(false);
    expect(showsBadge("workbench", "assistant")).toBe(true);
    expect(showsBadge("workbench", "workbench")).toBe(false);
  });

  it("lets the demo fill in an unread assistant and one asking conversation, never over a real one", () => {
    expect(
      spaceBadges({ assistant: null, workbench: null, demo: true }),
    ).toEqual({ assistant: "unread", workbench: { count: 1, tone: "warning" } });
    expect(
      spaceBadges({
        assistant: "error",
        workbench: { count: 3, tone: "error" },
        demo: true,
      }),
    ).toEqual({ assistant: "error", workbench: { count: 3, tone: "error" } });
    expect(
      spaceBadges({ assistant: null, workbench: null, demo: false }),
    ).toEqual({ assistant: null, workbench: null });
  });

  const badges = {
    assistant: "unread" as const,
    workbench: { count: 2, tone: "error" as const },
  };

  it("乙's switch draws them on the space you are not in", () => {
    const inWorkbench = wrap(
      <SpaceSwitch
        placement="masthead"
        space="workbench"
        badges={badges}
        onSwitch={() => {}}
      />,
    );
    expect(inWorkbench).toContain('data-role="assistant-badge"');
    expect(inWorkbench).toContain('data-kind="unread"');
    expect(inWorkbench).not.toContain('data-role="workbench-badge"');
    expect(count(inWorkbench, 'aria-current="page"')).toBe(1);
    expect(inWorkbench).toMatch(/aria-label="工作台"[^>]*aria-current="page"/);

    const inAssistant = wrap(
      <SpaceSwitch
        placement="header"
        space="assistant"
        badges={badges}
        onSwitch={() => {}}
      />,
    );
    expect(inAssistant).toContain('data-role="workbench-badge"');
    expect(inAssistant).toContain('data-tone="error"');
    expect(inAssistant).toMatch(/data-role="workbench-badge"[^>]*>2</);
    expect(inAssistant).not.toContain('data-role="assistant-badge"');
    expect(inAssistant).toMatch(/aria-label="助手"[^>]*aria-current="page"/);
  });

  it("甲's rail does too, and carries the gear", () => {
    const inWorkbench = wrap(
      <SpacesRail
        space="workbench"
        badges={badges}
        onSwitch={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(inWorkbench).toContain('data-role="assistant-badge"');
    expect(inWorkbench).not.toContain('data-role="workbench-badge"');
    expect(inWorkbench).toContain('aria-label="打开设置"');

    const inAssistant = wrap(
      <SpacesRail
        space="assistant"
        badges={badges}
        onSwitch={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(inAssistant).toContain('data-role="workbench-badge"');
    expect(inAssistant).not.toContain('data-role="assistant-badge"');
  });

  it("names the badge in the item's label", () => {
    const html = wrap(
      <SpacesRail
        space="assistant"
        badges={badges}
        workbenchWords={copy.topbar.sidebarNeedsYou(2)}
        onSwitch={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).toContain('aria-label="工作台 · 2 个对话在等你"');
    expect(html).toContain('aria-label="助手"');
  });
});

describe("what the assistant is doing, under its name", () => {
  const idle = { summary: "查完了", lastStepIndex: 3, errorCount: 0 };

  it("says the main chat row's states, and nothing at rest", () => {
    expect(assistantStatusLine(idle, "running", "idle", copy)).toEqual({
      text: "第 3 步 · 查完了",
      tone: "running",
    });
    expect(
      assistantStatusLine(
        { ...idle, lastStepIndex: undefined },
        "running",
        "idle",
        copy,
      ),
    ).toEqual({ text: "思考中", tone: "running" });
    expect(assistantStatusLine(idle, "ask", "idle", copy)).toEqual({
      text: "在等你回复",
      tone: "warning",
    });
    expect(assistantStatusLine(idle, "running", "ask", copy)).toEqual({
      text: "子任务在问你",
      tone: "warning",
    });
    expect(
      assistantStatusLine({ ...idle, errorCount: 2 }, "error", "ask", copy),
    ).toEqual({ text: "出错 · 2", tone: "error" });
    expect(assistantStatusLine(idle, "ask", "error", copy)).toEqual({
      text: "子任务出错",
      tone: "error",
    });
    expect(assistantStatusLine(idle, "idle", "idle", copy)).toBeNull();
    expect(assistantStatusLine(idle, "unread", "idle", copy)).toBeNull();
  });

  it("renders in the header in the title's place, with no title menu", () => {
    const html = wrap(
      <MainHeader
        sessionTitle="主对话"
        titleSlot={
          <AssistantIdentity line={{ text: "在等你回复", tone: "warning" }} />
        }
      />,
    );
    expect(html).toContain('data-role="assistant-identity"');
    expect(html).toContain(">Galley<");
    expect(html).toMatch(/data-role="assistant-status-line"[^>]*text-warning/);
    expect(html).toContain(">在等你回复<");
    // No title menu: the session title is not there.
    expect(html).not.toContain(">主对话<");
  });

  it("has no second line at rest", () => {
    const html = wrap(<AssistantIdentity line={null} />);
    expect(html).toContain(">Galley<");
    expect(html).not.toContain("assistant-status-line");
  });

  it("leaves the gear to 甲's rail", () => {
    const html = wrap(<MainHeader sessionTitle="订机票" hideSettings />);
    expect(html).not.toContain('aria-label="打开设置"');
    expect(wrap(<MainHeader sessionTitle="订机票" />)).toContain(
      'aria-label="打开设置"',
    );
  });
});

describe("the workbench's sidebar", () => {
  const sessions = [mainChat, sideChat, cliChat, subtask];
  const render = (
    extra: { workbench?: boolean; mastheadLead?: ReactNode } = {},
  ) =>
    wrap(
      <Sidebar
        sessions={sessions}
        expandedProjectIds={[]}
        onNewChat={() => {}}
        onSelectSession={() => {}}
        {...extra}
      />,
    );

  it("is the sidebar without the main chat: no main chat row, no section, no 其他来源", () => {
    const html = render({ workbench: true });
    expect(html).not.toContain('data-session-id="s-main"');
    expect(html).not.toContain("data-sidebar-section-header");
    expect(html).not.toContain('data-project-id="galley:other-sources"');
    // The subtask nobody wrote in is the assistant's too.
    expect(html).not.toContain('data-session-id="s-sub"');
    // The 新对话 row heads the list; agent-started chats sit in its
    // buckets, as without a main chat.
    expect(html).toContain('aria-label="新对话"');
    expect(html).toContain('data-session-id="s-side"');
    expect(html).toContain('data-session-id="s-cli"');
  });

  it("stays as it was without the trial (现状)", () => {
    const html = render();
    expect(html).toContain('data-session-id="s-main"');
    expect(html).toContain("data-sidebar-section-header");
  });

  it("puts 乙's switch in the wordmark's place", () => {
    const html = render({
      workbench: true,
      mastheadLead: <span data-role="lead-probe">switch</span>,
    });
    expect(html).toContain('data-role="lead-probe"');
    expect(html).not.toContain(">Galley<");
    expect(render({ workbench: true })).toContain(">Galley<");
  });
});

describe("App's side (useSpacesTrial)", () => {
  type Props = Parameters<typeof useSpacesTrial>[0];
  function Probe(props: Props) {
    const view = useSpacesTrial(props);
    return (
      <pre>
        {JSON.stringify({
          active: view.active,
          space: view.space,
          layout: view.layout,
          badges: view.badges,
          line: view.statusLine,
          words: [view.assistantWords ?? null, view.workbenchWords ?? null],
        })}
      </pre>
    );
  }
  function view(sessions: Session[], shown: Session | undefined) {
    const html = renderToStaticMarkup(
      <Probe
        sessions={sessions}
        shown={shown}
        screen={shown ? "main" : "empty"}
        activeSessionId={shown?.id}
        activeProjectFilter={undefined}
        focusEmptyComposer={() => {}}
        copy={copy}
        language="zh-CN"
      />,
    );
    const json = html
      .replace(/^<pre>|<\/pre>$/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    return JSON.parse(json) as {
      active: boolean;
      space: string;
      layout: Record<string, unknown> | null;
      badges: { assistant: string | null; workbench: unknown };
      line: { text: string } | null;
      words: (string | null)[];
    };
  }

  it("is off for the control and without a main chat", () => {
    trial.variant = "现状";
    expect(view([mainChat, sideChat], mainChat)).toMatchObject({
      active: false,
      layout: null,
    });
    trial.variant = "甲";
    expect(view([sideChat], sideChat)).toMatchObject({
      active: false,
      layout: null,
    });
  });

  it("feeds the assistant's badge from the main chat and its subtasks, the workbench's from the list", () => {
    attention.set("s-side", "ask");
    const unreadMain = { ...mainChat, hasUnread: true };
    const inWorkbench = view([unreadMain, sideChat, cliChat, subtask], sideChat);
    expect(inWorkbench.space).toBe("workbench");
    expect(inWorkbench.layout).toMatchObject({ rail: true, identity: false });
    expect(inWorkbench.badges.assistant).toBe("unread");
    expect(inWorkbench.words[0]).toBe("有新回复");
    // The workbench's own question is not counted against the assistant.
    expect(inWorkbench.badges.workbench).toEqual({
      count: 1,
      tone: "warning",
    });

    attention.set("s-sub", "ask");
    expect(
      view([mainChat, sideChat, subtask], sideChat).badges.assistant,
    ).toBe("ask");
  });

  it("does not count the subtask open in front of you", () => {
    attention.set("s-sub", "ask");
    const shownSubtask = view([mainChat, sideChat, subtask], subtask);
    expect(shownSubtask.space).toBe("workbench");
    expect(shownSubtask.badges.assistant).toBeNull();
  });

  it("keeps the main chat and its unpromoted subtasks out of the workbench's count", () => {
    attention.set("s-main", "error");
    attention.set("s-sub", "error");
    attention.set("s-promoted", "ask");
    const inAssistant = view([mainChat, sideChat, subtask, promoted], mainChat);
    expect(inAssistant.space).toBe("assistant");
    expect(inAssistant.layout).toMatchObject({
      sidebarHidden: true,
      identity: true,
    });
    // A promoted subtask is an ordinary conversation.
    expect(inAssistant.badges.workbench).toEqual({
      count: 1,
      tone: "warning",
    });
    expect(inAssistant.badges.assistant).toBe("error");
    expect(inAssistant.line).toEqual({ text: "出错", tone: "error" });
  });

  it("lets the demo show both badges", () => {
    trial.demo = true;
    expect(view([mainChat, sideChat], mainChat).badges).toEqual({
      assistant: "unread",
      workbench: { count: 1, tone: "warning" },
    });
  });

  it("gives 乙 a sidebar floor that fits its switch", () => {
    trial.variant = "乙";
    const { layout } = view([mainChat, sideChat], sideChat);
    expect(layout).toMatchObject({ switchIn: "masthead" });
    expect(layout?.sidebarMinSize).toMatch(/^\d+px$/);
  });
});

describe("⌘1 / ⌘2", () => {
  const key = (init: Partial<KeyboardEvent>) => ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });

  it("goes to the assistant and the workbench with the platform modifier", () => {
    expect(spaceForShortcut(key({ key: "1", metaKey: true }), true)).toBe(
      "assistant",
    );
    expect(spaceForShortcut(key({ key: "2", metaKey: true }), true)).toBe(
      "workbench",
    );
    expect(spaceForShortcut(key({ code: "Digit2", ctrlKey: true }), false)).toBe(
      "workbench",
    );
  });

  it("leaves every other chord alone", () => {
    expect(spaceForShortcut(key({ key: "1", ctrlKey: true }), true)).toBeNull();
    expect(spaceForShortcut(key({ key: "1", metaKey: true }), false)).toBeNull();
    expect(
      spaceForShortcut(key({ key: "1", metaKey: true, shiftKey: true }), true),
    ).toBeNull();
    expect(
      spaceForShortcut(key({ key: "2", metaKey: true, altKey: true }), true),
    ).toBeNull();
    expect(spaceForShortcut(key({ key: "3", metaKey: true }), true)).toBeNull();
    expect(spaceForShortcut(key({ key: "1" }), true)).toBeNull();
  });
});

describe("moving between the spaces", () => {
  const MAIN_BRIEF: SessionBriefWire = {
    id: "s-main",
    title: "主聊天",
    status: "idle",
    turnCount: 0,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    runtimeKind: "managed",
    runtimeLabel: "内置内核",
    gaRuntimeKind: "managed",
    promptProfile: "galley-persona-v1",
    mainChat: true,
  };
  const focus = vi.fn();

  function shown(): Session | undefined {
    const { sessions, activeSessionId } = useSessionsStore.getState();
    return useUiStore.getState().screen === "main"
      ? sessions.find((s) => s.id === activeSessionId)
      : undefined;
  }

  beforeEach(() => {
    resetStores();
    focus.mockReset();
    usePrefsStore.setState({ activeRuntimeKind: "managed" });
    useRuntimeStore.setState({
      ensureSessionRunner: async () => null,
      hasBridgeClient: () => false,
    });
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "get_or_create_main_chat" ? MAIN_BRIEF : undefined,
    );
    useSessionsStore.setState({
      sessions: [
        { ...mainChat, turnCount: 0 },
        { ...sideChat, turnCount: 0 },
        { ...subtask, turnCount: 0 },
      ],
      activeSessionId: "s-main",
    });
    useUiStore.setState({ screen: "main" });
    rememberWorkbench({ kind: "empty" });
  });

  it("opens the main chat for the assistant", () => {
    rememberWorkbench({ kind: "session", id: "s-side" });
    switchSpace("workbench", focus);
    expect(shown()?.id).toBe("s-side");
    useSessionsStore.getState().setActiveProjectFilter("p-1");
    switchSpace("assistant", focus);
    expect(shown()?.id).toBe("s-main");
    expect(useSessionsStore.getState().activeProjectFilter).toBeUndefined();
  });

  it("reopens what the workbench last showed", () => {
    rememberWorkbench({ kind: "session", id: "s-side" });
    switchSpace("workbench", focus);
    expect(shown()?.id).toBe("s-side");
    expect(focus).not.toHaveBeenCalled();
  });

  it("comes back to an empty composer, with its project", () => {
    rememberWorkbench({ kind: "empty", projectId: "p-1" });
    switchSpace("workbench", focus);
    expect(useUiStore.getState().screen).toBe("empty");
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();
    expect(useSessionsStore.getState().activeProjectFilter).toBe("p-1");
    expect(focus).toHaveBeenCalledOnce();
  });

  it("falls back to an empty new chat when that session has gone", () => {
    rememberWorkbench({ kind: "session", id: "s-deleted" });
    switchSpace("workbench", focus);
    expect(useUiStore.getState().screen).toBe("empty");
    expect(useSessionsStore.getState().activeProjectFilter).toBeUndefined();
  });

  it("changes nothing when you are already there", () => {
    const activate = vi.spyOn(useSessionsStore.getState(), "activateSession");
    switchSpace("assistant", focus);
    expect(activate).not.toHaveBeenCalled();
    expect(shown()?.id).toBe("s-main");
  });

  it("goes to the workbench for a subtask's card, and back with 「助手 ›」", async () => {
    expect(spaceOf(shown())).toBe("assistant");
    // What the card's 打开 does (SubtaskCards' openSubtask).
    useSessionsStore.getState().setActiveProjectFilter(undefined);
    await useSessionsStore.getState().activateSession("s-sub");
    useUiStore.getState().setScreen("main");
    expect(spaceOf(shown())).toBe("workbench");

    let back: Promise<boolean> | undefined;
    const crumb = subtaskBreadcrumb(shown(), {
      label: copy.spaces.assistant,
      ariaLabel: copy.spaces.backToAssistant,
      openParent: () => {
        back = openMainChat();
      },
    });
    expect(crumb?.label).toBe("助手");
    crumb?.onClick();
    await back;
    expect(spaceOf(shown())).toBe("assistant");
  });
});

describe("the launch", () => {
  function stubStorage(entries: Record<string, string>, broken = false) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => {
          if (broken) throw new Error("storage unavailable");
          return entries[key] ?? null;
        },
        setItem: () => {},
      },
    });
  }
  const VARIANT = "galley.tmp.spacesTrial.variant";
  const SPACE = "galley.tmp.spacesTrial.space";

  it("lands in the workbench only when a trial shell last left it there", () => {
    stubStorage({ [VARIANT]: "甲", [SPACE]: "workbench" });
    expect(launchesInWorkbench()).toBe(true);
    stubStorage({ [VARIANT]: "乙", [SPACE]: "workbench" });
    expect(launchesInWorkbench()).toBe(true);
    stubStorage({ [VARIANT]: "甲", [SPACE]: "assistant" });
    expect(launchesInWorkbench()).toBe(false);
    // No record: the assistant.
    stubStorage({ [VARIANT]: "甲" });
    expect(launchesInWorkbench()).toBe(false);
    // The control lands as before.
    stubStorage({ [VARIANT]: "现状", [SPACE]: "workbench" });
    expect(launchesInWorkbench()).toBe(false);
    stubStorage({}, true);
    expect(launchesInWorkbench()).toBe(false);
  });

  describe("on the managed runtime", () => {
    const MAIN_BRIEF: SessionBriefWire = {
      id: "s-main",
      title: "主聊天",
      status: "idle",
      turnCount: 0,
      lastActivityAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      runtimeKind: "managed",
      runtimeLabel: "内置内核",
      gaRuntimeKind: "managed",
      promptProfile: "galley-persona-v1",
      mainChat: true,
    };
    beforeEach(() => {
      resetStores();
      usePrefsStore.setState({ activeRuntimeKind: "managed" });
      tauriMocks.invoke.mockImplementation(async (command) =>
        command === "get_or_create_main_chat" ? MAIN_BRIEF : undefined,
      );
    });

    it("opens the main chat by default", async () => {
      stubStorage({ [VARIANT]: "甲" });
      await expect(landAtLaunch()).resolves.toBe(true);
      expect(useSessionsStore.getState().activeSessionId).toBe("s-main");
      expect(useUiStore.getState().screen).toBe("main");
    });

    it("lists the main chat but stays on the empty composer for the workbench", async () => {
      stubStorage({ [VARIANT]: "乙", [SPACE]: "workbench" });
      await expect(landAtLaunch()).resolves.toBe(true);
      const sessions = useSessionsStore.getState();
      expect(sessions.sessions.map((s) => s.id)).toEqual(["s-main"]);
      expect(sessions.activeSessionId).toBeUndefined();
      expect(useUiStore.getState().screen).toBe("empty");
    });

    it("lands the control on the main chat whatever was stored", async () => {
      stubStorage({ [VARIANT]: "现状", [SPACE]: "workbench" });
      await landAtLaunch();
      expect(useSessionsStore.getState().activeSessionId).toBe("s-main");
    });
  });
});
