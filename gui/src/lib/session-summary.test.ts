import { describe, expect, it } from "vitest";

import { cleanSessionSummary } from "./session-summary";

// Mirror of runner-side _clean_turn_summary (workbench_bridge.py) —
// if a rule changes here, change it there too.
describe("cleanSessionSummary", () => {
  it("passes clean model-provided summaries through", () => {
    expect(cleanSessionSummary("定位到空指针并修复")).toBe("定位到空指针并修复");
  });

  it("strips the legacy step prefix", () => {
    expect(cleanSessionSummary("第 3 步 · 修复了登录超时")).toBe(
      "修复了登录超时",
    );
  });

  it("scrubs GA fallback-recap junk (headings, chopped tags, ' ... ')", () => {
    // Real-world shape: raw reply body, newlines removed, middle-cut by
    // smart_format leaving an orphan "<sugg…estion>" tail fragment.
    expect(
      cleanSessionSummary("两天数据都拿到了！### 🌊 潮汐 ... estion>帮我推荐厦门周末"),
    ).toBe("两天数据都拿到了！ 🌊 潮汐 … 帮我推荐厦门周末");
  });

  it("removes complete tags, emphasis runs and backticks", () => {
    expect(cleanSessionSummary("答复 <suggestion>试试这个</suggestion>")).toBe(
      "答复 试试这个",
    );
    expect(cleanSessionSummary("行内 `code` 与 **强调**")).toBe(
      "行内 code 与 强调",
    );
  });

  it("removes a head-side chopped tag before the truncation marker", () => {
    expect(cleanSessionSummary("已发出 <sugg ...")).toBe("已发出 …");
  });
});
