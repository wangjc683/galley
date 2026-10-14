import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import { assistantLabel, assistantState } from "@/lib/assistant";
import { CopyProvider, copyForLanguage } from "@/lib/i18n";
import { subtaskBreadcrumb } from "@/lib/subtasks";
import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import {
  paletteSessionMatches,
  paletteSessionValue,
} from "../overlay/palette-search";
import { AssistantIdentity } from "./assistant/AssistantIdentity";
import { MainHeader } from "./MainHeader";
import { Sidebar } from "./Sidebar";
import {
  demoAssistantState,
  demoMainChatRow,
  mainChatNaming,
  readSidebarTopDemo,
  readSidebarTopVariant,
  type SidebarTopDemo,
  type SidebarTopVariant,
  sidebarTopActive,
} from "./sidebar/sidebar-top-trial";

/**
 * TEMPORARY — the sidebar-top trial (`.scratch/main-chat` ticket 17,
 * sidebar/sidebar-top-trial.ts). Delete with the trial; the winner's
 * cases move into Sidebar.main-chat.test.tsx and the header / palette
 * tests.
 */

// A main chat's live state (running, a question, an error) is
// store-derived and can't be seeded under static rendering; override
// the view by session id on top of the real hook.
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

// A subtask's question or error the same way: the kind the hook would
// report for a list holding it.
const attentionKind = vi.hoisted(() => new Map<string, "error" | "ask">());
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      const kinds = args[0].map((s) => attentionKind.get(s.id));
      const kind = kinds.includes("error")
        ? "error"
        : kinds.includes("ask")
          ? "ask"
          : view.kind;
      return { ...view, kind };
    },
  };
});

afterEach(() => {
  live.clear();
  attentionKind.clear();
  vi.unstubAllGlobals();
});

const copy = copyForLanguage("zh-CN");
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    lastActivityAt: minutesAgo(5),
    origin: { via: "gui" },
    ...extra,
  });

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const sideChat = managed("s-side", { title: "订机票" });
const cliChat = managed("s-cli", {
  origin: { via: "cli" },
  lastActivityAt: minutesAgo(2),
});
const subtask = managed("s-sub", {
  title: "查天气",
  origin: { via: "subtask" },
  parentSessionId: "s-main",
});
const projectChat = managed("s-proj", { projectId: "p" });
const project = {
  id: "p",
  name: "回归",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: minutesAgo(5),
  createdAt: minutesAgo(5),
  updatedAt: minutesAgo(5),
} as Project;

function wrap(node: ReactNode, language: "zh-CN" | "en-US" = "zh-CN") {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>{node}</Tooltip.Provider>
    </CopyProvider>,
  );
}

function render(
  sessions: Session[],
  opts: {
    topVariant?: SidebarTopVariant;
    topDemo?: SidebarTopDemo;
    activeId?: string;
    newChatActive?: boolean;
    newChatProjectId?: string;
    newChatSessionId?: string;
    projects?: Project[];
    language?: "zh-CN" | "en-US";
  } = {},
) {
  return wrap(
    <Sidebar
      sessions={sessions}
      projects={opts.projects}
      activeId={opts.activeId}
      newChatActive={opts.newChatActive}
      newChatProjectId={opts.newChatProjectId}
      newChatSessionId={opts.newChatSessionId}
      expandedProjectIds={[]}
      onNewChat={() => {}}
      onSelectSession={() => {}}
      onStartProjectConversation={() => {}}
      onArchiveSession={() => {}}
      onRenameSession={() => {}}
      onTogglePinSession={() => {}}
      {...(opts.topVariant ? { topVariant: opts.topVariant } : {})}
      {...(opts.topDemo ? { topDemo: opts.topDemo } : {})}
    />,
    opts.language,
  );
}

const TRIAL: readonly SidebarTopVariant[] = ["2", "3", "3′"];
const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
/** From the element carrying `needle` to the end of its own markup,
 * roughly: up to the next element carrying `until`. */
const between = (html: string, from: string, until: string) =>
  html.slice(html.indexOf(from), html.indexOf(until, html.indexOf(from) + 1));
const ENTRY = 'data-role="assistant-entry"';
const MASTHEAD = 'data-role="assistant-masthead"';
const ROW = 'data-role="sidebar-new-chat-row"';
const NEW_CHAT = 'aria-label="新对话"';
const LINE = 'data-role="assistant-status-line"';
const BADGE = 'data-role="assistant-badge"';

