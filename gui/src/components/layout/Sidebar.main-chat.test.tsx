import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import type { AssistantLastMessage } from "@/lib/assistant";
import { dropComposerDraft, saveComposerDraft } from "@/lib/composer-draft";
import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import { Sidebar } from "./Sidebar";

// useCopy falls back to the zh copy without a CopyProvider.

// 票 65 临时切换器，定档后由拆除票删掉：these tests describe today's
// avatar and card (现状, what a production build draws); the trial's own
// tests are under assistant/face-trial.
vi.mock(
  "@/components/layout/assistant/face-trial/face-trial",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/components/layout/assistant/face-trial/face-trial")
    >()),
    useAssistantFaceTrial: () => ({
      motion: null,
      layout: null,
      demo: false,
      pinned: null,
    }),
  }),
);

// A row's live state (running, a pending question, a runtime error) is
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

// A session's erroring bridge can't be seeded in a store under static
// rendering; mark ids as needing the user on top of the real hook.
const needsYou = vi.hoisted(() => new Set<string>());
// A subtask's ask / error the same way: the kind the hook would report
// for a list holding it (ticket 06a).
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
      const kinds = args[0]
        .map((s) => attentionKind.get(s.id))
        .filter((k) => k !== undefined);
      const kind = kinds.includes("error")
        ? "error"
        : kinds.includes("ask")
          ? "ask"
          : view.kind;
      return {
        ...view,
        kind,
        needsYouIds: new Set([...view.needsYouIds, ...needsYou]),
      };
    },
  };
});

