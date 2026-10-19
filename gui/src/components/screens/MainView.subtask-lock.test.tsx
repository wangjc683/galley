import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import type { SubtaskQuestionHolder } from "@/lib/subtasks";
import type { PendingAskUser, Turn } from "@/types/conversation";

import { MainView } from "./MainView";

/**
 * Main chat PRD ruling 102: a subtask opened from its card cannot answer
 * its question while the question is with Galley — the candidates and
 * the composer are off, one line under the question says so and leads
 * back. Who holds the question is pinned in lib/subtasks.test.ts; a
 * static render reads the stores' initial state, so the hook is handed
 * its answer here, per session id.
 */

const held = vi.hoisted(() => ({
  holder: "none" as SubtaskQuestionHolder,
  askedFor: [] as Array<string | undefined>,
}));
vi.mock("@/hooks/useSubtaskQuestionHolder", () => ({
  useSubtaskQuestionHolder: (sessionId: string | undefined) => {
    held.askedFor.push(sessionId);
    return sessionId ? held.holder : "none";
  },
}));

afterEach(() => {
  held.holder = "none";
  held.askedFor = [];
});

const asked: PendingAskUser = {
  question: "下载文件夹按什么分类？",
  candidates: ["按类型", "按用途"],
};

const turns: Turn[] = [
  { role: "user", content: "整理下载文件夹，先问分类" },
  {
    role: "agent",
    turnIndex: 1,
    finalAnswer: null,
    tools: [
      {
        id: "t-ask",
        name: "ask_user",
        status: "success-historical",
        args: { question: asked.question, candidates: asked.candidates },
      },
    ],
  },
];

function render(isMainChat = false): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={turns}
          llmDisplayName="model"
          activeSessionId="s-sub"
          isMainChat={isMainChat}
          pendingAskUser={asked}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

const LINE = 'data-role="question-with-galley"';
const TEXTAREA = /<textarea[^>]*data-composer-input=""[^>]*>/;

function textarea(html: string): string {
  return html.match(TEXTAREA)?.[0] ?? "";
}

/** The candidate buttons, as rendered. */
function chips(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(按类型|按用途)<\/button>/g)].map(
    (m) => m[0],
  );
}

describe("a subtask opened while Galley has its question", () => {
  it("turns the candidates and the composer off and points back to Galley while Galley asks you", () => {
    held.holder = "galleyAsked";
    const html = render();
    expect(html).toContain(LINE);
    expect(html).toContain(zhCopy.subtask.withGalleyAsked);
    expect(html).toContain(`>${zhCopy.assistant.backTo}<`);
    // The question itself still reads.
    expect(html).toContain(asked.question);
    expect(chips(html)).toHaveLength(2);
    for (const chip of chips(html)) expect(chip).toContain('disabled=""');
    expect(textarea(html)).toContain('disabled=""');
    expect(textarea(html)).toContain(
      `placeholder="${zhCopy.composer.answerWithGalley}"`,
    );
    // The way back is a button with the crumb's words, not a link.
    expect(html).not.toContain("cursor-pointer");
  });

  it("says Galley is handling it while its round runs", () => {
    held.holder = "galleyWorking";
    const html = render();
    expect(html).toContain(zhCopy.subtask.withGalleyWorking);
    expect(html).not.toContain(zhCopy.subtask.withGalleyAsked);
    expect(textarea(html)).toContain('disabled=""');
  });

  it("answers as before when the question is the subtask's or the card's", () => {
    for (const holder of ["subtask", "card", "none"] as const) {
      held.holder = holder;
      const html = render();
      expect(html, holder).not.toContain(LINE);
      for (const chip of chips(html)) expect(chip).not.toContain('disabled=""');
      expect(textarea(html)).not.toContain('disabled=""');
      expect(textarea(html)).toContain(
        `placeholder="${zhCopy.composer.replyToContinue}"`,
      );
    }
  });

  it("asks nothing of the main chat itself", () => {
    held.holder = "galleyAsked";
    const html = render(true);
    expect(held.askedFor).toContain(undefined);
    expect(held.askedFor).not.toContain("s-sub");
    expect(html).not.toContain(LINE);
    expect(textarea(html)).not.toContain('disabled=""');
  });
});
