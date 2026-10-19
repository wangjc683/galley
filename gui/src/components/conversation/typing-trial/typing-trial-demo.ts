/**
 * TEMPORARY — 票 55 临时切换器，定档后由拆除票删掉 (see typing-trial.ts).
 *
 * Three display-only demos for the pill, so both tiers can be compared on
 * one script. Each plays into the main chat through the page's own data
 * path: the composer's echo of a send (`appendUserTurn`) and Core's
 * broadcast of the persisted row (`applyUserMessagePersisted`; for a
 * woken round the report row Core writes), then the runner's events as
 * they reach the page (`dispatchIPCEvent`: turn_start, turn_progress,
 * turn_end, run_complete). The conversation, the header and the card
 * read the result as they read a real round. Nothing is written to the
 * database or sent to a model: the store and the in-memory session row
 * are put back as they were when it ends (played out, or stopped).
 *
 *   1  a round you start: your 「明天早上 9 点提醒我喝水」, two tool steps
 *      (their summaries, no narration — the main model's habit), the
 *      reply streams and lands; about 20 seconds with the look after.
 *   2  a round Core woke it for: the report row, one tool step, the reply
 *      streams and lands; about 10 seconds.
 *   3  the same, saying nothing (`<no-reply/>`); about 10 seconds.
 *
 * What differs from a real round: no reminder card under demo 1's reply
 * (it would have to exist in Core); `bumpSessionAfterTurn` (turn_end's
 * in-memory mirror of Core's session bump) runs and is put back. A real
 * event for the main chat during a demo (a wake, a reminder) lands in
 * the same slice; when that happened the conversation is read again from
 * Core once the demo ends.
 */