// The card reads the pending question, the last message and, while it
// runs, whether it types (a woken round only while it writes words) from
// the messages store, which static rendering only sees in its initial
// state (lib/assistant.test.ts and hooks/useAssistantSentence.test.ts
// cover how they are worked out); seed them here. Drafts come from the
// real composer-draft module.
const card = vi.hoisted(() => ({
  question: null as string | null,
  lastMessage: null as AssistantLastMessage | null,
  // A round you started types throughout; a woken one between its words
  // does not.
  typing: true,
}));
vi.mock("@/hooks/useAssistantState", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantState")>();
  return {
    ...actual,
    usePendingQuestion: () => card.question,
    useAssistantLastMessage: () => card.lastMessage,
  };
});
vi.mock("@/hooks/useAssistantSentence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useAssistantSentence")>();
  return {
    ...actual,
    useAssistantTyping: (_id: string, running: boolean) =>
      running && card.typing,
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
const subtask = managed("s-sub", {
  title: "把 PDF 分类",
  origin: { via: "subtask" },
  parentSessionId: "s-main",
  lastActivityAt: minutesAgo(1),
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
    newChatSessionId?: string;
    projects?: Project[];
    language?: "zh-CN" | "en-US";
    scheduledActionCount?: number;
    archivedCount?: number;
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
          newChatSessionId={opts.newChatSessionId}
          scheduledActionCount={opts.scheduledActionCount}
          archivedCount={opts.archivedCount}
          onOpenArchived={() => {}}
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

const count = (html: string, needle: string) => html.split(needle).length - 1;
const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);
/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
/** From the element carrying `from` up to the next `until` after it. */
const between = (html: string, from: string, until: string) =>
  html.slice(html.indexOf(from), html.indexOf(until, html.indexOf(from) + 1));

const OTHER_SOURCES = 'data-project-id="galley:other-sources"';
const NEW_CHAT = 'aria-label="新对话"';
const PROJECT_PLUS = 'aria-label="在 回归 里新建对话"';
const CARD = 'data-role="assistant-card"';
const LINE = 'data-role="assistant-card-line"';
const BADGE = 'data-role="assistant-badge"';
const ROW = 'data-role="sidebar-new-chat-row"';
const SCROLL_LIST = "overflow-y-auto";
const STICKY = "data-sidebar-section-header";
const EMPTY = "你的对话会出现在这里。";
const WORKBENCH = 'data-sidebar-zone-label="workbench"';
const ARCHIVED = ">已归档</span>";

afterEach(() => {
  needsYou.clear();
  attentionKind.clear();
  live.clear();
  card.question = null;
  card.lastMessage = null;
  card.typing = true;
  dropComposerDraft("s-main");
});

describe("with a main chat: the masthead, the card, the new-chat row", () => {
  it("drops the wordmark: the masthead is the lights' zone and two icons", () => {
    const html = render([mainChat, sideChat]);
    const masthead = html.slice(0, html.indexOf(CARD));
    expect(masthead).not.toContain("font-serif");
    expect(masthead).not.toContain(">Galley<");
    for (const label of ["搜索", "新建项目"]) {
      expect(count(masthead, `aria-label="${label}"`)).toBe(1);
    }
    // Ticket 42: the 待办 icon gave way to the row under the card.
    expect(masthead).not.toContain('aria-label="待办"');
    expect(tagWith(html, "data-tauri-drag-region")).toContain("justify-end");
    // Off macOS (the test platform) the icons never leave the masthead.
    expect(masthead).toContain('class="items-center flex shrink-0 gap-1"');
  });

  it("has neither 定时 nor its badge in the masthead (tickets 37, 42)", () => {
    const html = render([mainChat, sideChat], { scheduledActionCount: 2 });
    const masthead = html.slice(0, html.indexOf(CARD));
    expect(masthead.indexOf('aria-label="搜索"')).toBeLessThan(
      masthead.indexOf('aria-label="新建项目"'),
    );
    // A count here only ever meant "handle something" (ruling 86).
    expect(html).not.toContain('aria-label="定时"');
    expect(html).not.toContain("2 项定时任务需要处理");
    expect(html).not.toContain("sidebar-state-pop");
    expect(html).not.toContain(">2</span>");
  });

  it("has no 「待办」 row under the card: it opens from Galley's top bar (ticket 45)", () => {
    const html = render([mainChat, sideChat]);
    expect(html).not.toContain('aria-label="待办"');
    // The card's block holds the card alone, as before ticket 42.
    const block = html.slice(
      html.indexOf('<div class="pb-2.5 pt-3">'),
      html.indexOf(WORKBENCH),
    );
    expect(count(block, CARD)).toBe(1);
    // The card is the block's only button.
    expect(count(block, "<button")).toBe(1);
  });

  it("keeps 定时 and its badge without a main chat", () => {
    const html = render([sideChat], { scheduledActionCount: 2 });
    expect(html).toContain('aria-label="2 项定时任务需要处理"');
    expect(html).not.toContain('aria-label="待办"');
    expect(html).toContain(">2</span>");
  });

  it("has no main chat row, 其他对话 header or its hint, nor 主对话 anywhere", () => {
    const html = render([mainChat, sideChat, cliChat], {
      projects: [project],
    });
    expect(html).not.toContain('data-session-id="s-main"');
    expect(html).not.toContain(">其他对话<");
    expect(html).not.toContain("另开一个对话聊一件事");
    expect(html).not.toContain("主对话");
    expect(html).not.toContain("data-sidebar-section-body");
    expect(count(html, CARD)).toBe(1);
    expect(count(html, 'data-session-id="s-side"')).toBe(1);
  });

  it("stands the card on the chrome above the strong line, the list under it on the app ground", () => {
    const html = render([mainChat, sideChat]);
    // The card's block (12px over the card, 10px under it), then the
    // workbench's name on the strong line; the list follows.
    expect(tagWith(html, CARD)).not.toContain("line-strong");
    expect(html.indexOf('<div class="pb-2.5 pt-3">')).toBeLessThan(
      html.indexOf(CARD),
    );
    expect(html.indexOf(CARD)).toBeLessThan(html.indexOf(WORKBENCH));
    expect(html.indexOf(WORKBENCH)).toBeLessThan(html.indexOf(SCROLL_LIST));
    const cardTag = tagWith(html, CARD);
    // One IM list row: fixed 58px, the card radius, no border.
    expect(cardTag).toContain("h-[58px]");
    expect(cardTag).toContain("rounded-md");
    expect(cardTag).not.toContain("border");
    // At rest: no fill, no lift, the hover fill.
    expect(cardTag).not.toContain("bg-selected");
    expect(cardTag).toContain("hover:bg-hover");
    // A 40px avatar, 「Galley」 at 14px.
    const body = between(html, CARD, "</button>");
    expect(body).toContain("size-10");
    expect(body).toMatch(/text-\[14px\][^>]*>Galley</);
    expect(tagWith(html, 'data-sidebar-section=""')).toContain("bg-app");
  });

  it("names the workbench on the strong line, drawn from after the word (ticket 62's C)", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      const html = render([mainChat, sideChat], { language });
      const word = language === "zh-CN" ? ">工作台<" : ">Workbench<";
      expect(count(html, "data-sidebar-zone-label")).toBe(1);
      expect(count(html, word)).toBe(1);
      // The strong line is the name row's, nowhere else.
      expect(count(html, "line-strong")).toBe(1);
      const row = between(html, WORKBENCH, SCROLL_LIST);
      expect(row.indexOf(word)).toBeLessThan(row.indexOf("bg-line-strong"));
      // The ground turns on the line: chrome above, the app ground below.
      expect(tagWith(html, WORKBENCH)).toContain("h-[13px]");
      expect(tagWith(html, WORKBENCH)).toContain(
        "linear-gradient(to bottom, transparent 6px, var(--color-app) 6px)",
      );
      // Quieter than a bucket's eyebrow: regular, untracked, upright.
      const span = row.slice(row.indexOf("<span"), row.indexOf("</span>"));
      expect(span).toContain("text-ui-label");
      expect(span).toContain("text-ink-muted");
      expect(span).toContain("whitespace-nowrap");
      for (const eyebrow of ["uppercase", "tracking-", "font-semibold"]) {
        expect(span).not.toContain(eyebrow);
      }
    }
    // No 「助理」 over the card (ruling 114 point 2).
    expect(render([mainChat, sideChat])).not.toContain(">助理<");
  });

  it("runs the workbench's ground to the window's foot, 已归档 pinned there on it", () => {
    const html = render([mainChat, sideChat], { archivedCount: 2 });
    expect(tagWith(html, SCROLL_LIST)).toContain("scroll-pt-[42px] bg-app");
    const i = html.indexOf(ARCHIVED);
    expect(i).toBeGreaterThan(html.lastIndexOf(SCROLL_LIST));
    const button = html.lastIndexOf("<button", i);
    expect(html.slice(0, button).endsWith('<div class="bg-app">')).toBe(true);
    expect(html.slice(button, i)).toContain("border-t border-line/70");
    // Only with something archived, as before.
    expect(render([mainChat, sideChat], { archivedCount: 0 })).not.toContain(
      ARCHIVED,
    );
  });

  it("opens the list on the sticky new-chat row, with the old sidebar's spacing", () => {
    const html = render([mainChat, sideChat]);
    const sticky = tagWith(html, STICKY);
    expect(sticky).toContain("sticky top-0 z-20 bg-app pb-1 pt-1.5");
    expect(html.indexOf(STICKY)).toBeGreaterThan(html.indexOf(SCROLL_LIST));
    const row = between(html, ROW, "data-sidebar-section-fade");
    expect(count(row, NEW_CHAT)).toBe(1);
    // The external runtime's button: the brand plus, ⌘N on its end.
    expect(row).toContain("text-brand-strong");
    expect(row).toContain("Ctrl+N");
    // The masthead's two icons are in the row too, shown below the
    // macOS threshold only.
    for (const label of ["搜索", "新建项目"]) {
      expect(count(row, `aria-label="${label}"`)).toBe(1);
    }
    expect(row).not.toContain('aria-label="待办"');
    expect(row).toContain('class="items-center hidden min-w-0 gap-0.5"');
    expect(count(html, NEW_CHAT)).toBe(1);
    // scrollIntoView clears the sticky row; rows fade under it once the
    // list scrolls.
    expect(tagWith(html, SCROLL_LIST)).toContain("scroll-pt-[42px]");
    expect(tagWith(html, "data-sidebar-section-fade")).toContain("opacity-0");
    // The first label keeps its own top space (no tightening).
    expect(html).not.toContain("first-child");
  });

  it("says the old sidebar's line while nobody has started a conversation", () => {
    expect(render([mainChat])).toContain(EMPTY);
    // Agent sessions don't count; 其他来源 is there with it.
    const agentsOnly = render([mainChat, cliChat]);
    expect(agentsOnly).toContain(EMPTY);
    expect(agentsOnly).toContain(OTHER_SOURCES);
    expect(render([mainChat, sideChat])).not.toContain(EMPTY);
  });
});

