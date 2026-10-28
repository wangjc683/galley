import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitReviewContext } from "@/lib/git-review";

import type { MainHeaderProps } from "./MainHeader";
import { MainHeaderHost } from "./MainHeaderHost";

/**
 * The top bar's Supervisor SOP icon (main chat ruling 106, ticket 54):
 * on the managed runtime the assistant is the supervisor, so the tool
 * cluster has no SOP icon there — 待办, 改动, 显示, 设置 — and Settings →
 * Agent stays reachable from Settings and ⌘K. The external runtime keeps
 * it as it was: between 显示 and 设置, opening Settings → Agent. Only the
 * runtime decides, not whether there is a main chat. The runtime is
 * seeded per test; the MainHeader is the real one, its props recorded.
 */

const seed = vi.hoisted(() => ({
  runtime: "managed" as "managed" | "external",
  props: null as null | MainHeaderProps,
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
vi.mock("./MainHeader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./MainHeader")>();
  return {
    ...actual,
    MainHeader: (props: MainHeaderProps) => {
      seed.props = props;
      return <actual.MainHeader {...props} />;
    },
  };
});

// TEMP variant switcher (main chat 103): the 待办 button's look, seeded
// per test (a static render reads a store's initial state).
const look = vi.hoisted(() => ({ value: "now" as "now" | "A" | "B" | "C" }));
vi.mock(
  "@/components/todo/todo-button-variants/todo-button-variants",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/todo/todo-button-variants/todo-button-variants")
      >();
    const get = () => ({
      look: look.value,
      demo: "real" as const,
      setLook: () => {},
      setDemo: () => {},
    });
    return {
      ...actual,
      useTodoButtonVariants: Object.assign(
        <R,>(select: (s: ReturnType<typeof get>) => R) => select(get()),
        { getState: get },
      ),
    };
  },
);

afterEach(() => {
  seed.runtime = "managed";
  seed.props = null;
  look.value = "now";
});

function header(
  opts: {
    openSettings?: (tab: string) => void;
    /** App hands the 待办 toggle while there is a main chat. */
    todo?: boolean;
    mainChat?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    <GitReviewContext.Provider
      value={{ isOpen: false, repositoryKnown: true, toggle: () => {} }}
    >
      <Tooltip.Provider>
        <MainHeaderHost
          channelStatuses={[]}
          channelsLoadError={null}
          onRestartChannels={() => {}}
          runtimeIndicator="hidden"
          openSettings={opts.openSettings ?? (() => {})}
          onOpenSettings={() => {}}
          resolvedTheme="light"
          sessionTitle={opts.mainChat ? "Galley" : "整理发票"}
          isMainChat={opts.mainChat ?? false}
          canRenameSession={!opts.mainChat}
          onToggleTodo={opts.todo === false ? undefined : () => {}}
        />
      </Tooltip.Provider>
    </GitReviewContext.Provider>,
  );
}

const TOOLS = 'aria-label="视图与设置"';
const SOP = 'aria-label="打开 Supervisor SOP 设置"';

/** The tool cluster's buttons, in order, by their accessible names: up
 * to the gear, the cluster's last (Windows' window controls follow). */
function toolButtons(html: string): string[] {
  const tools = html.slice(html.indexOf(TOOLS));
  const names = [...tools.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map(
    (m) => m[1],
  );
  return names.slice(0, names.indexOf("打开设置") + 1);
}

describe("the top bar's Supervisor SOP icon", () => {
  it("is not there on the managed runtime, with or without a main chat", () => {
    for (const mainChat of [true, false]) {
      for (const todo of [true, false]) {
        const html = header({ mainChat, todo });
        expect(html, `${mainChat} ${todo}`).not.toContain(SOP);
      }
    }
    expect(seed.props?.onOpenSupervisorSop).toBeUndefined();
    // What is left, in the same order: 待办, 改动, 显示, 设置 (待办 named
    // 「待办与备忘」 since ticket 103).
    expect(toolButtons(header())).toEqual([
      "待办与备忘",
      "工作区改动",
      "显示设置",
      "打开设置",
    ]);
    // Ticket 103's 甲 / 乙 / 丙 take 待办 out to a group of its own: the
    // rest in the same order.
    for (const value of ["A", "B", "C"] as const) {
      look.value = value;
      expect(toolButtons(header()), value).toEqual([
        "工作区改动",
        "显示设置",
        "打开设置",
      ]);
    }
  });

  it("stays on the external runtime, between 显示 and 设置, opening Settings → Agent", () => {
    seed.runtime = "external";
    const openSettings = vi.fn();
    const html = header({ openSettings });
    // Ticket 103's pill changes nothing there (no 待办 button).
    for (const value of ["A", "B", "C"] as const) {
      look.value = value;
      expect(header({ openSettings }), value).toBe(html);
    }
    look.value = "now";
    expect(html).toContain(SOP);
    expect(toolButtons(html)).toEqual([
      "工作区改动",
      "显示设置",
      "打开 Supervisor SOP 设置",
      "打开设置",
    ]);
    seed.props?.onOpenSupervisorSop?.();
    expect(openSettings).toHaveBeenCalledWith("integration");
  });
});
