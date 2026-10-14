import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import type { MainChatSublineVariant } from "./sidebar/main-chat-subline-trial";
import { Sidebar } from "./Sidebar";

// TEMPORARY — the main chat row's second-line trial (ticket 14). Static
// rendering reads a zustand store's initial state, so the variant, a
// row's live state and a subtask's ask are mocked instead of set.
const trial = vi.hoisted(() => ({
  variant: "现状" as MainChatSublineVariant,
  live: new Map<string, Partial<SessionStatusView>>(),
  subtaskAsk: false,
}));
vi.mock("./sidebar/main-chat-subline-trial", () => ({
  useMainChatSublineTrialStore: <T,>(
    selector: (state: { variant: MainChatSublineVariant }) => T,
  ) => selector({ variant: trial.variant }),
}));
vi.mock("@/hooks/useSessionStatusView", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionStatusView")>();
  return {
    ...actual,
    useSessionStatusView: (session: Session) => ({
      ...actual.useSessionStatusView(session),
      ...trial.live.get(session.id),
    }),
  };
});
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      const holdsSubtask = args[0].some((s) => s.id === "s-sub");
      return trial.subtaskAsk && holdsSubtask
        ? { ...view, kind: "ask" as const, count: 1 }
        : view;
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

const RECAP = "花市要顺便买一袋营养土";
const SIDE_RECAP = "已订好周五的机票";
const mainChat = managed("s-main", {
  title: "主聊天",
  mainChat: true,
  summary: RECAP,
});
const sideChat = managed("s-side", {
  title: "订机票",
  origin: { via: "gui" },
  summary: SIDE_RECAP,
});
const subtask = managed("s-sub", {
  title: "把 PDF 分类",
  origin: { via: "subtask" },
  parentSessionId: "s-main",
});

function render(
  sessions: Session[],
  opts: { variant: MainChatSublineVariant; activeId?: string },
) {
  trial.variant = opts.variant;
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          activeId={opts.activeId}
          expandedProjectIds={[]}
          onNewChat={() => {}}
          onSelectSession={() => {}}
          onArchiveSession={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);
/** A row's opening tag. */
const rowTag = (html: string, id: string) =>
  html.slice(
    html.lastIndexOf("<div", at(html, id)),
    html.indexOf(">", at(html, id)) + 1,
  );
/** The main chat's row, up to the 其他对话 header under it. */
const mainRow = (html: string) =>
  html.slice(
    html.lastIndexOf("<div", at(html, "s-main")),
    html.indexOf(">其他对话<"),
  );
/** The side chat's row, up to the end of the list. */
const sideRow = (html: string) => html.slice(at(html, "s-side"));

afterEach(() => {
  trial.variant = "现状";
  trial.live.clear();
  trial.subtaskAsk = false;
});

describe("现状: the control keeps a session row's subline", () => {
  it("shows the recap at rest, read or unread, in a 48px row", () => {
    const read = render([mainChat, sideChat], { variant: "现状" });
    expect(mainRow(read)).toContain(RECAP);
    expect(rowTag(read, "s-main")).toContain("min-h-[48px]");

    const unread = render([{ ...mainChat, hasUnread: true }, sideChat], {
      variant: "现状",
    });
    expect(mainRow(unread)).toContain(RECAP);
  });

  it("says 已中止 after a stopped reply", () => {
    const html = render([{ ...mainChat, status: "cancelled" }], {
      variant: "现状",
    });
    expect(mainRow(html)).toContain(`已中止 · ${RECAP}`);
  });
});

describe.each(["A", "A′"] as const)("%s: quiet once settled", (variant) => {
  it("says nothing at rest and centres the title in a 50px row", () => {
    const html = render([mainChat, sideChat], { variant });
    const row = mainRow(html);
    expect(row).not.toContain(RECAP);
    expect(row).toContain(">主对话<");
    expect(rowTag(html, "s-main")).toContain("min-h-[50px]");
    expect(rowTag(html, "s-main")).not.toContain("min-h-[48px]");
    // The icon and the title both sit in the middle of the row.
    expect(row.split("self-center").length - 1).toBe(2);
  });

  it("says nothing while it is open, even with an unread mark", () => {
    const html = render([{ ...mainChat, hasUnread: true }], {
      variant,
      activeId: "s-main",
    });
    expect(mainRow(html)).not.toContain(RECAP);
  });

  it("drops a stopped reply's 已中止 once read", () => {
    const html = render([{ ...mainChat, status: "cancelled" }], { variant });
    expect(mainRow(html)).not.toContain("已中止");
  });

  it("keeps every state's words, in the same 50px row", () => {
    trial.live.set("s-main", { status: "running" });
    const thinking = render([mainChat], { variant });
    expect(mainRow(thinking)).toContain(">思考中<");
    expect(rowTag(thinking, "s-main")).toContain("min-h-[50px]");

    const stepping = render([{ ...mainChat, lastStepIndex: 2 }], { variant });
    expect(mainRow(stepping)).toContain(`第 2 步 · ${RECAP}`);

    trial.live.set("s-main", { hasPendingAskUser: true });
    expect(mainRow(render([mainChat], { variant }))).toContain(">等你回复<");

    trial.live.set("s-main", { status: "error" });
    expect(mainRow(render([mainChat], { variant }))).toContain(">出错<");

    trial.live.clear();
    trial.subtaskAsk = true;
    expect(mainRow(render([mainChat, subtask], { variant }))).toContain(
      ">子任务在问你<",
    );
  });

  it("leaves every other row's recap alone", () => {
    const html = render([mainChat, sideChat], { variant });
    expect(sideRow(html)).toContain(SIDE_RECAP);
    expect(rowTag(html, "s-side")).toContain("min-h-[48px]");
  });
});

describe("A: a new reply has no words either", () => {
  it("leaves it to the filled house and the weight", () => {
    const html = render([{ ...mainChat, hasUnread: true }], { variant: "A" });
    const row = mainRow(html);
    expect(row).not.toContain(RECAP);
    expect(row).toContain("text-brand");
    expect(row).toContain("font-semibold");
  });
});

describe("A′: a new reply shows its recap until read", () => {
  it("shows what it said while you were away", () => {
    const html = render([{ ...mainChat, hasUnread: true }], { variant: "A′" });
    const row = mainRow(html);
    expect(row).toContain(RECAP);
    expect(row).toContain("font-semibold");
  });

  it("keeps a stopped reply's 已中止 while unread", () => {
    const html = render(
      [{ ...mainChat, status: "cancelled", hasUnread: true }],
      { variant: "A′" },
    );
    expect(mainRow(html)).toContain(`已中止 · ${RECAP}`);
  });
});

describe("a fresh main chat (greeting only)", () => {
  it.each(["A", "A′", "现状"] as const)(
    "has no second line under %s",
    (variant) => {
      const html = render([{ ...mainChat, summary: undefined }], { variant });
      const row = mainRow(html);
      expect(row).toContain(">主对话<");
      expect(row).not.toContain("text-[11px]");
    },
  );
});