describe("the new-chat row lights while the empty composer is up", () => {
  it("lights for a new chat, as the one place that says you are here", () => {
    expect(render([mainChat, sideChat])).not.toContain('aria-current="page"');
    const html = render([mainChat, sideChat], { newChatActive: true });
    expect(count(html, 'aria-current="page"')).toBe(1);
    const button = tagWith(html, NEW_CHAT);
    expect(button).toContain('aria-current="page"');
    expect(button).toContain("bg-selected shadow-[var(--shadow-selected)]");
  });

  it("lights for a project's new chat too: no pressed + on its group row", () => {
    const html = render([mainChat, sideChat, projectCliChat], {
      newChatActive: true,
      projects: [project],
    });
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(tagWith(html, NEW_CHAT)).toContain('aria-current="page"');
    const plus = tagWith(html, PROJECT_PLUS);
    expect(plus).not.toContain("aria-current");
    expect(plus).not.toContain("bg-selected shadow");
    // The group's + stays a hover control.
    const overlay = html.lastIndexOf("<div", html.indexOf(PROJECT_PLUS));
    expect(html.slice(overlay, html.indexOf(">", overlay))).not.toContain(
      "pointer-events-auto opacity-100",
    );
  });

  it("hands the selection to the first send's session at once", () => {
    // createSessionPersisted lists it and makes it the store's active
    // session before the screen flips from the empty composer.
    const fresh = managed("s-new", { title: "新对话", origin: { via: "gui" } });
    const html = render([mainChat, sideChat, fresh], {
      newChatActive: true,
      newChatSessionId: "s-new",
    });
    expect(tagWith(html, NEW_CHAT)).not.toContain("aria-current");
    expect(tagWith(html, 'data-session-id="s-new"')).toContain("bg-selected");
  });
});