import type { ResolvedLanguage } from "@/lib/language";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { clearReplyNotifyPending } from "@/lib/notify";
import { SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { type PerSessionMessages, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import type { IPCEvent, ToolCall, ToolResult } from "@/types/ipc";
import type { Session } from "@/types/session";

import { type TypingDemoId, useTypingTrialStore } from "./typing-trial";

/** One beat of a script: when it reaches the page (ms from the start). */
export interface TypingDemoBeat {
  at: number;
  label: string;
  run: () => void;
}

export interface TypingDemoScript {
  beats: TypingDemoBeat[];
  /** When it ends and the conversation goes back. */
  endAt: number;
}

interface DemoCopy {
  ask: string;
  stepOne: string;
  stepTwo: string;
  reply: string[];
  report: string;
  wakeStep: string;
  wakeReply: string[];
  silentStep: string;
  /** The closing step's summary (GA's own words for it). */
  answered: string;
}

const COPY: Record<ResolvedLanguage, DemoCopy> = {
  "zh-CN": {
    ask: "明天早上 9 点提醒我喝水",
    stepOne: "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。",
    stepTwo: "已建好明天 9:00 的提醒。",
    reply: ["好的，", "明天早上 ", "9 点", "提醒你", "喝水。"],
    report: "子任务汇报（演示）",
    wakeStep: "读到子任务的汇报：喝水提醒到点了。",
    wakeReply: ["该喝水啦，", "记得喝", "点水 💧"],
    silentStep: "子任务交回的结果缺了确认号，打回去重查。",
    answered: "直接回答了用户问题",
  },
  "en-US": {
    ask: "Remind me to drink water at 9 tomorrow morning",
    stepOne:
      "Local time is Oct 19, 10:34; checking for an existing water reminder first, to avoid a duplicate.",
    stepTwo: "Set the reminder for 9:00 tomorrow.",
    reply: [
      "Sure, ",
      "I'll remind you ",
      "to drink water ",
      "at 9 ",
      "tomorrow morning.",
    ],
    report: "Subtask report (demo)",
    wakeStep: "Read the subtask's report: the water reminder is due.",
    wakeReply: ["Time for ", "some water ", "💧"],
    silentStep:
      "The subtask's result is missing the confirmation number; sending it back.",
    answered: "Answered the user directly",
  },
};

/** What the composer says while a demo plays (it is off). */
export function typingDemoComposerPlaceholder(
  language: ResolvedLanguage,
): string {
  return language === "en-US"
    ? "Demo: display only — nothing is saved or sent to the model"
    : "演示只换显示：不写进对话，也不发给模型";
}

/** Rows a demo writes sit far past the session's own turn indices, so
 * their message ids never meet a real row's (a reminder or subtask card
 * keyed by one would show under the demo's reply). */
const DEMO_TURN_BASE = 9_000_000;

let plays = 0;

function iso(): string {
  return new Date().toISOString();
}

/**
 * A demo's beats for the main chat `sessionId`. Each play gets its own
 * ids (rows from two plays never share a key).
 */
export function typingDemoScript(
  demo: TypingDemoId,
  sessionId: string,
  language: ResolvedLanguage,
): TypingDemoScript {
  plays += 1;
  const tag = `t55-demo-${plays}`;
  const base = DEMO_TURN_BASE + plays * 10;
  const copy = COPY[language];
  const send = (event: IPCEvent) => () => dispatchIPCEvent(event);
  const turnStart = (turnIndex: number) =>
    send({ kind: "turn_start", sessionId, turnIndex, timestamp: iso() });
  const chunk = (delta: string) => () =>
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId,
      delta,
      source: "t55-demo",
      timestamp: iso(),
    });
  const turnEnd =
    (
      turnIndex: number,
      {
        summary,
        content,
        script,
        last = false,
        elapsedMs,
      }: {
        summary: string;
        content: string;
        script?: string;
        last?: boolean;
        elapsedMs: number;
      },
    ) =>
    () => {
      const toolCalls: ToolCall[] = script
        ? [{ toolName: "code_run", args: { script } }]
        : [];
      const toolResults: ToolResult[] = script ? [{ content: "ok" }] : [];
      dispatchIPCEvent({
        kind: "turn_end",
        sessionId,
        turnIndex,
        summary,
        toolCalls,
        toolResults,
        responseContent: content,
        exitReason: last ? { result: "CURRENT_TASK_DONE", data: null } : null,
        telemetry: { elapsedMs },
        absoluteTurnIndex: base + turnIndex,
        timestamp: iso(),
      });
    };
  const runComplete = (finalContent: string, totalTurns: number) => () =>
    dispatchIPCEvent({
      kind: "run_complete",
      sessionId,
      exitReason: { result: "CURRENT_TASK_DONE", data: null },
      finalContent,
      totalTurns,
      timestamp: iso(),
    });
  // Core's report row waking the main chat (main chat ticket 31), as its
  // broadcast reaches the page.
  const wake = () =>
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId,
      message: {
        id: `${tag}-report`,
        sessionId,
        role: "user",
        content: copy.report,
        createdAt: iso(),
        turnIndex: base,
        origin: {
          via: "system",
          supervisor: SUBTASK_REPORT_SUPERVISOR,
          reason: tag,
        },
      },
      dispatch: "dispatched",
    });
  const streamed = (pieces: string[], from: number, every: number) =>
    pieces.map((piece, i) => ({
      at: from + i * every,
      label: `chunk ${i + 1}`,
      run: chunk(piece),
    }));
  // GA's verbose display of a step, as the runner streams it: the turn's
  // header line, then for a tool step its summary, the dispatch marker
  // and the tool's output fence (all of it cleaned away on the page: a
  // tool step with no narration shows no words, the main model's habit).
  const stepHeader = (turnIndex: number, at: number): TypingDemoBeat => ({
    at,
    label: `step ${turnIndex} header`,
    run: chunk(`**LLM Running (Turn ${turnIndex}) ...**\n\n`),
  });
  const toolStream = (
    turnIndex: number,
    from: number,
    summary: string,
    script: string,
  ): TypingDemoBeat[] => [
    stepHeader(turnIndex, from),
    {
      at: from + 900,
      label: `step ${turnIndex} summary`,
      run: chunk(`<summary>${summary}</summary>\n`),
    },
    {
      at: from + 1500,
      label: `step ${turnIndex} dispatch`,
      run: chunk(
        `🛠️ Tool: \`code_run\`  📥 args:\n\`\`\`\`text\n${JSON.stringify({ script })}\n\`\`\`\`\n`,
      ),
    },
    {
      at: from + 2400,
      label: `step ${turnIndex} output`,
      run: chunk("`````\nok\n`````\n"),
    },
  ];
  const toolEnd = (
    turnIndex: number,
    summary: string,
    script: string,
    elapsedMs: number,
  ) =>
    turnEnd(turnIndex, {
      summary,
      content: `<summary>${summary}</summary>`,
      script,
      elapsedMs,
    });

  if (demo === 1) {
    const clientRequestId = `${tag}-send`;
    const reply = copy.reply.join("");
    const list = "galley reminder list --json";
    const add = "galley reminder add --at 09:00";
    return {
      beats: [
        {
          at: 0,
          label: "you send",
          run: () =>
            useMessagesStore
              .getState()
              .appendUserTurn(sessionId, copy.ask, clientRequestId),
        },
        {
          at: 300,
          label: "persisted",
          run: () =>
            useMessagesStore.getState().applyUserMessagePersisted({
              sessionId,
              message: {
                id: `${tag}-user`,
                sessionId,
                role: "user",
                content: copy.ask,
                createdAt: iso(),
                turnIndex: base,
              },
              dispatch: "dispatched",
              clientRequestId,
            }),
        },
        { at: 1200, label: "step 1 starts", run: turnStart(1) },
        ...toolStream(1, 2600, copy.stepOne, list),
        {
          at: 6200,
          label: "step 1 settles",
          run: toolEnd(1, copy.stepOne, list, 5000),
        },
        { at: 6400, label: "step 2 starts", run: turnStart(2) },
        ...toolStream(2, 7600, copy.stepTwo, add),
        {
          at: 11400,
          label: "step 2 settles",
          run: toolEnd(2, copy.stepTwo, add, 5000),
        },
        { at: 11600, label: "step 3 starts", run: turnStart(3) },
        stepHeader(3, 12200),
        ...streamed(copy.reply, 12600, 450),
        {
          at: 15200,
          label: "reply settles",
          run: turnEnd(3, {
            summary: copy.answered,
            content: reply,
            last: true,
            elapsedMs: 3600,
          }),
        },
        { at: 15400, label: "run complete", run: runComplete(reply, 3) },
      ],
      endAt: 20_000,
    };
  }

  const read = "galley session read --json";
  if (demo === 2) {
    const reply = copy.wakeReply.join("");
    return {
      beats: [
        { at: 0, label: "report row", run: wake },
        { at: 900, label: "step 1 starts", run: turnStart(1) },
        ...toolStream(1, 1400, copy.wakeStep, read),
        {
          at: 4200,
          label: "step 1 settles",
          run: toolEnd(1, copy.wakeStep, read, 3300),
        },
        { at: 4400, label: "step 2 starts", run: turnStart(2) },
        stepHeader(2, 4800),
        ...streamed(copy.wakeReply, 5200, 500),
        {
          at: 7000,
          label: "reply settles",
          run: turnEnd(2, {
            summary: copy.answered,
            content: reply,
            last: true,
            elapsedMs: 2600,
          }),
        },
        { at: 7200, label: "run complete", run: runComplete(reply, 2) },
      ],
      endAt: 10_000,
    };
  }

  return {
    beats: [
      { at: 0, label: "report row", run: wake },
      { at: 900, label: "step 1 starts", run: turnStart(1) },
      ...toolStream(1, 1400, copy.silentStep, read),
      {
        at: 4200,
        label: "step 1 settles",
        run: toolEnd(1, copy.silentStep, read, 3300),
      },
      { at: 4400, label: "step 2 starts", run: turnStart(2) },
      stepHeader(2, 4800),
      { at: 5200, label: "chunk 1", run: chunk("<no-") },
      { at: 5600, label: "chunk 2", run: chunk("reply/>") },
      {
        at: 6400,
        label: "silent reply settles",
        run: turnEnd(2, {
          summary: copy.answered,
          content: "<no-reply/>",
          last: true,
          elapsedMs: 2000,
        }),
      },
      { at: 6600, label: "run complete", run: runComplete("<no-reply/>", 2) },
    ],
    endAt: 10_000,
  };
}