describe("the spaces shell trial is gone (ticket 16)", () => {
  const SRC = path.resolve(__dirname, "../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no rail, switch, ⌘1 / ⌘2, launch space or storage key behind", () => {
    const self = path.resolve(__filename);
    const leftovers = [
      "galley.tmp.spacesTrial",
      "spaces-trial",
      "useSpacesTrial",
      "SpacesRail",
      "SpaceSwitch",
      "SpacesTrialSwitcher",
      "spaceForShortcut",
      "ensureMainChatListed",
      "landAtLaunch",
      "copy.spaces",
      "Digit1",
      "Digit2",
      '"Mod+1"',
      '"Mod+2"',
    ];
    const hits = sources(SRC)
      .filter((file) => file !== self && !file.includes("zz-harness"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return leftovers
          .filter((needle) => text.includes(needle))
          .map((needle) => `${path.relative(SRC, file)}: ${needle}`);
      });
    expect(hits).toEqual([]);
  });

  it("drops the spaces copy", () => {
    expect("spaces" in copyForLanguage("zh-CN")).toBe(false);
    expect("spaces" in copyForLanguage("en-US")).toBe(false);
  });
});

describe("which variant", () => {
  it("replaces the top half only for 2 / 3 / 3′ with a main chat", () => {
    expect(sidebarTopActive("现状", true)).toBe(false);
    for (const variant of TRIAL) {
      expect(sidebarTopActive(variant, true)).toBe(true);
      // The external runtime, or a main chat not loaded yet.
      expect(sidebarTopActive(variant, false)).toBe(false);
    }
  });

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

  it("starts on the control with no demo, unless the pill kept a valid choice", () => {
    stubStorage({});
    expect(readSidebarTopVariant()).toBe("现状");
    expect(readSidebarTopDemo()).toBe("无");
    stubStorage({
      "galley.tmp.sidebarTopTrial.variant": "3′",
      "galley.tmp.sidebarTopTrial.demo": "未读",
    });
    expect(readSidebarTopVariant()).toBe("3′");
    expect(readSidebarTopDemo()).toBe("未读");
    stubStorage({
      "galley.tmp.sidebarTopTrial.variant": "甲",
      "galley.tmp.sidebarTopTrial.demo": "maybe",
    });
    expect(readSidebarTopVariant()).toBe("现状");
    expect(readSidebarTopDemo()).toBe("无");
    stubStorage({}, true);
    expect(readSidebarTopVariant()).toBe("现状");
    expect(readSidebarTopDemo()).toBe("无");
  });
});

describe("the control and the external runtime stay as they are", () => {
  it("draws 现状 exactly as the sidebar without the trial", () => {
    const sessions = [mainChat, sideChat, cliChat, subtask, projectChat];
    for (const opts of [
      {},
      { activeId: "s-main" },
      { newChatActive: true },
      { newChatActive: true, newChatProjectId: "p" },
    ]) {
      const before = render(sessions, { ...opts, projects: [project] });
      expect(
        render(sessions, {
          ...opts,
          projects: [project],
          topVariant: "现状",
          topDemo: "无",
        }),
      ).toBe(before);
    }
  });

  it("keeps the external runtime's sidebar in every variant", () => {
    const sessions = [sideChat, cliChat];
    const before = render(sessions, { newChatActive: true });
    for (const topVariant of TRIAL) {
      expect(render(sessions, { newChatActive: true, topVariant })).toBe(
        before,
      );
    }
    expect(before).not.toContain(ENTRY);
  });
});