describe("the assistant's card", () => {
  const RECAP = "花市要顺便买一袋营养土";
  const used = { ...mainChat, turnCount: 3, summary: RECAP, lastStepIndex: 2 };
  const lineOf = (html: string) => {
    const body = between(html, CARD, "</button>");
    const i = body.indexOf(LINE);
    return i < 0 ? null : body.slice(body.lastIndexOf("<", i));
  };
  const textOf = (fragment: string | null) =>
    fragment === null ? null : fragment.replace(/<[^>]*>/g, "");

  it("is selected while the main chat or one of its subtasks is open", () => {
    for (const activeId of ["s-main", "s-sub"]) {
      const tag = tagWith(
        render([mainChat, sideChat, subtask], { activeId }),
        CARD,
      );
      expect(tag).toContain('aria-current="page"');
      expect(tag).toContain("bg-selected shadow-[var(--shadow-selected)]");
    }
    const elsewhere = tagWith(
      render([mainChat, sideChat], { activeId: "s-side" }),
      CARD,
    );
    expect(elsewhere).not.toContain("aria-current");
    // The open subtask has no row of its own.
    expect(render([mainChat, subtask], { activeId: "s-sub" })).not.toContain(
      'data-session-id="s-sub"',
    );
  });

  it("says the last message at rest — the greeting at first, 「你：」 before the user's", () => {
    card.lastMessage = {
      fromUser: false,
      text: "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
    };
    const greeting = lineOf(render([mainChat, sideChat]));
    expect(textOf(greeting)).toBe(card.lastMessage.text);
    expect(greeting).toContain('data-kind="message"');
    expect(greeting).toContain("text-ink-muted");
    // Open too: a chat list repeats what is on screen.
    expect(textOf(lineOf(render([used], { activeId: "s-main" })))).toBe(
      card.lastMessage.text,
    );
    card.lastMessage = { fromUser: true, text: "明早提醒我" };
    expect(textOf(lineOf(render([used, sideChat])))).toBe("你：明早提醒我");
    // Nothing to say, nothing under the name.
    card.lastMessage = null;
    expect(lineOf(render([mainChat, sideChat]))).toBeNull();
  });

  it("puts an error over a question over running over a draft over the last message", () => {
    card.lastMessage = { fromUser: false, text: "好的" };
    card.question = "去哪个花市？";
    saveComposerDraft("s-main", { text: "下周三的会", images: [] });
    const say = () => lineOf(render([used, sideChat], { activeId: "s-side" }));

    live.set("s-main", { status: "error", hasPendingAskUser: true });
    expect(textOf(say())).toBe("出错");
    expect(say()).toContain("text-error");

    live.set("s-main", { status: "running", hasPendingAskUser: true });
    const asking = say();
    expect(textOf(asking)).toBe("等你回复：去哪个花市？");
    // The prefix in amber, the question in the line's ink.
    expect(asking).toMatch(/text-warning[^>]*>等你回复：</);
    expect(asking).toContain("text-ink-muted");

    // Running: 「正在输入…」 (rulings 107, 110) — never the header's
    // sentence, never 「第 N 步 · 摘要」.
    live.set("s-main", { status: "running" });
    expect(textOf(say())).toBe("正在输入…");
    expect(say()).toContain("text-brand-strong/85");
    expect(say()).toContain("sidebar-step-tick");

    live.clear();
    const draft = say();
    expect(textOf(draft)).toBe("草稿：下周三的会");
    expect(draft).toMatch(/text-brand-strong[^>]*>草稿：</);

    dropComposerDraft("s-main");
    expect(textOf(say())).toBe("好的");
  });

  // Ruling 104 (ticket 52), overturning ruling 87's 2nd and 3rd points;
  // rulings 107, 110 (tickets 55, 58) for running.
  it("says only the last message with the main chat on screen, the state on the avatar; the words away from it", () => {
    card.question = "去哪个花市？";
    card.lastMessage = { fromUser: true, text: "周六去花市" };
    saveComposerDraft("s-main", { text: "下周三的会", images: [] });
    const onScreen = () => render([used, subtask], { activeId: "s-main" });
    const inSubtask = () =>
      lineOf(render([used, subtask], { activeId: "s-sub" }));

    for (const [arrange, kind] of [
      [
        () =>
          live.set("s-main", { status: "running", hasPendingAskUser: true }),
        "ask",
      ],
      [() => live.set("s-main", { status: "error" }), "error"],
      [() => attentionKind.set("s-sub", "ask"), "ask"],
      [() => attentionKind.set("s-sub", "error"), "error"],
    ] as const) {
      live.clear();
      attentionKind.clear();
      arrange();
      const html = onScreen();
      const said = lineOf(html);
      // Asking, its question is what it said; otherwise your last words.
      expect(textOf(said)).toBe(
        kind === "ask" && live.get("s-main")?.hasPendingAskUser
          ? "去哪个花市？"
          : "你：周六去花市",
      );
      // In the last message's ink: no brand, amber or red state words.
      expect(said).toContain('data-kind="message"');
      expect(said).toContain("text-ink-muted");
      expect(said).not.toMatch(/text-(brand-strong|warning|error)/);
      expect(said).not.toContain("sidebar-step-tick");
      // The avatar and the name carry the state.
      const body = between(html, CARD, "</button>");
      expect(body).toContain(`data-kind="${kind}"`);
      expect(body).toMatch(/font-semibold[^>]*>Galley</);
    }

    // Running: 「正在输入…」 on screen and away alike, in the running tone.
    live.clear();
    attentionKind.clear();
    live.set("s-main", { status: "running" });
    for (const said of [
      lineOf(onScreen()),
      inSubtask(),
      lineOf(render([used, sideChat], { activeId: "s-side" })),
    ]) {
      expect(textOf(said)).toBe("正在输入…");
      expect(said).toContain('data-kind="running"');
      expect(said).toContain("text-brand-strong/85");
    }
    expect(between(onScreen(), CARD, "</button>")).toContain(
      'data-kind="running"',
    );
    // A woken round between its words: the last message, open or not —
    // never the draft — the avatar still spinning.
    card.typing = false;
    for (const html of [
      onScreen(),
      render([used, subtask], { activeId: "s-sub" }),
    ]) {
      expect(textOf(lineOf(html))).toBe("你：周六去花市");
      expect(between(html, CARD, "</button>")).toContain('data-kind="running"');
    }
    card.typing = true;

    // Away in its subtask, not running: the words, as before.
    live.set("s-main", { status: "running", hasPendingAskUser: true });
    expect(textOf(inSubtask())).toBe("等你回复：去哪个花市？");
    live.set("s-main", { status: "error" });
    expect(textOf(inSubtask())).toBe("出错");
    live.clear();
    expect(textOf(inSubtask())).toBe("草稿：下周三的会");
  });

  it("stays selected but marks a new reply while one of its subtasks is open", () => {
    card.lastMessage = { fromUser: false, text: "子任务办完了" };
    const html = render([{ ...used, hasUnread: true }, subtask], {
      activeId: "s-sub",
    });
    expect(tagWith(html, CARD)).toContain('aria-current="page"');
    expect(tagWith(html, CARD)).toContain('data-state="unread"');
  });

  it("reports no steps, while a workbench session running beside it keeps its 「第 N 步」", () => {
    const stepping = { ...sideChat, summary: "比较两班车", lastStepIndex: 3 };
    live.set("s-main", { status: "running" });
    live.set("s-side", { status: "running" });
    const html = render([used, stepping]);
    expect(textOf(lineOf(html))).toBe("正在输入…");
    expect(between(html, CARD, "</button>")).not.toMatch(/第 \d+ 步/);
    expect(between(html, 'data-session-id="s-side"', "</button>")).toContain(
      "第 3 步 · 比较两班车",
    );
  });

  it("says 「等你回复」 alone when the question is not at hand, and a subtask's in its words", () => {
    live.set("s-main", { hasPendingAskUser: true });
    const plain = lineOf(render([used, sideChat]));
    expect(textOf(plain)).toBe("等你回复");
    expect(plain).toContain("font-medium text-warning");
    live.clear();
    card.question = "这个不是它的";
    attentionKind.set("s-sub", "ask");
    expect(textOf(lineOf(render([used, sideChat, subtask])))).toBe(
      "子任务在问你",
    );
    attentionKind.set("s-sub", "error");
    expect(textOf(lineOf(render([used, sideChat, subtask])))).toBe(
      "子任务出错",
    );
  });

  it("shows no draft while the main chat is open: it is in the composer", () => {
    card.lastMessage = { fromUser: false, text: "好的" };
    saveComposerDraft("s-main", { text: "下周三的会", images: [] });
    expect(textOf(lineOf(render([used], { activeId: "s-main" })))).toBe("好的");
    // One of its subtasks open is not the main chat on screen (ruling
    // 87): the draft is not in front of you there.
    expect(textOf(lineOf(render([used, subtask], { activeId: "s-sub" })))).toBe(
      "草稿：下周三的会",
    );
    // An image-only draft, elsewhere.
    saveComposerDraft("s-main", {
      text: "",
      images: [
        {
          id: "i",
          dataUrl: "data:image/png;base64,xx",
          previewUrl: "blob:i",
          mimeType: "image/png",
          byteSize: 2,
        },
      ],
    });
    expect(textOf(lineOf(render([used, sideChat])))).toBe("草稿：[图片]");
  });

  it("marks a new reply on the avatar and bolds the name, only while it is not open", () => {
    card.lastMessage = { fromUser: false, text: "查到了：多云" };
    const unread = { ...used, hasUnread: true };
    const away = render([unread, sideChat], { activeId: "s-side" });
    const body = between(away, CARD, "</button>");
    expect(tagWith(away, CARD)).toContain('data-state="unread"');
    expect(body).toContain('data-kind="unread"');
    expect(body).toMatch(/font-semibold[^>]*>Galley</);
    // The new reply is the second line.
    expect(textOf(lineOf(away))).toBe("查到了：多云");
    expect(tagWith(away, CARD)).toContain(
      'aria-label="Galley · 有新回复 · 查到了：多云"',
    );
    const open = render([unread], { activeId: "s-main" });
    expect(tagWith(open, CARD)).toContain('data-state="idle"');
    expect(open).not.toContain(BADGE);
    expect(between(open, CARD, "</button>")).toMatch(
      /font-medium[^>]*>Galley</,
    );
  });

  it("wears a row's status glyph on the avatar while busy, none for a draft or at rest", () => {
    saveComposerDraft("s-main", { text: "下周三的会", images: [] });
    const rest = render([used, sideChat]);
    expect(rest).not.toContain(BADGE);
    expect(between(rest, CARD, "</button>")).toMatch(
      /font-medium[^>]*>Galley</,
    );
    for (const [arrange, kind] of [
      [() => live.set("s-main", { status: "running" }), "running"],
      [() => live.set("s-main", { hasPendingAskUser: true }), "ask"],
      [() => live.set("s-main", { status: "error" }), "error"],
    ] as const) {
      live.clear();
      arrange();
      const html = render([used, sideChat]);
      expect(between(html, CARD, "</button>")).toContain(`data-kind="${kind}"`);
      expect(between(html, CARD, "</button>")).toMatch(
        /font-semibold[^>]*>Galley</,
      );
    }
  });

  it("dates the last message on the name line, else the last activity", () => {
    const noon = new Date();
    noon.setHours(12, 5, 0, 0);
    card.lastMessage = {
      fromUser: true,
      text: "订周五的票",
      sentAt: noon.toISOString(),
    };
    const time = between(
      render([used, sideChat]),
      'data-role="assistant-time"',
      "</span>",
    );
    expect(time).toContain(">12:05");
    expect(time).toContain("text-[11px]");
    expect(time).toContain("text-ink-muted");
    // It yields whole to the name: wrapped off the clipped name line.
    expect(
      tagWith(
        between(render([used]), 'data-role="assistant-card"', "</button>"),
        "flex-wrap",
      ),
    ).toContain("h-5");
    // No message at hand: the session's last activity.
    card.lastMessage = null;
    const lastWeek = new Date();
    lastWeek.setHours(9, 0, 0, 0);
    lastWeek.setDate(lastWeek.getDate() - 40);
    const html = render([{ ...used, lastActivityAt: lastWeek.toISOString() }]);
    const label =
      lastWeek.getFullYear() === new Date().getFullYear()
        ? `${lastWeek.getMonth() + 1}月${lastWeek.getDate()}日`
        : `${lastWeek.getFullYear()}年${lastWeek.getMonth() + 1}月${lastWeek.getDate()}日`;
    expect(between(html, 'data-role="assistant-time"', "</span>")).toContain(
      `>${label}`,
    );
  });

  it("speaks English in the English UI", () => {
    card.lastMessage = { fromUser: true, text: "Book Friday" };
    const html = render([used, cliChat], {
      language: "en-US",
      newChatActive: true,
    });
    expect(textOf(lineOf(html))).toBe("You: Book Friday");
    expect(html).toContain(">Galley<");
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain(">Other sources<");
    expect(html).not.toContain("Main chat");
    expect(render([mainChat], { language: "en-US" })).toContain(
      "Your conversations will appear here.",
    );
  });
});

