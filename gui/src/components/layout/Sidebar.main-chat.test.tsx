import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import { Sidebar } from "./Sidebar";
import { buildMainChatDemo, isDemoSessionId } from "./sidebar/main-chat-demo";
import type {
  MainChatLayout,
  SideChatNaming,
} from "./sidebar/main-chat-layout";

// useCopy falls back to the zh copy without a CopyProvider.

// Static rendering reads a store's initial state, so the switcher's
// choices (layout, naming, demo) are fed through the modules instead.
const trial = vi.hoisted(() => ({
  layout: "B" as MainChatLayout,
  naming: "旁聊" as SideChatNaming,
  demo: false,
}));
vi.mock("./sidebar/main-chat-layout", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./sidebar/main-chat-layout")>();
  const { zhCopy } = await import("@/i18n/locales/zh");
  return {
    ...actual,
    useMainChatLayout: () => trial.layout,
    useMainChatTrialCopy: () =>
      actual.mainChatTrialCopy(zhCopy, "zh-CN", trial.naming),
  };
});
const DEMO_ANCHOR = new Date().toISOString();
vi.mock("./sidebar/main-chat-demo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./sidebar/main-chat-demo")>();
  return {
    ...actual,
    useMainChatDemoOverlay: (sessions: Session[]) =>
      trial.demo ? actual.buildMainChatDemo(sessions, DEMO_ANCHOR) : null,
  };
});
// A session's erroring bridge can't be seeded in a store either; mark
// ids as needing the user on top of the real hook.
const needsYou = vi.hoisted(() => new Set<string>());
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      return {
        ...view,
        needsYouIds: new Set([...view.needsYouIds, ...needsYou]),
      };
    },
  };
});

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    lastActivityAt: minutesAgo(5),
    ...extra,
  });

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const sideChat = managed("s-side", {
  title: "订机票",
  origin: { via: "gui" },
});
const cliChat = managed("s-cli", {
  origin: { via: "cli" },
  lastActivityAt: minutesAgo(2),
});
const supervisorChat = managed("s-sup", {
  origin: { via: "supervisor", supervisor: "ga-claude-1" },
  lastActivityAt: minutesAgo(8),
});
const projectCliChat = managed("s-pcli", {
  origin: { via: "cli" },
  projectId: "p",
});
const project = {
  id: "p",
  name: "回归",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: minutesAgo(5),
  createdAt: minutesAgo(5),
  updatedAt: minutesAgo(5),
} as Project;

function render(
  sessions: Session[],
  opts: {
    layout?: MainChatLayout;
    naming?: SideChatNaming;
    demo?: boolean;
    activeId?: string;
    newChatActive?: boolean;
    projects?: Project[];
  } = {},
) {
  trial.layout = opts.layout ?? "B";
  trial.naming = opts.naming ?? "旁聊";
  trial.demo = opts.demo ?? false;
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <Sidebar
        sessions={sessions}
        projects={opts.projects}
        activeId={opts.activeId}
        newChatActive={opts.newChatActive}
        expandedProjectIds={[]}
        onNewChat={() => {}}
        onSelectSession={() => {}}
        onArchiveSession={() => {}}
        onRenameSession={() => {}}
        onTogglePinSession={() => {}}
      />
    </Tooltip.Provider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);
const OTHER_SOURCES = 'data-project-id="galley:other-sources"';

afterEach(() => {
  needsYou.clear();
});

describe("the main chat's row", () => {
  it("stands on its own: once, under its label, never in a time bucket", () => {
    for (const layout of ["A3", "B", "B′"] as const) {
      const html = render([mainChat, sideChat], { layout });
      expect(count(html, 'data-session-id="s-main"')).toBe(1);
      expect(count(html, 'data-session-id="s-side"')).toBe(1);
      expect(html).toContain(">主对话<");
      // 今天 lists only the side chat.
      expect(at(html, "s-main")).toBeLessThan(html.indexOf(">今天<"));
      expect(at(html, "s-side")).toBeGreaterThan(html.indexOf(">今天<"));
    }
  });

  it("has no menu: no pin, rename, project or archive", () => {
    const html = render([mainChat]);
    // A row with actions is a context-menu trigger; the main chat's is not.
    expect(html).not.toContain("data-galley-context-menu-trigger");
  });

  it("is the selected row when it is open", () => {
    const html = render([mainChat, sideChat], { activeId: "s-main" });
    const tagStart = html.lastIndexOf("<div", at(html, "s-main"));
    expect(html.slice(tagStart, at(html, "s-main") + 200)).toContain(
      "bg-selected",
    );
  });

  it("keeps full ink while another row is selected", () => {
    for (const layout of ["A3", "B"] as const) {
      const html = render([mainChat, sideChat], {
        layout,
        activeId: "s-side",
      });
      const main = html.slice(at(html, "s-main"));
      expect(main.slice(0, 1600)).toMatch(/text-\[13px\] text-ink font-medium/);
    }
  });

  it("says 什么都可以跟它说 in B until its first message", () => {
    expect(render([mainChat], { layout: "B" })).toContain("什么都可以跟它说");
    expect(render([mainChat], { layout: "A3" })).not.toContain(
      "什么都可以跟它说",
    );
    const used = { ...mainChat, turnCount: 3, summary: "订好了" };
    const html = render([used], { layout: "B" });
    expect(html).not.toContain("什么都可以跟它说");
    expect(html).toContain(">订好了<");
  });
});

