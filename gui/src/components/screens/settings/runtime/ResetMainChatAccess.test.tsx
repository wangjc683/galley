import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsRuntime } from "@/components/screens/settings/SettingsRuntime";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { HoldToConfirm } from "@/lib/hold-to-confirm";
import { CopyProvider } from "@/lib/i18n";
import { DEFAULT_RUNTIME_INFO } from "@/stores/defaults";

import type { SettingsRuntimeProps } from "./types";
import { ResetMainChatBody, ResetMainChatDialog } from "./ResetMainChatAccess";

/**
 * Settings → 运行环境 → 更多 → 重置主对话 (main chat ticket 15): the row's
 * presence and disabled state, the confirm's copy, and the hold button's
 * states. The hold's timing is `lib/hold-to-confirm.test.ts`; landing on
 * the new main chat is `lib/main-chat-reset.test.ts`.
 */

// Radix renders a dialog through a portal after mount, which a static
// render never reaches; render its parts in place.
vi.mock("@radix-ui/react-dialog", async () => {
  const { createElement, Fragment } = await import("react");
  type Props = { children?: ReactNode; className?: string };
  return {
    Root: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? createElement(Fragment, null, children) : null,
    Portal: ({ children }: Props) => createElement(Fragment, null, children),
    Overlay: () => null,
    Content: ({ children, className }: Props) =>
      createElement("div", { className, "data-dialog": "" }, children),
    Title: ({ children, className }: Props) =>
      createElement("h2", { className }, children),
  };
});

/** Visible text of a static render, tags as separators. */
function text(node: ReactNode): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, "\u0001");
}

function runtime(overrides: Partial<SettingsRuntimeProps> = {}): string {
  return renderToStaticMarkup(
    <SettingsRuntime
      info={DEFAULT_RUNTIME_INFO}
      hasRunningSessions={false}
      hasMainChat
      activeRuntimeKind="managed"
      hasManagedRuntimeConfigured
      hasExternalRuntimeConfigured={false}
      useExternalPython={false}
      {...overrides}
    />,
  );
}

/** The `<button …>…</button>` whose text holds `label`. */
function buttonWith(html: string, label: string): string {
  const match = [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].find((m) =>
    m[0].includes(label),
  );
  expect(match, `a button with ${label}`).toBeDefined();
  return match![0];
}

/** The `disabled` attribute (not a `disabled:` utility class). */
function isDisabled(button: string): boolean {
  return /^<button[^>]*\sdisabled=""/.test(button);
}

const DELETES = [
  "主对话的全部记录，包括它派出去、还没变成普通对话的子任务和附件",
  "它的长期记忆（所有对话和 IM 共用，其他对话里的它也会一起忘）",
  "迁移前的自动备份",
];
const KEEPS = [
  "其他对话和 IM 里接回的对话（还在侧栏里，它以后翻历史仍可能读到）",
  "它替你做出来的文件",
  "模型、渠道和其他设置",
];

describe("the 重置主对话 row", () => {
  it("is the last row of 更多 on the managed runtime with a main chat", () => {
    const html = runtime();
    const row = buttonWith(html, "重置主对话");
    expect(row).toContain("清空主对话和它的长期记忆，回到刚装好时");
    expect(isDisabled(row)).toBe(false);
    // Destructive last: after 设置向导, 接入外部 GA and 高级诊断.
    for (const before of ["设置向导", "接入外部 GA", "高级诊断"]) {
      expect(html.indexOf("重置主对话")).toBeGreaterThan(html.indexOf(before));
    }
  });

  it("is not there on the external runtime, nor without a main chat", () => {
    expect(runtime({ activeRuntimeKind: "external" })).not.toContain(
      "重置主对话",
    );
    expect(runtime({ hasMainChat: false })).not.toContain("重置主对话");
  });

  it("is disabled while a conversation runs, saying so in place of the description", () => {
    const row = buttonWith(runtime({ hasRunningSessions: true }), "重置主对话");
    expect(isDisabled(row)).toBe(true);
    expect(row).toContain("有对话正在运行，结束后才能重置主对话");
    expect(row).not.toContain("清空主对话和它的长期记忆");
  });

  it("reads in English", () => {
    const html = renderToStaticMarkup(
      <CopyProvider language="en-US">
        <SettingsRuntime
          info={DEFAULT_RUNTIME_INFO}
          hasRunningSessions={false}
          hasMainChat
          activeRuntimeKind="managed"
          hasManagedRuntimeConfigured
          hasExternalRuntimeConfigured={false}
          useExternalPython={false}
        />
      </CopyProvider>,
    );
    expect(html).toContain("Reset main chat");
    expect(html).toContain(
      "Clear the main chat and its long-term memory, back to a fresh install",
    );
  });
});