describe("2 / 3 / 3′: the assistant on top, 「＋ 新对话」 under it", () => {
  const sessions = [mainChat, sideChat, cliChat, subtask, projectChat];

  it("has no main chat row, section header, wordmark or 主对话 left", () => {
    for (const topVariant of TRIAL) {
      const html = render(sessions, { topVariant, projects: [project] });
      expect(html).not.toContain('data-session-id="s-main"');
      expect(html).not.toContain(">其他对话<");
      expect(html).not.toContain("主对话");
      // The serif wordmark retires: Galley is the assistant's name.
      expect(html).not.toContain("font-serif text-[17px]");
      expect(count(html, ENTRY)).toBe(1);
      // Its subtasks stay out of the list; the rest are listed as before.
      expect(html).not.toContain('data-session-id="s-sub"');
      expect(html).toContain('data-session-id="s-side"');
      expect(html).toContain('data-project-id="galley:other-sources"');
    }
  });

  it("keeps only 搜索 on the masthead; 定时 and 新建项目 go to the new-chat row", () => {
    for (const topVariant of TRIAL) {
      const html = render(sessions, { topVariant });
      const masthead = between(html, MASTHEAD, ROW);
      expect(count(masthead, 'aria-label="搜索"')).toBe(1);
      expect(masthead).not.toContain('aria-label="定时"');
      expect(masthead).not.toContain('aria-label="新建项目"');
      const row = between(html, ROW, "data-sidebar-section-fade");
      expect(row).toContain(NEW_CHAT);
      expect(row).toContain('aria-label="定时"');
      expect(row).toContain('aria-label="新建项目"');
      // 搜索 never steps down off macOS (the test platform).
      expect(row).not.toContain('aria-label="搜索"');
      // The ⌘N hint stays in the row's button.
      expect(row).toContain("Ctrl+N");
    }
  });

  it("puts 2's entry in the masthead, and 3 / 3′'s card above the strong line", () => {
    const two = render(sessions, { topVariant: "2" });
    expect(between(two, MASTHEAD, ROW)).toContain(ENTRY);
    expect(tagWith(two, ENTRY)).toContain('data-variant="2"');
    expect(between(two, ENTRY, "</button>")).toContain("size-5");
    expect(two).not.toContain("border-line-strong");
    for (const [variant, avatar] of [
      ["3", "size-8"],
      ["3′", "size-12"],
    ] as const) {
      const html = render(sessions, { topVariant: variant });
      expect(between(html, MASTHEAD, ENTRY)).not.toContain("<button data-role");
      const card = tagWith(html, ENTRY);
      expect(card).toContain(`data-variant="${variant}"`);
      expect(between(html, ENTRY, "</button>")).toContain(avatar);
      // Under the masthead, in a block with the strong line at its foot
      // (the main chat row's, ticket 09); the list after it.
      const block = tagWith(html, "border-line-strong");
      expect(block).toContain("border-b border-line-strong");
      expect(html.indexOf("border-line-strong")).toBeGreaterThan(
        html.indexOf(MASTHEAD),
      );
      expect(html.indexOf("border-line-strong")).toBeLessThan(
        html.indexOf(ENTRY),
      );
      expect(html.indexOf(ROW)).toBeGreaterThan(html.indexOf(ENTRY));
    }
  });

  it("opens the list on the sticky new-chat row, with the old sidebar's spacing", () => {
    for (const topVariant of TRIAL) {
      const html = render(sessions, { topVariant });
      const sticky = tagWith(html, "data-sidebar-section-header");
      expect(sticky).toContain("sticky top-0 z-20 bg-app");
      expect(sticky).toContain("pb-1 pt-1.5");
      expect(html.indexOf(ROW)).toBeGreaterThan(
        html.indexOf("data-sidebar-section-header"),
      );
      expect(tagWith(html, 'data-sidebar-section=""')).toContain("bg-app");
      expect(tagWith(html, "overflow-y-auto")).toContain("scroll-pt-[42px]");
      // No first-child tightening under it: the first label keeps pt-3.5.
      expect(html).not.toContain('data-sidebar-section-body=""');
    }
  });

  it("lights the new-chat row for the empty composer — a project's too — until the first send's row takes over", () => {
    for (const topVariant of TRIAL) {
      const rest = render(sessions, { topVariant });
      expect(rest).not.toContain('aria-current="page"');

      const html = render(sessions, { topVariant, newChatActive: true });
      expect(count(html, 'aria-current="page"')).toBe(1);
      const button = tagWith(html, NEW_CHAT);
      expect(button).toContain('aria-current="page"');
      expect(button).toContain("bg-selected");

      const inProject = render(sessions, {
        topVariant,
        newChatActive: true,
        newChatProjectId: "p",
        projects: [project],
      });
      expect(count(inProject, 'aria-current="page"')).toBe(1);
      expect(tagWith(inProject, NEW_CHAT)).toContain('aria-current="page"');
      expect(
        tagWith(inProject, 'aria-label="在 回归 里新建对话"'),
      ).not.toContain("aria-current");

      const fresh = managed("s-new", { title: "新对话" });
      const handoff = render([...sessions, fresh], {
        topVariant,
        newChatActive: true,
        newChatSessionId: "s-new",
      });
      expect(tagWith(handoff, NEW_CHAT)).not.toContain("aria-current");
      expect(tagWith(handoff, 'data-session-id="s-new"')).toContain(
        "bg-selected",
      );
    }
  });

  it("selects the entry while the main chat or one of its subtasks is open", () => {
    for (const topVariant of TRIAL) {
      for (const activeId of ["s-main", "s-sub"]) {
        const entry = tagWith(
          render(sessions, { topVariant, activeId }),
          ENTRY,
        );
        expect(entry).toContain('aria-current="page"');
        expect(entry).toContain("bg-selected");
      }
      const elsewhere = tagWith(
        render(sessions, { topVariant, activeId: "s-side" }),
        ENTRY,
      );
      expect(elsewhere).not.toContain("aria-current");
      expect(elsewhere).not.toContain("bg-selected shadow");
      expect(elsewhere).toContain("hover:bg-hover");
    }
  });

  it("says the old sidebar's line while nobody has started a conversation", () => {
    for (const topVariant of TRIAL) {
      const html = render([mainChat, cliChat], { topVariant });
      expect(html).toContain("你的对话会出现在这里。");
      expect(html).not.toContain("另开一个对话聊一件事");
      expect(render([mainChat, sideChat], { topVariant })).not.toContain(
        "你的对话会出现在这里。",
      );
    }
  });

  it("speaks English in the English UI", () => {
    const html = render(sessions, {
      topVariant: "3",
      newChatActive: true,
      language: "en-US",
    });
    expect(html).toContain(">Galley<");
    expect(html).toContain('aria-label="New chat"');
    expect(html).not.toContain("Main chat");
    expect(
      render([mainChat], { topVariant: "3", language: "en-US" }),
    ).toContain("Your conversations will appear here.");
  });
});

