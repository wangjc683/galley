import { isSubtaskReportTurn } from "@/lib/subtasks";
import type { Turn } from "@/types/conversation";

/**
 * What the assistant's face shows (main chat PRD ruling 117, ticket 65):
 * the avatar is a character with a face — a wooden robot, two eyes and a
 * mouth, its tongue curling into the G — and the face follows what the
 * assistant is doing. Every expression stands for one thing the page
 * already knows; nothing is acted that is not happening.
 *
 * Two kinds of state:
 *
 *   - an activity lasts while its cause does (it is busy in a tool, it
 *     writes words, it waits for you): FaceActivity, chosen by
 *     `faceActivity` in ruling 117's order — waiting for your answer >
 *     an error > writing a reply > doing something > thinking;
 *   - a reaction plays once and goes back to the activity (you sent a
 *     message, a round finished, a reminder woke it): FaceReaction.
 *
 * How each looks and moves is lib/assistant-face-motion.ts; when what
 * plays is lib/assistant-face-director.ts. Everything here is pure.
 */

/** What lasts while its cause does. */
export type FaceActivity =
  /** At rest. 乙 holds still; 丙 blinks now and then. */
  | "idle"
  /** Running, between steps or before the first: thinking. */
  | "think"
  /** A browser tool runs: reading a web page. */
  | "browse"
  /** `file_read` runs: reading a file. */
  | "read"
  /** It writes something down: a file, a to-do, a reminder, memory. */
  | "note"
  /** Any other code it runs: doing the work by hand. */
  | "work"
  /** Words of a reply stream: talking. */
  | "talk"
  /** It is idle while a subtask it sent off runs: waiting for it. */
  | "awaitSubtask"
  /** It asked you something (or a subtask did): waiting for you. */
  | "ask"
  /** It or a subtask stopped on an error. */
  | "error"
  /** 丙 only: long without you, or late at night — dozing. */
  | "doze";

/** What plays once, then the face goes back to its activity. */
export type FaceReaction =
  /** You sent it a message (or queued one). */
  | "sent"
  /** You are typing in its composer. */
  | "listen"
  /** The pointer came onto it. */
  | "look"
  /** A file or an image is dragged in over its conversation. */
  | "drop"
  /** You pressed stop. */
  | "stop"
  /** A round finished with a reply. */
  | "done"
  /** A reply sent a subtask off. */
  | "dispatch"
  /** A subtask's report woke it. */
  | "subtaskBack"
  /** A reminder it set came due and woke it. */
  | "wakeReminder"
  /** 丙: you touched it while it dozed. */
  | "wake"
  /** It started waiting for your answer. */
  | "askEnter"
  /** It hit an error. */
  | "errorEnter";

// ---- Which tool is running -------------------------------------------------

/** The kind of work a tool call is, for the face. */
export type ToolKind = "browse" | "read" | "note" | "work" | "think";

/** GA's browser tools: Galley's browser control drives the user's own
 * browser through these two (managed-ga/code/ga.py `do_web_scan`,
 * `do_web_execute_js`). */
const BROWSE_TOOLS = new Set(["web_scan", "web_execute_js"]);
/** Writing something down: a file, a patch to one, the long-term memory
 * (`start_long_term_update` opens GA's memory update). */
const NOTE_TOOLS = new Set([
  "file_write",
  "file_patch",
  "start_long_term_update",
]);

/**
 * A Galley CLI write that notes something for the user: `galley todo
 * add / update / done / reopen / cancel` and `galley schedule create /
 * update / delete / enable / disable` (docs/agent-api todo-commands,
 * schedule-commands), as the main chat writes them in `code_run` — a
 * shell line (`"$GALLEY" todo add …`) or a Python argument list
 * (`[cli, 'todo', 'add', …]`), seen through GA's JSON of the arguments,
 * where a double quote is escaped. `list`, `show` and `schedule run` are
 * no note.
 */
