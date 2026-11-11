// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { GroupLabel } from "./GroupLabel";

/*
 * 已完成's count steps when it changes (main chat ticket 161, PRD ruling
 * 208 point 3): `sidebar-step-tick` on the number, each time it changes
 * after the label mounted, up or down; never at mounting.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function render(count?: number) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      <GroupLabel
        label="已完成"
        count={count}
        open={false}
        onToggle={() => {}}
      />,
    ),
  );
}

const number = () =>
  host!.querySelector<HTMLElement>('[data-role="group-count"]');
const steps = () => number()?.classList.contains("sidebar-step-tick");

describe("已完成's count", () => {
  it("does not step at mounting", () => {
    render(3);
    expect(number()?.textContent).toBe("3");
    expect(steps()).toBe(false);
  });

  it("steps when it changes, up or down, each time afresh", () => {
    render(3);
    const first = number();
    render(4);
    expect(number()?.textContent).toBe("4");
    expect(steps()).toBe(true);
    const second = number();
    // A new box each time: the step starts over.
    expect(second).not.toBe(first);
    render(3);
    expect(steps()).toBe(true);
    expect(number()).not.toBe(second);
  });

  it("does not step on a render that keeps it", () => {
    render(3);
    const first = number();
    render(3);
    expect(number()).toBe(first);
    expect(steps()).toBe(false);
  });

  it("draws no number without a count", () => {
    render();
    expect(number()).toBeNull();
  });
});
