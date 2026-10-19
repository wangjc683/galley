import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { RuntimeKind } from "@/types/session";

import { CommandPalette } from "./CommandPalette";

/**
 * ⌘K's 智能体接入 (main chat ruling 106, ticket 54): with no Supervisor
 * SOP icon in the managed top bar, the palette opens Settings → Agent
 * directly, in both runtimes, right after 打开设置; whoever types SOP,
 * Supervisor or 智能体 finds it. Static rendering cannot run cmdk's
 * dialog (a portal), so cmdk renders its parts inline and each item's
 * value and onSelect are recorded; the search is scored by cmdk's own
 * filter.
 */
const items = vi.hoisted(() => new Map<string, () => void>());
vi.mock("cmdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cmdk")>();
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Dialog = ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null;
  const Item = ({
    value,
    onSelect,
    children,
  }: {
    value?: string;
    onSelect?: () => void;
    children?: ReactNode;
  }) => {
    if (value && onSelect) items.set(value, onSelect);
    return <div data-test-item={value}>{children}</div>;
  };
  const Group = ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  );
  return {
    ...actual,
    Command: Object.assign(Pass, {
      Dialog,
      Input: () => <input readOnly />,
      List: Pass,
      Item,
      Group,
      Empty: Pass,
    }),
  };
});

afterEach(() => {
  items.clear();
});

const AGENT = "agent integration supervisor sop cli 智能体接入 智能体 接入";
const SETTINGS = "open settings 设置";

function palette(
  runtimeKind: RuntimeKind,
  handlers: {
    onOpenSettings?: (tab?: string) => void;
    onOpenChange?: (open: boolean) => void;
  } = {},
  language: "zh-CN" | "en-US" = "zh-CN",
) {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <CommandPalette
        open
        onOpenChange={handlers.onOpenChange ?? (() => {})}
        sessions={[makeSession({ id: "s-1", title: "整理发票" })]}
        runtimeKind={runtimeKind}
        onOpenSettings={handlers.onOpenSettings}
      />
    </CopyProvider>,
  );
}

/** The item's row: from its opening tag to the next item. */
function row(html: string, value: string): string {
  const start = html.indexOf(`data-test-item="${value}"`);
  const next = html.indexOf("data-test-item=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("⌘K's 智能体接入", () => {
  it("is in both runtimes, right after 打开设置, named as the Settings page", () => {
    for (const runtime of ["managed", "external"] as const) {
      const html = palette(runtime);
      expect(row(html, AGENT), runtime).toContain(">智能体接入<");
      const after = html.slice(html.indexOf(`data-test-item="${SETTINGS}"`));
      const next = after.indexOf("data-test-item=", 1);
      expect(after.slice(next), runtime).toMatch(
        new RegExp(`^data-test-item="${AGENT}"`),
      );
    }
    expect(row(palette("managed", {}, "en-US"), AGENT)).toContain(">Agent<");
  });

  it("is found by SOP, Supervisor, 智能体, 接入, agent and cli", async () => {
    const { defaultFilter } = await vi.importActual<typeof import("cmdk")>(
      "cmdk",
    );
    for (const query of [
      "SOP",
      "sop",
      "Supervisor",
      "智能体",
      "接入",
      "智能体接入",
      "agent",
      "cli",
    ]) {
      expect(defaultFilter(AGENT, query), query).toBeGreaterThan(0);
    }
    // 打开设置 is not what those find.
    expect(defaultFilter(SETTINGS, "SOP")).toBe(0);
  });

  it("opens Settings on the Agent page and closes the palette; 打开设置 keeps its first tab", () => {
    const onOpenSettings = vi.fn();
    const onOpenChange = vi.fn();
    palette("managed", { onOpenSettings, onOpenChange });
    items.get(AGENT)?.();
    expect(onOpenSettings).toHaveBeenLastCalledWith("integration");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    items.get(SETTINGS)?.();
    expect(onOpenSettings).toHaveBeenLastCalledWith();
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });
});
