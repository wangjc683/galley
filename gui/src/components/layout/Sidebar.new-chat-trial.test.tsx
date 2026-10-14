import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import type { NewChatTrialVariant } from "./sidebar/new-chat-trial";
import { Sidebar } from "./Sidebar";

// TEMPORARY — the new-chat placeholder trial (ticket 13). Static
// rendering reads a zustand store's initial state, so the variant and
// the 项目 section's fold are mocked instead of set.
const trial = vi.hoisted(() => ({
  variant: "现状" as NewChatTrialVariant,
  projectsCollapsed: false,
}));
vi.mock("./sidebar/new-chat-trial", () => ({
  useNewChatTrialStore: <T,>(
    selector: (state: { variant: NewChatTrialVariant }) => T,
  ) => selector({ variant: trial.variant }),
}));
vi.mock("@/hooks/useSidebarProjectsCollapsed", () => ({
  useSidebarProjectsCollapsed: () => [trial.projectsCollapsed, () => {}],
}));

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    origin: { via: "gui" },
    lastActivityAt: minutesAgo(5),
    ...extra,
  });

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const todayChat = managed("s-today");
// Three days back is never 今天 (which later bucket depends on the
// date), and 今天 is all these tests watch.
const olderChat = managed("s-older", { lastActivityAt: daysAgo(3) });
const projectChat = managed("s-p1", { projectId: "p" });
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
    variant: NewChatTrialVariant;
    newChatActive?: boolean;
    newChatProjectId?: string;
    newChatSessionId?: string;
    expandedProjectIds?: string[];
    projects?: Project[];
  },
) {
  trial.variant = opts.variant;
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          projects={opts.projects}
          newChatActive={opts.newChatActive ?? true}
          newChatProjectId={opts.newChatProjectId}
          newChatSessionId={opts.newChatSessionId}
          expandedProjectIds={opts.expandedProjectIds ?? []}
          onNewChat={() => {}}
          onSelectSession={() => {}}
          onStartProjectConversation={() => {}}
          onArchiveSession={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const DRAFT = "data-new-chat-draft";
const TODAY = ">今天<";
const HEADER_PLUS = 'aria-label="新对话"';
const GROUP_PLUS = 'aria-label="在 回归 里新建对话"';
const count = (html: string, needle: string) => html.split(needle).length - 1;
const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);
/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
/** The 今天 label's count: the text between the label and its end. */
const todayCount = (html: string) => {
  const i = html.indexOf(TODAY) + 1;
  return html
    .slice(i, html.indexOf("</div>", i))
    .replace(/<[^>]*>/g, "")
    .replace("今天", "");
};

afterEach(() => {
  trial.variant = "现状";
  trial.projectsCollapsed = false;
});

describe("现状: the placeholder row stays the control", () => {
  it("selects 新对话 at the section's top, nothing else", () => {
    const html = render([mainChat, olderChat], { variant: "现状" });
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(html).not.toContain(DRAFT);
    expect(html).not.toContain(TODAY);
  });
});

describe("B: the + that opened the composer stays pressed", () => {
  it("presses the section header's + for a plain new chat, with no row", () => {
    const html = render([mainChat, todayChat], { variant: "B" });
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(tagWith(html, HEADER_PLUS)).toContain('aria-current="page"');
    expect(tagWith(html, HEADER_PLUS)).toContain("bg-selected");
    expect(html).not.toContain(DRAFT);
  });

  it("presses the project row's + instead, shown without hover", () => {
    const html = render([mainChat, projectChat], {
      variant: "B",
      projects: [project],
      newChatProjectId: "p",
    });
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(tagWith(html, GROUP_PLUS)).toContain('aria-current="page"');
    expect(tagWith(html, HEADER_PLUS)).not.toContain("aria-current");
    // The overlay holding it is shown, not hover-only.
    const overlay = html.lastIndexOf("<div", html.indexOf(GROUP_PLUS));
    expect(html.slice(overlay, html.indexOf(">", overlay))).toContain(
      "pointer-events-auto opacity-100",
    );
  });

  it("presses nothing once the composer is gone", () => {
    const html = render([mainChat, todayChat], {
      variant: "B",
      newChatActive: false,
    });
    expect(html).not.toContain('aria-current="page"');
  });
});

describe("A: a draft row where the conversation will land", () => {
  it("opens 今天 for it when today has nothing yet, counted", () => {
    const html = render([mainChat, olderChat], { variant: "A" });
    expect(count(html, DRAFT)).toBe(1);
    expect(count(html, 'aria-current="page"')).toBe(1);
    const draft = html.indexOf(DRAFT);
    expect(draft).toBeGreaterThan(html.indexOf(TODAY));
    expect(draft).toBeLessThan(at(html, "s-older"));
    expect(todayCount(html)).toBe("1");
    expect(tagWith(html, HEADER_PLUS)).not.toContain("aria-current");
  });

  it("heads today's rows when there are some", () => {
    const html = render([mainChat, todayChat], { variant: "A" });
    const draft = html.indexOf(DRAFT);
    expect(draft).toBeGreaterThan(html.indexOf(TODAY));
    expect(draft).toBeLessThan(at(html, "s-today"));
    expect(todayCount(html)).toBe("2");
  });

  it("still opens 今天 when the section lists nothing else", () => {
    const html = render([mainChat], { variant: "A" });
    expect(html.indexOf(DRAFT)).toBeGreaterThan(html.indexOf(TODAY));
  });

  it("goes first in an open project group, before its sessions", () => {
    const html = render([mainChat, projectChat, olderChat], {
      variant: "A",
      projects: [project],
      newChatProjectId: "p",
      expandedProjectIds: ["p"],
    });
    const draft = html.indexOf(DRAFT);
    expect(draft).toBeGreaterThan(html.indexOf('data-project-id="p"'));
    expect(draft).toBeLessThan(at(html, "s-p1"));
    expect(html).not.toContain(TODAY);
  });

  it("takes an empty project's CTA slot", () => {
    const html = render([mainChat], {
      variant: "A",
      projects: [project],
      newChatProjectId: "p",
      expandedProjectIds: ["p"],
    });
    expect(count(html, DRAFT)).toBe(1);
    expect(html).not.toContain(">新建项目对话<");
  });

  it("hangs under a folded group, past its shut drawer", () => {
    const html = render([mainChat, projectChat], {
      variant: "A",
      projects: [project],
      newChatProjectId: "p",
    });
    // The drawer keeps s-p1 mounted at zero height; the hung draft
    // comes after it, inside the group.
    expect(html.indexOf(DRAFT)).toBeGreaterThan(at(html, "s-p1"));
    expect(html.indexOf(DRAFT)).toBeGreaterThan(
      html.indexOf("data-collapsed-drawer"),
    );
  });

  it("hangs under a folded 项目 section, as the selected session would", () => {
    trial.projectsCollapsed = true;
    const html = render([mainChat, projectChat, olderChat], {
      variant: "A",
      projects: [project],
      newChatProjectId: "p",
    });
    expect(html).not.toContain('data-project-id="p"');
    const draft = html.indexOf(DRAFT);
    expect(draft).toBeGreaterThan(html.indexOf(">项目<"));
    expect(draft).toBeLessThan(at(html, "s-older"));
  });

  it("falls back to 今天 for a project the sidebar doesn't know", () => {
    const html = render([mainChat, olderChat], {
      variant: "A",
      newChatProjectId: "gone",
    });
    expect(html.indexOf(DRAFT)).toBeGreaterThan(html.indexOf(TODAY));
  });
});

describe("the first send's session takes over at once (B and A)", () => {
  // createSessionPersisted lists the session and makes it the store's
  // active one before the screen flips from the empty composer.
  const fresh = managed("s-new", { title: "新对话" });

  for (const variant of ["B", "A"] as const) {
    it(`${variant}: selects its row and drops the draft / pressed +`, () => {
      const html = render([mainChat, fresh, olderChat], {
        variant,
        newChatSessionId: "s-new",
      });
      expect(html).not.toContain(DRAFT);
      expect(tagWith(html, HEADER_PLUS)).not.toContain("aria-current");
      expect(tagWith(html, 'data-session-id="s-new"')).toContain("bg-selected");
    });
  }

  it("现状 keeps today's beat as is", () => {
    const html = render([mainChat, fresh], {
      variant: "现状",
      newChatSessionId: "s-new",
    });
    expect(tagWith(html, 'data-session-id="s-new"')).not.toContain(
      "bg-selected",
    );
  });
});

describe("the external runtime has no trial", () => {
  it("keeps its 新对话 row selected under every variant", () => {
    for (const variant of ["现状", "B", "A"] as const) {
      const html = render([todayChat], { variant });
      expect(html).not.toContain(DRAFT);
      expect(count(html, 'aria-current="page"')).toBe(1);
    }
  });
});