describe("what the entry says", () => {
  const used = { ...mainChat, summary: "查厦门明天的天气", lastStepIndex: 2 };
  const entry = (
    html: string,
  ): { tag: string; body: string; line: string | null } => {
    const body = between(html, ENTRY, "</button>");
    const lineAt = body.indexOf(LINE);
    return {
      tag: tagWith(html, ENTRY),
      body,
      line:
        lineAt < 0
          ? null
          : body.slice(
              body.indexOf(">", lineAt) + 1,
              body.indexOf("<", lineAt),
            ),
    };
  };

  it("says nothing at rest: the name alone, no mark", () => {
    for (const topVariant of TRIAL) {
      const { tag, body, line } = entry(
        render([used, sideChat], { topVariant, activeId: "s-side" }),
      );
      expect(line).toBeNull();
      expect(body).not.toContain(BADGE);
      expect(tag).toContain('data-state="idle"');
      expect(tag).toContain('aria-label="Galley"');
      expect(body).toMatch(/font-medium[^>]*>Galley</);
    }
  });

  it("says what it is doing in 3 / 3′, and marks the avatar in all three", () => {
    const cases: Array<[() => void, string, string]> = [
      [
        () => live.set("s-main", { status: "running" }),
        "running",
        "第 2 步 · 查厦门明天的天气",
      ],
      [
        () => live.set("s-main", { hasPendingAskUser: true }),
        "ask",
        "等你回复",
      ],
      [() => live.set("s-main", { status: "error" }), "error", "出错"],
      [() => attentionKind.set("s-sub", "ask"), "ask", "子任务在问你"],
      [() => attentionKind.set("s-sub", "error"), "error", "子任务出错"],
    ];
    for (const [arrange, kind, words] of cases) {
      live.clear();
      attentionKind.clear();
      arrange();
      for (const topVariant of TRIAL) {
        const { tag, body, line } = entry(
          render([used, sideChat, subtask], { topVariant, activeId: "s-side" }),
        );
        expect(tag).toContain(`data-state="${kind}"`);
        expect(body).toContain(`data-kind="${kind}"`);
        expect(tag).toContain(`aria-label="Galley · ${words}"`);
        expect(body).toMatch(/font-semibold[^>]*>Galley</);
        // 2 has no room for the words: they are in its label only.
        expect(line).toBe(topVariant === "2" ? null : words);
      }
    }
  });

  it("thinks before the first step ends", () => {
    live.set("s-main", { status: "running" });
    const { line } = entry(
      render([{ ...mainChat, lastStepIndex: undefined }], { topVariant: "3" }),
    );
    expect(line).toBe("思考中");
  });

  it("marks a new reply on the avatar and bolds the name, without words, only while elsewhere", () => {
    const unread = { ...used, hasUnread: true };
    for (const topVariant of TRIAL) {
      const away = entry(
        render([unread, sideChat], { topVariant, activeId: "s-side" }),
      );
      expect(away.tag).toContain('data-state="unread"');
      expect(away.body).toContain('data-kind="unread"');
      expect(away.body).toMatch(/font-semibold[^>]*>Galley</);
      expect(away.line).toBeNull();
      expect(away.tag).toContain('aria-label="Galley · 有新回复"');
      // Open, it is read.
      const open = entry(render([unread], { topVariant, activeId: "s-main" }));
      expect(open.tag).toContain('data-state="idle"');
      expect(open.body).not.toContain(BADGE);
    }
  });

  it("puts 「演示」's state on the entry, over the real one", () => {
    live.set("s-main", { status: "error" });
    const running = entry(
      render([used, sideChat], {
        topVariant: "3",
        topDemo: "在跑",
        activeId: "s-side",
      }),
    );
    expect(running.line).toBe("第 3 步 · 查厦门明天的天气");
    expect(running.body).toContain('data-kind="running"');
    const asking = entry(
      render([used], { topVariant: "3′", topDemo: "在问你" }),
    );
    expect(asking.line).toBe("等你回复");
    // Unread shows only while the assistant is not open.
    const unreadOpen = entry(
      render([used], { topVariant: "2", topDemo: "未读", activeId: "s-main" }),
    );
    expect(unreadOpen.tag).toContain('data-state="idle"');
    const unreadAway = entry(
      render([used, sideChat], {
        topVariant: "2",
        topDemo: "未读",
        activeId: "s-side",
      }),
    );
    expect(unreadAway.body).toContain('data-kind="unread"');
  });
});

