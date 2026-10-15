import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatShortcut } from "@/lib/shortcuts";

import { MainHeaderHost } from "./MainHeaderHost";

/**
 * The title menu's find and reset (main chat ticket 28, PRD ruling 77):
 * 查找聊天记录… ⌘F in every conversation, 重置主对话… last in the main
 * chat's on the managed runtime, greyed with the reason while a
 * conversation runs. Static rendering never opens a Radix menu, so the
 * menu renders its items inline; the stores the host reads for the
 * runtime and the running state are seeded per test.
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
    Item: ({
      children,
      disabled,
    }: {
      children?: ReactNode;
      disabled?: boolean;
    }) => (
      <div data-test-menu-item="" data-disabled={disabled ? "" : undefined}>
        {children}
      </div>
    ),
    Separator: () => <hr />,
  };
});

const seed = vi.hoisted(() => ({
  runtime: "managed" as "managed" | "external",
  running: false,
}));
vi.mock("@/stores/prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/prefs")>();
  const get = () => ({
    ...actual.usePrefsStore.getState(),
    activeRuntimeKind: seed.runtime,
  });
  return {
    ...actual,
    usePrefsStore: Object.assign(
      <R,>(select: (s: ReturnType<typeof get>) => R) => select(get()),
      { getState: get },
    ),
  };
});
vi.mock("@/stores/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/messages")>();
  const get = () => ({
    ...actual.useMessagesStore.getState(),
    byId: seed.running ? { "s-other": { agentRunning: true } } : {},
  });
  return {
    ...actual,
    useMessagesStore: Object.assign(
      <R,>(select: (s: ReturnType<typeof get>) => R) => select(get()),
      { getState: get },
    ),
  };
});

afterEach(() => {
  seed.runtime = "managed";
  seed.running = false;
});

function menu(props: { title: string; mainChat: boolean }) {
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <MainHeaderHost
        channelStatuses={[]}
        channelsLoadError={null}
        onRestartChannels={() => {}}
        runtimeIndicator="hidden"
        openSettings={() => {}}
        onOpenSettings={() => {}}
        resolvedTheme="light"
        sessionTitle={props.title}
        canRenameSession={!props.mainChat}
        isMainChat={props.mainChat}
      />
    </Tooltip.Provider>,
  );
  const body = html.slice(html.indexOf("data-test-menu="));
  // Each item's name (the first text after its icon), separators as 「─」.
  const items = [
    ...body.matchAll(
      /<div data-test-menu-item=""[^>]*>.*?<\/svg><span[^>]*>(?:<span[^>]*>)?([^<]+)|<hr\/>/g,
    ),
  ].map((m) => m[1] ?? "─");
  return { body, items };
}

const RESET_REASON = "有对话正在运行，结束后才能重置主对话";

describe("the title menu's find and reset", () => {
  it("main chat: find, the engine's two, then reset", () => {
    const { body, items } = menu({ title: "Galley", mainChat: true });
    expect(items).toEqual([
      "查找聊天记录…",
      "─",
      "重新注入工具",
      "桌面宠物",
      "─",
      "重置主对话…",
    ]);
    // ⌘F as the sidebar writes ⌘N, after the name.
    const find = body.slice(0, body.indexOf("</div>"));
    expect(find).toContain(
      '查找聊天记录…</span><span aria-hidden="true" class="ml-auto pl-6 font-mono',
    );
    expect(find).toContain(`>${formatShortcut("Mod+F")}</span>`);
    expect(body).not.toContain(RESET_REASON);
    expect(body).not.toMatch(/data-disabled=""[^>]*>.*重置主对话/);
  });

  it("any other conversation: find and rename, the engine's two, no reset", () => {
    const { body, items } = menu({ title: "订机票", mainChat: false });
    expect(items).toEqual([
      "查找聊天记录…",
      "重命名",
      "─",
      "重新注入工具",
      "桌面宠物",
    ]);
    expect(body).not.toContain("重置主对话");
  });

  it("greys the reset while a conversation runs and says why", () => {
    seed.running = true;
    const { body } = menu({ title: "Galley", mainChat: true });
    const reset = body.slice(body.lastIndexOf("<div data-test-menu-item"));
    expect(reset).toMatch(/^<div data-test-menu-item="" data-disabled="">/);
    expect(reset).toContain("重置主对话…");
    expect(reset).toContain(RESET_REASON);
  });

  it("has no reset on the external runtime", () => {
    seed.runtime = "external";
    const { body } = menu({ title: "Galley", mainChat: true });
    expect(body).toContain("查找聊天记录…");
    expect(body).not.toContain("重置主对话");
  });
});
