import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemoryAskCard, MemoryAskStrip } from "./MemoryAsk";

function text(node: ReactNode): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>{node}</Tooltip.Provider>,
  ).replace(/<[^>]+>/g, "\u0001");
}

describe("the main chat's memory ask", () => {
  for (const [form, node] of [
    ["A (strip)", <MemoryAskStrip key="a" />],
    ["B (card)", <MemoryAskCard key="b" />],
  ] as const) {
    it(`${form} says what, through whom, where, and where to turn it off`, () => {
      const out = text(node);
      expect(out).toContain("要让 Galley 从对话里了解你吗？");
      expect(out).toContain("不读 AI 的回复");
      expect(out).toContain("模型服务商");
      expect(out).toContain("只存在这台电脑上");
      expect(out).toContain("设置 → 记忆");
      for (const answer of ["从现在开始", "也读以前的对话", "先不要"]) {
        expect(out).toContain(answer);
      }
    });
  }
});
