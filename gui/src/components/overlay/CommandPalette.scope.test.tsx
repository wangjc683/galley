import type { KeyboardEvent, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageSearchHit } from "@/lib/db";
import { CopyProvider } from "@/lib/i18n";
import type { PaletteScope } from "@/lib/palette-scope";
import { makeSession } from "@/test/factories";

import { CommandPalette, ScopedResults } from "./CommandPalette";

/**
 * The palette with a scope (main chat ticket 28): ⌘F and the title
 * menu's 查找聊天记录 search one conversation. Static rendering cannot
 * run cmdk's dialog (a portal) nor the debounced search, so cmdk renders
 * its parts inline here and the hits are fed to `ScopedResults`.
 */
const input = vi.hoisted(() => ({
  props: null as null | {
    placeholder?: string;
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  },
}));
vi.mock("cmdk", () => {
  const Root = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Dialog = ({
    open,
    shouldFilter,
    children,
  }: {
    open: boolean;
    shouldFilter?: boolean;
    children?: ReactNode;
  }) =>
    open ? (
      <div data-test-dialog="" data-should-filter={String(shouldFilter)}>
        {children}
      </div>
    ) : null;
  const Input = (props: {
    value?: string;
    placeholder?: string;
    className?: string;
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  }) => {
    input.props = props;
    return (
      <input
        data-test-input=""
        readOnly
        value={props.value}
        placeholder={props.placeholder}
        className={props.className}
      />
    );
  };
  const List = ({ children }: { children?: ReactNode }) => (
    <div data-test-list="">{children}</div>
  );
  const Item = ({
    value,
    children,
  }: {
    value?: string;
    children?: ReactNode;
  }) => <div data-test-item={value}>{children}</div>;
  const Group = ({
    heading,
    children,
  }: {
    heading?: ReactNode;
    children?: ReactNode;
  }) => (
    <section>
      <h6>{heading}</h6>
      {children}
    </section>
  );
  const Empty = ({ children }: { children?: ReactNode }) => (
    <div data-test-empty="">{children}</div>
  );
  return {
    Command: Object.assign(Root, { Dialog, Input, List, Item, Group, Empty }),
  };
});

const MAIN: PaletteScope = { sessionId: "s-main", mainChat: true };
const FLIGHT: PaletteScope = { sessionId: "s-flight", mainChat: false };
const sessions = [makeSession({ id: "s-flight", title: "订周五去上海的机票" })];

function palette(scope: PaletteScope | null, onDropScope = () => {}) {
  return renderToStaticMarkup(
    <CommandPalette
      open
      onOpenChange={() => {}}
      sessions={sessions}
      runtimeKind="managed"
      scope={scope}
      onDropScope={onDropScope}
    />,
  );
}

afterEach(() => {
  input.props = null;
});

describe("the palette inside one conversation", () => {
  it("names the main chat before the input and finds only in it", () => {
    const html = palette(MAIN);
    expect(html).toMatch(/data-role="palette-scope"[^>]*>在主对话里<button/);
    expect(html).toContain('aria-label="改为搜索全部"');
    expect(html).toContain('placeholder="查找主对话…"');
    expect(html).toContain('class="cmdk-input-scoped"');
    // Only its message hits: no recent sessions, no actions, no new chat.
    expect(html).not.toContain("最近会话");
    expect(html).not.toContain(">操作<");
    expect(html).not.toContain("新对话");
    expect(html).not.toContain("订周五去上海的机票");
    // Core's hits in Core's order: cmdk neither filters nor re-sorts.
    expect(html).toContain('data-should-filter="false"');
    // Nothing typed yet: the quiet hint.
    expect(html).toContain("输入至少两个字开始查找");
  });

  it("says 在这个对话里 in any other conversation", () => {
    const html = palette(FLIGHT);
    expect(html).toMatch(/data-role="palette-scope"[^>]*>在这个对话里<button/);
    expect(html).toContain('placeholder="查找这个对话…"');
  });

  it("speaks English", () => {
    const html = renderToStaticMarkup(
      <CopyProvider language="en-US">
        <CommandPalette
          open
          onOpenChange={() => {}}
          sessions={sessions}
          runtimeKind="managed"
          scope={MAIN}
        />
      </CopyProvider>,
    );
    expect(html).toMatch(/data-role="palette-scope"[^>]*>In main chat<button/);
    expect(html).toContain('placeholder="Find in main chat…"');
  });

  it("drops the scope on Backspace in the empty input, not while an IME composes", () => {
    const onDropScope = vi.fn();
    palette(MAIN, onDropScope);
    const press = (key: string, composing = false) => {
      const preventDefault = vi.fn();
      input.props?.onKeyDown?.({
        key,
        preventDefault,
        nativeEvent: { isComposing: composing, keyCode: composing ? 229 : 8 },
      } as unknown as KeyboardEvent<HTMLInputElement>);
      return preventDefault;
    };
    expect(press("Backspace", true)).not.toHaveBeenCalled();
    expect(onDropScope).not.toHaveBeenCalled();
    expect(press("a")).not.toHaveBeenCalled();
    expect(onDropScope).not.toHaveBeenCalled();
    expect(press("Backspace")).toHaveBeenCalled();
    expect(onDropScope).toHaveBeenCalledTimes(1);
  });

  it("leaves ⌘K as it was without a scope", () => {
    const html = palette(null);
    expect(html).not.toContain('data-role="palette-scope"');
    expect(html).toContain('placeholder="搜索对话或输入命令…"');
    expect(html).toContain("最近会话");
    expect(html).toContain("订周五去上海的机票");
    expect(html).toContain(">操作<");
    expect(html).toContain("新对话");
    expect(html).toContain('data-should-filter="true"');
    // The input row's markup is untouched.
    expect(html).toContain('<div class="relative shrink-0">');
    expect(html).toContain(
      '<input data-test-input="" readOnly="" placeholder="搜索对话或输入命令…" value=""/>',
    );
    expect(html).not.toContain("cmdk-input-scoped");
    expect(input.props?.onKeyDown).toBeUndefined();
  });
});

