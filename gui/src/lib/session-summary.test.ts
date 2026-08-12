import { describe, expect, it } from "vitest";

import {
  cleanSessionSummary,
  displaySessionSummary,
  isProtocolFailureSummary,
} from "./session-summary";

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

  it("strips attribute-carrying tags (#22 regex gap)", () => {
    expect(
      cleanSessionSummary('已改好 <file_content path="a.py">x</file_content> 收尾'),
    ).toBe("已改好 x 收尾");
  });
});

// Mirror of runner-side _TOOL_MARKUP_START_RE + the fixed marker
// TURN_PROTOCOL_FAILURE_SUMMARY (workbench_bridge.py — keep in sync).
describe("isProtocolFailureSummary", () => {
  it("detects raw leaked tool-call markup (historical / attach rows)", () => {
    // Real #22 session-list shape, verbatim minus redaction.
    expect(
      isProtocolFailureSummary(
        '<invoke name="code_run"><parameter nam ... e(js)print(len(js))',
      ),
    ).toBe(true);
    expect(
      isProtocolFailureSummary('<parameter name="script">import json'),
    ).toBe(true);
    // Legacy step prefix ahead of the markup doesn't hide it.
    expect(
      isProtocolFailureSummary('第 2 步 · <invoke name="code_run">x'),
    ).toBe(true);
  });

  it("detects the runner's replacement marker (new rows)", () => {
    expect(isProtocolFailureSummary("回合协议错误：工具调用未能送达")).toBe(true);
  });

  it("leaves ordinary recaps alone", () => {
    expect(isProtocolFailureSummary("定位到空指针并修复")).toBe(false);
    expect(isProtocolFailureSummary("检查了 invoke 调用的参数")).toBe(false);
    expect(isProtocolFailureSummary("答复 <suggestion>试试这个</suggestion>")).toBe(
      false,
    );
  });
});

describe("displaySessionSummary", () => {
  it("swaps protocol-failure rows for the localized label", () => {
    expect(
      displaySessionSummary('<invoke name="code_run">import json', "协议错误"),
    ).toBe("协议错误");
  });

  it("cleans everything else as before", () => {
    expect(displaySessionSummary("第 3 步 · 修复了登录超时", "协议错误")).toBe(
      "修复了登录超时",
    );
  });
});