describe("what the list holds with a main chat", () => {
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

  it("lists an unpromoted subtask nowhere: no bucket, no 其他来源, no 更早", () => {
    const oldSubtask = managed("s-sub-old", {
      title: "旧子任务",
      origin: { via: "subtask" },
      parentSessionId: "s-main",
      lastActivityAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    });
    const html = render([mainChat, sideChat, subtask, oldSubtask]);
    expect(html).not.toContain('data-session-id="s-sub"');
    expect(html).not.toContain('data-session-id="s-sub-old"');
    expect(html).not.toContain(OTHER_SOURCES);
    expect(html).not.toContain(">更早<");
    // Agent-started as it is, it does not stand in for a person's chat.
    expect(render([mainChat, subtask])).toContain(EMPTY);
  });

  it("lists a promoted one as a person's conversation, in its time bucket", () => {
    const html = render([mainChat, { ...subtask, promoted: true }]);
    expect(count(html, 'data-session-id="s-sub"')).toBe(1);
    expect(at(html, "s-sub")).toBeGreaterThan(html.indexOf(">今天<"));
    expect(html).not.toContain(OTHER_SOURCES);
    expect(html).not.toContain(EMPTY);
  });

  it("leaves every other row's recap alone, in the 48px row", () => {
    const side = { ...sideChat, summary: "已订好周五的机票" };
    const html = render([mainChat, side]);
    expect(html.slice(at(html, "s-side"))).toContain(">已订好周五的机票<");
    expect(tagWith(html, 'data-session-id="s-side"')).toContain("min-h-[48px]");
  });
});

