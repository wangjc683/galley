import { describe, expect, it } from "vitest";

import { lastVisibleMessage } from "@/lib/assistant";
import { assistantLinePlan } from "@/lib/assistant-conversation";
import { copyForLanguage } from "@/lib/i18n";
import { buildRunGroups } from "@/lib/run-groups";
import {
  endsInSilentReport,
  hiddenReportTurns,
  SUBTASK_REPORT_SUPERVISOR,
} from "@/lib/subtasks";
import { todosByMessage } from "@/lib/todo-panel";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { makeMessageRow } from "@/test/factories";
import type { TodoItem } from "@/lib/assistant-todo";
import type { AgentTurn } from "@/types/conversation";
import type { MessageRow } from "@/types/db";

/*
 * Main chat ticket 110 (PRD ruling 155): a morning review that finds a
 * to-do it got something done for, with nothing of it in its notes yet,
 * adds that line and has nothing new to tell — a woken round whose steps
 * are `todo show` and `todo update --notes=…` and whose reply is only
 * `<no-reply/>` (the eval's `review-done-not-noted`). The desktop draws
 * none of it, as it draws nothing of a woken round that only dispatched
 * (ruling 125, ticket 76): no steps, no reply, no card; the sidebar's last
 * message is the reply before it.
 */

const MAIN_CHAT = "s-main";
const HILTON = "todo_4c8e1a7d2b9f3605";
const EARLIER_REPLY =
  "希尔顿那件我先做了一份资料收集模板，你拿到业主那边的资料照着填就行。";
const REPLY_ID = `msg_${MAIN_CHAT}_43_assistant`;

const at = (hour: number, minute = 0, second = 0) =>
  new Date(2026, 9, 29, hour, minute, second).toISOString();

const codeRun = (script: string, output: string) => ({
  tool_calls: JSON.stringify([{ toolName: "code_run", args: { script } }]),
  tool_results: JSON.stringify([{ content: output }]),
});

const noTool = {
  tool_calls: JSON.stringify([{ toolName: "no_tool", args: {} }]),
  tool_results: JSON.stringify([{ content: "" }]),
};

function reviewRows(): MessageRow[] {
  const row = (overrides: Partial<MessageRow>) =>
    makeMessageRow({ session_id: MAIN_CHAT, ...overrides });
  return [
    row({
      id: `msg_${MAIN_CHAT}_40_user`,
      role: "user",
      turn_index: 40,
      sequence: 0,
      content: "[Galley — not a message from the user] A subtask you started …",
      created_via: "system",
      supervisor: SUBTASK_REPORT_SUPERVISOR,
      origin_note: "s-mgv8h2k5-3n7q1x4z",
      created_at: at(0, 0),
    }),
    row({
      id: `msg_${MAIN_CHAT}_40_assistant`,
      role: "assistant",
      turn_index: 40,
      content: EARLIER_REPLY,
      final_answer: EARLIER_REPLY,
      summary: "转告模板做好了",
      ...noTool,
      created_at: at(0, 0, 20),
    }),
    row({
      id: `msg_${MAIN_CHAT}_41_user`,
      role: "user",
      turn_index: 41,
      sequence: 0,
      content:
        "[Galley — not a message from the user] It is time for the morning review. …",
      created_via: "system",
      supervisor: SUBTASK_REPORT_SUPERVISOR,
      origin_note: "sched_review",
      created_at: at(8, 51),
    }),
    row({
      id: `msg_${MAIN_CHAT}_41_assistant`,
      role: "assistant",
      turn_index: 41,
      content: "<summary>读了希尔顿那件：备注里还没有模板那一行。</summary>",
      summary: "读了希尔顿那件：备注里还没有模板那一行。",
      ...codeRun(
        `galley todo show ${HILTON}`,
        '{"todo": {"notes": "收集要点：…"}}',
      ),
      created_at: at(8, 51, 20),
    }),
    row({
      id: `msg_${MAIN_CHAT}_42_assistant`,
      role: "assistant",
      turn_index: 42,
      content: "<summary>在备注最前面补了模板那一行。</summary>",
      summary: "在备注最前面补了模板那一行。",
      ...codeRun(
        `galley todo update ${HILTON} --notes="10月29日：资料收集模板做好了：…\n收集要点：…"`,
        '{"todo": {"id": "todo_4c8e1a7d2b9f3605"}}',
      ),
      created_at: at(8, 51, 40),
    }),
    row({
      id: REPLY_ID,
      role: "assistant",
      turn_index: 43,
      content:
        "<summary>补了希尔顿的进展，没有新东西要说。</summary>\n<no-reply/>",
      final_answer: null,
      summary: "补了希尔顿的进展，没有新东西要说。",
      ...noTool,
      created_at: at(8, 52),
    }),
  ];
}

describe("a morning review that only adds a line to a to-do's notes", () => {
  it("is a silent round: nothing drawn, no card, the reply before it stays the last message", () => {
    const turns = rowsToTurns(reviewRows());
    expect(turns.map((t) => t.role)).toEqual([
      "user",
      "agent",
      "user",
      "agent",
      "agent",
      "agent",
    ]);
    const closing = turns[5] as AgentTurn;
    expect(closing.messageId).toBe(REPLY_ID);
    expect(closing.silent).toBe(true);
    expect(closing.files ?? []).toEqual([]);
    const plan = assistantLinePlan(
      buildRunGroups(turns, { splitAfterAnswer: true }),
      turns,
      null,
    );
    // The reply the subtask's report got, and nothing of the review.
    expect([...plan.message]).toEqual([1]);
    expect(plan.flat.size).toBe(0);
    expect(plan.steps.size).toBe(0);
    expect(plan.question.size).toBe(0);
    expect(plan.reports.get(0)).toBe(1);
    expect(plan.reports.has(2)).toBe(false);
    expect([...hiddenReportTurns(turns)].sort()).toEqual([0, 2, 3, 4, 5]);
    expect(endsInSilentReport(turns)).toBe(true);
    expect(lastVisibleMessage(turns, copyForLanguage("zh-CN"))?.text).toBe(
      EARLIER_REPLY,
    );
  });

  it("hangs no to-do card on the review: an updated to-do keeps the card of the turn that noted it", () => {
    const hilton = {
      kind: "todo",
      id: HILTON,
      text: "希尔顿酒店项目上下文资料收集",
      state: "open",
      createdBy: "assistant",
      notes: "10月29日：资料收集模板做好了：…\n收集要点：…",
      createdIn: { sessionId: MAIN_CHAT, turnIndex: 30 },
      createdAt: "2026-10-28T09:44:00+00:00",
    } as TodoItem;
    const cards = todosByMessage([hilton], MAIN_CHAT);
    expect([...cards.keys()]).toEqual([`msg_${MAIN_CHAT}_30_assistant`]);
    expect(cards.has(REPLY_ID)).toBe(false);
  });
});
