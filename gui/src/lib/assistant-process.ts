import type { BrowserSiteResolver } from "@/lib/browser-site";
import { fileName } from "@/lib/local-file-path";
import {
  isEchoNarrationStep,
  stepMarkerLine,
  stepMarkerSummary,
  type StepMarkerWords,
} from "@/lib/step-heading";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
} from "@/types/conversation";

/*
 * The assistant's process card (main chat PRD ruling 69; spec:
 * docs/design/conversation.md 「助手的对话」 → 过程): the steps of a settled
 * reply, one line a step — the step marker's sentence and, after it in
 * a lighter ink, what the step touched (a website, a file name). The
 * card draws them (components/conversation/AssistantProcessCard.tsx);
 * the rules are here.
 */

/** Step rows the card shows before it scrolls. Ruling 69 set it at the
 * p75 of the 194 managed rounds of two steps or more (median 4, p75 8,
 * p90 11, at most 52): three rounds in four need no scrolling. */
export const ASSISTANT_PROCESS_ROWS = 8;

const BROWSER_TOOLS = new Set(["web_scan", "web_execute_js"]);
const FILE_TOOLS = new Set(["file_read", "file_write", "file_patch"]);

/** The tools a step shows: every one but GA's `no_tool` placeholder and
 * `ask_user` (its question is a message of its own). */
function shownTools(turn: AgentTurn): ConversationToolEvent[] {
  return turn.tools.filter(
    (tool) => tool.name !== "no_tool" && tool.name !== "ask_user",
  );
}

/**
 * The run's steps that get a row, in order: every agent turn of the run
 * but its answer (the closing turn, which is the reply itself) and a
 * step that did nothing but ask (its question and the user's answer stay
 * in the conversation as messages). A step that asked and also ran a
 * tool keeps its row, for that tool.
 */
export function assistantProcessSteps(
  members: readonly number[],
  turns: readonly Turn[],
  answerIndex: number,
): number[] {
  return members.filter((i) => {
    const turn = turns[i];
    if (i === answerIndex || turn?.role !== "agent") return false;
    const asked = turn.tools.some((tool) => tool.name === "ask_user");
    return !asked || shownTools(turn).length > 0;
  });
}

/**
 * What a step touched, in tool order, each once:
 *
 *   web_scan, web_execute_js     the site, as the tool pill resolves it
 *                                (lib/browser-site.ts): its host, else
 *                                the page title a scan read; nothing
 *                                when the tab is unknown, and nothing
 *                                for a step that only listed tabs.
 *   file_read, file_write,       the file's name without its folders:
 *   file_patch                   the path the bridge resolved, else the
 *                                path argument.
 *
 * Other tools (`code_run` and the rest) name nothing, and a denied tool
 * touched nothing.
 */
export function assistantStepObjects(
  turn: AgentTurn,
  resolveSite: BrowserSiteResolver | null,
): string[] {
  const objects: string[] = [];
  for (const tool of shownTools(turn)) {
    if (tool.status === "denied") continue;
    let object: string | null = null;
    if (BROWSER_TOOLS.has(tool.name)) {
      const preview = resolveSite?.(tool) ?? null;
      if (preview?.kind === "site") object = preview.host ?? preview.title;
    } else if (FILE_TOOLS.has(tool.name)) {
      const arg = tool.args?.path;
      const path =
        tool.resolvedPath ?? (typeof arg === "string" ? arg.trim() : "");
      if (path) object = fileName(path);
    }
    if (object && !objects.includes(object)) objects.push(object);
  }
  return objects;
}

/** One step as the card draws it: its row, and what opening it shows. */
export interface AssistantStep {
  /** The step marker's words, on one line. */
  sentence: string;
  /** What it touched (`assistantStepObjects`). The row writes the first,
   * then 「+N」 for the rest. */
  objects: string[];
  /** Narration the step marker draws as a row of its own (the model
   * wrote its own summary, so the sentence is not the narration). */
  narration: string | null;
  /** The tools, drawn as the step region draws them. */
  tools: ConversationToolEvent[];
  /** The marker's disclosure: the step's reasoning and preamble. */
  thinking?: string;
  preamble?: string;
  /** Anything to open: a row without it is no control. */
  hasDetail: boolean;
}

function inline(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A step's row and detail, from the same rules as the step marker
 * (lib/step-heading.ts; AgentTurnView): the narration on an echo step,
 * GA's summary when the model wrote one, 「调用了 X」 when the summary
 * only echoes. A bare step (GA wrote no summary at all, so its marker
 * row merges into its tool pill) falls back to 「调用了 X」 too: the row
 * needs words. The detail is what the step region drew under the marker
 * (its own narration row, its tools) and what the marker's caret opened
 * (reasoning, preamble), with the same dedupe of a preamble that only
 * repeats the narration.
 */
export function assistantStep(
  turn: AgentTurn,
  words: StepMarkerWords,
  resolveSite: BrowserSiteResolver | null,
): AssistantStep {
  const tools = shownTools(turn);
  const names = tools.map((tool) => tool.name);
  const prose =
    (turn.finalAnswer ?? "").trim() !== "" ? turn.finalAnswer : null;
  const closingShaped = tools.length === 0;
  const markerSummary = stepMarkerSummary(turn.summary, prose, names, words);
  const narrationIsHeading = isEchoNarrationStep({
    hasMarker: true,
    closingShaped,
    narration: prose,
    summary: turn.summary,
  });
  const line = inline(stepMarkerLine(markerSummary, prose, narrationIsHeading));
  const sentence =
    line ||
    (names.length > 0 ? words.stepCalledTools(names) : words.stepDirectAnswer);
  const narration =
    prose && !closingShaped && !narrationIsHeading ? prose : null;
  const preambleRepeats =
    !closingShaped &&
    inline(prose) !== "" &&
    inline(prose) === inline(turn.preamble);
  const preamble = preambleRepeats ? undefined : turn.preamble || undefined;
  const thinking = turn.thinking || undefined;
  return {
    sentence,
    objects: assistantStepObjects(turn, resolveSite),
    narration,
    tools,
    thinking,
    preamble,
    hasDetail:
      tools.length > 0 || narration !== null || Boolean(thinking || preamble),
  };
}
