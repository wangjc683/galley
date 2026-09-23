import { describe, expect, it } from "vitest";

import {
  THINKING_PREVIEW_TAIL_CHARS,
  thinkingPreviewTail,
} from "@/lib/thinking-preview";

/** `count` paragraphs of `size` chars each, blank-line separated. */
function paragraphs(count: number, size: number): string {
  return Array.from({ length: count }, (_, i) =>
    `${String(i).padStart(3, "0")} `.padEnd(size, "x"),
  ).join("\n\n");
}

describe("thinkingPreviewTail", () => {
  it("returns short reasoning unchanged", () => {
    const text = paragraphs(3, 100);
    expect(thinkingPreviewTail(text)).toBe(text);
    // Up to one step past the budget still renders whole.
    const almost = "y".repeat(THINKING_PREVIEW_TAIL_CHARS + 499);
    expect(thinkingPreviewTail(almost)).toBe(almost);
  });

  it("keeps a bounded tail that starts on a paragraph boundary", () => {
    const text = paragraphs(100, 120);
    const tail = thinkingPreviewTail(text);
    expect(text.endsWith(tail)).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(THINKING_PREVIEW_TAIL_CHARS + 500);
    expect(tail.length).toBeGreaterThanOrEqual(THINKING_PREVIEW_TAIL_CHARS / 2);
    // Starts at the head of a paragraph, not mid-word.
    expect(tail).toMatch(/^\d{3} x/);
    expect(text[text.length - tail.length - 1]).toBe("\n");
  });

  it("holds the cut still while tokens append within a step", () => {
    const text = paragraphs(100, 120);
    const cutOf = (s: string) => s.length - thinkingPreviewTail(s).length;
    const before = cutOf(text);
    expect(cutOf(`${text} more`)).toBe(before);
    expect(cutOf(`${text}${"z".repeat(200)}`)).toBe(before);
    // …and moves forward once a whole step has streamed.
    expect(cutOf(`${text}${"z".repeat(600)}`)).toBeGreaterThan(before);
  });

  it("falls back to a raw cut inside one huge paragraph", () => {
    const text = "w".repeat(6000);
    const tail = thinkingPreviewTail(text);
    expect(text.endsWith(tail)).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(THINKING_PREVIEW_TAIL_CHARS + 500);
  });

  it("re-opens a code fence the cut landed inside", () => {
    const code = Array.from({ length: 400 }, (_, i) => `line ${i};`).join("\n");
    const text = `Consider:\n\n\`\`\`ts\n${code}\n`;
    const tail = thinkingPreviewTail(text);
    expect(tail.startsWith("```\n")).toBe(true);
    // A cut after the fence closed adds nothing.
    const closed = `${text}\`\`\`\n\n${paragraphs(40, 120)}`;
    expect(thinkingPreviewTail(closed).startsWith("```")).toBe(false);
  });
});
