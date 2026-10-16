import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";

import { TodoGroups } from "./TodoDialog";

/**
 * The assistant's 待办 (main chat ticket 37): the groups, the rows, the
 * empty state. Static rendering cannot open the Radix dialog (a portal),
 * so the list's body is rendered with Core's answer fed in. Where a row
 * leads and which actions it has are pinned in
 * lib/assistant-todo.test.ts.
 */

function inDays(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function item(extra: Partial<TodoItem>): TodoItem {
  return {
    kind: "task",
    id: "sched_1",
    text: "提醒用户喝水",
    state: "scheduled",
    at: inDays(0, 23),
    createdBy: "assistant",
    target: "assistant",
    repeat: { kind: "once" },
    timeOfDay: "23:00",
    createdIn: { sessionId: "s-main", turnIndex: 7 },
    ...extra,
  };
}

const TODO: AssistantTodo = {
  upcoming: [
    item({}),
    item({
      id: "sched_news",
      text: "整理今天的新闻",
      repeat: { kind: "daily" },
      timeOfDay: "08:00",
      target: "session",
      createdBy: "user",
      createdIn: undefined,
      at: inDays(1, 8),
    }),
    item({
      id: "sched_agent",
      text: "检查构建",
      createdBy: "agent",
      agent: "claude-code",
      createdIn: undefined,
      at: inDays(2, 9),
    }),
  ],
  active: [
    item({
      kind: "subtask",
      id: "s-sub",
      text: "查周五去上海的机票",
      state: "asking",
      target: undefined,
      repeat: undefined,
      createdIn: undefined,
      at: inDays(0, 1),
    }),
  ],
  recent: [
    item({
      kind: "subtask",
      id: "s-done",
      text: "整理下载文件夹",
      state: "done",
      target: undefined,
      repeat: undefined,
      createdIn: undefined,
      at: inDays(-1, 9),
    }),
  ],
  recentOmitted: 0,
};

function render(
  todo: AssistantTodo,
  opts: {
    loaded?: boolean;
    recentOpen?: boolean;
    language?: "zh-CN" | "en-US";
  } = {},
) {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <TodoGroups
          todo={todo}
          loaded={opts.loaded ?? true}
          onGo={() => {}}
          onTalk={() => {}}
          defaultRecentOpen={opts.recentOpen}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const row = (html: string, id: string) => {
  const start = html.indexOf(`data-todo-row="${id}"`);
  const next = html.indexOf("data-todo-row=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

describe("the assistant's 待办", () => {
  it("has three groups in order, 最近做完 folded with its count", () => {
    const html = render(TODO);
    const labels = ["接下来", "在办", "最近做完"].map((l) => html.indexOf(l));
    expect(labels.every((i) => i > -1)).toBe(true);
    expect(labels).toEqual([...labels].sort((a, b) => a - b));
    expect(count(html, "data-todo-row=")).toBe(4);
    expect(html).not.toContain('data-todo-row="s-done"');
    expect(html).toContain('aria-expanded="false"');
    const recent = html.slice(html.indexOf('data-todo-group="recent"'));
    expect(recent).toContain(">1<");
  });

  it("draws a row as time, words, mark and state", () => {
    const html = render(TODO);
    const reminder = row(html, "sched_1");
    expect(reminder).toContain("今天 23:00");
    expect(reminder).toContain("提醒用户喝水");
    expect(reminder).toContain(">待提醒<");
    // The assistant's own carries no mark.
    expect(reminder).not.toContain(">手动<");
    expect(reminder).not.toContain(">Agent<");
    const form = row(html, "sched_news");
    expect(form).toContain("每天 08:00");
    expect(form).toContain(">手动<");
    expect(form).toContain(">待运行<");
    const agent = row(html, "sched_agent");
    expect(agent).toContain('title="claude-code 建的"');
    const sub = row(html, "s-sub");
    expect(sub).toContain(">等你回复<");
    expect(sub).toContain("text-warning");
  });

  it("makes a row with somewhere to go a button, and gives actions", () => {
    const html = render(TODO);
    // The reminder jumps to its reply; the agent's task goes nowhere.
    expect(row(html, "sched_1")).toContain('<button type="button"');
    expect(row(html, "sched_agent")).not.toContain(
      'class="flex min-w-0 flex-1 items-center gap-3 rounded-sm',
    );
    // Cancel for every task to come; pause and edit for the form's
    // repeating one; nothing on a subtask.
    expect(row(html, "sched_1")).toContain('aria-label="取消"');
    expect(row(html, "sched_1")).not.toContain('aria-label="暂停"');
    const form = row(html, "sched_news");
    for (const label of ["编辑", "暂停", "取消"]) {
      expect(form).toContain(`aria-label="${label}"`);
    }
    expect(row(html, "s-sub")).not.toContain('aria-label="取消"');
  });

  it("opens 最近做完 to its rows and says what was left out", () => {
    const html = render({ ...TODO, recentOmitted: 3 }, { recentOpen: true });
    const done = row(html, "s-done");
    expect(done).toContain(">已完成<");
    expect(done).toContain("昨天 09:00");
    expect(html).toContain("还有 3 件没有列出");
    expect(html).toContain('aria-expanded="true"');
  });

  it("leaves out an empty group", () => {
    const html = render({ ...TODO, active: [], recent: [] });
    expect(html).toContain("接下来");
    expect(html).not.toContain("在办");
    expect(html).not.toContain("最近做完");
  });

  it("is empty with a line, an example and 去跟它说 — once it was read", () => {
    const html = render(EMPTY_TODO);
    expect(html).toContain("它记下的提醒和派出去的活会出现在这里。");
    expect(html).toContain("明天早上 9 点提醒我开会");
    expect(html).toContain(">去跟它说<");
    expect(html).not.toContain("新建");
    // Before the first read: nothing, not a flash of the empty state.
    expect(render(EMPTY_TODO, { loaded: false })).toBe("");
  });

  it("speaks English", () => {
    const html = render(TODO, { language: "en-US" });
    for (const label of ["Coming up", "In progress", "Done lately", "Manual"]) {
      expect(html).toContain(label);
    }
    expect(render(EMPTY_TODO, { language: "en-US" })).toContain(
      ">Tell Galley<",
    );
  });
});