describe("A3", () => {
  it("keeps the 新对话 row under the main chat, quiet, named by the trial", () => {
    const html = render([mainChat, sideChat], { layout: "A3" });
    expect(html).toContain('aria-label="新旁聊"');
    expect(at(html, "s-main")).toBeLessThan(
      html.indexOf('aria-label="新旁聊"'),
    );
    const row = html.slice(
      html.lastIndexOf("<button", html.indexOf('aria-label="新旁聊"')),
    );
    expect(row.slice(0, 600)).toContain("h-7");
    expect(row.slice(0, 1600)).not.toContain("text-brand-strong");
    // No section header, no 其他来源.
    expect(html).not.toContain(">旁聊<");
    expect(render([mainChat, cliChat], { layout: "A3" })).not.toContain(
      OTHER_SOURCES,
    );
  });
});

describe("B", () => {
  it("heads the list with a 旁聊 section header and its +, no 新对话 row", () => {
    const html = render([mainChat, sideChat]);
    expect(html).toContain(">旁聊<");
    // The + is the only new-chat control.
    expect(count(html, 'aria-label="新旁聊"')).toBe(1);
    expect(html).not.toContain('aria-label="新对话"');
    expect(at(html, "s-main")).toBeLessThan(html.indexOf(">旁聊<"));
    expect(html.indexOf(">旁聊<")).toBeLessThan(html.indexOf(">今天<"));
    // Narrow fallback: the three icons, in the masthead and in a row of
    // their own (the width picks one).
    expect(count(html, 'aria-label="搜索"')).toBe(2);
  });

  it("draws B′ exactly as B (the collapse lives in AppShell)", () => {
    const sessions = [mainChat, sideChat, cliChat];
    expect(render(sessions, { layout: "B′" })).toBe(
      render(sessions, { layout: "B" }),
    );
  });

  it("puts what a person started in the buckets and the rest in 其他来源 or its project", () => {
    const html = render(
      [mainChat, sideChat, cliChat, supervisorChat, projectCliChat],
      { projects: [project] },
    );
    const today = html.indexOf(">今天<");
    const others = html.indexOf(OTHER_SOURCES);
    expect(today).toBeGreaterThan(-1);
    expect(others).toBeGreaterThan(today);
    expect(html).toContain(">其他来源<");
    // 今天 holds the person's chat only.
    expect(at(html, "s-side")).toBeGreaterThan(today);
    expect(at(html, "s-side")).toBeLessThan(others);
    // The agent ones sit in the group (shut drawer, one line each).
    expect(at(html, "s-cli")).toBeGreaterThan(others);
    expect(at(html, "s-sup")).toBeGreaterThan(others);
    // An agent session in a project stays in its project's group.
    const group = html.indexOf('data-project-id="p"');
    expect(at(html, "s-pcli")).toBeGreaterThan(group);
    expect(at(html, "s-pcli")).toBeLessThan(today);
    for (const id of ["s-side", "s-cli", "s-sup", "s-pcli"]) {
      expect(count(html, `data-session-id="${id}"`)).toBe(1);
    }
  });

  it("is collapsed at launch and hangs what needs you under 其他来源", () => {
    needsYou.add("s-cli");
    const html = render([mainChat, cliChat, supervisorChat]);
    const others = html.indexOf(OTHER_SOURCES);
    expect(html.slice(others, others + 600)).toContain('aria-expanded="false"');
    // s-cli is the newer one, so in the drawer it would come first; hung
    // it comes after the drawer, once.
    expect(count(html, 'data-session-id="s-cli"')).toBe(1);
    expect(at(html, "s-cli")).toBeGreaterThan(at(html, "s-sup"));
    // The selected one hangs the same way.
    needsYou.clear();
    const selected = render([mainChat, cliChat, supervisorChat], {
      activeId: "s-cli",
    });
    expect(at(selected, "s-cli")).toBeGreaterThan(at(selected, "s-sup"));
  });

  it("selects a placeholder row at the section's top while the new-chat composer is up", () => {
    const html = render([mainChat, sideChat], { newChatActive: true });
    expect(count(html, 'aria-current="page"')).toBe(1);
    const placeholder = html.indexOf('aria-current="page"');
    expect(placeholder).toBeGreaterThan(html.indexOf(">旁聊<"));
    expect(placeholder).toBeLessThan(html.indexOf(">今天<"));
    expect(html.slice(placeholder, placeholder + 800)).toContain(">新旁聊<");
    expect(render([mainChat, sideChat])).not.toContain('aria-current="page"');
  });

  it("explains the section until a person starts a conversation", () => {
    const line = "单独聊一件事，主对话不受打扰。";
    expect(render([mainChat])).toContain(line);
    // Agent sessions don't count; the 其他来源 row is there with it.
    const agentsOnly = render([mainChat, cliChat]);
    expect(agentsOnly).toContain(line);
    expect(agentsOnly).toContain(OTHER_SOURCES);
    expect(agentsOnly).not.toContain("你的对话会出现在这里。");
    expect(render([mainChat, sideChat])).not.toContain(line);
  });

  it("follows the naming on the header, the +, the placeholder and the line", () => {
    const topic = render([mainChat], { naming: "话题", newChatActive: true });
    expect(topic).toContain(">话题<");
    expect(topic).toContain('aria-label="新话题"');
    expect(topic).toContain(">新话题<");
    expect(topic).toContain("一件事一个话题，主对话不受打扰。");
    const other = render([mainChat], { naming: "其他对话" });
    expect(other).toContain(">其他对话<");
    expect(other).toContain('aria-label="新对话"');
    const a3 = render([mainChat], { layout: "A3", naming: "话题" });
    expect(a3).toContain('aria-label="新话题"');
  });
});