const GALLEY_WRITE =
  /(?:^|[^\w-])(?:todo[\s'"\\,]{1,8}(?:add|update|done|reopen|cancel)|schedule[\s'"\\,]{1,8}(?:create|update|delete|enable|disable))\b/;

/**
 * The face for a tool call (ticket 65's table): browser tools look at a
 * page, `file_read` reads, writing a file or the memory and a Galley
 * to-do or reminder write notes, any other `code_run` works by hand.
 * Anything else — `update_working_checkpoint` (its own working notes),
 * `ask_user` (its face is the question's), `no_tool`, a name this list
 * does not know — is thinking.
 */
export function classifyTool(name: string, args: string): ToolKind {
  if (BROWSE_TOOLS.has(name)) return "browse";
  if (name === "file_read") return "read";
  if (NOTE_TOOLS.has(name)) return "note";
  if (name === "code_run") {
    return /galley/i.test(args) && GALLEY_WRITE.test(args) ? "note" : "work";
  }
  return "think";
}

/** GA's dispatch line in verbose mode (managed-ga/code/agent_loop.py:78,
 * which the bridge forwards: its fence filter drops only the tool's
 * five-backtick output): the tool's name, then its arguments as JSON in
 * a four-backtick block, the closing fence once they are all there. */
const VERBOSE_DISPATCH =
  /🛠️?\s+Tool:\s+`([^`\n]+)`[^\n]*(?:\n````text\n([\s\S]*?)(?:\n````|$))?/g;
/** The compact form (agent_loop.py:79), `🛠️ name(args)`. */
const COMPACT_DISPATCH = /🛠️?\s+(\w+)\(([^\n]*)/g;

/** A tool call the stream shows: its name and its arguments' text. */
export interface LiveToolCall {
  name: string;
  args: string;
}

/**
 * The tool this step is running, from the step's raw stream (messages
 * `inFlightContent`): the last dispatch line in it, or null before any.
 * GA prints the line just before it dispatches the call and the stream
 * keeps it until the step's turn_end clears the buffer, so while a tool
 * runs this is that tool. (The runner's protocol has a `tool_call_start`
 * event, but the bridge never sends it; the dispatch line is what the
 * page has.)
 */
export function liveToolCall(inFlightContent: string): LiveToolCall | null {
  if (!inFlightContent || !inFlightContent.includes("🛠")) return null;
  let last: { at: number; call: LiveToolCall } | null = null;
  for (const re of [VERBOSE_DISPATCH, COMPACT_DISPATCH]) {
    re.lastIndex = 0;
    for (let m = re.exec(inFlightContent); m; m = re.exec(inFlightContent)) {
      if (!last || m.index > last.at) {
        last = { at: m.index, call: { name: m[1], args: m[2] ?? "" } };
      }
    }
  }
  return last?.call ?? null;
}

let toolCache: { inFlightContent: string; kind: ToolKind | null } | null = null;

/**
 * `classifyTool` of the live call, null with none. Kept for the last
 * stream: the driver's selector runs on every store write (each chunk),
 * and returning the same string re-renders nothing.
 */
export function liveToolKind(inFlightContent: string): ToolKind | null {
  if (toolCache?.inFlightContent === inFlightContent) return toolCache.kind;
  const call = liveToolCall(inFlightContent);
  const kind = call ? classifyTool(call.name, call.args) : null;
  toolCache = { inFlightContent, kind };
  return kind;
}

// ---- Which activity --------------------------------------------------------

export interface FaceActivityInput {
  /** It or one of its unpromoted subtasks waits for your answer
   * (`hasPendingAskUser`, useSessionsAttention's `ask`). */
  asking: boolean;
  /** It or one of its unpromoted subtasks stopped on an error. */
  erroring: boolean;
  /** The main chat's round runs. */
  running: boolean;
  /** Words of a reply stream right now (lib/assistant-conversation.ts
   * `assistantWriting`). */
  writing: boolean;
  /** The tool this step runs (`liveToolKind`), null with none. */
  tool: ToolKind | null;
  /** One of its unpromoted subtasks runs. */
  subtasksRunning: boolean;
  /** 丙: long without you, or late at night (`shouldDoze`). */
  dozing: boolean;
}

/**
 * The activity, in ruling 117's order: waiting for your answer > an
 * error > writing a reply > doing something > thinking. Not running, a
 * subtask still out is waited for; else it rests, or dozes (丙).
 *
 * Writing a reply is words streaming now, not 「the conversation shows
 * the typing bubble」: in a round you started the bubble stands for the
 * whole round (`assistantTyping`), so it would hide every tool's face;
 * in a round Core woke it for the two are the same (`assistantWriting`
 * is the bubble's own rule there).
 */
export function faceActivity(input: FaceActivityInput): FaceActivity {
  if (input.asking) return "ask";
  if (input.erroring) return "error";
  if (input.running) {
    if (input.writing) return "talk";
    if (input.tool && input.tool !== "think") return input.tool;
    return "think";
  }
  if (input.subtasksRunning) return "awaitSubtask";
  return input.dozing ? "doze" : "idle";
}

// ---- What woke it ----------------------------------------------------------

/** The task ids of a reminder that came due (Core `scheduler.rs`: a
 * scheduled task's id); a subtask's report names the subtask's session. */
const SCHEDULED_TASK_ID = /^sched_/;

/**
 * Why Core woke the main chat, for a round that opened on a report row
 * (lib/subtasks.ts `isSubtaskReportTurn`): the row's note lists the ids
 * it covers (Core `subtask_report.rs`, the row's `origin.reason`) — a
 * reminder that came due when they are all scheduled tasks, else a
 * subtask's report. Null when the latest user turn is not a report row.
 */
export function wakeKind(
  turns: readonly Turn[],
): "reminder" | "subtask" | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== "user") continue;
    if (!isSubtaskReportTurn(turn)) return null;
    const ids = (turn.origin?.reason ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return ids.length > 0 && ids.every((id) => SCHEDULED_TASK_ID.test(id))
      ? "reminder"
      : "subtask";
  }
  return null;
}

// ---- 丙: dozing ------------------------------------------------------------

/** 丙's dozing (ruling 117 point 4): after this long without you it
 * slowly closes its eyes. */
export const DOZE_AFTER_MS = 30 * 60_000;
/** Late at night, local time: from this hour… */
export const NIGHT_FROM_HOUR = 23;
/** …to this one, it dozes whenever it rests… */
export const NIGHT_TO_HOUR = 7;
/** …once you have left it alone this long (a touch wakes it; without
 * this it would close its eyes again the moment it woke). */
export const NIGHT_DOZE_AFTER_MS = 60_000;

/** Whether 丙 dozes: `idleMs` since your last touch, at `hour` (0–23,
 * local). */
export function shouldDoze(idleMs: number, hour: number): boolean {
  const night = hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR;
  return idleMs >= (night ? NIGHT_DOZE_AFTER_MS : DOZE_AFTER_MS);
}