describe("the confirm", () => {
  it("says what goes, what stays and what cannot be called back", () => {
    const out = text(
      <ResetMainChatDialog
        open
        onOpenChange={() => {}}
        hasRunningSessions={false}
      />,
    );
    for (const line of [
      "重置主对话？",
      "主对话会清空，从问候重新开始；它记住的关于你的事、学会的做事方法也会清掉，回到刚装好时。",
      "会删除",
      ...DELETES,
      "不会删除",
      ...KEEPS,
      "已经发给模型服务商的内容收不回来。",
      "取消",
      "按住 5 秒重置",
    ]) {
      expect(out).toContain(line);
    }
    // Nothing said about holding until a press comes up too early.
    expect(out).not.toContain("要按住不放");
    expect(out).not.toContain("有对话正在运行");
  });

  it("deletes before keeps, the unrecoverable line last", () => {
    const out = text(
      <ResetMainChatDialog
        open
        onOpenChange={() => {}}
        hasRunningSessions={false}
      />,
    );
    const order = ["会删除", DELETES[2], "不会删除", KEEPS[2], "收不回来"].map(
      (line) => out.indexOf(line),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("with a conversation running, the hold button is disabled and the dialog says why", () => {
    const html = renderToStaticMarkup(
      <ResetMainChatDialog open onOpenChange={() => {}} hasRunningSessions />,
    );
    expect(isDisabled(buttonWith(html, "按住 5 秒重置"))).toBe(true);
    expect(isDisabled(buttonWith(html, "取消"))).toBe(false);
    expect(html).toContain("有对话正在运行，结束后才能重置主对话");
  });

  it("a failure says why, with its detail to copy", () => {
    const running = text(
      <ResetMainChatBody
        hasRunningSessions={false}
        failure={{ kind: "running", detail: '{"error":"running"}' }}
      />,
    );
    expect(running).toContain("有对话正在运行，结束后才能重置主对话。");
    expect(running).toContain("复制详情");

    const other = text(
      <ResetMainChatBody
        hasRunningSessions={false}
        failure={{ kind: "other", detail: '{"error":"failed"}' }}
      />,
    );
    expect(other).toContain("没能重置主对话。");
    expect(other).toContain("复制详情");
    expect(other).not.toContain("有对话正在运行");
  });
});

describe("the hold button", () => {
  function button(hold: HoldToConfirm, props: { busy?: boolean } = {}) {
    return renderToStaticMarkup(
      <HoldToConfirmButton
        hold={hold}
        label="按住 5 秒重置"
        busyLabel="正在重置…"
        hint="要按住不放"
        {...props}
      />,
    );
  }

  it("at rest: empty, no hint", () => {
    const html = button(new HoldToConfirm());
    expect(html).toContain("transform:scaleX(0)");
    expect(html).not.toContain("要按住不放");
    expect(html).toContain("按住 5 秒重置");
  });

  it("held: fills linearly over the five seconds", () => {
    const hold = new HoldToConfirm();
    hold.press();
    const html = button(hold);
    hold.cancel();
    expect(html).toContain("transform:scaleX(1)");
    expect(html).toContain("transition:transform 5000ms linear");
    // The fill is state: no motion-reduce rule touches its inline
    // transition (only the class's run back has one).
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("let go too early: says to hold, under the button", () => {
    const hold = new HoldToConfirm();
    hold.press();
    hold.release();
    const html = button(hold);
    expect(html).toContain("要按住不放");
    expect(html).toContain("transform:scaleX(0)");
  });

  it("confirmed and running: full, disabled, says it is resetting", () => {
    const html = button(new HoldToConfirm(), { busy: true });
    expect(html).toContain("正在重置…");
    expect(html).not.toContain("按住 5 秒重置");
    expect(html).toContain("transform:scaleX(1)");
    expect(isDisabled(buttonWith(html, "正在重置…"))).toBe(true);
  });
});