describe("⌘K's 待办 (main chat ticket 37)", () => {
  it("opens the assistant's to-do list with a main chat, found by 定时 and 提醒 too", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        open
        onOpenChange={() => {}}
        sessions={sessions}
        runtimeKind="managed"
        onOpenTodo={() => {}}
      />,
    );
    const item = html.slice(html.indexOf('data-test-item="todo'));
    expect(item.slice(0, item.indexOf(">"))).toMatch(/待办 提醒 定时 定时任务/);
    expect(item).toContain(">待办<");
    // First of the actions.
    expect(html.indexOf(">操作<")).toBeLessThan(
      html.indexOf('data-test-item="todo'),
    );
    expect(html.indexOf('data-test-item="todo')).toBeLessThan(
      html.indexOf('data-test-item="switch llm'),
    );
  });

  it("has no such item without one", () => {
    expect(palette(null)).not.toContain('data-test-item="todo');
  });
});

describe("ScopedResults", () => {
  // Local wall-clock parts: the dates hold in whatever timezone the
  // suite runs in.
  const at = (y: number, m: number, d: number, h: number, min: number) =>
    new Date(y, m - 1, d, h, min).toISOString();
  const hit = (overrides: Partial<MessageSearchHit>): MessageSearchHit => ({
    messageId: "m",
    sessionId: "s-main",
    sessionTitle: "主聊天",
    role: "user",
    turnIndex: 0,
    snippet: "",
    sessionActivityAt: at(2026, 10, 15, 21, 41),
    createdAt: at(2026, 10, 15, 21, 40),
    ...overrides,
  });
  const hits = [
    hit({
      messageId: "m-today",
      snippet: "明天去«花市»记得买营养土",
      createdAt: at(2026, 10, 15, 21, 40),
    }),
    hit({
      messageId: "m-earlier",
      role: "assistant",
      turnIndex: 1,
      snippet: "好的，到«花市»提醒你",
      createdAt: at(2026, 10, 13, 21, 40),
    }),
    hit({
      messageId: "m-last-year",
      snippet: "去年的«花市»",
      createdAt: at(2025, 2, 3, 8, 5),
    }),
  ];
  const results = (
    props: Partial<Parameters<typeof ScopedResults>[0]>,
    language: "zh-CN" | "en-US" = "zh-CN",
  ) =>
    renderToStaticMarkup(
      <CopyProvider language={language}>
        <ScopedResults
          search="花市"
          hits={hits}
          hitsFor="花市"
          onOpenMessage={() => {}}
          {...props}
        />
      </CopyProvider>,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 22, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates each hit where ⌘K writes the session title, the snippet under it", () => {
    const html = results({});
    expect(html).toContain("在对话内容中");
    expect(html).not.toContain("主聊天");
    const firstLines = [
      ...html.matchAll(
        /<div class="truncate text-\[12\.5px\] text-ink-soft">([^<]*)</g,
      ),
    ].map((m) => m[1]);
    expect(firstLines).toEqual([
      "今天 21:40",
      "10月13日 21:40",
      "2025年2月3日 08:05",
    ]);
    // Core's order is kept, the snippet's match marked.
    expect(html.indexOf("msg-hit m-today")).toBeLessThan(
      html.indexOf("msg-hit m-earlier"),
    );
    expect(html).toMatch(/<mark [^>]*>花市<\/mark>/);
    // Who said it: the icon, as in ⌘K.
    expect(html).toContain('title="你的提问"');
    expect(html).toContain('title="Agent 回复"');
  });

  it("dates in English too", () => {
    const html = results({}, "en-US").replace(/\s/g, " ");
    expect(html).toContain("Today 9:40 PM");
    expect(html).toContain("Oct 13, 9:40 PM");
  });

  it("is quiet while a query is out, says 没找到 when it came back empty", () => {
    expect(results({ hits: [], hitsFor: null })).toBe("");
    expect(results({ hits: [], hitsFor: "花市" })).toContain("没找到。");
    expect(results({ hits: [], hitsFor: "花市" })).not.toContain(
      "Enter 直接发问",
    );
    expect(results({ search: "花", hits: [], hitsFor: null })).toContain(
      "输入至少两个字开始查找",
    );
  });
});