describe("without a main chat (external runtime)", () => {
  it("is the sidebar as it was: the wordmark, the 新对话 row, nothing split off", () => {
    const html = render([sideChat, cliChat]);
    expect(html).toContain("font-serif");
    expect(html).toContain(">Galley<");
    expect(count(html, NEW_CHAT)).toBe(1);
    // The 新对话 row is the loud one.
    expect(html).toContain("text-brand-strong");
    expect(html).not.toContain(CARD);
    expect(html).not.toContain(OTHER_SOURCES);
    expect(html).not.toContain("主对话");
    expect(html).not.toContain("sticky");
    expect(html).not.toContain("border-line-strong");
    expect(html).not.toContain("data-sidebar-zone-label");
    for (const attr of ["section", "section-header"]) {
      expect(html).not.toContain(`data-sidebar-${attr}=""`);
    }
    expect(tagWith(html, SCROLL_LIST)).toContain(
      'class="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2"',
    );
    // The CLI session stays in 今天.
    expect(at(html, "s-cli")).toBeGreaterThan(html.indexOf(">今天<"));
    expect(render([])).toContain(EMPTY);
    // 已归档 on the chrome, its own row: no ground around it.
    const archived = render([sideChat], { archivedCount: 2 });
    expect(archived).toContain(ARCHIVED);
    expect(archived).not.toContain('<div class="bg-app">');
  });

  it("selects the 新对话 row itself while the new-chat composer is up, a project's too", () => {
    for (const projects of [undefined, [project]]) {
      const html = render([sideChat], { newChatActive: true, projects });
      expect(count(html, 'aria-current="page"')).toBe(1);
      const row = html.lastIndexOf(
        "<button",
        html.indexOf('aria-current="page"'),
      );
      expect(html.slice(row, row + 400)).toContain(NEW_CHAT);
    }
  });
});

