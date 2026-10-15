import * as Tooltip from "@radix-ui/react-tooltip";
import {
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Composer, type ComposerProps } from "./Composer";

/**
 * Enter in the Composer. A static render runs no handlers, so the
 * Composer's own render function (it is a `forwardRef`) runs inside a
 * probe component and the test calls the textarea's keydown handler
 * from the element tree it returned.
 */

type ComposerRender = (props: ComposerProps, ref: null) => ReactNode;

function findElement(
  node: ReactNode,
  match: (element: ReactElement) => boolean,
): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (match(node)) return node;
  return findElement((node.props as { children?: ReactNode }).children, match);
}

/** The textarea's keydown handler after one render with `props`. */
function keydownOf(
  props: Partial<ComposerProps>,
): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  const render = (Composer as unknown as { render: ComposerRender }).render;
  let tree: ReactNode = null;
  function Probe() {
    tree = render({ llmDisplayName: "model", ...props }, null);
    return tree;
  }
  renderToStaticMarkup(
    <Tooltip.Provider>
      <Probe />
    </Tooltip.Provider>,
  );
  const textarea = findElement(tree, (element) => element.type === "textarea");
  expect(textarea, "the Composer's textarea").toBeDefined();
  return (
    textarea!.props as {
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    }
  ).onKeyDown;
}

function enter(composing = false): KeyboardEvent<HTMLTextAreaElement> {
  return {
    key: "Enter",
    shiftKey: false,
    preventDefault: () => {},
    nativeEvent: { isComposing: composing, keyCode: composing ? 229 : 13 },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe("Enter in the Composer", () => {
  it("hands the draft to the send while the agent runs: its owner queues it, nothing opens in between (ruling 71)", () => {
    const onSubmit = vi.fn();
    const onKeyDown = keydownOf({
      value: "顺便查下周五的天气",
      onChange: () => {},
      onSubmit,
      stopMode: true,
    });
    onKeyDown(enter());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("顺便查下周五的天气", []);
  });

  it("leaves an Enter that confirms an IME candidate to the IME", () => {
    const onSubmit = vi.fn();
    const onKeyDown = keydownOf({
      value: "顺便",
      onChange: () => {},
      onSubmit,
      stopMode: true,
    });
    onKeyDown(enter(true));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
