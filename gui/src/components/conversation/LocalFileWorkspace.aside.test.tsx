import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TODO_PANEL_ID, TODO_PANEL_WIDTH } from "@/lib/todo-panel";

import { LocalFileWorkspace } from "./LocalFileWorkspace";

/**
 * The to-do panel in the reading panel's place (main chat ticket 42).
 * A static render has no ResizeObserver, so the main area reads as
 * narrow: the panel covers the conversation's right edge at its own
 * width, beside it in the DOM, not in a dialog (the composer stays
 * usable for 「说说这件」). Without it, the workspace is as it was.
 */

// The panel group keeps its splits in localStorage; Node has none.
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function render(aside?: { id: string; width: number }) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFileWorkspace
        sessionId="s-main"
        aside={
          aside
            ? { ...aside, content: <div data-role="todo-panel">待办</div> }
            : null
        }
      >
        <div data-role="conversation" />
      </LocalFileWorkspace>
    </Tooltip.Provider>,
  );
}

describe("the workspace's aside (the to-do panel)", () => {
  it("covers the conversation's right edge at its own width when narrow", () => {
    const html = render({ id: TODO_PANEL_ID, width: TODO_PANEL_WIDTH });
    expect(html).toContain('data-role="workspace-aside-overlay"');
    expect(html).toContain("width:min(100%, 320px)");
    expect(html).toContain('data-role="todo-panel"');
    // Not a dialog: no overlay dimming the conversation, no portal.
    expect(html).not.toContain("bg-overlay");
    expect(html.indexOf('data-role="conversation"')).toBeLessThan(
      html.indexOf('data-role="todo-panel"'),
    );
  });

  it("is not there without one", () => {
    const html = render();
    expect(html).not.toContain("workspace-aside-overlay");
    expect(html).toContain('data-role="conversation"');
  });
});
