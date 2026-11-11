// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Checkbox, type CheckboxCheckedTone } from "./checkbox";

/**
 * The app's one checkbox: ticked, it fills with the brand colour unless
 * asked for `quiet` (main chat ticket 84, ruling 129 point 2), which
 * only a to-do done in Core asks for. Unticked, the tone changes
 * nothing. Held down it sinks, and ticked after mount it plays its beat
 * (ticket 160, ruling 208 point 2); at rest it is as it was.
 */

/** The sink while held, on every box not disabled (ticket 160). */
const PRESS =
  "motion-safe:group-active:scale-90 group-active:transition-[scale] group-active:duration-(--motion-press) group-active:ease-firm";

/** The drawn box's classes. */
function box(html: string): string {
  const match = /<span aria-hidden="true" class="([^"]*)"/.exec(html);
  if (!match) throw new Error("no box");
  return match[1];
}

describe("the checkbox", () => {
  it("fills a ticked box with the brand colour by default, as ever", () => {
    expect(box(renderToStaticMarkup(<Checkbox checked aria-label="x" />))).toBe(
      `inline-flex items-center justify-center rounded-sm border peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 border-brand bg-brand text-ink ${PRESS} size-4`,
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
      `inline-flex items-center justify-center rounded-sm border peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 border-line-strong bg-line-strong text-ink-soft ${PRESS} size-4`,
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

  it("sinks while held only when it is not disabled, the transition on :active alone", () => {
    for (const checked of [false, true]) {
      const live = box(
        renderToStaticMarkup(<Checkbox checked={checked} aria-label="x" />),
      );
      expect(live).toContain(PRESS);
      // Nothing transitions at rest: the box snaps back on release.
      expect(live.split(" ").filter((c) => c.startsWith("transition"))).toEqual(
        [],
      );
      expect(
        box(
          renderToStaticMarkup(
            <Checkbox checked={checked} disabled aria-label="x" />,
          ),
        ),
      ).not.toContain("group-active");
    }
  });
});

describe("the checkbox's beat", () => {
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.useRealTimers();
  });

  function mount(
    checked: boolean,
    props: { disabled?: boolean; checkedTone?: CheckboxCheckedTone } = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    root = r;
    const render = (next: boolean) =>
      act(() =>
        r.render(<Checkbox checked={next} aria-label="x" {...props} />),
      );
    render(checked);
    return render;
  }

  function boxClasses(): DOMTokenList {
    const element = host?.querySelector("span[aria-hidden]");
    if (!element) throw new Error("no box");
    return element.classList;
  }

  it("is still when it mounts ticked", () => {
    mount(true);
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
    expect(boxClasses().contains("checkbox-untick")).toBe(false);
  });

  it("plays the tick when ticked after mount, whoever ticks it", () => {
    const render = mount(false);
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
    render(true);
    expect(boxClasses().contains("checkbox-tick")).toBe(true);
    expect(boxClasses().contains("checkbox-untick")).toBe(false);
  });

  it("does not pop when unticked: only the colours ease back", () => {
    const render = mount(true);
    render(false);
    expect(boxClasses().contains("checkbox-untick")).toBe(true);
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
  });

  it("drops the beat once it has played, so nothing can replay it", () => {
    vi.useFakeTimers();
    const render = mount(false);
    render(true);
    expect(boxClasses().contains("checkbox-tick")).toBe(true);
    act(() => vi.advanceTimersByTime(399));
    expect(boxClasses().contains("checkbox-tick")).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
    // A turn inside a beat starts a new one, timed from that turn.
    render(false);
    act(() => vi.advanceTimersByTime(300));
    render(true);
    act(() => vi.advanceTimersByTime(300));
    expect(boxClasses().contains("checkbox-tick")).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
  });

  it("keeps the quiet tone's colours through and after the beat", () => {
    vi.useFakeTimers();
    const render = mount(false, { checkedTone: "quiet" });
    render(true);
    for (const name of [
      "border-line-strong",
      "bg-line-strong",
      "text-ink-soft",
    ])
      expect(boxClasses().contains(name)).toBe(true);
    expect(boxClasses().contains("bg-brand")).toBe(false);
    act(() => vi.advanceTimersByTime(400));
    expect(boxClasses().contains("checkbox-tick")).toBe(false);
    expect(boxClasses().contains("bg-line-strong")).toBe(true);
  });

  it("ticks a disabled box with the same beat but never sinks it", () => {
    const render = mount(false, { disabled: true });
    render(true);
    expect(boxClasses().contains("checkbox-tick")).toBe(true);
    expect(
      [...boxClasses()].filter((name) => name.includes("group-active")),
    ).toEqual([]);
  });
});