describe("the trials and the main-chat-on-top sidebar are gone", () => {
  const SRC = path.resolve(__dirname, "../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no switcher, demo, storage key or old structure behind", () => {
    const self = path.resolve(__filename);
    const leftovers = [
      // Ticket 16's spaces shell.
      "galley.tmp.spacesTrial",
      "spaces-trial",
      "useSpacesTrial",
      "SpacesRail",
      "SpaceSwitch",
      "ensureMainChatListed",
      "copy.spaces",
      '"Mod+1"',
      '"Mod+2"',
      // Ticket 17's sidebar-top trial.
      "galley.tmp.sidebarTopTrial",
      "sidebar-top-trial",
      "SidebarTopTrialSwitcher",
      "ASSISTANT_TOP_WIDTHS",
      "mainChatNaming",
      "statusOverride",
      "topVariant",
      "topDemo",
      "SidebarAssistantMasthead",
      "SidebarAssistantButton",
      "ticket 17",
      // The main chat row, its section and the pressed + (tickets 07–14).
      "mainChatLabel",
      "SidebarNarrowNavRow",
      "SidebarSideChatHeader",
      "SidebarSideChatEmptyHint",
      "otherChatsHint",
      "pressedPlusProjectId",
      "plusPressed",
      "data-sidebar-section-body",
      // Ticket 62's zones trial (C won, ruling 118 point 5).
      "galley.tmp.sidebarZonesTrial",
      "zones-trial",
      "SidebarZonesTrialSwitcher",
      "SidebarAssistantLabel",
      "zoneAssistant",
      "demoNewUser",
      // Spelled apart so a grep for the ticket marker finds nothing.
      ["票", "62"].join(" "),
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
});
