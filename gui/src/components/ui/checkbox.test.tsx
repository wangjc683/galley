import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

/**
 * The app's one checkbox: ticked, it fills with the brand colour unless
 * asked for `quiet` (main chat ticket 84, ruling 129 point 2), which
 * only a to-do done in Core asks for. Unticked, the tone changes
 * nothing.
 */

/** The drawn box's classes. */
function box(html: string): string {
  const match = /<span aria-hidden="true" class="([^"]*)"/.exec(html);
  if (!match) throw new Error("no box");
  return match[1];
}

describe("the checkbox", () => {
  it("fills a ticked box with the brand colour by default, as ever", () => {
    expect(box(renderToStaticMarkup(<Checkbox checked aria-label="x" />))).toBe(
      "inline-flex items-center justify-center rounded-sm border peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 border-brand bg-brand text-ink size-4",
    );
    expect(
      box(
        renderToStaticMarkup(
          <Checkbox checked checkedTone="brand" aria-label="x" />,
        ),
      ),
    ).toContain("border-brand bg-brand text-ink");
  });

  it("fills a quiet one in line-strong with an ink-soft tick, same shape and size, still enabled", () => {
    const html = renderToStaticMarkup(
      <Checkbox checked checkedTone="quiet" aria-label="x" />,
    );
    expect(box(html)).toBe(
      "inline-flex items-center justify-center rounded-sm border peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 border-line-strong bg-line-strong text-ink-soft size-4",
    );
    expect(html).not.toContain("disabled");
  });

  it("leaves an unticked box alone, whatever the tone", () => {
    for (const tone of [undefined, "brand", "quiet"] as const) {
      expect(
        box(
          renderToStaticMarkup(
            <Checkbox checked={false} checkedTone={tone} aria-label="x" />,
          ),
        ),
      ).toContain(
        "border-line-strong bg-elevated text-transparent group-hover:border-brand",
      );
    }
  });
});