describe("the entry's state, in the main chat row's priority", () => {
  const base = {
    status: "idle" as const,
    hasPendingAskUser: false,
    open: false,
    summary: "查厦门明天的天气",
    lastStepIndex: 4,
  };

  it("puts an error over a question over running over unread", () => {
    const kind = (input: Partial<Parameters<typeof assistantState>[0]>) =>
      assistantState({ ...base, ...input }, copy).kind;
    expect(kind({})).toBe("idle");
    expect(kind({ hasUnread: true })).toBe("unread");
    expect(kind({ hasUnread: true, open: true })).toBe("idle");
    expect(kind({ status: "running", hasUnread: true })).toBe("running");
    expect(kind({ status: "running", hasPendingAskUser: true })).toBe("ask");
    expect(kind({ status: "running", subtaskState: "ask" })).toBe("ask");
    expect(kind({ hasPendingAskUser: true, subtaskState: "error" })).toBe(
      "error",
    );
    expect(kind({ status: "error", subtaskState: "ask" })).toBe("error");
    // A stop or a step-cap pause says nothing (the row's icon does).
    expect(kind({ status: "cancelled" })).toBe("idle");
  });

  it("uses the row's words, its own ahead of a subtask's", () => {
    const line = (input: Partial<Parameters<typeof assistantState>[0]>) =>
      assistantState({ ...base, ...input }, copy).line;
    expect(line({ status: "running" })).toEqual({
      text: "第 4 步 · 查厦门明天的天气",
      tone: "running",
    });
    expect(line({ status: "error", errorCount: 3 })).toEqual({
      text: "出错 · 3",
      tone: "error",
    });
    expect(line({ status: "error", subtaskState: "error" })?.text).toBe("出错");
    expect(line({ subtaskState: "error" })?.text).toBe("子任务出错");
    expect(line({ hasPendingAskUser: true, subtaskState: "ask" })?.text).toBe(
      "等你回复",
    );
    expect(line({ hasUnread: true })).toBeNull();
    expect(line({})).toBeNull();
  });

  it("names the state after the name", () => {
    const idle = assistantState(base, copy);
    expect(assistantLabel("Galley", idle)).toBe("Galley");
    expect(
      assistantLabel(
        "Galley",
        assistantState({ ...base, hasUnread: true }, copy),
      ),
    ).toBe("Galley · 有新回复");
  });

  it("lets 「演示」 stand in, never as unread while open", () => {
    expect(demoAssistantState("无", false, copy, "zh-CN")).toBeNull();
    expect(demoAssistantState("在跑", true, copy, "zh-CN")?.line?.text).toBe(
      "第 3 步 · 查厦门明天的天气",
    );
    expect(demoAssistantState("在问你", true, copy, "zh-CN")?.kind).toBe("ask");
    expect(demoAssistantState("未读", false, copy, "zh-CN")?.kind).toBe(
      "unread",
    );
    expect(demoAssistantState("未读", true, copy, "zh-CN")?.kind).toBe("idle");
  });
});