/** The session row fields turn_end's in-memory bump touches. */
type BumpedFields = Pick<
  Session,
  | "turnCount"
  | "summary"
  | "lastStepIndex"
  | "lastActivityAt"
  | "updatedAt"
  | "hasUnread"
>;

function bumpedFields(session: Session): BumpedFields {
  return {
    turnCount: session.turnCount,
    summary: session.summary,
    lastStepIndex: session.lastStepIndex,
    lastActivityAt: session.lastActivityAt,
    updatedAt: session.updatedAt,
    hasUnread: session.hasUnread,
  };
}

/** A demo being played: its beats on timers, and what it puts back. */
export interface TypingDemoPlayback {
  /** Runs the beats up to `index` now (a harness steps them by hand). */
  runThrough: (index: number) => void;
  /** Ends it: timers off, the conversation and the session row back. */
  stop: () => void;
  script: TypingDemoScript;
}

/**
 * Plays `demo` into the main chat `sessionId` (on timers unless
 * `manual`), and calls `onEnd` once it has put everything back. A beat
 * that would land while the main chat is no longer the active session
 * ends the demo instead (turn_end would mark it unread in Core).
 */
export function playTypingDemo({
  sessionId,
  demo,
  language,
  onEnd,
  onBeat,
  manual = false,
}: {
  sessionId: string;
  demo: TypingDemoId;
  language: ResolvedLanguage;
  onEnd?: () => void;
  onBeat?: (label: string) => void;
  manual?: boolean;
}): TypingDemoPlayback {
  const script = typingDemoScript(demo, sessionId, language);
  const messagesBefore: PerSessionMessages | undefined =
    useMessagesStore.getState().byId[sessionId];
  const sessionBefore = useSessionsStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  const fieldsBefore = sessionBefore ? bumpedFields(sessionBefore) : null;
  // A stale reply flag would turn the demo's reply into a notification.
  clearReplyNotifyPending(sessionId);

  // Writes to the slice that are not the demo's own: a real event.
  let own = false;
  let foreign = false;
  const unsubscribe = useMessagesStore.subscribe((state, previous) => {
    if (!own && state.byId[sessionId] !== previous.byId[sessionId]) {
      foreign = true;
    }
  });

  const timers: ReturnType<typeof setTimeout>[] = [];
  let next = 0;
  let ended = false;

  const stop = () => {
    if (ended) return;
    ended = true;
    for (const id of timers) clearTimeout(id);
    unsubscribe();
    useMessagesStore.setState((state) => {
      const byId = { ...state.byId };
      if (messagesBefore) byId[sessionId] = messagesBefore;
      else delete byId[sessionId];
      return { byId };
    });
    if (fieldsBefore) {
      useSessionsStore.setState((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, ...fieldsBefore } : s,
        ),
      }));
    }
    if (foreign)
      void useMessagesStore.getState().restoreSessionTurns(sessionId);
    onEnd?.();
  };

  const runThrough = (index: number) => {
    while (!ended && next <= index && next < script.beats.length) {
      if (useSessionsStore.getState().activeSessionId !== sessionId) {
        stop();
        return;
      }
      const beat = script.beats[next];
      next += 1;
      own = true;
      try {
        beat.run();
      } finally {
        own = false;
      }
      onBeat?.(beat.label);
    }
  };

  if (!manual) {
    script.beats.forEach((beat, index) => {
      timers.push(setTimeout(() => runThrough(index), beat.at));
    });
    timers.push(setTimeout(stop, script.endAt));
  }
  return { runThrough, stop, script };
}

let current: TypingDemoPlayback | null = null;

/** The pill's 「演示 N」: ends whatever plays, then plays `demo`. */
export function startTypingDemo(
  sessionId: string,
  demo: TypingDemoId,
  language: ResolvedLanguage,
): void {
  stopTypingDemo();
  useTypingTrialStore.setState({ demo });
  const playback = playTypingDemo({
    sessionId,
    demo,
    language,
    onEnd: () => {
      if (current !== playback) return;
      current = null;
      useTypingTrialStore.setState({ demo: null });
    },
  });
  current = playback;
}

/** Ends the demo playing, if any (the pill's second click, leaving the
 * main chat). */
export function stopTypingDemo(): void {
  current?.stop();
}
