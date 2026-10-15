import { describe, expect, it } from "vitest";

import {
  ASSISTANT_PROCESS_ROWS,
  assistantProcessSteps,
  assistantStep,
  assistantStepObjects,
} from "./assistant-process";
import { zhCopy } from "@/i18n/locales/zh";
import { buildBrowserSiteResolver } from "@/lib/browser-site";
import type {
  AgentTurn,
  BrowserFacts,
  ConversationToolEvent,
  Turn,
} from "@/types/conversation";

const words = zhCopy.conversation;

let seq = 0;
function tool(
  name: string,
  extra: Partial<ConversationToolEvent> = {},
): ConversationToolEvent {
  seq += 1;
  return { id: `t-${seq}`, name, status: "success-historical", ...extra };
}

const CTRIP: BrowserFacts = {
  kind: "scan",
  tabsOnly: false,
  activeTabId: "7",
  tabs: [
    { id: "7", url: "https://www.ctrip.com/ferry?day=sat", title: "携程船票" },
    { id: "8", url: "https://weather.com.cn/xiamen", title: "厦门天气" },
  ],
};

function agent(overrides: Partial<AgentTurn>): AgentTurn {
  return { role: "agent", finalAnswer: null, tools: [], ...overrides };
}

describe("assistantProcessSteps: which steps get a row", () => {
  it("leaves out the answer and a step that only asked, keeps one that asked and ran a tool", () => {
    const turns: Turn[] = [
      { role: "user", content: "订船票" },
      agent({ summary: "看船班", tools: [tool("web_scan")] }),
      agent({
        summary: "问用户",
        tools: [tool("ask_user", { args: { question: "哪一班？" } })],
      }),
      { role: "user", content: "8:30" },
      agent({
        summary: "边查边问",
        tools: [
          tool("web_scan"),
          tool("ask_user", { args: { question: "要往返吗？" } }),
        ],
      }),
      { role: "user", content: "要" },
      agent({ finalAnswer: "订好了。", tools: [tool("no_tool")] }),
    ];
    expect(assistantProcessSteps([0, 1, 2, 3, 4, 5, 6], turns, 6)).toEqual([
      1, 4,
    ]);
  });

  it("caps the card at the p75 of the rounds: eight rows", () => {
    expect(ASSISTANT_PROCESS_ROWS).toBe(8);
  });
});

