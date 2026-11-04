import {
  SUBTASK_REPORT_SUPERVISOR,
  type SubtaskDispatch,
} from "@/lib/subtasks";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/*
 * The main chat's rounds that ruling 197 (ticket 146) tells apart, as the
 * page holds them: turns, and the dispatch records saying which reply
 * sent which subtask off. A wake is Core's report row (`via: system`,
 * `supervisor: galley-report`), its reason the ids it covers — a
 * subtask's session id, or a reminder's or the daily review's `sched_…`
 * task. Message ids follow Core's `msg_${session}_${turn}_${role}`, so a
 * record's `messageId` finds its reply.
 */

export const MAIN_CHAT = "s-main";

const replyId = (turn: number) => `msg_${MAIN_CHAT}_${turn}_assistant`;

function tool(name: string): ConversationToolEvent {
  return { id: `t-${name}`, name, status: "success-historical" };
}

/** Your message, opening a round (`interjected`: said while one ran). */
export function you(
  text: string,
  turn: number,
  extra: Partial<UserTurn> = {},
): UserTurn {
  return {
    role: "user",
    content: text,
    messageId: `msg_${MAIN_CHAT}_${turn}_user`,
    origin: { via: "gui" },
    ...extra,
  };
}

/** Core's report row, waking the main chat for `reason`. */
export function wake(reason: string, turn: number): UserTurn {
  return {
    role: "user",
    content: "[Galley — not a message from the user] …",
    messageId: `msg_${MAIN_CHAT}_${turn}_user`,
    origin: {
      via: "system",
      supervisor: SUBTASK_REPORT_SUPERVISOR,
      reason,
    },
  };
}

/** A step that called a tool, its summary GA's two halves. */
export function toolStep(summary: string, turn: number): AgentTurn {
  return {
    role: "agent",
    messageId: replyId(turn),
    summary,
    finalAnswer: null,
    tools: [tool("code_run")],
  };
}

/** A closing reply: words, or (`silent`) `<no-reply/>`. */
export function reply(
  text: string,
  turn: number,
  extra: Partial<AgentTurn> = {},
): AgentTurn {
  return {
    role: "agent",
    messageId: replyId(turn),
    finalAnswer: text,
    tools: [tool("no_tool")],
    ...extra,
  };
}

/** The record of `sessionId` sent off by the reply at `turn`. */
export function dispatched(
  sessionId: string,
  turn: number,
  ordinal = 0,
): SubtaskDispatch {
  return {
    parentSessionId: MAIN_CHAT,
    turnIndex: turn,
    ordinal,
    messageId: replyId(turn),
    sessionId,
    title: sessionId,
    failure: null,
    failureDetail: null,
    createdAt: "2026-11-04T07:55:00.000Z",
  };
}

export interface Rounds {
  turns: Turn[];
  dispatches: SubtaskDispatch[];
}

/** You asked for a comparison split three ways; it sent two off
 * (turn 2). */
export const yourRound = (): Rounds => ({
  turns: [
    you("比较这两款手机，拆开分头查，回来合成一张表", 1),
    reply("好，我派两个人分头查，回来合成一张表。", 2),
  ],
  dispatches: [dispatched("s-phone-a", 2, 0), dispatched("s-phone-b", 2, 1)],
});

/** The morning review woke it and it sent one off, saying nothing
 * (turns 10–12). */
export const reviewRound = (): Rounds => ({
  turns: [
    wake("sched_review", 10),
    toolStep("读了待办；周六的船票还没订，交给子任务去查", 11),
    reply("", 12, { finalAnswer: null, silent: true }),
  ],
  dispatches: [dispatched("s-ferry", 12)],
});

/** `rounds` one after another, their records together. */
export function after(...rounds: Rounds[]): Rounds {
  return {
    turns: rounds.flatMap((r) => r.turns),
    dispatches: rounds.flatMap((r) => r.dispatches),
  };
}
