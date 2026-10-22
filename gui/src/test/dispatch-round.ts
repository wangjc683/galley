import { SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { makeMessageRow } from "@/test/factories";
import type { MessageRow } from "@/types/db";

/*
 * A main chat round that only dispatched a subtask, as Core persists it
 * (main chat PRD ruling 125, ticket 76): two `code_run` steps that wrote
 * only their summaries, then a closing reply that is the subtask tag and,
 * in the shape the daily review writes when it has no result yet,
 * `<no-reply/>` — `no_tool` its only tool, no final answer, a summary.
 * `woken`: Core's report row opens the round (`created_via: system`,
 * `supervisor: galley-report`, as subtask reports and the daily review
 * stamp it); otherwise it is the user's own message. An earlier exchange
 * comes first, so there is a reply before the round.
 */

const MAIN_CHAT = "s-main";

/** Local times on one day, so the breaks read the same in any zone. */
const dispatchAt = (hour: number, minute = 0, second = 0) =>
  new Date(2026, 9, 21, hour, minute, second).toISOString();

export const EARLIER_REPLY = "好，周六的船票我记下了。";
export const STEP_ONE_SUMMARY = "读了待办清单：周六的船票还没订。";
export const STEP_TWO_SUMMARY = "查余票要一阵子，交给子任务去查。";
export const DISPATCH_TAG =
  "<subtask>查周六上午厦门到鼓浪屿的船票余票</subtask>";

/** The closing reply's raw text. */
export function dispatchReply(noReply: boolean): string {
  return `<summary>派子任务查船票</summary>\n${DISPATCH_TAG}${noReply ? "\n<no-reply/>" : ""}`;
}

/** The closing reply's row id: the message id its subtask cards hang on
 * (Core's `msg_${sessionId}_${absoluteTurnIndex}_assistant`). */
export const DISPATCH_REPLY_ID = `msg_${MAIN_CHAT}_33_assistant`;

const codeRun = (script: string, output: string) => ({
  tool_calls: JSON.stringify([{ toolName: "code_run", args: { script } }]),
  tool_results: JSON.stringify([{ content: output }]),
});

const noTool = {
  tool_calls: JSON.stringify([{ toolName: "no_tool", args: {} }]),
  tool_results: JSON.stringify([{ content: "" }]),
};

export function dispatchRoundRows({
  woken,
  noReply = true,
}: {
  woken: boolean;
  noReply?: boolean;
}): MessageRow[] {
  const row = (overrides: Partial<MessageRow>) =>
    makeMessageRow({ session_id: MAIN_CHAT, ...overrides });
  return [
    row({
      id: `msg_${MAIN_CHAT}_30_user`,
      role: "user",
      turn_index: 30,
      sequence: 0,
      content: "周六去鼓浪屿，帮我盯一下船票",
      created_via: "gui",
      created_at: dispatchAt(9),
    }),
    row({
      id: `msg_${MAIN_CHAT}_30_assistant`,
      role: "assistant",
      turn_index: 30,
      content: EARLIER_REPLY,
      final_answer: EARLIER_REPLY,
      summary: "记下周六的船票",
      ...noTool,
      created_at: dispatchAt(9, 0, 8),
    }),
    woken
      ? row({
          id: `msg_${MAIN_CHAT}_31_user`,
          role: "user",
          turn_index: 31,
          sequence: 0,
          content: "[Galley — not a message from the user] …",
          created_via: "system",
          supervisor: SUBTASK_REPORT_SUPERVISOR,
          origin_note: "sched_review",
          created_at: dispatchAt(21, 27),
        })
      : row({
          id: `msg_${MAIN_CHAT}_31_user`,
          role: "user",
          turn_index: 31,
          sequence: 0,
          content: "船票帮我查一下还有没有",
          created_via: "gui",
          created_at: dispatchAt(21, 27),
        }),
    row({
      id: `msg_${MAIN_CHAT}_31_assistant`,
      role: "assistant",
      turn_index: 31,
      content: `<summary>${STEP_ONE_SUMMARY}</summary>`,
      summary: STEP_ONE_SUMMARY,
      ...codeRun("galley todo list", "周六 船票 未订"),
      created_at: dispatchAt(21, 27, 20),
    }),
    row({
      id: `msg_${MAIN_CHAT}_32_assistant`,
      role: "assistant",
      turn_index: 32,
      content: `<summary>${STEP_TWO_SUMMARY}</summary>`,
      summary: STEP_TWO_SUMMARY,
      ...codeRun("galley session list --json", "[]"),
      created_at: dispatchAt(21, 27, 40),
    }),
    row({
      id: DISPATCH_REPLY_ID,
      role: "assistant",
      turn_index: 33,
      content: dispatchReply(noReply),
      final_answer: null,
      summary: "派子任务查船票",
      ...noTool,
      created_at: dispatchAt(21, 28),
    }),
  ];
}
