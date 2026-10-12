import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { Sidebar } from "./Sidebar";
import type { MainChatLayout } from "./sidebar/main-chat-layout";

// useCopy falls back to the zh copy without a CopyProvider.

// Static rendering reads a store's initial state, so the switcher's
// choices (layout and copy pair) are fed through the module instead.
const layoutChoice = vi.hoisted(() => ({ current: "A2" as MainChatLayout }));
const copyChoice = vi.hoisted(() => ({
  current: { mainChat: "主聊天", newChat: "新旁聊" },
}));
vi.mock("./sidebar/main-chat-layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sidebar/main-chat-layout")>()),
  useMainChatLayout: () => layoutChoice.current,
  useMainChatTrialCopy: () => copyChoice.current,
  mainChatTrialCopy: () => copyChoice.current,
}));

const today = new Date().toISOString();

const mainChat = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
  lastActivityAt: today,
});
const sideChat = makeSession({
  id: "s-side",
  title: "订机票",
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
  lastActivityAt: today,
});

function render(
  sessions: Session[],
  opts: {
    layout?: MainChatLayout;
    activeId?: string;
    newChatActive?: boolean;
    copy?: { mainChat: string; newChat: string };
  } = {},
) {
  layoutChoice.current = opts.layout ?? "A2";
  copyChoice.current = opts.copy ?? { mainChat: "主聊天", newChat: "新旁聊" };
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <Sidebar
        sessions={sessions}
        activeId={opts.activeId}
        newChatActive={opts.newChatActive}
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

beforeEach(() => {
  layoutChoice.current = "A2";
});

describe("the main chat's row", () => {
  it("stands on its own: once, under its label, never in a time bucket", () => {
    for (const layout of ["A1", "A2"] as const) {
      const html = render([mainChat, sideChat], { layout });
      expect(count(html, 'data-session-id="s-main"')).toBe(1);
      expect(count(html, 'data-session-id="s-side"')).toBe(1);
      // 今天 lists only the side chat.
      expect(html).toContain("今天");
      expect(html.indexOf('data-session-id="s-main"')).toBeLessThan(
        html.indexOf("今天"),
      );
    }
  });

  it("has no menu: no pin, rename, project or archive", () => {
    const html = render([mainChat], { layout: "A2" });
    const row = html.slice(html.indexOf('data-session-id="s-main"'));
    expect(row.startsWith('data-session-id="s-main"')).toBe(true);
    // A row with actions is a context-menu trigger; the main chat's is not.
    expect(html).not.toContain("data-galley-context-menu-trigger");
  });

  it("is the selected row when it is open", () => {
    const html = render([mainChat, sideChat], { activeId: "s-main" });
    const at = html.indexOf('data-session-id="s-main"');
    const tagStart = html.lastIndexOf("<div", at);
    expect(html.slice(tagStart, at + 200)).toContain("bg-selected");
  });
});

describe("A1 and A2", () => {
  it("A1 keeps the 新对话 row under the main chat, three masthead icons", () => {
    const html = render([mainChat, sideChat], {
      layout: "A1",
      copy: { mainChat: "主聊天", newChat: "新对话" },
    });
    expect(html).toContain('aria-label="新对话"');
    expect(html).not.toContain('aria-label="新旁聊"');
    expect(html.indexOf('data-session-id="s-main"')).toBeLessThan(
      html.indexOf('aria-label="新对话"'),
    );
  });

  it("A2 drops the 新对话 row; 新旁聊 joins the masthead and the narrow row", () => {
    const html = render([mainChat, sideChat], { layout: "A2" });
    expect(html).not.toContain('aria-label="新对话"');
    // Two copies: the masthead's and the narrow-width row's.
    expect(count(html, 'aria-label="新旁聊"')).toBe(2);
  });

  it("A2's 新旁聊 is the 'you are here' while the empty composer is up", () => {
    const html = render([mainChat], { layout: "A2", newChatActive: true });
    expect(count(html, 'aria-current="page"')).toBe(2);
  });

  it("A3 keeps the 新对话 row, quiet: no brand plus, regular weight", () => {
    const html = render([mainChat, sideChat], {
      layout: "A3",
      copy: { mainChat: "主对话", newChat: "新对话" },
    });
    expect(html).toContain('aria-label="新对话"');
    expect(html).toContain("主对话");
    expect(html.indexOf('data-session-id="s-main"')).toBeLessThan(
      html.indexOf('aria-label="新对话"'),
    );
    const row = html.slice(
      html.lastIndexOf("<button", html.indexOf('aria-label="新对话"')),
    );
    expect(row.slice(0, 600)).toContain("h-7");
    expect(row.slice(0, 1600)).not.toContain("text-brand-strong");
  });

  it("A3's main chat keeps full ink while another row is selected", () => {
    const html = render([mainChat, sideChat], {
      layout: "A3",
      activeId: "s-side",
      copy: { mainChat: "主对话", newChat: "新对话" },
    });
    const main = html.slice(html.indexOf('data-session-id="s-main"'));
    expect(main.slice(0, 1600)).toMatch(/text-\[13px\] text-ink font-medium/);
  });

  it("without a main chat (external runtime) every layout is today's sidebar", () => {
    for (const layout of ["A1", "A2", "A3"] as const) {
      const html = render([sideChat], { layout });
      expect(html).toContain('aria-label="新对话"');
      expect(html).not.toContain('aria-label="新旁聊"');
      expect(html).not.toContain("主聊天");
    }
  });
});