describe("「演示」 on the control's main chat row", () => {
  const row = (html: string) =>
    html.slice(
      html.lastIndexOf("<", html.indexOf('data-session-id="s-main"')),
      html.indexOf(">其他对话<"),
    );

  it("shows the state there, nothing written", () => {
    expect(
      row(
        render([mainChat, sideChat], { topDemo: "在跑", activeId: "s-side" }),
      ),
    ).toContain("第 3 步 · 查厦门明天的天气");
    expect(row(render([mainChat, sideChat], { topDemo: "在问你" }))).toContain(
      ">等你回复<",
    );
    const unread = row(
      render([mainChat, sideChat], { topDemo: "未读", activeId: "s-side" }),
    );
    expect(unread).toContain("text-brand");
    expect(unread).toContain("font-semibold");
    expect(demoMainChatRow("无", "zh-CN")).toEqual({});
  });
});

describe("the main header, the crumb and ⌘K", () => {
  it("shows the assistant in the title's place, with no title menu", () => {
    live.set("s-main", { hasPendingAskUser: true });
    const html = wrap(
      <MainHeader
        sessionTitle="主对话"
        identity={<AssistantIdentity mainChat={mainChat} subtasks={[]} />}
      />,
    );
    expect(html).toContain('data-role="assistant-identity"');
    expect(html).toContain('data-role="assistant-avatar"');
    expect(html).toContain(">Galley<");
    expect(html).toMatch(/data-role="assistant-status-line"[^>]*text-warning/);
    expect(html).toContain(">等你回复<");
    expect(html).not.toContain(">主对话<");
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it("has no second line at rest, and the title menu without it", () => {
    expect(
      wrap(<AssistantIdentity mainChat={mainChat} subtasks={[]} />),
    ).not.toContain(LINE);
    expect(wrap(<MainHeader sessionTitle="主对话" />)).toContain(">主对话<");
  });

  it("names the main chat Galley in 2 / 3 / 3′ and 主对话 otherwise", () => {
    expect(mainChatNaming(false, copy)).toEqual({
      label: "主对话",
      crumbAria: "回到主对话",
    });
    const galley = mainChatNaming(true, copy);
    expect(galley.label).toBe("Galley");
    expect(galley.crumbAria).toBe("回到 Galley");
    expect(mainChatNaming(true, copyForLanguage("en-US")).crumbAria).toBe(
      "Back to Galley",
    );
    const crumb = subtaskBreadcrumb(subtask, {
      label: galley.label,
      ariaLabel: galley.crumbAria,
      openParent: () => {},
    });
    expect(crumb?.label).toBe("Galley");
  });

  it("still finds Galley in ⌘K by 主对话, 助手 and their English", () => {
    const keywords = mainChatNaming(true, copy).searchKeywords;
    for (const query of [
      "galley",
      "主对话",
      "助手",
      "main chat",
      "assistant",
    ]) {
      expect(paletteSessionMatches(query, "Galley", "", keywords)).toBe(true);
    }
    expect(paletteSessionMatches("订机票", "Galley", "", keywords)).toBe(false);
    expect(paletteSessionMatches("主对话", "Galley", "")).toBe(false);
    expect(paletteSessionValue("Galley", undefined, keywords)).toContain(
      "助手",
    );
    // Without keywords the value is what it always was.
    expect(paletteSessionValue("订机票", "已订好")).toBe(
      "session 订机票 已订好",
    );
  });
});
