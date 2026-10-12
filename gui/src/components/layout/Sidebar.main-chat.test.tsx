import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import { Sidebar } from "./Sidebar";

// useCopy falls back to the zh copy without a CopyProvider.

// A session's erroring bridge can't be seeded in a store under static
// rendering; mark ids as needing the user on top of the real hook.
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

// TEMPORARY (ticket 09 trial): the section-belonging variant, fed past
// the localStorage-backed store.
const belonging = vi.hoisted(() => ({
  current: "C1" as "C1" | "C2" | "C3",
}));
const divider = vi.hoisted(() => ({
  current: "scroll" as "scroll" | "always",
}));
vi.mock("./sidebar/section-belonging-trial", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./sidebar/section-belonging-trial")>();
  return {
    ...actual,
    useSectionBelonging: () => belonging.current,
    useSectionDivider: () => divider.current,
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
    activeId?: string;
    newChatActive?: boolean;
    projects?: Project[];
    language?: "zh-CN" | "en-US";
  } = {},
) {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
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
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);
const OTHER_SOURCES = 'data-project-id="galley:other-sources"';
const SECTION = ">其他对话<";
const HINT = "另开一个对话聊一件事，主对话不受打扰。";

afterEach(() => {
  needsYou.clear();
  belonging.current = "C1";
});

/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
/** The opening tag right after the element carrying `needle` opens: its
 * first child. */
const firstChildOf = (html: string, needle: string) => {
  const i = html.indexOf(">", html.indexOf(needle)) + 1;
  return html.slice(i, html.indexOf(">", i) + 1);
};
const SCROLL_LIST = "overflow-y-auto";
const SECTION_HEADER = "data-sidebar-section-header";
const SECTION_BODY = "data-sidebar-section-body";

describe("the main chat's row", () => {
  it("stands on its own: once, as 主对话, never in a time bucket", () => {
    const html = render([mainChat, sideChat]);
    expect(count(html, 'data-session-id="s-main"')).toBe(1);
    expect(count(html, 'data-session-id="s-side"')).toBe(1);
    expect(html).toContain(">主对话<");
    expect(html).not.toContain(">主聊天<");
    // 今天 lists only the other chat.
    expect(at(html, "s-main")).toBeLessThan(html.indexOf(">今天<"));
    expect(at(html, "s-side")).toBeGreaterThan(html.indexOf(">今天<"));
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
    const html = render([mainChat, sideChat], { activeId: "s-side" });
    const main = html.slice(at(html, "s-main"));
    expect(main.slice(0, 1600)).toMatch(/text-\[13px\] text-ink font-medium/);
  });

  it("has no subline of its own before its first message", () => {
    const html = render([mainChat]);
    const main = html.slice(
      html.lastIndexOf("<", at(html, "s-main")),
      html.lastIndexOf("<", html.indexOf(SECTION)),
    );
    // The row's only text is its label.
    expect(main.replace(/<[^>]*>/g, "")).toBe("主对话");
    // Its status reads like any row's once it has one.
    const used = { ...mainChat, turnCount: 3, summary: "订好了" };
    expect(render([used])).toContain(">订好了<");
  });
});