describe("without a main chat (external runtime)", () => {
  it("is today's sidebar in every layout and naming", () => {
    for (const layout of ["A3", "B", "B′"] as const) {
      for (const naming of ["旁聊", "话题"] as const) {
        const html = render([sideChat, cliChat], { layout, naming });
        expect(html).toContain('aria-label="新对话"');
        expect(html).not.toContain(">旁聊<");
        expect(html).not.toContain(">话题<");
        expect(html).not.toContain(OTHER_SOURCES);
        expect(html).not.toContain("主对话");
        // The CLI session stays in 今天; the 新对话 row is the loud one.
        expect(at(html, "s-cli")).toBeGreaterThan(html.indexOf(">今天<"));
        expect(html).toContain("text-brand-strong");
        expect(render([], { layout, naming })).toContain(
          "你的对话会出现在这里。",
        );
      }
    }
  });

  it("ignores the demo", () => {
    const html = render([sideChat], { demo: true });
    expect(html).not.toContain("等你回复");
    expect(html).not.toContain(OTHER_SOURCES);
  });
});

describe("demo states", () => {
  it("fakes the states over the real list, render layer only", () => {
    const demo = buildMainChatDemo([mainChat, sideChat], DEMO_ANCHOR);
    expect(demo).not.toBeNull();
    // The real side chat runs; three fakes fill in; two fake agents.
    expect(demo!.live.get("s-main")).toEqual({ ask: true });
    expect(demo!.live.get("s-side")).toEqual({ running: true });
    const fakes = demo!.sessions.filter((s) => isDemoSessionId(s.id));
    expect(fakes).toHaveLength(5);
    expect(fakes.filter((s) => s.origin?.via !== "gui")).toHaveLength(2);
    // The input is untouched.
    expect(sideChat.summary).toBeUndefined();
    expect(buildMainChatDemo([sideChat], DEMO_ANCHOR)).toBeNull();
  });

  it("shows the main chat asking, a running step and 其他来源 with a row hung", () => {
    const html = render([mainChat, sideChat], { demo: true });
    const main = html.slice(at(html, "s-main"), at(html, "s-main") + 3000);
    expect(main).toContain("等你回复");
    expect(html).toContain("第 3 步 · 对比三家航司的退改规则");
    expect(html).toContain("出错");
    const others = html.indexOf(OTHER_SOURCES);
    expect(others).toBeGreaterThan(-1);
    // The asking CLI fake is newer than the scheduled one, yet hangs
    // after the shut drawer.
    expect(at(html, "demo:agent-cli")).toBeGreaterThan(
      at(html, "demo:agent-scheduled"),
    );
    expect(at(html, "demo:agent-scheduled")).toBeGreaterThan(others);
  });
});