describe("assistantStepObjects: what a step touched", () => {
  it("writes the site of a browser step as the tool pill resolves it: the host", () => {
    const scan = tool("web_scan", { browser: CTRIP });
    const script = tool("web_execute_js", {
      browser: { kind: "script", tabId: "8", newTabs: [] },
    });
    const turns: Turn[] = [
      agent({ tools: [scan] }),
      agent({ tools: [script] }),
    ];
    const resolve = buildBrowserSiteResolver(turns);
    expect(assistantStepObjects(turns[0] as AgentTurn, resolve)).toEqual([
      "ctrip.com",
    ]);
    expect(assistantStepObjects(turns[1] as AgentTurn, resolve)).toEqual([
      "weather.com.cn",
    ]);
  });

  it("writes nothing for a browser step it cannot place, or one that only listed tabs", () => {
    const unknownTab = tool("web_execute_js", {
      browser: { kind: "script", tabId: "99", newTabs: [] },
    });
    const listed = tool("web_scan", { browser: { ...CTRIP, tabsOnly: true } });
    const bare = tool("web_scan");
    const turns: Turn[] = [
      agent({ tools: [unknownTab] }),
      agent({ tools: [listed] }),
      agent({ tools: [bare] }),
    ];
    const resolve = buildBrowserSiteResolver(turns);
    for (const turn of turns) {
      expect(assistantStepObjects(turn as AgentTurn, resolve)).toEqual([]);
    }
    expect(assistantStepObjects(turns[2] as AgentTurn, null)).toEqual([]);
  });

  it("falls back to the page title a scan read when the host is cut", () => {
    const clipped = tool("web_scan", {
      browser: {
        kind: "scan",
        tabsOnly: false,
        activeTabId: "1",
        tabs: [{ id: "1", url: "https://www.verylonghost...", title: "船票" }],
      },
    });
    const turn = agent({ tools: [clipped] });
    expect(
      assistantStepObjects(turn, buildBrowserSiteResolver([turn])),
    ).toEqual(["船票"]);
  });

  it("writes a file step's name without its folders, the resolved path first", () => {
    const read = tool("file_read", {
      args: { path: "~/Documents/行程/鼓浪屿.md" },
    });
    const write = tool("file_write", {
      args: { path: "./清单.md" },
      resolvedPath: "/Users/me/Documents/清单 v2.md",
    });
    const windows = tool("file_patch", {
      args: { path: "C:\\Users\\me\\notes.txt" },
    });
    expect(
      assistantStepObjects(agent({ tools: [read, write, windows] }), null),
    ).toEqual(["鼓浪屿.md", "清单 v2.md", "notes.txt"]);
  });

  it("writes nothing for other tools, nothing for a denied one, each object once", () => {
    expect(
      assistantStepObjects(
        agent({
          tools: [
            tool("code_run", { args: { script: "ls ~/Downloads" } }),
            tool("update_working_checkpoint"),
            tool("file_read", {
              args: { path: "/tmp/secret.txt" },
              status: "denied",
            }),
            tool("file_read", { args: { path: "/a/plan.md" } }),
            tool("file_read", { args: { path: "/b/plan.md" } }),
            tool("file_read", { args: { path: "  " } }),
          ],
        }),
        null,
      ),
    ).toEqual(["plan.md"]);
  });
});

describe("assistantStep: the row's words and what opening it shows", () => {
  const narration = "我先查一下周六上午的船班。";

  it("writes an echo step's narration as the sentence and keeps no narration row", () => {
    const step = assistantStep(
      agent({
        finalAnswer: narration,
        summary: narration,
        tools: [tool("web_scan")],
      }),
      words,
      null,
    );
    expect(step.sentence).toBe(narration);
    expect(step.narration).toBeNull();
    expect(step.hasDetail).toBe(true);
  });

  it("writes the model's own summary and keeps its narration for the detail", () => {
    const step = assistantStep(
      agent({
        finalAnswer: narration,
        summary: "查船班",
        thinking: "先看携程。",
        tools: [tool("web_scan")],
      }),
      words,
      null,
    );
    expect(step.sentence).toBe("查船班");
    expect(step.narration).toBe(narration);
    expect(step.thinking).toBe("先看携程。");
  });

  it("falls back to 「调用了 X」: an echoed summary without narration words, a bare step", () => {
    expect(
      assistantStep(
        agent({ summary: "**", finalAnswer: "**", tools: [tool("code_run")] }),
        words,
        null,
      ).sentence,
    ).toBe("调用了 code_run");
    expect(
      assistantStep(agent({ tools: [tool("web_scan")] }), words, null).sentence,
    ).toBe("调用了 web_scan");
  });

  it("collapses a sentence onto one line", () => {
    expect(
      assistantStep(
        agent({ summary: "查船班，\n再看天气", tools: [tool("web_scan")] }),
        words,
        null,
      ).sentence,
    ).toBe("查船班， 再看天气");
  });

  it("has no detail for a step that is only a sentence", () => {
    const step = assistantStep(
      agent({ summary: "想了一下怎么排", tools: [tool("no_tool")] }),
      words,
      null,
    );
    expect(step.sentence).toBe("想了一下怎么排");
    expect(step.tools).toEqual([]);
    expect(step.hasDetail).toBe(false);
  });

  it("drops a preamble that only repeats the narration, as the marker does", () => {
    const step = assistantStep(
      agent({
        finalAnswer: narration,
        summary: "查船班",
        preamble: `  ${narration} `,
        tools: [tool("web_scan")],
      }),
      words,
      null,
    );
    expect(step.preamble).toBeUndefined();
  });
});