describe("with a main chat: the sectioned sidebar", () => {
  it("heads the list with 其他对话 and its +, no 新对话 row", () => {
    const html = render([mainChat, sideChat]);
    expect(html).toContain(SECTION);
    // The + is the only new-chat control.
    expect(count(html, 'aria-label="新对话"')).toBe(1);
    expect(html.indexOf(SECTION)).toBeLessThan(
      html.indexOf('aria-label="新对话"'),
    );
    // No brand plus: that is the external runtime's 新对话 row.
    expect(html).not.toContain("text-brand-strong");
    expect(at(html, "s-main")).toBeLessThan(html.indexOf(SECTION));
    expect(html.indexOf(SECTION)).toBeLessThan(html.indexOf(">今天<"));
    // Narrow fallback: the three icons, in the masthead and in a row of
    // their own (the width picks one).
    expect(count(html, 'aria-label="搜索"')).toBe(2);
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

  it("keeps 其他来源 collapsed at launch and hangs what needs you under it", () => {
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

  it("selects a 新对话 placeholder at the section's top while the new-chat composer is up", () => {
    const html = render([mainChat, sideChat], { newChatActive: true });
    expect(count(html, 'aria-current="page"')).toBe(1);
    const placeholder = html.indexOf('aria-current="page"');
    expect(placeholder).toBeGreaterThan(html.indexOf(SECTION));
    expect(placeholder).toBeLessThan(html.indexOf(">今天<"));
    expect(html.slice(placeholder, placeholder + 800)).toContain(">新对话<");
    expect(render([mainChat, sideChat])).not.toContain('aria-current="page"');
  });

  it("explains the section until a person starts a conversation", () => {
    expect(render([mainChat])).toContain(HINT);
    // Agent sessions don't count; the 其他来源 row is there with it.
    const agentsOnly = render([mainChat, cliChat]);
    expect(agentsOnly).toContain(HINT);
    expect(agentsOnly).toContain(OTHER_SOURCES);
    expect(agentsOnly).not.toContain("你的对话会出现在这里。");
    expect(render([mainChat, sideChat])).not.toContain(HINT);
  });

  it("speaks English in the English UI", () => {
    const html = render([mainChat, cliChat], {
      language: "en-US",
      newChatActive: true,
    });
    expect(html).toContain(">Main chat<");
    expect(html).toContain(">Chats<");
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain(">Other sources<");
    expect(html).toContain(
      "Give one thing its own chat. The main chat stays uncluttered.",
    );
  });
});

describe("the section's belonging (ticket 09)", () => {
  it("「常显」 draws the divider under the main-chat row at rest, in the masthead's line", () => {
    divider.current = "always";
    try {
      const html = render([mainChat, sideChat]);
      const block = html.lastIndexOf("border-b py-1", at(html, "s-main"));
      expect(block).toBeGreaterThan(-1);
      expect(html.slice(block, at(html, "s-main"))).toContain("border-line/60");
    } finally {
      divider.current = "scroll";
    }
  });

  it("C1: pins only the main-chat row; the section header heads the scrolling list and sticks", () => {
    const html = render([mainChat, sideChat]);
    const list = html.indexOf(SCROLL_LIST);
    // The main-chat row is outside the scroll container, in the block
    // that owns the scroll-linked divider (clear at rest).
    expect(at(html, "s-main")).toBeLessThan(list);
    const block = html.lastIndexOf("border-b py-1", at(html, "s-main"));
    expect(block).toBeGreaterThan(-1);
    expect(html.slice(block, at(html, "s-main"))).toContain(
      "border-transparent",
    );
    // The header is inside it, first, sticky, opaque and above the rows.
    const header = html.indexOf(SECTION_HEADER);
    expect(header).toBeGreaterThan(list);
    expect(firstChildOf(html, SCROLL_LIST)).toContain("data-sidebar-section");
    expect(html.indexOf(SECTION)).toBeGreaterThan(header);
    expect(html.indexOf(SECTION)).toBeLessThan(at(html, "s-side"));
    const headerTag = tagWith(html, SECTION_HEADER);
    expect(headerTag).toContain("sticky top-0 z-20");
    expect(headerTag).toContain("bg-chrome");
    // scrollIntoView clears it.
    expect(tagWith(html, SCROLL_LIST)).toContain("scroll-pt-11");
    // The first label under it opens on the small gap.
    expect(firstChildOf(html, SECTION_BODY)).toContain(
      "[[data-sidebar-section-body]&gt;&amp;:first-child]:pt-1.5",
    );
    // The placeholder row and the empty hint sit under the header.
    const composing = render([mainChat, sideChat], { newChatActive: true });
    expect(firstChildOf(composing, SECTION_BODY)).toContain('class="pt-1"');
    const empty = render([mainChat]);
    expect(empty.indexOf(HINT)).toBeGreaterThan(empty.indexOf(SECTION_BODY));
  });

  it("C2: indents everything under the header, not the header", () => {
    belonging.current = "C2";
    const html = render([mainChat, sideChat]);
    expect(tagWith(html, SECTION_BODY)).toContain('class="pl-2"');
    expect(tagWith(html, SECTION_HEADER)).not.toContain("pl-2");
    belonging.current = "C1";
    expect(tagWith(render([mainChat, sideChat]), SECTION_BODY)).toContain(
      'class=""',
    );
  });

  it("C3: lays the section, header included, on its own ground; the main chat stays on chrome", () => {
    belonging.current = "C3";
    const html = render([mainChat, sideChat]);
    const section = tagWith(html, 'data-sidebar-section=""');
    expect(section).toContain("bg-app");
    const headerTag = tagWith(html, SECTION_HEADER);
    expect(headerTag).toContain("bg-app");
    expect(headerTag).not.toContain("bg-chrome");
    expect(at(html, "s-main")).toBeLessThan(html.indexOf(section));
    belonging.current = "C1";
    expect(
      tagWith(render([mainChat, sideChat]), 'data-sidebar-section=""'),
    ).not.toContain("bg-app");
  });

  it("leaves the external runtime's sidebar alone in every variant", () => {
    const today = render([sideChat, cliChat], { newChatActive: true });
    // No section wrappers (the labels' first-child class names the
    // attribute but needs it on a parent to match).
    for (const attr of ["section", "section-header", "section-body"]) {
      expect(today).not.toContain(`data-sidebar-${attr}=""`);
    }
    expect(today).not.toContain("sticky");
    expect(tagWith(today, SCROLL_LIST)).toContain(
      'class="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2"',
    );
    for (const variant of ["C2", "C3"] as const) {
      belonging.current = variant;
      expect(render([sideChat, cliChat], { newChatActive: true })).toBe(today);
    }
  });
});

describe("without a main chat (external runtime)", () => {
  it("is today's sidebar: the 新对话 row, nothing split off", () => {
    const html = render([sideChat, cliChat]);
    expect(count(html, 'aria-label="新对话"')).toBe(1);
    // The 新对话 row is the loud one.
    expect(html).toContain("text-brand-strong");
    expect(html).not.toContain(SECTION);
    expect(html).not.toContain(OTHER_SOURCES);
    expect(html).not.toContain(HINT);
    expect(html).not.toContain("主对话");
    // The CLI session stays in 今天.
    expect(at(html, "s-cli")).toBeGreaterThan(html.indexOf(">今天<"));
    expect(render([])).toContain("你的对话会出现在这里。");
  });

  it("selects the 新对话 row itself while the new-chat composer is up", () => {
    const html = render([sideChat], { newChatActive: true });
    expect(count(html, 'aria-current="page"')).toBe(1);
    const row = html.lastIndexOf(
      "<button",
      html.indexOf('aria-current="page"'),
    );
    expect(html.slice(row, row + 400)).toContain('aria-label="新对话"');
  });
});
