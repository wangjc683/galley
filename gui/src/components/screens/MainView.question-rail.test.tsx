import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalFilesContext } from "@/lib/local-files";
import type { Turn } from "@/types/conversation";

import { MainView } from "./MainView";

// useCopy falls back to the zh copy without a CopyProvider.
const RAIL = 'aria-label="提问索引"';

const turns: Turn[] = [
  { role: "user", content: "明天厦门天气怎么样" },
  {
    role: "agent",
    tools: [],
    finalAnswer: "明天晴，最高 29 度。",
    turnIndex: 1,
  },
];

function render(isMainChat: boolean): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={turns}
          llmDisplayName="model"
          activeSessionId="s-1"
          isMainChat={isMainChat}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

// Main chat PRD ruling 60: the question rail places its dots by their
// share of the loaded content, which a conversation with no end (paged
// from the bottom) cannot keep still, so the main chat has none.
describe("the question rail", () => {
  it("shows from the first question in an ordinary conversation", () => {
    expect(render(false)).toContain(RAIL);
  });

  it("is not there in the main chat", () => {
    const html = render(true);
    expect(html).not.toContain(RAIL);
    // The conversation itself still renders.
    expect(html).toContain("明天厦门天气怎么样");
  });
});
