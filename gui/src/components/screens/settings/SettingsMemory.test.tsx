import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryOverview } from "@/lib/memory";

import type { MemoryActions } from "./memory/memory-actions";
import {
  MEMORY_FIXTURE_SESSION_TITLES,
  MEMORY_OVERVIEW_FIXTURE,
} from "./memory/memory-overview.fixture";
import { MemoryPage } from "./SettingsMemory";
import { SettingsSidebar } from "./SettingsSidebar";

const noop = async () => {};
const actions: MemoryActions = {
  setSwitch: noop,
  deleteEntry: noop,
  unforget: noop,
  restoreExclusion: noop,
  writeGlobal: async () => "rev",
  reload: () => {},
};

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<Tooltip.Provider>{node}</Tooltip.Provider>);
}

/** Visible text, tags as separators. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "\u0001");
}

function page(
  overview: MemoryOverview | null,
  loadError: string | null = null,
): string {
  return markup(
    <MemoryPage
      overview={overview}
      loadError={loadError}
      actions={actions}
      lookupSession={(id) => {
        const title = MEMORY_FIXTURE_SESSION_TITLES[id];
        return title ? { title, archived: false } : null;
      }}
    />,
  );
}

function withLedger(ledger: Partial<MemoryOverview["ledger"]>): MemoryOverview {
  return {
    ...MEMORY_OVERVIEW_FIXTURE,
    ledger: { ...MEMORY_OVERVIEW_FIXTURE.ledger, ...ledger },
  };
}

const EMPTY_LEDGER: Partial<MemoryOverview["ledger"]> = {
  switch: { state: "undecided" },
  lastRun: undefined,
  nextRunAt: undefined,
  activities: { kind: "absent" },
  emotions: { kind: "absent" },
  forgotten: [],
  exclusions: [],
};

/** The `disabled` attribute (class names carry `disabled:` variants). */
const DISABLED_ATTRIBUTE = /\sdisabled=""/;

/** The `<button>` whose aria-label is `label`. */
function buttonWithLabel(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Settings → Memory", () => {
  it("undecided, nothing kept: only the switch and the AI's memory", () => {
    const html = page(withLedger(EMPTY_LEDGER));
    const out = text(html);
    expect(out).toContain("从对话里了解我");
    expect(out).toContain("包括以前的对话，不读 AI 的回复");
    expect(out).toContain("再经过一次模型服务商");
    expect(out).toContain("只存在这台电脑上");
    expect(html).toMatch(/role="switch" aria-checked="false"/);
    for (const area of [
      "正在进行的事",
      "已经结束的事",
      "情绪时刻",
      "不再记的事",
      "不用于了解我的对话",
    ]) {
      expect(out).not.toContain(area);
    }
    expect(out).toContain("AI 的长期记忆");
    expect(out).toContain("不受上面的开关控制");
    expect(out).toContain("global_mem.txt");
    expect(out).toContain("global_mem_insight.txt");
    // No status line while not on.
    expect(out).not.toContain("上次整理");
  });

  it("off, files gone: the same, but a kept list brings the areas back", () => {
    const off = { ...EMPTY_LEDGER, switch: { state: "off" } as const };
    expect(text(page(withLedger(off)))).not.toContain("正在进行的事");
    const kept = text(
      page(
        withLedger({
          ...off,
          forgotten: MEMORY_OVERVIEW_FIXTURE.ledger.forgotten,
        }),
      ),
    );
    expect(kept).toContain("不再记的事");
    expect(kept).toContain("Galley 留着它们的标题");
  });

  it("on: the status line and all seven areas", () => {
    const html = page(MEMORY_OVERVIEW_FIXTURE);
    const out = text(html);
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(out).toContain(
      "从最早的对话开始 · 上次整理 今天 04:00，已更新 · 下次 明天 04:00",
    );
    for (const area of [
      "正在进行的事",
      "已经结束的事",
      "情绪时刻",
      "只在把事办好需要时引用，不会单独评论你的情绪。",
      "不再记的事",
      "不用于了解我的对话",
      "AI 的长期记忆",
      "其他内容",
    ]) {
      expect(out).toContain(area);
    }
  });

  it("lists ongoing activities newest first, with status and meta", () => {
    const out = text(page(MEMORY_OVERVIEW_FIXTURE));
    const order = [
      "杭州半程马拉松备赛",
      "母亲膝关节置换后的陪护与康复",
      "日语 N3 备考",
      "豆包的体重与猫粮管理",
      "banner 尺寸修改",
      "双十一项目的后续安排",
    ].map((title) => out.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain(
      "9 月 27 日长距离 18 公里，比计划快，离半马还有八周。",
    );
    expect(out).toContain("最近提到：9月27日 · 4 个对话");
  });

  it("folds ended activities and emotions by default", () => {
    const out = text(page(MEMORY_OVERVIEW_FIXTURE));
    expect(out).not.toContain("9 月搬家准备与搬入");
    expect(out).not.toContain("手术等待超预期时的明显焦急");
    expect(out).not.toContain("与阿杰在西溪湿地附近找房");
    // Exclusions stay open, each with 恢复.
    expect(out).toContain("上下文记忆测试");
    expect(out).toContain("公司周报");
    expect(out).toContain("恢复");
  });

  it("an unreadable activities file shows read-only as one area", () => {
    const out = text(
      page(
        withLedger({
          activities: { kind: "raw", text: "# 活动知识层\n随手写的段落" },
        }),
      ),
    );
    expect(out).toContain("记下的事");
    expect(out).toContain("格式没认出来，先显示原文。");
    expect(out).toContain("随手写的段落");
    expect(out).not.toContain("正在进行的事");
  });

  it("while a run is going: 正在整理, and deleting waits", () => {
    const html = page(withLedger({ running: true }));
    expect(text(html)).toContain("正在整理");
    expect(text(html)).not.toContain("下次 明天");
    expect(buttonWithLabel(html, "删除「杭州半程马拉松备赛」")).toMatch(
      DISABLED_ATTRIBUTE,
    );
  });

  it("not running: deleting is open", () => {
    const html = page(MEMORY_OVERVIEW_FIXTURE);
    expect(buttonWithLabel(html, "删除「杭州半程马拉松备赛」")).not.toMatch(
      DISABLED_ATTRIBUTE,
    );
  });

  it("a failed read says so and offers a retry", () => {
    const out = text(page(null, "managed_only"));
    expect(out).toContain("读取记忆失败：managed_only");
    expect(out).toContain("重试");
    expect(out).not.toContain("从对话里了解我");
  });
});

describe("SettingsSidebar memory tab", () => {
  function sidebar(showMemoryTab: boolean) {
    return text(
      markup(
        <SettingsSidebar
          tab="general"
          onChange={() => {}}
          resolvedLanguage="zh-CN"
          showImTab
          showBrowserTab
          showPhoneTab={false}
          showMemoryTab={showMemoryTab}
        />,
      ),
    );
  }

  it("is absent on the external runtime", () => {
    expect(sidebar(false)).not.toContain("记忆");
  });

  it("sits right after Models on the managed runtime", () => {
    const out = sidebar(true);
    const models = out.indexOf("模型");
    const memory = out.indexOf("记忆");
    const browser = out.indexOf("浏览器控制");
    expect(models).toBeGreaterThanOrEqual(0);
    expect(memory).toBeGreaterThan(models);
    expect(memory).toBeLessThan(browser);
  });
});
