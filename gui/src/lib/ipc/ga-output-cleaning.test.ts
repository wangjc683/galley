import { describe, expect, it } from "vitest";

import {
  cleanPartialContent,
  extractPlanSteps,
  extractPreamble,
} from "@/lib/ipc/ga-output-cleaning";

describe("extractPlanSteps", () => {
  it("returns input untouched when no pin is present", () => {
    const text = "研究代理已成功启动（PID 68560）；现在读取输出。";
    expect(extractPlanSteps(text)).toEqual({ steps: [], rest: text });
  });

  it("extracts a bold pin line and cleans label / emoji / bold / 句号", () => {
    const { steps, rest } = extractPlanSteps(
      "📌 **当前步骤：探索态—监察研究代理。**\n\n接下来读取交付文件。",
    );
    expect(steps).toEqual(["探索态—监察研究代理"]);
    expect(rest).toBe("接下来读取交付文件。");
  });

  it("handles catch-up replies with several pins in one paragraph", () => {
    // The model repaying skipped turns crams multiple announcements
    // into one soft-wrapped paragraph (dogfood screenshot, step 17).
    const { steps, rest } = extractPlanSteps(
      "📌 当前步骤：探索态—核实官方信息边界。 📌 当前步骤：探索态—补齐赛季叙事主线。 📌 当前步骤：规划态—把探索结论转成执行计划。",
    );
    expect(steps).toEqual([
      "探索态—核实官方信息边界",
      "探索态—补齐赛季叙事主线",
      "规划态—把探索结论转成执行计划",
    ]);
    expect(rest).toBe("");
  });

  it("keeps surrounding narration when the pin sits mid-text", () => {
    const { steps, rest } = extractPlanSteps(
      "先说明一下。\n📌 当前步骤：执行态—迁移旧数据\n然后继续。",
    );
    expect(steps).toEqual(["执行态—迁移旧数据"]);
    expect(rest).toBe("先说明一下。\n\n然后继续。");
  });

  it("accepts a half-width colon", () => {
    const { steps } = extractPlanSteps("📌当前步骤: 验证态—对抗性验证");
    expect(steps).toEqual(["验证态—对抗性验证"]);
  });
});

describe("plan-step stripping in streaming / preamble paths", () => {
  it("cleanPartialContent drops pin announcements", () => {
    const out = cleanPartialContent(
      "📌 **当前步骤：探索态—启动只读研究代理。**\n\n正在启动子代理…",
    );
    expect(out).not.toContain("📌");
    expect(out).toContain("正在启动子代理…");
  });

  it("extractPreamble drops pin announcements", () => {
    const out = extractPreamble(
      "📌 当前步骤：探索态—检查代理运行日志。\n当前阶段判断：日志可能包含退出原因。",
    );
    expect(out).not.toContain("📌");
    expect(out).toContain("日志可能包含退出原因");
  });
});
